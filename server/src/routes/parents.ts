import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/index.js'
import { parents, guardianParentLinks, companionFacts, reminders, summarySchedules, users, activityLogs, subscriptions } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { registerPhone } from '../lib/claw.js'
import { chat, COMPANION_NAME } from '../lib/llm.js'
import { sendIMessageCheckin } from '../lib/notifications.js'
import { SEAT_LIMITS } from '../lib/plans.js'

const CreateParentBody = z.object({
  name: z.string().min(1),
  phone: z.string().min(7),
  timezone: z.string().default('America/New_York'),
  activeHoursFrom: z.string().default('09:00'),
  activeHoursTo: z.string().default('20:00'),
  notifyVia: z.enum(['imessage', 'gmail']).default('imessage'),
  guardianPhone: z.string().optional(),
  reminders: z.array(z.string()).optional(),
  facts: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
})

const UpdateParentBody = CreateParentBody.partial().omit({ notifyVia: true, guardianPhone: true }).extend({
  // days > 0 pauses Mae's initiations for that long; null/0 resumes
  pauseDays: z.number().min(0).max(90).nullable().optional(),
})

const normalizePhone = (p: string) => p.replace(/[^\d+]/g, '')

export const parentRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /api/parents — list all parents this guardian manages
  fastify.get('/api/parents', async (request, reply) => {
    const links = await db.query.guardianParentLinks.findMany({
      where: eq(guardianParentLinks.guardianId, request.userId),
      with: {
        parent: {
          with: {
            activityLogs: { limit: 1, orderBy: (t, { desc }) => [desc(t.createdAt)] },
          },
        },
      },
    })

    return links.map(l => ({
      ...l.parent,
      role: l.role,
      notifyVia: l.notifyVia,
      lastContact: l.parent.activityLogs[0]?.createdAt ?? null,
    }))
  })

  // POST /api/parents — create new parent + link to guardian
  fastify.post('/api/parents', async (request, reply) => {
    const parse = CreateParentBody.safeParse(request.body)
    if (!parse.success) return reply.status(400).send({ error: parse.error.flatten() })

    const { name, phone, timezone, activeHoursFrom, activeHoursTo, notifyVia, guardianPhone, reminders: reminderTexts, facts } = parse.data

    // A guardian can't also be the elder — Mae texts the elder directly, so
    // they need their own number, distinct from the guardian's
    const self = await db.query.users.findFirst({ where: eq(users.id, request.userId) })
    const ownPhone = guardianPhone ?? self?.phone
    if (ownPhone && normalizePhone(ownPhone) === normalizePhone(phone)) {
      return reply.status(400).send({
        error: `Your loved one's phone number can't be the same as your own — they need their own number so ${COMPANION_NAME} can text them directly.`,
      })
    }

    // One subscription per guardian, covering up to SEAT_LIMITS[plan] parents —
    // not one subscription per parent.
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.guardianId, request.userId),
      orderBy: desc(subscriptions.createdAt),
    })
    if (!sub || !['trialing', 'active', 'past_due'].includes(sub.status)) {
      return reply.status(402).send({ error: 'Complete checkout before adding a companion.', code: 'no_subscription' })
    }

    const existingParents = await db.query.guardianParentLinks.findMany({
      where: and(eq(guardianParentLinks.guardianId, request.userId), eq(guardianParentLinks.role, 'primary')),
    })
    if (existingParents.length >= SEAT_LIMITS[sub.plan]) {
      return reply.status(402).send({
        error: `Your ${sub.plan} plan covers up to ${SEAT_LIMITS[sub.plan]} companion${SEAT_LIMITS[sub.plan] === 1 ? '' : 's'} — upgrade to add another.`,
        code: 'capacity_reached',
      })
    }

    if (guardianPhone) {
      await db.update(users).set({ phone: guardianPhone }).where(eq(users.id, request.userId))
    }

    const [parent] = await db.insert(parents).values({
      name, phone, timezone,
      activeHoursFrom: activeHoursFrom as `${number}:${number}`,
      activeHoursTo: activeHoursTo as `${number}:${number}`,
    }).returning()

    await db.insert(guardianParentLinks).values({
      guardianId: request.userId,
      parentId: parent.id,
      role: 'primary',
      notifyVia,
    })

    if (reminderTexts?.length) {
      await db.insert(reminders).values(reminderTexts.map(text => ({ parentId: parent.id, text })))
    }

    if (facts?.length) {
      await db.insert(companionFacts).values(facts.map(f => ({ parentId: parent.id, ...f })))
    }

    // Default weekly summary schedule (Sundays at 6 PM)
    await db.insert(summarySchedules).values({ parentId: parent.id, frequency: 'weekly', dayOfWeek: 6, sendAt: '18:00' })

    // Register phone with Claw Messenger so inbound replies are routed to us
    await registerPhone(phone).catch(err => console.warn('[claw] phone register failed:', err.message))

    return reply.status(201).send(parent)
  })

  // GET /api/parents/:id
  fastify.get('/api/parents/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    await assertAccess(request.userId, id, reply)

    const parent = await db.query.parents.findFirst({
      where: eq(parents.id, id),
      with: {
        companionFacts: true,
        reminders: true,
        summarySchedule: true,
        guardianLinks: { with: { guardian: true } },
      },
    })

    if (!parent) return reply.status(404).send({ error: 'Not found' })
    return parent
  })

  // PATCH /api/parents/:id
  fastify.patch('/api/parents/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const parse = UpdateParentBody.safeParse(request.body)
    if (!parse.success) return reply.status(400).send({ error: parse.error.flatten() })

    await assertAccess(request.userId, id, reply)

    const { reminders: reminderTexts, facts, pauseDays, ...fields } = parse.data

    if (Object.keys(fields).length) {
      await db.update(parents).set(fields as Partial<typeof parents.$inferInsert>).where(eq(parents.id, id))
    }

    if (pauseDays !== undefined) {
      if (!pauseDays) {
        await db.update(parents)
          .set({ pausedUntil: null, pausedAt: null, pauseReminderSentAt: null })
          .where(eq(parents.id, id))
      } else {
        await db.update(parents)
          .set({
            pausedUntil: new Date(Date.now() + pauseDays * 86_400_000),
            pausedAt: new Date(),
            pauseReminderSentAt: null,
          })
          .where(eq(parents.id, id))
      }
    }

    return reply.status(200).send({ ok: true })
  })

  // POST /api/parents/:id/checkin — send an immediate check-in text right now
  fastify.post('/api/parents/:id/checkin', async (request, reply) => {
    const { id } = request.params as { id: string }

    await assertAccess(request.userId, id, reply)

    const parent = await db.query.parents.findFirst({
      where: eq(parents.id, id),
      with: { companionFacts: true },
    })
    if (!parent) return reply.status(404).send({ error: 'Not found' })

    const factsText = parent.companionFacts.map(f => `${f.label}: ${f.value}`).join(', ') || 'nothing yet'

    const priorContact = await db.query.activityLogs.findFirst({ where: eq(activityLogs.parentId, parent.id) })
    const isFirstContact = !priorContact

    const msg = await chat([
      {
        role: 'user',
        content: `You are ${COMPANION_NAME}, a warm friend who texts ${parent.name}, an elderly person you check in on. What you know about them: ${factsText}.

Their guardian asked you to check in on them right now. ${isFirstContact
          ? `This is the very FIRST message you've ever sent them — briefly introduce yourself by name and mention their family asked you to check in and that you'll share how they're doing with them, warmly, like a friend being introduced, then move into a light easy question.`
          : `Write a warm, casual check-in text.`
        } 1–2 sentences, like a real friend texting, never robotic. Reply with ONLY the text message, nothing else.`,
      },
    ], { temperature: 0.8 })

    const text = msg.content?.trim()
    if (!text) return reply.status(502).send({ error: 'Could not generate message' })

    await sendIMessageCheckin(parent.phone, text)

    await db.insert(activityLogs).values({
      parentId: parent.id,
      type: 'message',
      direction: 'outbound',
      summary: `Guardian-requested check-in: "${text.slice(0, 120)}"`,
      sentiment: 'neutral',
      rawTranscript: text,
    })

    return { ok: true, message: text }
  })

  // ─── Companion facts ─────────────────────────────────────────────────────

  fastify.post('/api/parents/:id/facts', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { label, value } = request.body as { label: string; value: string }

    await assertAccess(request.userId, id, reply)

    const [fact] = await db.insert(companionFacts).values({ parentId: id, label, value }).returning()
    return reply.status(201).send(fact)
  })

  fastify.delete('/api/parents/:id/facts/:factId', async (request, reply) => {
    const { id, factId } = request.params as { id: string; factId: string }
    await assertAccess(request.userId, id, reply)
    await db.delete(companionFacts).where(and(eq(companionFacts.id, factId), eq(companionFacts.parentId, id)))
    return { ok: true }
  })

  // ─── Reminders ───────────────────────────────────────────────────────────

  fastify.post('/api/parents/:id/reminders', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { text } = request.body as { text: string }

    await assertAccess(request.userId, id, reply)

    const [reminder] = await db.insert(reminders).values({ parentId: id, text }).returning()
    return reply.status(201).send(reminder)
  })

  fastify.delete('/api/parents/:id/reminders/:reminderId', async (request, reply) => {
    const { id, reminderId } = request.params as { id: string; reminderId: string }
    await assertAccess(request.userId, id, reply)
    await db.delete(reminders).where(and(eq(reminders.id, reminderId), eq(reminders.parentId, id)))
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
