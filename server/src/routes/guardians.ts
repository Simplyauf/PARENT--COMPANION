import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/index.js'
import { guardianParentLinks, invites, users } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { Resend } from 'resend'
import crypto from 'crypto'

const getResend = () => process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

const InviteBody = z.object({
  parentId: z.string().uuid(),
  email: z.string().email(),
  notifyVia: z.enum(['imessage', 'gmail']).default('imessage'),
})

const AcceptInviteBody = z.object({
  token: z.string().min(1),
})

export const guardianRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /api/guardians/:parentId — list guardians for a parent
  fastify.get('/api/guardians/:parentId', async (request, reply) => {
    const { parentId } = request.params as { parentId: string }

    await assertPrimaryAccess(request.userId, parentId, reply)

    const links = await db.query.guardianParentLinks.findMany({
      where: eq(guardianParentLinks.parentId, parentId),
      with: { guardian: true },
    })

    return links.map(l => ({
      id: l.id,
      guardianId: l.guardianId,
      name: l.guardian.email.split('@')[0],
      email: l.guardian.email,
      role: l.role,
      notifyVia: l.notifyVia,
    }))
  })

  // POST /api/guardians/invite — invite a co-guardian
  fastify.post('/api/guardians/invite', async (request, reply) => {
    const parse = InviteBody.safeParse(request.body)
    if (!parse.success) return reply.status(400).send({ error: parse.error.flatten() })

    const { parentId, email, notifyVia } = parse.data

    await assertPrimaryAccess(request.userId, parentId, reply)

    // Check for existing pending invite
    const existing = await db.query.invites.findFirst({
      where: and(eq(invites.parentId, parentId), eq(invites.email, email)),
    })
    if (existing && !existing.acceptedAt) {
      return reply.status(409).send({ error: 'Invite already sent to this email' })
    }

    const token = crypto.randomBytes(32).toString('hex')

    await db.insert(invites).values({
      email,
      parentId,
      invitedBy: request.userId,
      notifyVia,
      token,
    })

    const inviteUrl = `${process.env.DASHBOARD_URL}/auth?invite=${token}`

    const resend = getResend()
    if (!resend) return reply.status(503).send({ error: 'Email not configured' })

    await resend.emails.send({
      from: 'Companion <invites@companion.app>',
      to: email,
      subject: "You've been invited to Companion",
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #F7F5F0;">
          <p style="font-family: Georgia, serif; font-size: 24px; color: #1B4D3E; margin: 0 0 16px;">You're invited to Companion</p>
          <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
            Someone has added you as a co-guardian. You'll receive updates about your loved one via ${notifyVia === 'gmail' ? 'Gmail' : 'iMessage'}.
          </p>
          <a href="${inviteUrl}" style="display: inline-block; background: #1B4D3E; color: white; text-decoration: none; padding: 12px 24px; border-radius: 10px; font-size: 15px; font-weight: 600;">
            Accept invitation
          </a>
          <p style="color: #6B7280; font-size: 12px; margin-top: 24px;">
            No password needed — the link signs you straight in.
          </p>
        </div>
      `,
    })

    return reply.status(201).send({ ok: true })
  })

  // POST /api/guardians/accept — accept an invite (called after magic link auth)
  fastify.post('/api/guardians/accept', async (request, reply) => {
    const parse = AcceptInviteBody.safeParse(request.body)
    if (!parse.success) return reply.status(400).send({ error: parse.error.flatten() })

    const { token } = parse.data

    const invite = await db.query.invites.findFirst({
      where: eq(invites.token, token),
    })

    if (!invite) return reply.status(404).send({ error: 'Invite not found' })
    if (invite.acceptedAt) return reply.status(409).send({ error: 'Invite already accepted' })
    if (invite.email !== request.userEmail) return reply.status(403).send({ error: 'This invite is for a different email' })

    // Link the new guardian
    await db.insert(guardianParentLinks).values({
      guardianId: request.userId,
      parentId: invite.parentId,
      role: 'co',
      notifyVia: invite.notifyVia,
    }).onConflictDoNothing()

    // Mark invite as accepted
    await db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.token, token))

    return { ok: true, parentId: invite.parentId }
  })

  // DELETE /api/guardians/:parentId/:guardianId — remove a co-guardian
  fastify.delete('/api/guardians/:parentId/:guardianId', async (request, reply) => {
    const { parentId, guardianId } = request.params as { parentId: string; guardianId: string }

    await assertPrimaryAccess(request.userId, parentId, reply)

    // Cannot remove yourself as primary
    if (guardianId === request.userId) {
      return reply.status(400).send({ error: 'Cannot remove yourself as primary guardian' })
    }

    await db.delete(guardianParentLinks).where(
      and(
        eq(guardianParentLinks.parentId, parentId),
        eq(guardianParentLinks.guardianId, guardianId)
      )
    )

    return { ok: true }
  })
}

async function assertPrimaryAccess(userId: string, parentId: string, reply: any) {
  const link = await db.query.guardianParentLinks.findFirst({
    where: and(
      eq(guardianParentLinks.guardianId, userId),
      eq(guardianParentLinks.parentId, parentId)
    ),
  })
  if (!link) return reply.status(403).send({ error: 'Access denied' })
}
