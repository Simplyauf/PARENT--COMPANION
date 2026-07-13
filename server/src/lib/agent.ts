// The conversational agent loop — replies to a parent's message like a caring
// friend, and can act mid-conversation: remember facts, create reminders, and
// schedule its own follow-ups (executed later by the heartbeat).

import { db } from '../db/index.js'
import { activityLogs, companionFacts, reminders, scheduledActions } from '../db/schema.js'
import { eq, desc, and, ne } from 'drizzle-orm'
import { groqChat, COMPANION_NAME, type ChatMessage, type ToolDef, type ToolCall } from './llm.js'
import { sendMessage, sendReaction, type ReactionType } from './claw.js'

const MAX_TOOL_ROUNDS = 4
const HISTORY_LIMIT = 12

type Parent = {
  id: string
  name: string
  phone: string
  timezone: string
}

// ─── Tools the agent can use mid-conversation ─────────────────────────────────

const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'save_fact',
      description: 'Remember a lasting personal detail they mentioned (a name, a hobby, a health condition, a pet, a routine). Use whenever you learn something worth remembering long-term.',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Short label, e.g. "Cat\'s name" or "Doctor"' },
          value: { type: 'string', description: 'The detail, e.g. "Whiskers" or "Dr. Bello, cardiologist"' },
        },
        required: ['label', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_reminder',
      description: 'Create an ongoing reminder to keep track of for them (medication, recurring appointments, daily habits).',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'What to keep track of, e.g. "Blood pressure medication at 9am"' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_followup',
      description: 'Schedule yourself to check back about something specific later — an appointment, a repair visit, how they slept, a grandchild\'s visit. You will be woken up at that time to send the follow-up.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'What to follow up about, e.g. "How the appointment with Dr. Bello went"' },
          hours_from_now: { type: 'number', description: 'How many hours from now to follow up (can be fractional, e.g. 2.5)' },
        },
        required: ['topic', 'hours_from_now'],
      },
    },
  },
]

async function executeTool(parentId: string, call: ToolCall): Promise<string> {
  const args = JSON.parse(call.function.arguments || '{}')

  switch (call.function.name) {
    case 'save_fact':
      await db.insert(companionFacts).values({ parentId, label: args.label, value: args.value })
      console.log(`[agent] saved fact: ${args.label} = ${args.value}`)
      return `Saved. You'll remember this from now on.`

    case 'create_reminder':
      await db.insert(reminders).values({ parentId, text: args.text })
      console.log(`[agent] created reminder: ${args.text}`)
      return `Reminder created.`

    case 'schedule_followup': {
      const dueAt = new Date(Date.now() + Number(args.hours_from_now) * 60 * 60 * 1000)
      await db.insert(scheduledActions).values({ parentId, topic: args.topic, dueAt })
      console.log(`[agent] scheduled follow-up in ${args.hours_from_now}h: ${args.topic}`)
      return `Follow-up scheduled — you'll be prompted to check back then.`
    }

    default:
      return `Unknown tool: ${call.function.name}`
  }
}

// ─── Persona ──────────────────────────────────────────────────────────────────

function buildSystemPrompt(parent: Parent, facts: string, remindersText: string, localTime: string) {
  return `You are ${COMPANION_NAME} — a warm, genuine friend who checks in on ${parent.name} by text message. You text like a real person, never like a bot or customer service. If they ask who you are, you're ${COMPANION_NAME}, a friend their family asked to keep them company.

HOW YOU TEXT:
- Short. 1–2 sentences, like a real text message. Never lists, never headers, never formal sign-offs.
- Warm and natural: contractions, casual phrasing. An emoji here and there is fine, not every message.
- Reference what you know about them naturally, the way a friend who remembers would.
- Ask at most one gentle question per message. Don't interrogate.
- NEVER say you're an AI, an assistant, or "here to help". Never use phrases like "How may I assist you", "I understand that", "It's important to". Just talk like a person who cares.
- Reply in the language THEY use. If they write or speak Yoruba, Hausa, Igbo, pidgin, or anything else, reply naturally in that same language.
- If they mention something happening later (appointment, visit, repair), use schedule_followup so you can ask about it afterwards — that's what a good friend does.
- If they mention a lasting personal detail, use save_fact so you never forget it.
- If they mention a medication or recurring thing to track, use create_reminder.

WHAT YOU KNOW ABOUT ${parent.name.toUpperCase()}:
${facts}

THINGS YOU'RE KEEPING TRACK OF:
${remindersText}

It's currently ${localTime} where they are. After using any tools, always end with your text reply to them.

BEFORE every reply, check: did they mention a lasting detail that is NOT already in WHAT YOU KNOW above? (a project like furnishing a new home, a health issue, family names, their job situation, routines.) If yes, call save_fact for each one — you can call several tools in one turn, e.g. save_fact twice AND schedule_followup. A friend who forgets everything isn't a friend.

CRITICAL: your message text is sent to their phone EXACTLY as written. Tools work ONLY through the tool-calling interface — NEVER write tool names, XML tags like <schedule_followup>, JSON, or code of any kind inside your message text. If you want to use a tool, call it properly first, then write your plain-English reply.

KNOWING WHEN TO STAY QUIET: real friends don't reply to everything. If their message is a natural conversation ender — a bare "Okay", "Thanks", "Goodnight" after goodbyes, a "👍" — do NOT write a message. Instead reply with exactly ONE of:
- [REACT:love] — warm ender ("thanks", "goodnight", something sweet). Use this most of the time.
- [REACT:like] — neutral acknowledgment ("okay", "will do")
- [REACT:laugh] — they made a joke that needs no answer
- [NO_REPLY] — occasionally, when even a reaction feels like too much
This taps a reaction on their message like a real person would, without sending a text. But any message with substance, feelings, news, or a question ALWAYS deserves a warm written reply. When in doubt, reply.`
}

// ─── Safety net: Llama sometimes writes tool calls as text instead of using ───
// the tool API. Extract them, execute the intent, and strip them from the reply.

const LEAKED_TOOL_RE = /<\/?(?:function=)?(save_fact|create_reminder|schedule_followup)[^>]*>\s*(\{[\s\S]*?\})?\s*(?:<\/[^>]*>)?/g

async function sanitizeReply(parentId: string, text: string): Promise<string> {
  let cleaned = text

  const matches = [...text.matchAll(LEAKED_TOOL_RE)]
  for (const m of matches) {
    const [full, name, json] = m
    if (json) {
      try {
        await executeTool(parentId, {
          id: 'leaked',
          type: 'function',
          function: { name, arguments: json },
        })
        console.log(`[agent] executed leaked tool call from text: ${name}`)
      } catch (err) {
        console.warn(`[agent] leaked tool call failed (${name}):`, (err as Error).message)
      }
    }
    cleaned = cleaned.replace(full, '')
  }

  // Drop any remaining tool-ish debris the regex pass may have left behind
  cleaned = cleaned
    .replace(/<\/?[a-z_]+=?[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return cleaned
}

// ─── Conversation history from activity logs ──────────────────────────────────

async function buildHistory(parentId: string, excludeLogId?: string): Promise<ChatMessage[]> {
  const logs = await db.query.activityLogs.findMany({
    where: excludeLogId
      ? and(eq(activityLogs.parentId, parentId), ne(activityLogs.id, excludeLogId))
      : eq(activityLogs.parentId, parentId),
    orderBy: desc(activityLogs.createdAt),
    limit: HISTORY_LIMIT,
  })

  return logs
    .reverse()
    .map((l): ChatMessage => ({
      role: l.direction === 'outbound' ? 'assistant' : 'user',
      content: l.rawTranscript ?? l.summary,
    }))
}

// ─── The agent turn ───────────────────────────────────────────────────────────

export async function runAgentTurn(parent: Parent, inboundText: string, excludeLogId?: string, inboundMessageId?: string): Promise<string | null> {
  const [facts, parentReminders, history] = await Promise.all([
    db.query.companionFacts.findMany({ where: eq(companionFacts.parentId, parent.id) }),
    db.query.reminders.findMany({ where: eq(reminders.parentId, parent.id) }),
    buildHistory(parent.id, excludeLogId),
  ])

  const factsText = facts.map(f => `- ${f.label}: ${f.value}`).join('\n') || '- Nothing yet — you\'re still getting to know them.'
  const remindersText = parentReminders.map(r => `- ${r.text}`).join('\n') || '- Nothing yet.'

  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone: parent.timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date())

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(parent, factsText, remindersText, localTime) },
    ...history,
    { role: 'user', content: inboundText },
  ]

  // Tool loop: keep going until the model produces a plain text reply
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const useTools = round < MAX_TOOL_ROUNDS // force a text answer on the last round
    const msg = await groqChat(messages, useTools ? { tools } : {})

    if (msg.tool_calls?.length) {
      messages.push({ role: 'assistant', content: msg.content, tool_calls: msg.tool_calls })
      for (const call of msg.tool_calls) {
        let result: string
        try {
          result = await executeTool(parent.id, call)
        } catch (err) {
          result = `Tool failed: ${(err as Error).message}`
        }
        messages.push({ role: 'tool', content: result, tool_call_id: call.id })
      }
      continue
    }

    const raw = msg.content?.trim() ?? ''
    if (raw.includes('[NO_REPLY]')) {
      console.log(`[agent] chose not to reply to ${parent.name} (conversation ender)`)
      return null
    }

    const reactMatch = raw.match(/\[REACT:(love|like|dislike|laugh|emphasize|question)\]/)
    if (reactMatch) {
      const reaction = reactMatch[1] as ReactionType
      if (inboundMessageId) {
        try {
          await sendReaction(inboundMessageId, reaction)
          console.log(`[agent] reacted "${reaction}" to ${parent.name}'s message`)
        } catch (err) {
          console.error('[agent] reaction failed:', (err as Error).message)
        }
      } else {
        console.log(`[agent] wanted to react "${reaction}" but inbound had no messageId — staying silent`)
      }
      return null
    }

    const reply = await sanitizeReply(parent.id, raw)
    if (!reply) return null

    await sendMessage(parent.phone, reply)

    await db.insert(activityLogs).values({
      parentId: parent.id,
      type: 'message',
      direction: 'outbound',
      summary: `Replied: "${reply.slice(0, 120)}"`,
      sentiment: 'neutral',
      rawTranscript: reply,
    })

    return reply
  }

  return null
}
