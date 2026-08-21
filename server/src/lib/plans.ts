export type Plan = 'basic' | 'family'
export type Cycle = 'monthly' | 'yearly'

// Seat limits enforced when inviting co-guardians
export const SEAT_LIMITS: Record<Plan, number> = { basic: 1, family: 5 }

// Daily self-initiated contact cap enforced by the heartbeat
export const DAILY_CONTACT_CAP: Record<Plan, number> = { basic: 3, family: 8 }

// Paddle price IDs for each plan/cycle combo
export const PRICE_IDS: Record<Plan, Record<Cycle, string | undefined>> = {
  basic: {
    monthly: process.env.PADDLE_PRICE_BASIC_MONTHLY,
    yearly: process.env.PADDLE_PRICE_BASIC_YEARLY,
  },
  family: {
    monthly: process.env.PADDLE_PRICE_FAMILY_MONTHLY,
    yearly: process.env.PADDLE_PRICE_FAMILY_YEARLY,
  },
}
