import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { initializePaddle } from '@paddle/paddle-js'
import { supabase } from '../lib/supabase'
import { acceptInvite, getBillingPlans, type Plan, type Cycle } from '../lib/api'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const handled = useRef(false)

  useEffect(() => {
    // If they arrived via a co-guardian invite, accept it before entering the dashboard
    const onSignedIn = async () => {
      if (handled.current) return
      handled.current = true

      const token = localStorage.getItem('companion_invite_token')
      if (token) {
        try {
          await acceptInvite(token)
        } catch (err) {
          console.warn('Invite accept failed:', (err as Error).message)
        }
        localStorage.removeItem('companion_invite_token')
      }

      // Picked a plan on the landing page: send them straight to checkout
      // instead of the dashboard — Setup waits for the subscription webhook
      const pending = localStorage.getItem('maemate_pending_plan')
      if (pending) {
        localStorage.removeItem('maemate_pending_plan')
        try {
          const { plan, cycle } = JSON.parse(pending) as { plan: Plan; cycle: Cycle }

          const clientToken = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined
          const env = import.meta.env.VITE_PADDLE_ENV as 'sandbox' | 'production' | undefined
          const [paddle, billingPlans, { data: { session } }] = await Promise.all([
            clientToken && env ? initializePaddle({ token: clientToken, environment: env }) : undefined,
            getBillingPlans(),
            supabase.auth.getSession(),
          ])

          const priceId = billingPlans[plan][cycle]
          if (!paddle || !priceId || !session?.user) {
            throw new Error('Checkout not available')
          }

          paddle.Checkout.open({
            items: [{ priceId, quantity: 1 }],
            customer: session.user.email ? { email: session.user.email } : undefined,
            customData: { guardianId: session.user.id, plan, cycle },
            discountCode: billingPlans.discountCode,
            settings: { successUrl: `${window.location.origin}/setup?checkout=success` },
          })
          return
        } catch (err) {
          console.warn('Checkout creation failed, continuing to dashboard:', (err as Error).message)
        }
      }

      navigate('/dashboard')
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
        onSignedIn()
      }
    })

    // Also check current session in case already resolved
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) { setError(error.message); return }
      if (session) onSignedIn()
    })

    return () => subscription.unsubscribe()
  }, [navigate])

  if (error) {
    return (
      <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-[#DC2626] text-sm mb-4">{error}</p>
          <button
            onClick={() => navigate('/auth')}
            className="text-[#1B4D3E] text-sm font-medium hover:underline"
          >
            Try signing in again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-[#1B4D3E] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-[#646D7A] text-sm">Signing you in…</p>
      </div>
    </div>
  )
}
