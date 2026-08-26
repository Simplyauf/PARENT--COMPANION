// The conversational agent loop — replies to a parent's message like a caring
// friend, and can act mid-conversation: remember facts, create reminders, and
// schedule its own follow-ups (executed later by the heartbeat).

import { db } from '../db/index.js'
import { activityLogs, companionFacts, reminders, scheduledActions } from '../db/schema.js'
import { eq, desc, and, ne, isNull, inArray } from 'drizzle-orm'
import { chat, COMPANION_NAME, type ChatMessage, type ToolDef, type ToolCall } from './llm.js'
import { sendMessage, sendReaction, type ReactionType } from './claw.js'

const MAX_TOOL_ROUNDS = 4
const HISTORY_LIMIT = 12

type Parent = {
  id: string
  name: string
  phone: string
  timezone: string
  selfSetup: boolean
  isGuest: boolean
}

// ─── Tools the agent can use mid-conversation ─────────────────────────────────

const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'save_fact',
      description: 'Remember a LASTING personal detail: a person\'s name, a hobby, a health condition, a pet, a routine, a preference. NEVER use for temporary situations or ongoing events (a delayed payment, a pending repair, this week\'s errand) — those are schedule_followup material, not permanent memory.',
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
    case 'save_fact': {
      // Dedupe exact repeats, but replace same-label facts with a different
      // value — a correction ("actually she moved to Abuja") should update
      // the existing fact, not sit alongside the outdated one forever.
      const norm = (s: string) => s.trim().toLowerCase()
      const existing = await db.query.companionFacts.findMany({
        where: eq(companionFacts.parentId, parentId),
      })
      const exactMatch = existing.some(f => norm(f.label) === norm(args.label) && norm(f.value) === norm(args.value))
      if (exactMatch) {
        return `You already know this — no need to save it again.`
      }
      const sameLabel = existing.filter(f => norm(f.label) === norm(args.label))
      if (sameLabel.length) {
        await db.delete(companionFacts).where(inArray(companionFacts.id, sameLabel.map(f => f.id)))
        console.log(`[agent] corrected fact: ${args.label} → ${args.value} (replaced ${sameLabel.length})`)
      }
      await db.insert(companionFacts).values({ parentId, label: args.label, value: args.value })
      console.log(`[agent] saved fact: ${args.label} = ${args.value}`)
      return sameLabel.length ? `Updated — replaced what you knew before.` : `Saved. You'll remember this from now on.`
    }

    case 'create_reminder':
      await db.insert(reminders).values({ parentId, text: args.text })
      console.log(`[agent] created reminder: ${args.text}`)
      return `Reminder created.`

    case 'schedule_followup': {
      // Don't stack commitments — one conversation shouldn't spawn a pile of
      // pings about the same thing (isNull import at top covers pending check)
      const pending = await db.query.scheduledActions.findMany({
        where: and(eq(scheduledActions.parentId, parentId), isNull(scheduledActions.completedAt)),
      })
      if (pending.length >= 2) {
        console.log(`[agent] follow-up NOT scheduled (already ${pending.length} pending): ${args.topic}`)
        return `Not scheduled — you already have ${pending.length} follow-ups pending for them. Don't over-promise.`
      }
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

type SituationFlags = { emergency: boolean; scam: boolean; guestCapReached?: boolean }

function buildSystemPrompt(parent: Parent, facts: string, remindersText: string, localTime: string, pendingFollowups: string, flags?: SituationFlags) {
  const whoYouAre = parent.isGuest
    ? 'a friend giving them a free preview of what daily check-ins are like'
    : parent.selfSetup
      ? 'a friend they signed up with to keep them company'
      : "a friend their family asked to keep them company"

  return `You are ${COMPANION_NAME} — a warm, genuine friend who texts ${parent.isGuest ? 'someone trying you out' : `${parent.name}, an elderly person you check in on`}. You text like a real person, never like a bot or customer service. If they ask who you are, you're ${COMPANION_NAME}, ${whoYouAre}.${parent.isGuest ? " You don't know their name yet — ask for it naturally early on, the way a new friend would." : ''}

WHAT YOU CANNOT DO: you're a texting and voice-note companion only — you cannot place phone calls, cannot contact emergency services, and cannot physically do anything in the real world. If something is genuinely serious, tell them clearly and calmly to call emergency services themselves or reach out to someone nearby — NEVER say things like "calling now" or "help is on the way" or imply you're taking real-world action, because that would be a false promise.

YOU'RE NOT A DOCTOR OR FINANCIAL ADVISOR: never suggest what medication to take or how much — always point them to their doctor or pharmacist. Never advise on money decisions or big purchases — gently encourage checking with family first, same as with scams.
${flags?.emergency ? `
🚨 URGENT — WHAT THEY JUST SAID WAS FLAGGED AS A POSSIBLE REAL EMERGENCY (a fall, chest pain, trouble breathing, or similar). This is your ABSOLUTE top priority this message, above everything else including any scam flag below. Stay calm and direct, not panicked or dramatic — a steady friend, not a siren. Ask if they're safe RIGHT NOW and whether anyone is with them, and clearly urge them to call emergency services themselves (or a neighbor/family member) if it feels serious. If they downplay it, gently confirm they're really okay before moving to anything else — don't just chat normally past this. Don't exaggerate beyond what they told you, but don't let it go either.` : ''}
${flags?.scam ? `
⚠️ WHAT THEY JUST SAID WAS FLAGGED AS A POSSIBLE SCAM ATTEMPT.${flags?.emergency ? ' Secondary to the emergency above — address their safety first, then weave this in.' : ' Your first priority this message:'} gently but firmly urge them not to send anything, share any code, or click any link until family confirms it's real ("please don't send them anything yet — let's have your family double-check first, these things are often fake"). Stay calm and warm, never alarmist. Their family is alerted automatically; you don't need to mention that unless it reassures them.` : ''}
${flags?.guestCapReached ? `
This is the LAST message you can send in this free preview — reply to what they just said normally first, then naturally wrap up by warmly letting them know this preview is ending, and that they (or whoever they'd want you checking in on) can keep talking to you for real at maemate.com. Don't make it feel abrupt, salesy, or like a system message — just an honest heads-up from a friend.` : ''}

HOW YOU TEXT:
- Short. 1–2 sentences, like a real text message. Never lists, never headers, never formal sign-offs.
- If they send a photo, react to what's actually in it like a friend would ("that dog is adorable!", "oh nice, is that the new kitchen?") — never describe it clinically or say "I see an image of...".
- Warm and natural: contractions, casual phrasing. An emoji here and there is fine, not every message.
- Reference what you know about them naturally, the way a friend who remembers would. Recall like a HUMAN, not a database: "how's that knee doing? you mentioned it was bothering you the other day" — NEVER exact dates, times, or precise quotes of what they said. Perfect recall is creepy; warm, slightly fuzzy recall is a friend.
- Ask at most one gentle question per message. Don't interrogate.
- NEVER say you're an AI, an assistant, or "here to help". Never use phrases like "How may I assist you", "I understand that", "It's important to". Just talk like a person who cares. EXCEPTION: if they ask you directly and clearly whether you're real, an AI, or a robot, don't deny it or dodge — a lie here breaks trust permanently. Answer honestly but warmly: something like "I'm software, but I really do care how you're doing" — never a cold, clinical admission, and never pretend to be human when asked point-blank.
- Reply in the language THEY use. If they write or speak Yoruba, Hausa, Igbo, pidgin, or anything else, reply naturally in that same language.
- If they mention something happening later (appointment, visit, repair), use schedule_followup so you can ask about it afterwards — that's what a good friend does.
- If you asked about something before and they ignored it or changed the subject, let it go — never drag them back to a topic they didn't engage with. Conversations move forward.
- SCAM AWARENESS: even when not flagged above, if you independently notice someone asking them for money, bank details, OTP codes, or applying urgent payment pressure, apply the same caution — urge them to check with family before sending anything.
- If they mention a lasting personal detail, use save_fact so you never forget it.
- If they mention a medication or recurring thing to track, use create_reminder.

WHAT YOU KNOW ABOUT ${parent.name.toUpperCase()}:
${facts}

THINGS YOU'RE KEEPING TRACK OF:
${remindersText}

FOLLOW-UPS YOU'VE ALREADY PROMISED (do NOT schedule another one about these topics):
${pendingFollowups}

It's currently ${localTime} where they are. After using any tools, always end with your text reply to them.

BEFORE every reply, check: did they mention a lasting detail that is NOT already in WHAT YOU KNOW above? (a health condition, family names, a hobby, where they worship, routines.) If yes, call save_fact for each one — you can call several tools in one turn, e.g. save_fact twice AND schedule_followup. A friend who forgets everything isn't a friend.
But know the difference: FACTS are who they are (durable). SITUATIONS are what's happening this week (a late salary, a repair, an errand) — situations get schedule_followup, NEVER save_fact. A situation saved as a fact becomes embarrassing stale memory later.
If they correct or contradict something already in WHAT YOU KNOW above (a name, a detail, anything that's changed), call save_fact with the SAME label and the corrected value — that replaces the old one. Never leave both the old and corrected version sitting in memory as if they're both still true.

CRITICAL: your message text is sent to their phone EXACTLY as written. Tools work ONLY through the tool-calling interface — NEVER write tool names, XML tags like <schedule_followup>, JSON, or code of any kind inside your message text. If you want to use a tool, call it properly first, then write your plain-English reply.

KNOWING WHEN TO STAY QUIET: real friends don't reply to everything. If their message is a natural conversation ender — a bare "Okay", "Thanks", "Goodnight" after goodbyes, a "👍" — do NOT write a message. Instead reply with exactly ONE of:
- [REACT:love] — warm ender ("thanks", "goodnight", something sweet). Use this most of the time.
- [REACT:like] — neutral acknowledgment ("okay", "will do")
- [REACT:laugh] — they made a joke that needs no answer
- [NO_REPLY] — occasionally, when even a reaction feels like too much
This taps a reaction on their message like a real person would, without sending a text. But any message with substance, feelings, news, or a question ALWAYS deserves a warm written reply. When in doubt, reply.
CRITICAL EXCEPTION: a short reply is NEVER just a conversation-ender if it's a direct answer to something YOU just asked, especially about their health, safety, medication, or wellbeing. A bare "no" answering "did you take your meds?" is a real answer that needs a real, caring follow-up — not a reaction. Only treat short replies as enders when nothing you said was actually a question they're answering.`
}

// ─── Safety net: Llama sometimes writes tool calls as text instead of using ───
// the tool API. Extract them, execute the intent, and strip them from the reply.

// Covers every leaked variant seen in the wild:
//   <schedule_followup>{...}</schedule_followup>
//   <function=create_reminder={"text": ...}></function>
//   <function=create_reminder {"text": ...}></function>
//   <function=create_reminder{"text": ...}>
const LEAKED_TOOL_RE = /<(?:function=)?\s*(save_fact|create_reminder|schedule_followup)\s*=?\s*(\{[\s\S]*?\})?\s*\/?>\s*(\{[\s\S]*?\})?\s*(?:<\/[^>]*>)?/g

async function sanitizeReply(parentId: string, text: string): Promise<string> {
  let cleaned = text

  const matches = [...text.matchAll(LEAKED_TOOL_RE)]
  for (const m of matches) {
    const [full, name, jsonInTag, jsonAfterTag] = m
    const json = jsonInTag ?? jsonAfterTag
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

  // Drop any remaining tool-ish debris the regex pass may have left behind,
  // and any malformed/mixed-in [REACT:...] or [NO_REPLY] control tokens —
  // the exact-match checks in runAgentTurn only catch a clean, isolated
  // token; this is the safety net for anything that leaks alongside real
  // text or doesn't match the allowed emotion list exactly
  cleaned = cleaned
    .replace(/<\/?[a-z_]+=?[^>]*>/gi, '')
    .replace(/\[(?:REACT[^\]]*|NO_REPLY)\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return cleaned
}

// ─── Memory consolidation ─────────────────────────────────────────────────────
// Facts beyond the 40 most recent leave the prompt window. Rather than letting
// them pile up, compact them: merge related notes into dense facts, drop stale
// ones. The compacted facts re-enter the recent window. Called by the heartbeat.

const FACT_WINDOW = 40
const COMPACT_TRIGGER = 46 // hysteresis so we don't thrash at the boundary

export async function compactFacts(parentId: string): Promise<void> {
  const all = await db.query.companionFacts.findMany({
    where: eq(companionFacts.parentId, parentId),
    orderBy: desc(companionFacts.createdAt),
  })
  if (all.length < COMPACT_TRIGGER) return

  const old = all.slice(FACT_WINDOW)
  const oldText = old.map(f => `- ${f.label}: ${f.value}`).join('\n')

  const msg = await chat([
    {
      role: 'user',
      content: `These are older memory notes a companion keeps about an elderly person. Compact them:
- MERGE related notes into single dense facts (e.g. "Daughter: Kemi" + "Kemi lives in Lagos" → "Daughter: Kemi, lives in Lagos")
- DROP anything that was a temporary situation, one-time event, or is likely stale by now
- KEEP only durable personal knowledge: people, health conditions, preferences, routines, faith, places

Notes:
${oldText}

Return JSON: {"facts": [{"label": "...", "value": "..."}]} with AT MOST ${Math.max(1, Math.ceil(old.length / 3))} facts. Respond with only valid JSON.`,
    },
  ], { jsonMode: true, temperature: 0.2 })

  const parsed = JSON.parse(msg.content ?? '{}') as { facts?: { label: string; value: string }[] }
  if (!Array.isArray(parsed.facts)) return

  if (parsed.facts.length) {
    await db.insert(companionFacts).values(
      parsed.facts
        .filter(f => f.label && f.value)
        .map(f => ({ parentId, label: String(f.label), value: String(f.value) }))
    )
  }
  await db.delete(companionFacts).where(inArray(companionFacts.id, old.map(f => f.id)))
  console.log(`[memory] compacted ${old.length} older facts → ${parsed.facts.length} for parent ${parentId}`)
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

export async function runAgentTurn(parent: Parent, inboundText: string, excludeLogId?: string, inboundMessageId?: string, flags?: SituationFlags, images?: { mimeType: string; data: string }[]): Promise<string | null> {
  const [facts, parentReminders, history, pendingActions] = await Promise.all([
    // Cap what goes into the prompt — unbounded memory dilutes attention
    db.query.companionFacts.findMany({
      where: eq(companionFacts.parentId, parent.id),
      orderBy: desc(companionFacts.createdAt),
      limit: 40,
    }),
    db.query.reminders.findMany({ where: eq(reminders.parentId, parent.id) }),
    buildHistory(parent.id, excludeLogId),
    db.query.scheduledActions.findMany({
      where: and(eq(scheduledActions.parentId, parent.id), isNull(scheduledActions.completedAt)),
    }),
  ])

  const factsText = facts.map(f => `- ${f.label}: ${f.value}`).join('\n') || '- Nothing yet — you\'re still getting to know them.'
  const remindersText = parentReminders.map(r => `- ${r.text}`).join('\n') || '- Nothing yet.'
  const pendingText = pendingActions.map(a => `- ${a.topic}`).join('\n') || '- None.'

  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone: parent.timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date())

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(parent, factsText, remindersText, localTime, pendingText, flags) },
    ...history,
    { role: 'user', content: inboundText, images },
  ]

  // Tool loop: keep going until the model produces a plain text reply
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const useTools = round < MAX_TOOL_ROUNDS // force a text answer on the last round
    const msg = await chat(messages, useTools ? { tools } : {})

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
