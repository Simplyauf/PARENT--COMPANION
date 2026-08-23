import { supabase } from './supabase'

const API_URL = (import.meta.env.VITE_API_URL as string) ?? 'http://localhost:3000'

export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new ApiError(401, 'Not signed in')

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  if (!res.ok) {
    let message = res.statusText
    let code: string | undefined
    try {
      const body = await res.json()
      if (typeof body.error === 'string') message = body.error
      if (typeof body.code === 'string') code = body.code
    } catch { /* not JSON */ }
    throw new ApiError(res.status, message, code)
  }

  return res.json() as Promise<T>
}

// ─── Types (match server responses) ───────────────────────────────────────────

export type ApiParent = {
  id: string
  name: string
  phone: string
  timezone: string
  activeHoursFrom: string
  activeHoursTo: string
  isActive: boolean
  pausedUntil: string | null
  createdAt: string
  role: 'primary' | 'co'
  notifyVia: 'imessage' | 'gmail'
  lastContact: string | null
}

export type ApiFact = { id: string; parentId: string; label: string; value: string }
export type ApiReminder = { id: string; parentId: string; text: string }

export type ApiParentDetail = Omit<ApiParent, 'role' | 'notifyVia' | 'lastContact'> & {
  companionFacts: ApiFact[]
  reminders: ApiReminder[]
  summarySchedule: {
    id: string
    frequency: 'weekly' | 'monthly'
    dayOfWeek: number | null
    dayOfMonth: number | null
    sendAt: string
  }[]
}

export type ApiLogEntry = {
  id: string
  type: 'call' | 'message'
  direction: 'inbound' | 'outbound'
  summary: string
  sentiment: 'positive' | 'neutral' | 'alert'
  createdAt: string
}

export type ApiGuardian = {
  id: string
  guardianId: string
  name: string
  email: string
  role: 'primary' | 'co'
  notifyVia: 'imessage' | 'gmail'
}

export type ApiWeeklySummary = {
  overallMood: 'great' | 'good' | 'mixed' | 'concerning'
  moodSentence: string
  notableMoments: string[]
  companionNote: string
  stats: { checkins: number; calls: number; alerts: number }
} | { message: string }

// ─── Endpoints ────────────────────────────────────────────────────────────────

export const getParents = () => api<ApiParent[]>('/api/parents')

export const getParent = (id: string) => api<ApiParentDetail>(`/api/parents/${id}`)

export const createParent = (body: {
  name: string
  phone: string
  timezone: string
  activeHoursFrom: string
  activeHoursTo: string
  notifyVia: 'imessage' | 'gmail'
  guardianPhone?: string
  reminders?: string[]
}) => api<ApiParentDetail>('/api/parents', { method: 'POST', body: JSON.stringify(body) })

export const updateParent = (id: string, body: Partial<{
  name: string
  phone: string
  timezone: string
  activeHoursFrom: string
  activeHoursTo: string
  pauseDays: number // > 0 pauses Mae's check-ins for that many days; 0 resumes
}>) => api<{ ok: true }>(`/api/parents/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const requestCheckin = (parentId: string) =>
  api<{ ok: true; message: string }>(`/api/parents/${parentId}/checkin`, { method: 'POST', body: '{}' })

export const addFact = (parentId: string, label: string, value: string) =>
  api<ApiFact>(`/api/parents/${parentId}/facts`, { method: 'POST', body: JSON.stringify({ label, value }) })

export const deleteFact = (parentId: string, factId: string) =>
  api<{ ok: true }>(`/api/parents/${parentId}/facts/${factId}`, { method: 'DELETE' })

export const addReminder = (parentId: string, text: string) =>
  api<ApiReminder>(`/api/parents/${parentId}/reminders`, { method: 'POST', body: JSON.stringify({ text }) })

export const deleteReminder = (parentId: string, reminderId: string) =>
  api<{ ok: true }>(`/api/parents/${parentId}/reminders/${reminderId}`, { method: 'DELETE' })

export const getActivity = (parentId: string, limit = 50) =>
  api<ApiLogEntry[]>(`/api/dashboard/${parentId}/activity?limit=${limit}`)

export const getWeeklySummary = (parentId: string) =>
  api<ApiWeeklySummary>(`/api/dashboard/${parentId}/summary`)

export const updateSchedule = (parentId: string, body: {
  frequency?: 'weekly' | 'monthly'
  dayOfWeek?: number
  dayOfMonth?: number
  sendAt?: string
}) => api<{ ok: true }>(`/api/dashboard/${parentId}/schedule`, { method: 'PATCH', body: JSON.stringify(body) })

export const getGuardians = (parentId: string) => api<ApiGuardian[]>(`/api/guardians/${parentId}`)

export const getMyGuardianProfile = () => api<{ phone: string | null }>('/api/guardians/me')

export const inviteGuardian = (parentId: string, email: string, notifyVia: 'imessage' | 'gmail') =>
  api<{ ok: true }>('/api/guardians/invite', { method: 'POST', body: JSON.stringify({ parentId, email, notifyVia }) })

export const acceptInvite = (token: string) =>
  api<{ ok: true; parentId: string }>('/api/guardians/accept', { method: 'POST', body: JSON.stringify({ token }) })

export const removeGuardian = (parentId: string, guardianId: string) =>
  api<{ ok: true }>(`/api/guardians/${parentId}/${guardianId}`, { method: 'DELETE' })

// ─── Billing ──────────────────────────────────────────────────────────────────

export type Plan = 'basic' | 'family'
export type Cycle = 'monthly' | 'yearly'

export type ApiSubscription = {
  plan: Plan
  cycle: Cycle
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired'
  trialEndsAt: string | null
  renewsAt: string | null
  endsAt: string | null
}

export type ApiBillingPlans = {
  basic: { monthly?: string; yearly?: string }
  family: { monthly?: string; yearly?: string }
  discountCode?: string
}

export const getBillingPlans = () =>
  api<ApiBillingPlans>('/api/billing/plans')

export type ApiSubscriptionStatus =
  | { hasSubscription: false }
  | { hasSubscription: true; plan: Plan; cycle: Cycle; status: string; capacity: number; atCapacity: boolean }

export const getSubscriptionStatus = () =>
  api<ApiSubscriptionStatus>('/api/subscriptions/status')

export const getSubscription = (parentId: string) =>
  api<ApiSubscription>(`/api/subscriptions/${parentId}`)

export const getCustomerPortal = () =>
  api<{ url: string }>('/api/subscriptions/portal', { method: 'POST', body: '{}' })

export const changePlan = (plan: Plan, cycle: Cycle) =>
  api<{ ok: true }>('/api/subscriptions/change-plan', { method: 'POST', body: JSON.stringify({ plan, cycle }) })
