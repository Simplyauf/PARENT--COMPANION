import { Environment, LogLevel, Paddle, type PaddleOptions } from '@paddle/paddle-node-sdk'

let paddle: Paddle | undefined

export function getPaddleInstance(): Paddle {
  if (paddle) return paddle

  if (!process.env.PADDLE_API_KEY) throw new Error('PADDLE_API_KEY not set')

  const options: PaddleOptions = {
    environment: process.env.PADDLE_ENV === 'production' ? Environment.production : Environment.sandbox,
    logLevel: LogLevel.error,
  }

  paddle = new Paddle(process.env.PADDLE_API_KEY, options)
  return paddle
}

// Portal session URLs are one-time-use and time-limited — mint a fresh one
// per request, never cache.
export async function getPortalUrl(customerId: string, subscriptionIds: string[]): Promise<string> {
  const session = await getPaddleInstance().customerPortalSessions.create(customerId, subscriptionIds)
  return session.urls.general.overview
}
