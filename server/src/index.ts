import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import authPlugin from './plugins/auth.js'
import { webhookRoutes } from './routes/webhooks.js'
import { parentRoutes } from './routes/parents.js'
import { guardianRoutes } from './routes/guardians.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { startHeartbeat } from './heartbeat.js'
import { connectClaw } from './lib/claw.js'

const fastify = Fastify({
  logger: {
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
})

// ─── Plugins ──────────────────────────────────────────────────────────────────

await fastify.register(cors, {
  origin: [process.env.DASHBOARD_URL ?? 'http://localhost:5173'],
  credentials: true,
})

await fastify.register(authPlugin)

// ─── Routes ───────────────────────────────────────────────────────────────────

await fastify.register(webhookRoutes)
await fastify.register(parentRoutes)
await fastify.register(guardianRoutes)
await fastify.register(dashboardRoutes)

// ─── Health check ─────────────────────────────────────────────────────────────

fastify.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3000')

try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`Server running on port ${PORT}`)

  // Connect to Claw Messenger WebSocket (iMessage pipe)
  connectClaw()

  // Start the autonomous heartbeat loop
  startHeartbeat()
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
