// LLM client — Groq (OpenAI-compatible API), llama-3.3-70b-versatile
// Free tier: 30 req/min, 1k req/day, 100k tokens/day — plenty for Phase 1

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'llama-3.3-70b-versatile'

// The AI's persona name — what it introduces itself as when texting parents
export const COMPANION_NAME = process.env.COMPANION_NAME ?? 'Deera'

// ─── Low-level chat call ──────────────────────────────────────────────────────

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
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

export async function groqChat(
  messages: ChatMessage[],
  opts: { tools?: ToolDef[]; jsonMode?: boolean; temperature?: number } = {}
): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set')

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: opts.temperature ?? 0.7,
      ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
      ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Groq API ${res.status}: ${body}`)
  }

  const data = await res.json() as {
    choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[]
  }
  return data.choices[0].message
}

async function groqJSON<T>(prompt: string): Promise<T> {
  const msg = await groqChat(
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
}

export async function analyzeTranscript(transcript: string): Promise<TranscriptAnalysis> {
  return groqJSON<TranscriptAnalysis>(`You are an eldercare assistant. Analyze this message from an elderly person and return a JSON object with:
- "summary": one plain-language sentence describing how the person is doing (no clinical language)
- "sentiment": exactly one of "positive", "neutral", or "alert"
- "emergency": true or false

Flag "alert" if the person mentions pain, a fall, confusion, not eating, loneliness distress, or any health concern worth telling their family about.

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

  return groqJSON<WeeklySummary>(`You are writing a weekly wellbeing summary for a guardian about their elderly family member named ${parentName}.

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

  return groqJSON<HeartbeatDecision>(`You are ${COMPANION_NAME}, an autonomous eldercare companion agent making a real-time check-in decision.

Person: ${ctx.parentName}
Current time: ${ctx.currentTime}
Active hours: ${ctx.activeHoursFrom} – ${ctx.activeHoursTo}
Contacts today: ${ctx.contactsToday} of ${ctx.maxContactsPerDay} max
Personal facts: ${factsText}
Reminders to track: ${remindersText}

Today's interactions so far:
${logsText}

Decide what to do RIGHT NOW. Return a JSON object:
- "action": exactly one of "IDLE" or "MESSAGE"
  - IDLE: not the right time, or person has been contacted recently enough
  - MESSAGE: send a warm iMessage check-in
- "reason": one sentence explaining your decision
- "messageText": if action is MESSAGE, a warm natural text message (2 sentences max, first-person as ${COMPANION_NAME}, like a caring friend texting — never robotic, never formal)

Consider: time of day, last contact sentiment, reminders, and daily limit.
Respond with only valid JSON.`)
}
