import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { createClient } from '@supabase/supabase-js'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'

declare module 'fastify' {
  interface FastifyRequest {
    userId: string
    userEmail: string
  }
}

// Using Supabase admin client for token verification — handles both HS256 (legacy)
// and ECC P-256 (current) signing keys automatically via getUser().

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('userId', '')
  fastify.decorateRequest('userEmail', '')

  fastify.addHook('preHandler', async (request: FastifyRequest, reply) => {
    const publicPaths = ['/health', '/api/webhooks/']
    if (publicPaths.some(p => request.url.startsWith(p))) return

    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing authorization header' })
    }

    const token = authHeader.slice(7)

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)

    if (error || !user?.email) {
      return reply.status(401).send({ error: 'Invalid or expired token' })
    }

    // Upsert user row on first request (mirrors Supabase auth.users)
    await db
      .insert(users)
      .values({ id: user.id, email: user.email })
      .onConflictDoNothing()

    request.userId = user.id
    request.userEmail = user.email
  })
}

export default fp(authPlugin, { name: 'auth' })
