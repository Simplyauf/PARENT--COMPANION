// LLM client — Vertex AI (Gemini). Provider-specific call logic lives in
// vertex.ts; this module is the stable interface the rest of the app imports.

import { vertexChat } from './vertex.js'

// The AI's persona name — what it introduces itself as when texting parents
export const COMPANION_NAME = process.env.COMPANION_NAME ?? 'Mae'

// ─── Low-level chat call ──────────────────────────────────────────────────────

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  images?: { mimeType: string; data: string }[] // base64, user messages only
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ToolDef = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export const chat = vertexChat

async function chatJSON<T>(prompt: string): Promise<T> {
  const msg = await chat(
    [{ role: 'user', content: prompt }],
    { jsonMode: true, temperature: 0.3 }
  )
  return JSON.parse(msg.content ?? '{}') as T
}

// ─── Transcript analysis ──────────────────────────────────────────────────────

export type TranscriptAnalysis = {
  summary: string
  sentiment: 'positive' | 'neutral' | 'alert'
  emergency: boolean
  scam: boolean
}

export async function analyzeTranscript(transcript: string): Promise<TranscriptAnalysis> {
  return chatJSON<TranscriptAnalysis>(`You are an eldercare assistant. Analyze this message from an elderly person and return a JSON object with:
- "summary": one plain-language sentence describing how the person is doing (no clinical language)
- "sentiment": exactly one of "positive", "neutral", or "alert"
- "emergency": true or false
- "scam": true or false

CRITICAL — ground everything strictly in what is literally written below. Never invent a threat, a caller, a scammer, a relative, or an event that isn't explicitly mentioned in the message. If the message is short, casual, or ambiguous, that alone is never grounds for "alert" — default to "neutral" or "positive" unless something concrete and concerning is actually stated.

Flag "alert" only for real signals about the person's wellbeing: pain, a fall, confusion, not eating, genuine loneliness distress, or a real health concern. Do NOT flag: jokes, sarcasm, teasing, or venting directed at the companion app itself (e.g. "I'm uninstalling you", "you're annoying me", complaints about the AI) — that is not a safety signal about the person.

Set "scam" to true (and sentiment to "alert") ONLY if the message explicitly describes someone actually asking them for money, bank details, card numbers, OTP/verification codes, gift cards, crypto, or explicitly mentions a locked-account call, a prize/lottery claim, an urgent payment demand, or a caller pressuring them. Never infer a scam from a vague or unrelated message.

Set "emergency" to true ONLY for genuinely serious situations: a fall, chest pain, trouble breathing, serious confusion, not eating for days, or expressions of despair. A manageable complaint (a headache they're taking medication for, a sore knee, feeling tired) is "alert" with "emergency": false.

Message:
${transcript}

Respond with only valid JSON.`)
}

// ─── Weekly summary generation ────────────────────────────────────────────────

export type WeeklySummary = {
  overallMood: 'great' | 'good' | 'mixed' | 'concerning'
  moodSentence: string
  notableMoments: string[]
  companionNote: string
  stats: { checkins: number; calls: number; alerts: number }
}

export async function generateWeeklySummary(
  parentName: string,
  logs: { type: string; summary: string; sentiment: string; createdAt: Date }[]
): Promise<WeeklySummary> {
  const logText = logs
    .map(l => `[${l.createdAt.toDateString()} ${l.type} - ${l.sentiment}] ${l.summary}`)
    .join('\n')

  return chatJSON<WeeklySummary>(`You are writing a weekly wellbeing summary for a guardian about their elderly family member named ${parentName}.

Based on these interaction logs from the past 7 days, return a JSON object with:
- "overallMood": one of "great", "good", "mixed", "concerning"
- "moodSentence": one sentence summarising the week's mood (e.g. "6 of 7 days in good spirits")
- "notableMoments": array of 2–3 plain-language bullet strings about meaningful moments (positive or negative)
- "companionNote": 2–3 sentence personalised note for the guardian with a suggested action
- "stats": object with "checkins" (total interactions), "calls" (call count), "alerts" (alert count)

Logs:
${logText}

Respond with only valid JSON.`)
}

// ─── Heartbeat decision ───────────────────────────────────────────────────────

export type HeartbeatDecision = {
  action: 'IDLE' | 'MESSAGE'
  reason: string
  messageText?: string // populated when action === 'MESSAGE'
}

export type HeartbeatContext = {
  parentName: string
  currentTime: string   // e.g. "2:30 PM"
  activeHoursFrom: string
  activeHoursTo: string
  contactsToday: number
  maxContactsPerDay: number
  todayLogs: { type: string; summary: string; sentiment: string; time: string }[]
  facts: { label: string; value: string }[]
  reminders: string[]
  unansweredStreak: number
  isFirstContact: boolean
  selfSetup: boolean
}

export async function decideHeartbeat(ctx: HeartbeatContext): Promise<HeartbeatDecision> {
  if (ctx.contactsToday >= ctx.maxContactsPerDay) {
    return { action: 'IDLE', reason: 'Daily contact limit reached' }
  }

  const logsText = ctx.todayLogs.length
    ? ctx.todayLogs.map(l => `[${l.time} ${l.type}] ${l.summary} (${l.sentiment})`).join('\n')
    : 'No contact yet today.'

  const factsText = ctx.facts.map(f => `${f.label}: ${f.value}`).join(', ') || 'None yet'
  const remindersText = ctx.reminders.join(', ') || 'None'

  return chatJSON<HeartbeatDecision>(`You are ${COMPANION_NAME}, an autonomous eldercare companion agent making a real-time check-in decision.

Person: ${ctx.parentName}
Current time: ${ctx.currentTime}
Active hours: ${ctx.activeHoursFrom} – ${ctx.activeHoursTo}
Contacts today: ${ctx.contactsToday} of ${ctx.maxContactsPerDay} max
Personal facts: ${factsText}
Reminders to track: ${remindersText}

Today's interactions so far:
${logsText}

${ctx.isFirstContact ? `This would be the very FIRST message you've ever sent this person. If you choose MESSAGE, briefly introduce yourself by name${ctx.selfSetup ? ` and what you're here for (a daily friendly check-in) — do NOT mention family or a guardian asking you to reach out, nobody set this up but them` : ` and mention their family asked you to check in and that you'll share how they're doing with them`} — say it warmly, like a friend being introduced, not like a legal disclaimer, then move naturally into a light, easy question.` : ''}

Unanswered streak: they have not replied to your last ${ctx.unansweredStreak} message(s).

Decide what to do RIGHT NOW. Return a JSON object:
- "action": exactly one of "IDLE" or "MESSAGE"
  - IDLE: not the right time, or person has been contacted recently enough
  - MESSAGE: send a warm iMessage check-in
- "reason": one sentence explaining your decision
- "messageText": if action is MESSAGE, a warm natural text message (2 sentences max, first-person as ${COMPANION_NAME}, like a caring friend texting — never robotic, never formal)

Consider: time of day, last contact sentiment, reminders, and daily limit.
If the unanswered streak is 1, prefer IDLE unless several hours have passed — give them space.
If the unanswered streak is 2 or more and you choose MESSAGE, keep it SHORT and completely pressure-free: something like checking in about your last chat, "if everything's fine just let me know when you can" — never guilt-trip, never repeat earlier questions, never demand a reply.
If you asked about something (a trip, an appointment) and they never engaged with it, LET IT GO — do not ask about it again. Open with something fresh, the way a normal conversation moves on.
Respond with only valid JSON.`)
}
