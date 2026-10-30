import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import {
  EventName,
  type SubscriptionCreatedEvent,
  type SubscriptionUpdatedEvent,
  type SubscriptionCanceledEvent,
  type SubscriptionTrialingEvent,
  type SubscriptionPastDueEvent,
  type SubscriptionPausedEvent,
  type SubscriptionResumedEvent,
  type SubscriptionActivatedEvent,
} from '@paddle/paddle-node-sdk'
import { db } from '../db/index.js'
import { activityLogs, guardianParentLinks, subscriptions, users } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { analyzeTranscript, chat, COMPANION_NAME } from '../lib/llm.js'
import { dispatchAlert, dispatchPaymentIssue, sendIMessageCheckin } from '../lib/notifications.js'
import { getPaddleInstance, getPortalUrl } from '../lib/paddle.js'
import { planFromPriceId, type Plan, type Cycle } from '../lib/plans.js'

const ClawMessageBody = z.object({
  parentId: z.string().uuid(),
  text: z.string().min(1),
  direction: z.enum(['inbound', 'outbound']),
})

type SubscriptionEvent =
  | SubscriptionCreatedEvent
  | SubscriptionUpdatedEvent
  | SubscriptionCanceledEvent
  | SubscriptionTrialingEvent
  | SubscriptionPastDueEvent
  | SubscriptionPausedEvent
  | SubscriptionResumedEvent
  | SubscriptionActivatedEvent

const STATUS_MAP: Record<string, typeof subscriptions.$inferInsert.status> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  // Paddle's "paused" has no billing and no access — closest match to our
  // "expired" state (which already drives the reactivate-subscription UI).
  paused: 'expired',
  canceled: 'cancelled',
}

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /api/webhooks/claw-message
  // OpenClaw forwards every inbound/outbound iMessage event here.
  // Configure this URL in the Claw Messenger dashboard as your webhook endpoint.
  fastify.post('/api/webhooks/claw-message', async (request, reply) => {
    const parse = ClawMessageBody.safeParse(request.body)
    if (!parse.success) return reply.status(400).send({ error: parse.error.flatten() })

    const { parentId, text, direction } = parse.data

    // Only run Gemini analysis on inbound replies from the senior
    const analysis = direction === 'inbound'
      ? await analyzeTranscript(text)
      : { summary: text, sentiment: 'neutral' as const, emergency: false, scam: false }

    await db.insert(activityLogs).values({
      parentId,
      type: 'message',
      summary: analysis.summary,
      sentiment: analysis.sentiment,
    })

    if (analysis.sentiment === 'alert' && direction === 'inbound') {
      await notifyGuardians(parentId, analysis.summary, analysis.emergency === true)
    }

    return reply.status(200).send({ ok: true })
  })

  // POST /api/webhooks/paddle — subscription lifecycle events.
  //
  // Pre-validate cheaply (400 on missing signature/body); everything else is
  // one try/catch returning a non-2xx on any failure, so Paddle retries.
  // Only a 2xx marks an event "delivered" — that's the one response that
  // loses an event on a real failure.
  fastify.post('/api/webhooks/paddle', async (request, reply) => {
    const signature = request.headers['paddle-signature'] as string | undefined
    const rawBody = request.rawBody?.toString('utf8')
    const secret = process.env.PADDLE_NOTIFICATION_WEBHOOK_SECRET

    if (!signature || !rawBody || !secret) {
      return reply.status(400).send({ error: 'Missing signature, body, or webhook secret' })
    }

    try {
      const event = await getPaddleInstance().webhooks.unmarshal(rawBody, secret, signature)
      if (!event) return reply.status(200).send({ ok: true })

      switch (event.eventType) {
        case EventName.SubscriptionCreated:
        case EventName.SubscriptionUpdated:
        case EventName.SubscriptionCanceled:
        case EventName.SubscriptionTrialing:
        case EventName.SubscriptionPastDue:
        case EventName.SubscriptionPaused:
        case EventName.SubscriptionResumed:
        case EventName.SubscriptionActivated:
          await upsertSubscription(event as SubscriptionEvent)
          break
        default:
          // Not an event type we act on — no-op.
          break
      }

      return reply.status(200).send({ ok: true })
    } catch (err) {
      fastify.log.error(err, '[billing] paddle webhook error')
      return reply.status(500).send({ error: 'Internal error' })
    }
  })
}

async function upsertSubscription(event: SubscriptionEvent) {
  const sub = event.data
  const status = STATUS_MAP[sub.status] ?? 'active'

  const trialEndsAt = sub.status === 'trialing' && sub.currentBillingPeriod
    ? new Date(sub.currentBillingPeriod.endsAt)
    : undefined
  const renewsAt = sub.nextBilledAt ? new Date(sub.nextBilledAt) : undefined
  const endsAt = sub.scheduledChange?.effectiveAt
    ? new Date(sub.scheduledChange.effectiveAt)
    : sub.status === 'canceled' ? new Date() : undefined

  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.paddleSubscriptionId, sub.id),
  })

  if (existing) {
    // Plan/cycle can change outside our own change-plan endpoint too (the
    // Paddle customer portal supports upgrades/downgrades directly) — resync
    // from whatever price is actually on the subscription now.
    const priceId = sub.items?.[0]?.price?.id
    const resolved = priceId ? planFromPriceId(priceId) : undefined

    await db.update(subscriptions)
      .set({
        status, trialEndsAt, renewsAt, endsAt,
        ...(resolved ? { plan: resolved.plan, cycle: resolved.cycle } : {}),
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.paddleSubscriptionId, sub.id))
    console.log(`[billing] ${event.eventType} → ${sub.id} now ${status}${resolved ? ` (${resolved.plan}/${resolved.cycle})` : ''}`)

    // Only fire on the transition INTO past_due, not every webhook ping
    // while it stays there — and only to the guardian, never through Mae's
    // thread with the parent.
    if (existing.status !== 'past_due' && status === 'past_due') {
      const guardian = await db.query.users.findFirst({ where: eq(users.id, existing.guardianId) })
      if (guardian && existing.paddleCustomerId) {
        const portalUrl = await getPortalUrl(existing.paddleCustomerId, [sub.id])
        const parentNames = (await getGuardianParents(existing.guardianId)).map(p => p.name)
        await dispatchPaymentIssue({ guardianEmail: guardian.email, guardianPhone: guardian.phone, portalUrl, parentNames })
      }
    }

    // Fully lapsed (not just past_due) — Mae has to actually stop, so each
    // parent gets one gentle sign-off in her own voice, never mentioning
    // money or billing. Only on the transition in, not every ping after.
    const wasLapsed = existing.status === 'cancelled' || existing.status === 'expired'
    const nowLapsed = status === 'cancelled' || status === 'expired'
    if (!wasLapsed && nowLapsed) {
      await notifyParentsOfLapse(existing.guardianId)
    }
    return
  }

  // First time we've seen this subscription — needs guardianId/plan/cycle,
  // which only live in customData (set client-side when checkout opened).
  const guardianId = sub.customData?.guardianId as string | undefined
  const plan = sub.customData?.plan as Plan | undefined
  const cycle = sub.customData?.cycle as Cycle | undefined

  if (!guardianId || !plan || !cycle) {
    console.warn(`[billing] ${event.eventType} for ${sub.id} missing customData — cannot link to a guardian`, sub.customData)
    return
  }

  await db.insert(subscriptions).values({
    guardianId,
    plan,
    cycle,
    status,
    paddleSubscriptionId: sub.id,
    paddleCustomerId: sub.customerId,
    trialEndsAt,
    renewsAt,
    endsAt,
  })
  console.log(`[billing] subscription created for guardian ${guardianId}: ${plan}/${cycle}`)
}

async function getGuardianParents(guardianId: string) {
  const links = await db.query.guardianParentLinks.findMany({
    where: and(eq(guardianParentLinks.guardianId, guardianId), eq(guardianParentLinks.role, 'primary')),
    with: { parent: true },
  })
  return links.map(l => l.parent)
}

// Subscription fully lapsed — Mae has to stop, but the parent should never
// hear anything about "nobody's paying for me anymore" — but it's fine to
// name what happened plainly (the subscription ran out) as long as whatever
// we ask them to do about it is something they can actually act on.
// One warm, in-character sign-off per parent, generated once and sent once.
async function notifyParentsOfLapse(guardianId: string) {
  const affected = await getGuardianParents(guardianId)

  await Promise.allSettled(affected.map(async parent => {
    const situation = parent.selfSetup
      ? `Their subscription has run out, so you have to pause checking in — they set you up themselves, with no one else involved, so they're the one who'd renew it.`
      : `Their family's subscription has run out, so you have to pause checking in.`

    const msg = await chat([
      {
        role: 'user',
        content: `You are ${COMPANION_NAME}, a warm friend who has been texting ${parent.name}, an elderly person you check in on. ${situation} Write a short, gentle goodbye-for-now message — you're not sure when you'll be back, but you've enjoyed getting to know them. It's fine to plainly say the subscription ran out. ${parent.selfSetup ? "Mention they can renew it themselves at maemate.com to get you checking in again." : "Give them one concrete, actionable thing to do: gently ask them to let their family know, so family can renew it and get you checking in again — phrase it as something THEY can do (tell family), not something they need to log into or manage themselves, they don't have an account."} 1–2 sentences, warm, like a real friend, never robotic. Reply with ONLY the text message, nothing else.`,
      },
    ], { temperature: 0.8 })

    const text = msg.content?.trim()
    if (!text) return

    await sendIMessageCheckin(parent.phone, text)
    await db.insert(activityLogs).values({
      parentId: parent.id,
      type: 'message',
      direction: 'outbound',
      summary: `Subscription lapsed — sent sign-off: "${text.slice(0, 120)}"`,
      sentiment: 'neutral',
      rawTranscript: text,
    })
  }))
}

async function notifyGuardians(parentId: string, summary: string, isEmergency: boolean) {
  const links = await db.query.guardianParentLinks.findMany({
    where: eq(guardianParentLinks.parentId, parentId),
    with: { guardian: true, parent: true },
  })

  await Promise.allSettled(
    links.map(link =>
      dispatchAlert({
        guardianEmail: link.guardian.email,
        guardianPhone: link.guardian.phone ?? undefined,
        parentPhone: link.parent.phone,
        notifyVia: link.notifyVia,
        parentName: link.parent.name,
        summary,
        isEmergency,
      })
    )
  )
}
