import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/index.js'
import { activityLogs, guardianParentLinks, summarySchedules, parents } from '../db/schema.js'
import { eq, and, gte, desc } from 'drizzle-orm'
import { generateWeeklySummary } from '../lib/llm.js'

export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /api/dashboard/:parentId/activity — paginated activity log
  fastify.get('/api/dashboard/:parentId/activity', async (request, reply) => {
    const { parentId } = request.params as { parentId: string }
    const { limit = '20', offset = '0' } = request.query as { limit?: string; offset?: string }

    await assertAccess(request.userId, parentId, reply)

    const logs = await db.query.activityLogs.findMany({
      where: eq(activityLogs.parentId, parentId),
      orderBy: [desc(activityLogs.createdAt)],
      limit: parseInt(limit),
      offset: parseInt(offset),
    })

    return logs
  })

  // GET /api/dashboard/:parentId/summary — generate (or fetch cached) weekly summary
  fastify.get('/api/dashboard/:parentId/summary', async (request, reply) => {
    const { parentId } = request.params as { parentId: string }

    await assertAccess(request.userId, parentId, reply)

    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const logs = await db.query.activityLogs.findMany({
      where: and(
        eq(activityLogs.parentId, parentId),
        gte(activityLogs.createdAt, sevenDaysAgo)
      ),
      orderBy: [desc(activityLogs.createdAt)],
    })

    const parent = await db.query.parents.findFirst({ where: eq(parents.id, parentId) })

    if (!logs.length) {
      return { message: 'No activity in the last 7 days' }
    }

    const summary = await generateWeeklySummary(
      parent?.name ?? 'your parent',
      logs.map(l => ({ type: l.type, summary: l.summary, sentiment: l.sentiment, createdAt: l.createdAt }))
    )

    return summary
  })

  // PATCH /api/dashboard/:parentId/schedule — update summary schedule
  fastify.patch('/api/dashboard/:parentId/schedule', async (request, reply) => {
    const { parentId } = request.params as { parentId: string }
    const body = request.body as {
      frequency?: 'weekly' | 'monthly'
      dayOfWeek?: number
      dayOfMonth?: number
      sendAt?: string
    }

    await assertAccess(request.userId, parentId, reply)

    await db
      .update(summarySchedules)
      .set(body as any)
      .where(eq(summarySchedules.parentId, parentId))

    return { ok: true }
  })
}

async function assertAccess(userId: string, parentId: string, reply: any) {
  const link = await db.query.guardianParentLinks.findFirst({
    where: and(
      eq(guardianParentLinks.guardianId, userId),
      eq(guardianParentLinks.parentId, parentId)
    ),
  })
  if (!link) return reply.status(403).send({ error: 'Access denied' })
}
