import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/index.js'
import { activityLogs, guardianParentLinks } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { analyzeTranscript } from '../lib/llm.js'
import { dispatchAlert } from '../lib/notifications.js'

const ClawMessageBody = z.object({
  parentId: z.string().uuid(),
  text: z.string().min(1),
  direction: z.enum(['inbound', 'outbound']),
})

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
        notifyVia: link.notifyVia,
        parentName: link.parent.name,
        summary,
        isEmergency,
      })
    )
  )
}
