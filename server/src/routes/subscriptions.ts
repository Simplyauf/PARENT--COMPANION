import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/index.js'
import { subscriptions, guardianParentLinks } from '../db/schema.js'
import { eq, and, isNull, desc } from 'drizzle-orm'
import { getPortalUrl } from '../lib/paddle.js'
import { PRICE_IDS } from '../lib/plans.js'

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

  // GET /api/subscriptions/pending — does this guardian have a subscription
  // from checkout that hasn't been linked to a parent yet? Polled by the Setup
  // wizard while it waits for the Paddle webhook to land.
  fastify.get('/api/subscriptions/pending', async (request, reply) => {
    const pending = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.guardianId, request.userId),
        isNull(subscriptions.parentId)
      ),
      orderBy: desc(subscriptions.createdAt),
    })

    if (!pending || !['trialing', 'active'].includes(pending.status)) {
      return { ready: false }
    }
    return { ready: true, plan: pending.plan, cycle: pending.cycle }
  })

  // GET /api/subscriptions/:parentId — billing info for the dashboard
  fastify.get('/api/subscriptions/:parentId', async (request, reply) => {
    const { parentId } = request.params as { parentId: string }

    const link = await db.query.guardianParentLinks.findFirst({
      where: and(eq(guardianParentLinks.guardianId, request.userId), eq(guardianParentLinks.parentId, parentId)),
    })
    if (!link) return reply.status(403).send({ error: 'Access denied' })

    const sub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.parentId, parentId) })
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

  // POST /api/subscriptions/:parentId/portal — mint a fresh Paddle customer
  // portal session (one-time-use, never cached).
  fastify.post('/api/subscriptions/:parentId/portal', async (request, reply) => {
    const { parentId } = request.params as { parentId: string }

    const link = await db.query.guardianParentLinks.findFirst({
      where: and(eq(guardianParentLinks.guardianId, request.userId), eq(guardianParentLinks.parentId, parentId)),
    })
    if (!link) return reply.status(403).send({ error: 'Access denied' })

    const sub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.parentId, parentId) })
    if (!sub?.paddleCustomerId || !sub.paddleSubscriptionId) return reply.status(404).send({ error: 'No subscription found' })

    const url = await getPortalUrl(sub.paddleCustomerId, [sub.paddleSubscriptionId])
    return { url }
  })
}
