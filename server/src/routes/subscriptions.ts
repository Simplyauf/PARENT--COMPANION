import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/index.js'
import { subscriptions, guardianParentLinks } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { getPaddleInstance, getPortalUrl } from '../lib/paddle.js'
import { PRICE_IDS, SEAT_LIMITS, type Plan, type Cycle } from '../lib/plans.js'

const ChangePlanBody = z.object({
  plan: z.enum(['basic', 'family']),
  cycle: z.enum(['monthly', 'yearly']),
})

export const subscriptionRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /api/billing/plans — price IDs + launch discount code for the
  // dashboard to open a Paddle.js checkout directly (client-side).
  fastify.get('/api/billing/plans', async () => {
    return {
      basic: { monthly: PRICE_IDS.basic.monthly, yearly: PRICE_IDS.basic.yearly },
      family: { monthly: PRICE_IDS.family.monthly, yearly: PRICE_IDS.family.yearly },
      discountCode: process.env.PADDLE_LAUNCH_DISCOUNT_CODE,
    }
  })

  // GET /api/subscriptions/status — one subscription per guardian, covering
  // up to SEAT_LIMITS[plan] parents. Setup uses this to decide whether to
  // show the plan picker, skip straight to the parent form, or prompt an
  // upgrade.
  fastify.get('/api/subscriptions/status', async (request, reply) => {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.guardianId, request.userId),
      orderBy: desc(subscriptions.createdAt),
    })

    if (!sub || !['trialing', 'active', 'past_due'].includes(sub.status)) {
      return { hasSubscription: false }
    }

    const parentCount = await db.query.guardianParentLinks.findMany({
      where: and(eq(guardianParentLinks.guardianId, request.userId), eq(guardianParentLinks.role, 'primary')),
    })

    const capacity = SEAT_LIMITS[sub.plan]
    return {
      hasSubscription: true,
      plan: sub.plan,
      cycle: sub.cycle,
      status: sub.status,
      capacity,
      atCapacity: parentCount.length >= capacity,
    }
  })

  // GET /api/subscriptions/:parentId — billing info for the dashboard.
  // Resolved via the parent's PRIMARY guardian's subscription, not a
  // per-parent one — one subscription can cover several parents.
  fastify.get('/api/subscriptions/:parentId', async (request, reply) => {
    const { parentId } = request.params as { parentId: string }

    const link = await db.query.guardianParentLinks.findFirst({
      where: and(eq(guardianParentLinks.guardianId, request.userId), eq(guardianParentLinks.parentId, parentId)),
    })
    if (!link) return reply.status(403).send({ error: 'Access denied' })

    const primaryLink = await db.query.guardianParentLinks.findFirst({
      where: and(eq(guardianParentLinks.parentId, parentId), eq(guardianParentLinks.role, 'primary')),
    })
    if (!primaryLink) return reply.status(404).send({ error: 'No subscription found' })

    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.guardianId, primaryLink.guardianId),
      orderBy: desc(subscriptions.createdAt),
    })
    if (!sub) return reply.status(404).send({ error: 'No subscription found' })

    return {
      plan: sub.plan,
      cycle: sub.cycle,
      status: sub.status,
      trialEndsAt: sub.trialEndsAt,
      renewsAt: sub.renewsAt,
      endsAt: sub.endsAt,
    }
  })

  // POST /api/subscriptions/portal — mint a fresh Paddle customer portal
  // session for the signed-in guardian's own subscription (one-time-use).
  fastify.post('/api/subscriptions/portal', async (request, reply) => {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.guardianId, request.userId),
      orderBy: desc(subscriptions.createdAt),
    })
    if (!sub?.paddleCustomerId || !sub.paddleSubscriptionId) return reply.status(404).send({ error: 'No subscription found' })

    const url = await getPortalUrl(sub.paddleCustomerId, [sub.paddleSubscriptionId])
    return { url }
  })

  // POST /api/subscriptions/change-plan — upgrade or downgrade in place.
  // Upgrades bill the prorated difference now; downgrades apply at the next
  // renewal instead of issuing a mid-period refund.
  fastify.post('/api/subscriptions/change-plan', async (request, reply) => {
    const parse = ChangePlanBody.safeParse(request.body)
    if (!parse.success) return reply.status(400).send({ error: parse.error.flatten() })
    const { plan, cycle } = parse.data

    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.guardianId, request.userId),
      orderBy: desc(subscriptions.createdAt),
    })
    if (!sub?.paddleSubscriptionId) return reply.status(404).send({ error: 'No subscription found' })

    const newPriceId = PRICE_IDS[plan as Plan][cycle as Cycle]
    if (!newPriceId) return reply.status(400).send({ error: 'That plan is not available right now' })

    const isUpgrade = SEAT_LIMITS[plan as Plan] > SEAT_LIMITS[sub.plan]

    await getPaddleInstance().subscriptions.update(sub.paddleSubscriptionId, {
      items: [{ priceId: newPriceId, quantity: 1 }],
      prorationBillingMode: isUpgrade ? 'prorated_immediately' : 'prorated_next_billing_period',
    })

    // Optimistic — the subscription.updated webhook will also sync this,
    // but the UI shouldn't have to wait for it to reflect the new plan.
    await db.update(subscriptions).set({ plan, cycle, updatedAt: new Date() }).where(eq(subscriptions.id, sub.id))

    return { ok: true }
  })
}
