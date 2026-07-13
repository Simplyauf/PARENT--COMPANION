import { db } from './db/index.js'
import { activityLogs, parents, companionFacts, reminders, scheduledActions } from './db/schema.js'
import { eq, and, gte, lte, isNull, type InferSelectModel } from 'drizzle-orm'
import { decideHeartbeat, groqChat, COMPANION_NAME } from './lib/llm.js'
import { sendIMessageCheckin } from './lib/notifications.js'

const HEARTBEAT_INTERVAL_MS = 45 * 60 * 1000 // 45 minutes
const MAX_CONTACTS_PER_DAY = 3

async function tick() {
  console.log(`[heartbeat] tick at ${new Date().toISOString()}`)

  // Agent-scheduled follow-ups come first — these are commitments the agent
  // made during conversation ("I'll ask how the appointment went")
  const followedUp = await runDueFollowups()

  const allParents = await db.query.parents.findMany({
    where: eq(parents.isActive, true),
    with: { companionFacts: true, reminders: true },
  })

  await Promise.allSettled(
    allParents
      .filter(p => !followedUp.has(p.id)) // just messaged them — don't double-text
      .map(processParent)
  )
}

// ─── Execute due follow-ups the agent scheduled for itself ───────────────────

async function runDueFollowups(): Promise<Set<string>> {
  const due = await db.query.scheduledActions.findMany({
    where: and(isNull(scheduledActions.completedAt), lte(scheduledActions.dueAt, new Date())),
    with: { parent: true },
  })

  const messaged = new Set<string>()

  for (const action of due) {
    try {
      const msg = await groqChat([
        {
          role: 'user',
          content: `You are ${COMPANION_NAME}, a warm friend texting ${action.parent.name}, an elderly person you check in on. Earlier you promised yourself to follow up about: "${action.topic}".

Write that follow-up text now — 1–2 sentences, casual and caring like a real friend texting, never robotic. Reply with ONLY the text message, nothing else.`,
        },
      ], { temperature: 0.8 })

      const text = msg.content?.trim()
      if (!text) continue

      await sendIMessageCheckin(action.parent.phone, text)

      await db.insert(activityLogs).values({
        parentId: action.parentId,
        type: 'message',
        direction: 'outbound',
        summary: `Follow-up: "${text.slice(0, 120)}"`,
        sentiment: 'neutral',
        rawTranscript: text,
      })

      await db.update(scheduledActions)
        .set({ completedAt: new Date() })
        .where(eq(scheduledActions.id, action.id))

      messaged.add(action.parentId)
      console.log(`[heartbeat] follow-up sent to ${action.parent.name}: ${action.topic}`)
    } catch (err) {
      console.error(`[heartbeat] follow-up failed for ${action.parent.name}:`, (err as Error).message)
    }
  }

  return messaged
}

type ParentWithContext = InferSelectModel<typeof parents> & {
  companionFacts: InferSelectModel<typeof companionFacts>[]
  reminders: InferSelectModel<typeof reminders>[]
}

async function processParent(parent: ParentWithContext) {
  const now = new Date()

  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone: parent.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)

  // Gate on active hours
  const [fromH, fromM] = parent.activeHoursFrom.split(':').map(Number)
  const [toH, toM] = parent.activeHoursTo.split(':').map(Number)
  const [nowH, nowM] = localTime.split(':').map(Number)

  const fromMinutes = fromH * 60 + fromM
  const toMinutes = toH * 60 + toM
  const nowMinutes = nowH * 60 + nowM

  if (nowMinutes < fromMinutes || nowMinutes > toMinutes) {
    console.log(`[heartbeat] ${parent.name} — outside active hours (${localTime})`)
    return
  }

  // Today's logs for context
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const todayLogs = await db.query.activityLogs.findMany({
    where: and(
      eq(activityLogs.parentId, parent.id),
      gte(activityLogs.createdAt, startOfDay)
    ),
  })

  const logsForContext = todayLogs.map(l => ({
    type: l.type,
    summary: l.summary,
    sentiment: l.sentiment,
    time: new Intl.DateTimeFormat('en-US', {
      timeZone: parent.timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(l.createdAt),
  }))

  // Only Companion-initiated outbound messages count toward the daily cap —
  // replies to the parent's own messages are conversation, not contact attempts
  const initiatedToday = todayLogs.filter(
    l => l.direction === 'outbound' && !l.summary.startsWith('Replied:')
  ).length

  const decision = await decideHeartbeat({
    parentName: parent.name,
    currentTime: new Intl.DateTimeFormat('en-US', {
      timeZone: parent.timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(now),
    activeHoursFrom: parent.activeHoursFrom,
    activeHoursTo: parent.activeHoursTo,
    contactsToday: initiatedToday,
    maxContactsPerDay: MAX_CONTACTS_PER_DAY,
    todayLogs: logsForContext,
    facts: parent.companionFacts.map(f => ({ label: f.label, value: f.value })),
    reminders: parent.reminders.map(r => r.text),
  })

  console.log(`[heartbeat] ${parent.name}: ${decision.action} — ${decision.reason}`)

  if (decision.action === 'MESSAGE' && decision.messageText) {
    await sendIMessageCheckin(parent.phone, decision.messageText)

    await db.insert(activityLogs).values({
      parentId: parent.id,
      type: 'message',
      summary: `Sent: "${decision.messageText}"`,
      sentiment: 'neutral',
    })
  }
}

export function startHeartbeat() {
  console.log(`[heartbeat] started — interval: ${HEARTBEAT_INTERVAL_MS / 60000} min`)
  tick().catch(err => console.error('[heartbeat] tick error:', err))
  return setInterval(() => {
    tick().catch(err => console.error('[heartbeat] tick error:', err))
  }, HEARTBEAT_INTERVAL_MS)
}
