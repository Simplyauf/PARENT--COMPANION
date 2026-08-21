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
import { activityLogs, guardianParentLinks, subscriptions } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { analyzeTranscript } from '../lib/llm.js'
import { dispatchAlert } from '../lib/notifications.js'
import { getPaddleInstance } from '../lib/paddle.js'
import type { Plan, Cycle } from '../lib/plans.js'

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
    await db.update(subscriptions)
      .set({ status, trialEndsAt, renewsAt, endsAt, updatedAt: new Date() })
      .where(eq(subscriptions.paddleSubscriptionId, sub.id))
    console.log(`[billing] ${event.eventType} → ${sub.id} now ${status}`)
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
