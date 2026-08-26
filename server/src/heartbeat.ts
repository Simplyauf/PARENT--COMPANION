import { db } from './db/index.js'
import { activityLogs, parents, companionFacts, reminders, scheduledActions, guardianParentLinks, subscriptions, summarySchedules } from './db/schema.js'
import { eq, and, gte, lte, lt, isNull, desc, type InferSelectModel } from 'drizzle-orm'
import { decideHeartbeat, chat, COMPANION_NAME, generateWeeklySummary } from './lib/llm.js'
import { sendIMessageCheckin, dispatchAlert, sendSummaryEmail } from './lib/notifications.js'
import { compactFacts } from './lib/agent.js'
import { DAILY_CONTACT_CAP, type Plan } from './lib/plans.js'

const HEARTBEAT_INTERVAL_MS = 45 * 60 * 1000 // 45 minutes
const LIVE_SUB_STATUSES = ['trialing', 'active', 'past_due'] // past_due keeps running — provider is still retrying the card
const FOLLOWUP_EXPIRY_MS = 48 * 60 * 60 * 1000   // stale follow-ups die after 48h overdue
const NO_REPLY_STREAK = 3                         // stop initiating after 3 unanswered messages
const GUARDIAN_ALERT_AFTER_H = 12                 // hours of silence after 3rd msg → tell guardians
const RETRY_AFTER_H = 72                          // days of silence before one gentle re-attempt
const PAUSE_REMINDER_AFTER_MS = 4 * 24 * 60 * 60 * 1000
const RECENT_ACTIVITY_COOLDOWN_MS = 20 * 60 * 1000 // never initiate within 20 min of any activity
const MIN_RESEND_GAP_MS = { weekly: 6 * 24 * 60 * 60 * 1000, monthly: 25 * 24 * 60 * 60 * 1000 }
const HEARTBEAT_CONCURRENCY = 20 // cap concurrent per-parent processing so a
                                  // large parent count can't fan out into
                                  // hundreds of simultaneous LLM calls / DB
                                  // connections in the same tick

// Bounded-concurrency worker pool — same resilience as Promise.allSettled
// (one failure never stops the rest) but never more than `limit` in flight
async function runBounded<T>(items: T[], limit: number, fn: (item: T) => Promise<unknown>) {
  let next = 0
  async function worker() {
    while (next < items.length) {
      const item = items[next++]
      try {
        await fn(item)
      } catch (err) {
        console.error('[heartbeat] item failed:', (err as Error).message)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

async function tick() {
  console.log(`[heartbeat] tick at ${new Date().toISOString()}`)

  // Agent-scheduled follow-ups come first — these are commitments the agent
  // made during conversation ("I'll ask how the appointment went")
  const followedUp = await runDueFollowups()

  await runDueSummaries()

  const allParents = await db.query.parents.findMany({
    where: eq(parents.isActive, true),
    with: { companionFacts: true, reminders: true, subscription: true },
  })

  await runBounded(
    allParents.filter(p => !followedUp.has(p.id)), // just messaged them — don't double-text
    HEARTBEAT_CONCURRENCY,
    processParent
  )

  // Memory maintenance: compact facts that have drifted out of the prompt window
  await runBounded(allParents, HEARTBEAT_CONCURRENCY, p => compactFacts(p.id))
}

// ─── Execute due follow-ups the agent scheduled for itself ───────────────────

async function runDueFollowups(): Promise<Set<string>> {
  const now = new Date()

  // A follow-up that's been overdue for 2+ days is about a moment that has
  // passed — asking about it now would feel weird and pushy. Let it die.
  const expired = await db.update(scheduledActions)
    .set({ completedAt: now })
    .where(and(
      isNull(scheduledActions.completedAt),
      lt(scheduledActions.dueAt, new Date(now.getTime() - FOLLOWUP_EXPIRY_MS))
    ))
    .returning()
  if (expired.length) console.log(`[heartbeat] expired ${expired.length} stale follow-up(s)`)

  const due = await db.query.scheduledActions.findMany({
    where: and(isNull(scheduledActions.completedAt), lte(scheduledActions.dueAt, now)),
    with: { parent: true },
  })

  // One message per parent per tick — if several follow-ups are due at once
  // (e.g. after downtime), merge them instead of machine-gunning texts
  const byParent = new Map<string, typeof due>()
  for (const action of due) {
    const list = byParent.get(action.parentId) ?? []
    list.push(action)
    byParent.set(action.parentId, list)
  }

  const messaged = new Set<string>()

  for (const [parentId, actions] of byParent) {
    const parent = actions[0].parent
    if (parent.pausedUntil && parent.pausedUntil > now) continue // paused — hold, expiry will clean up

    const topics = actions.map(a => a.topic).join('; ')
    try {
      const msg = await chat([
        {
          role: 'user',
          content: `You are ${COMPANION_NAME}, a warm friend texting ${parent.name}, an elderly person you check in on. Earlier you promised yourself to follow up about: "${topics}".

Write ONE follow-up text now covering ${actions.length > 1 ? 'these (they overlap — weave them into one natural question, do not list them)' : 'that'} — 1–2 sentences, casual and caring like a real friend texting, never robotic. Reply with ONLY the text message, nothing else.`,
        },
      ], { temperature: 0.8 })

      const text = msg.content?.trim()
      if (!text) continue

      await sendIMessageCheckin(parent.phone, text)

      await db.insert(activityLogs).values({
        parentId,
        type: 'message',
        direction: 'outbound',
        summary: `Follow-up: "${text.slice(0, 120)}"`,
        sentiment: 'neutral',
        rawTranscript: text,
      })

      for (const action of actions) {
        await db.update(scheduledActions)
          .set({ completedAt: new Date() })
          .where(eq(scheduledActions.id, action.id))
      }

      messaged.add(parentId)
      console.log(`[heartbeat] follow-up sent to ${parent.name}: ${topics}`)
    } catch (err) {
      console.error(`[heartbeat] follow-up failed for ${parent.name}:`, (err as Error).message)
    }
  }

  return messaged
}

// dayOfWeek in the schema is 0=Mon…6=Sun — compute that plus day-of-month
// and HH:MM in the PARENT's own timezone, not server time
function getLocalDateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  const WEEKDAY_MAP: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

  const year = Number(get('year'))
  const month = Number(get('month')) // 1-12
  const day = Number(get('day'))
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()

  return {
    dayOfWeek: WEEKDAY_MAP[get('weekday')] ?? 0,
    dayOfMonth: day,
    isLastDayOfMonth: day === lastDayOfMonth,
    timeStr: `${get('hour')}:${get('minute')}`,
  }
}

// Weekly/monthly wellbeing summaries to guardians — schedule stored per
// parent, checked every tick and sent at most once per period
async function runDueSummaries() {
  const now = new Date()
  const schedules = await db.query.summarySchedules.findMany({
    with: { parent: { with: { guardianLinks: { with: { guardian: true } } } } },
  })

  for (const sched of schedules) {
    const parent = sched.parent
    if (!parent?.isActive) continue

    const local = getLocalDateParts(now, parent.timezone)
    const dueToday = sched.frequency === 'weekly'
      ? sched.dayOfWeek === local.dayOfWeek
      : sched.dayOfMonth != null ? sched.dayOfMonth === local.dayOfMonth : local.isLastDayOfMonth
    if (!dueToday || local.timeStr < sched.sendAt) continue

    const minGap = MIN_RESEND_GAP_MS[sched.frequency]
    if (sched.lastSentAt && now.getTime() - sched.lastSentAt.getTime() < minGap) continue

    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const logs = await db.query.activityLogs.findMany({
      where: and(eq(activityLogs.parentId, parent.id), gte(activityLogs.createdAt, since)),
      orderBy: desc(activityLogs.createdAt),
    })
    if (!logs.length) continue // nothing to summarize yet

    try {
      const summary = await generateWeeklySummary(parent.name, logs)
      const weekOf = new Intl.DateTimeFormat('en-US', { timeZone: parent.timezone, month: 'short', day: 'numeric' }).format(since)

      await Promise.allSettled(
        parent.guardianLinks.map(link =>
          sendSummaryEmail({
            guardianEmail: link.guardian.email,
            guardianPhone: link.guardian.phone ?? undefined,
            notifyVia: link.notifyVia,
            parentName: parent.name,
            weekOf,
            overallMood: summary.overallMood,
            moodSentence: summary.moodSentence,
            notableMoments: summary.notableMoments,
            companionNote: summary.companionNote,
            stats: summary.stats,
          })
        )
      )

      await db.update(summarySchedules).set({ lastSentAt: now }).where(eq(summarySchedules.id, sched.id))
      console.log(`[heartbeat] sent ${sched.frequency} summary for ${parent.name} to ${parent.guardianLinks.length} guardian(s)`)
    } catch (err) {
      console.error(`[heartbeat] summary failed for ${parent.name}:`, (err as Error).message)
    }
  }
}

type ParentWithContext = InferSelectModel<typeof parents> & {
  companionFacts: InferSelectModel<typeof companionFacts>[]
  reminders: InferSelectModel<typeof reminders>[]
  subscription: InferSelectModel<typeof subscriptions> | null
}

async function processParent(parent: ParentWithContext) {
  const now = new Date()

  // No live subscription (cancelled/expired, or never linked) — Mae stops
  // initiating entirely. Replies are handled in claw.ts and aren't gated here,
  // matching the same "pause still lets them reply" philosophy.
  if (!parent.subscription || !LIVE_SUB_STATUSES.includes(parent.subscription.status)) {
    console.log(`[heartbeat] ${parent.name} — no active subscription, skipping`)
    return
  }
  const plan = parent.subscription.plan as Plan
  const maxContactsPerDay = DAILY_CONTACT_CAP[plan]

  // Guardian paused Mae for this parent — no initiations (replies still work).
  // After 4 days paused, remind guardians once that they can unpause.
  if (parent.pausedUntil && parent.pausedUntil > now) {
    if (
      parent.pausedAt &&
      !parent.pauseReminderSentAt &&
      now.getTime() - parent.pausedAt.getTime() >= PAUSE_REMINDER_AFTER_MS
    ) {
      const days = Math.round((now.getTime() - parent.pausedAt.getTime()) / 86_400_000)
      await alertGuardians(parent.id, parent.name, parent.phone,
        `${COMPANION_NAME}'s messages to ${parent.name} have been paused for ${days} days now. You can resume them anytime from the dashboard.`)
      await db.update(parents).set({ pauseReminderSentAt: now }).where(eq(parents.id, parent.id))
    }
    return
  }

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

  // Recent activity (any direction) — fetched once, used for both the cooldown
  // guard below and the unanswered-streak logic further down
  const recentLogs = await db.query.activityLogs.findMany({
    where: eq(activityLogs.parentId, parent.id),
    orderBy: desc(activityLogs.createdAt),
    limit: 10,
  })

  // Hard cooldown: never initiate on top of a conversation that just happened.
  // This is a code-level guard rather than relying on the model to judge
  // "contacted recently enough" — it's what stops a server restart (heartbeat
  // fires immediately on startup) from barging into an active exchange.
  if (recentLogs[0] && now.getTime() - recentLogs[0].createdAt.getTime() < RECENT_ACTIVITY_COOLDOWN_MS) {
    const minsAgo = Math.round((now.getTime() - recentLogs[0].createdAt.getTime()) / 60000)
    console.log(`[heartbeat] ${parent.name} — activity ${minsAgo}m ago, within cooldown, skipping`)
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

  // Don't-pester policy: count consecutive outbound messages since their last
  // reply. At 3 unanswered we stop initiating; 12h later guardians get a heads-up;
  // after 3 days of silence one gentle, zero-pressure re-attempt is allowed.
  let unanswered = 0
  let lastOutboundAt: Date | null = null
  for (const l of recentLogs) {
    if (l.direction === 'inbound') break
    unanswered++
    if (!lastOutboundAt) lastOutboundAt = l.createdAt
  }

  if (unanswered >= NO_REPLY_STREAK && lastOutboundAt) {
    const hoursSilent = (now.getTime() - lastOutboundAt.getTime()) / 3_600_000

    if (hoursSilent >= GUARDIAN_ALERT_AFTER_H && !parent.noReplyAlertedAt) {
      const alerted = await alertGuardians(parent.id, parent.name, parent.phone,
        `${parent.name} hasn't responded to ${COMPANION_NAME}'s last ${unanswered} messages. Might be worth checking in personally.`)
      if (alerted) {
        await db.update(parents).set({ noReplyAlertedAt: now }).where(eq(parents.id, parent.id))
      }
    }

    if (hoursSilent < RETRY_AFTER_H) {
      console.log(`[heartbeat] ${parent.name} — ${unanswered} unanswered messages, backing off (${Math.round(hoursSilent)}h silent)`)
      return
    }
    // 3+ days silent: fall through and let the model send one gentle check-in
  }

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
    maxContactsPerDay,
    todayLogs: logsForContext,
    facts: parent.companionFacts.map(f => ({ label: f.label, value: f.value })),
    reminders: parent.reminders.map(r => r.text),
    unansweredStreak: unanswered,
    isFirstContact: recentLogs.length === 0,
    selfSetup: parent.selfSetup,
  })

  console.log(`[heartbeat] ${parent.name}: ${decision.action} — ${decision.reason}`)

  if (decision.action === 'MESSAGE' && decision.messageText) {
    await sendIMessageCheckin(parent.phone, decision.messageText)

    await db.insert(activityLogs).values({
      parentId: parent.id,
      type: 'message',
      direction: 'outbound',
      summary: `Sent: "${decision.messageText}"`,
      sentiment: 'neutral',
      rawTranscript: decision.messageText,
    })
  }
}

// Notify every guardian of a parent (respecting each one's channel preference).
// Returns false when the parent has no guardians — nothing is sent to anyone.
async function alertGuardians(parentId: string, parentName: string, parentPhone: string, summary: string): Promise<boolean> {
  const links = await db.query.guardianParentLinks.findMany({
    where: eq(guardianParentLinks.parentId, parentId),
    with: { guardian: true },
  })
  if (!links.length) return false

  for (const link of links) {
    await dispatchAlert({
      guardianEmail: link.guardian.email,
      guardianPhone: link.guardian.phone ?? undefined,
      parentPhone,
      notifyVia: link.notifyVia,
      parentName,
      summary,
      isEmergency: false,
    }).catch(err => console.error('[heartbeat] guardian alert failed:', (err as Error).message))
  }
  console.log(`[heartbeat] notified ${links.length} guardian(s) about ${parentName}`)
  return true
}

export function startHeartbeat() {
  console.log(`[heartbeat] started — interval: ${HEARTBEAT_INTERVAL_MS / 60000} min`)
  tick().catch(err => console.error('[heartbeat] tick error:', err))
  return setInterval(() => {
    tick().catch(err => console.error('[heartbeat] tick error:', err))
  }, HEARTBEAT_INTERVAL_MS)
}
