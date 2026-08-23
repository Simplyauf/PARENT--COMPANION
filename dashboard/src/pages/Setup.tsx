import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Plus, X, MessageCircle, Mail, AlertCircle, Heart, Users, Check } from 'lucide-react'
import { initializePaddle, CheckoutEventNames, type Paddle } from '@paddle/paddle-js'
import { createParent, getBillingPlans, getSubscriptionStatus, getCustomerPortal, changePlan, getMyGuardianProfile, getParents, ApiError, type ApiBillingPlans, type ApiSubscriptionStatus, type Plan, type Cycle } from '../lib/api'
import { supabase } from '../lib/supabase'

const BILLING_PLANS: { id: Plan; name: string; icon: typeof Heart; monthly: number; yearly: number; blurb: string; capacity: number }[] = [
  { id: 'basic', name: 'Basic', icon: Heart, monthly: 12, yearly: 120, blurb: 'One companion, one person', capacity: 1 },
  { id: 'family', name: 'Family', icon: Users, monthly: 22, yearly: 216, blurb: 'Up to 5 companions or guardians', capacity: 5 },
]

const TIMEZONES = [
  { value: 'America/New_York', label: 'America/New_York (EST)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST)' },
  { value: 'America/Denver', label: 'America/Denver (MST)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST)' },
  { value: 'Europe/London', label: 'Europe/London (GMT)' },
  { value: 'Africa/Lagos', label: 'Africa/Lagos (WAT)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
]

type BillingGate = 'checking' | 'polling' | 'poll-timeout' | 'picking-plan' | 'starting-checkout' | 'ready' | 'at-capacity'

export default function Setup() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const navState = location.state as { role?: string; plan?: Plan; cycle?: Cycle } | null
  const role = navState?.role ?? 'guardian'
  const isGuardian = role === 'guardian'

  // ─── Billing gate: one subscription per guardian, covering up to a plan's
  // capacity in parents — not one subscription per parent. ──────────────────
  const [billingGate, setBillingGate] = useState<BillingGate>('checking')
  const [pickedPlan, setPickedPlan] = useState<Plan>(navState?.plan ?? 'basic')
  const [pickedCycle, setPickedCycle] = useState<Cycle>(navState?.cycle ?? 'monthly')
  const [billingError, setBillingError] = useState<string | null>(null)
  const [currentPlan, setCurrentPlan] = useState<Extract<ApiSubscriptionStatus, { hasSubscription: true }> | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)
  const pollTries = useRef(0)

  const paddleRef = useRef<Paddle | null>(null)
  const billingPlansRef = useRef<ApiBillingPlans | null>(null)

  const checkSubscription = async () => {
    try {
      const status = await getSubscriptionStatus()
      if (status.hasSubscription) {
        setCurrentPlan(status)
        setBillingGate(status.atCapacity ? 'at-capacity' : 'ready')
        return true
      }
    } catch { /* treat as no subscription */ }
    return false
  }

  useEffect(() => {
    const clientToken = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined
    const env = import.meta.env.VITE_PADDLE_ENV as 'sandbox' | 'production' | undefined
    if (clientToken && env) {
      initializePaddle({
        token: clientToken,
        environment: env,
        eventCallback: (event) => {
          // User closed the overlay or something went wrong opening it —
          // un-stick the "Starting checkout…" button so they can retry.
          if (event.name === CheckoutEventNames.CHECKOUT_CLOSED || event.name === CheckoutEventNames.CHECKOUT_ERROR) {
            setBillingGate(g => g === 'starting-checkout' ? 'picking-plan' : g)
            if (event.name === CheckoutEventNames.CHECKOUT_ERROR) {
              setBillingError('Something went wrong opening checkout — try again')
            }
          }
        },
      }).then(p => {
        if (p) paddleRef.current = p
      })
    }
    getBillingPlans().then(plans => { billingPlansRef.current = plans }).catch(() => { /* surfaced at checkout time */ })
  }, [])

  useEffect(() => {
    (async () => {
      if (await checkSubscription()) return

      if (searchParams.get('checkout') === 'success') {
        // Just came back from Paddle checkout — webhook may take a few seconds
        setBillingGate('polling')
        const interval = setInterval(async () => {
          pollTries.current += 1
          if (await checkSubscription()) { clearInterval(interval); return }
          if (pollTries.current >= 10) {
            clearInterval(interval)
            setBillingGate('poll-timeout')
          }
        }, 2000)
        return () => clearInterval(interval)
      }

      // No subscription at all yet — fresh onboarding
      setBillingGate('picking-plan')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openUpgrade = async () => {
    setPortalLoading(true)
    try {
      const { url } = await getCustomerPortal()
      window.location.href = url
    } catch {
      setBillingError('Could not open billing — try again')
      setPortalLoading(false)
    }
  }

  const [changingPlan, setChangingPlan] = useState<Plan | null>(null)

  const handleChangePlan = async (plan: Plan, cycle: Cycle) => {
    setBillingError(null)
    setChangingPlan(plan)
    try {
      await changePlan(plan, cycle)
      await checkSubscription() // re-syncs billingGate — 'ready' if this opened up room
    } catch (err) {
      setBillingError((err as Error).message || 'Could not change plan — try again')
    } finally {
      setChangingPlan(null)
    }
  }

  const startCheckout = async () => {
    setBillingError(null)

    const paddle = paddleRef.current
    if (!paddle) {
      setBillingError('Checkout is still loading — try again in a moment')
      return
    }

    const priceId = billingPlansRef.current?.[pickedPlan]?.[pickedCycle]
    if (!priceId) {
      setBillingError('This plan is not available right now — try again in a moment')
      return
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      setBillingError('Not signed in — try refreshing the page')
      return
    }

    setBillingGate('starting-checkout')
    paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customer: session.user.email ? { email: session.user.email } : undefined,
      customData: { guardianId: session.user.id, plan: pickedPlan, cycle: pickedCycle },
      discountCode: billingPlansRef.current?.discountCode,
      settings: {
        successUrl: `${window.location.origin}/setup?checkout=success`,
      },
    })
  }

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [timezone, setTimezone] = useState('')
  const [guardianPhone, setGuardianPhone] = useState('')
  const [notifyVia, setNotifyVia] = useState<'imessage' | 'gmail'>('imessage')
  const [activeFrom, setActiveFrom] = useState('09:00')
  const [activeTo, setActiveTo] = useState('20:00')
  const [reminders, setReminders] = useState<string[]>([''])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingParentNames, setExistingParentNames] = useState<string[]>([])

  // Prefill "your contact" with whatever this guardian already has on file —
  // set the first time they added a parent, so it shouldn't be retyped for the next one
  useEffect(() => {
    getMyGuardianProfile()
      .then(({ phone }) => { if (phone) setGuardianPhone(phone) })
      .catch(() => { /* no saved phone yet — leave blank */ })
  }, [])

  // Prefill timezone + active hours from the guardian's most recently added
  // parent — likely the same household/schedule, unlike name/phone which are
  // always specific to whoever's being set up right now
  useEffect(() => {
    getParents()
      .then(parents => {
        if (!parents.length) return
        setExistingParentNames(parents.map(p => p.name))

        const latest = [...parents].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        setTimezone(latest.timezone)
        setActiveFrom(latest.activeHoursFrom)
        setActiveTo(latest.activeHoursTo)
      })
      .catch(() => { /* no prior parent — leave defaults */ })
  }, [])

  const addReminder = () => setReminders(r => [...r, ''])
  const removeReminder = (i: number) => setReminders(r => r.filter((_, idx) => idx !== i))
  const updateReminder = (i: number, val: string) =>
    setReminders(r => r.map((item, idx) => (idx === i ? val : item)))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)

    try {
      const parent = await createParent({
        name: name.trim(),
        phone: phone.trim().replace(/[\s()-]/g, ''),
        timezone: timezone || 'Africa/Lagos',
        activeHoursFrom: activeFrom,
        activeHoursTo: activeTo,
        notifyVia,
        guardianPhone: guardianPhone.trim().replace(/[\s()-]/g, '') || undefined,
        reminders: reminders.map(r => r.trim()).filter(Boolean),
      })
      navigate('/activate', { state: { parentId: parent.id, parentName: parent.name } })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'capacity_reached') {
        setBillingGate('at-capacity')
        setSubmitting(false)
        return
      }
      setError((err as Error).message || 'Something went wrong — try again')
      setSubmitting(false)
    }
  }

  // ─── Billing gate screens — shown before the parent form ────────────────────
  if (billingGate === 'checking' || billingGate === 'polling') {
    return (
      <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#1B4D3E] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#646D7A] text-sm">
            {billingGate === 'polling' ? 'Confirming your subscription…' : 'Loading…'}
          </p>
        </div>
      </div>
    )
  }

  if (billingGate === 'at-capacity') {
    const capacity = currentPlan?.capacity ?? 1
    return (
      <div className="min-h-screen bg-[#F7F5F0] px-4 py-10">
        <div className="w-full max-w-md mx-auto">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1.5 text-[#646D7A] text-sm mb-8 hover:text-[#1A1A1A] transition-colors">
            <ArrowLeft size={16} /> Back to dashboard
          </button>

          <div className="mb-6">
            <p className="text-[#D97706] font-medium text-sm tracking-widest uppercase mb-2">Plan limit reached</p>
            <h2 className="text-3xl text-[#1A1A1A]" style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}>
              Upgrade to add another
            </h2>
            <p className="text-[#646D7A] text-sm mt-2">
              Your current plan covers up to {capacity} companion{capacity === 1 ? '' : 's'}.
            </p>
          </div>

          <div className="flex justify-center mb-6">
            <div className="inline-flex bg-white border border-[#E5E1D8] rounded-full p-1">
              {(['monthly', 'yearly'] as const).map(c => (
                <button
                  key={c}
                  onClick={() => setPickedCycle(c)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors capitalize ${pickedCycle === c ? 'bg-[#1B4D3E] text-white' : 'text-[#646D7A]'}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 mb-4">
            {BILLING_PLANS.map(p => {
              const cycle = currentPlan?.plan === p.id ? currentPlan.cycle : pickedCycle
              const price = cycle === 'monthly' ? p.monthly : p.yearly
              const isActive = currentPlan?.plan === p.id
              const isUpgrade = p.capacity > capacity
              const isDowngrade = p.capacity < capacity
              return (
                <div
                  key={p.id}
                  className={`w-full bg-white border rounded-2xl p-5 flex items-center gap-4 ${isActive ? 'border-[#1B4D3E] ring-1 ring-[#1B4D3E]' : 'border-[#E5E1D8]'}`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-[#1B4D3E]' : 'bg-[#F7F5F0]'}`}>
                    <p.icon size={18} className={isActive ? 'text-white' : 'text-[#1B4D3E]'} />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-[#1A1A1A] text-sm">{p.name}</p>
                    <p className="text-xs text-[#646D7A]">{p.blurb}</p>
                    <p className="text-xs text-[#1A1A1A] font-medium mt-0.5">
                      ${price}<span className="font-normal text-[#646D7A]">/{cycle === 'monthly' ? 'mo' : 'yr'}</span>
                    </p>
                  </div>
                  {isActive ? (
                    <span className="text-xs font-semibold text-[#1B4D3E] bg-[#1B4D3E]/10 px-3 py-1.5 rounded-full flex-shrink-0">
                      Active
                    </span>
                  ) : (
                    <button
                      onClick={() => handleChangePlan(p.id, pickedCycle)}
                      disabled={changingPlan !== null}
                      className="text-xs font-semibold text-white bg-[#1B4D3E] hover:bg-[#2D6A56] px-3.5 py-2 rounded-full flex-shrink-0 transition-colors disabled:opacity-60"
                    >
                      {changingPlan === p.id ? '…' : isUpgrade ? 'Upgrade' : isDowngrade ? 'Downgrade' : 'Switch'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {billingError && <p className="text-xs text-[#DC2626] mb-4">{billingError}</p>}

          <button
            onClick={openUpgrade}
            disabled={portalLoading}
            className="text-[#646D7A] text-xs hover:text-[#1A1A1A] transition-colors disabled:opacity-60"
          >
            {portalLoading ? 'Opening…' : 'Manage billing, payment method, or cancel'}
          </button>
        </div>
      </div>
    )
  }

  if (billingGate === 'poll-timeout') {
    return (
      <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <AlertCircle size={24} className="text-[#D97706] mx-auto mb-3" />
          <p className="text-[#1A1A1A] text-sm mb-1">Still confirming your subscription</p>
          <p className="text-[#646D7A] text-xs mb-4">This can take a few extra seconds. If it doesn't resolve, your payment may not have completed.</p>
          <button
            onClick={() => { pollTries.current = 0; setBillingGate('checking'); checkSubscription().then(ok => !ok && setBillingGate('picking-plan')) }}
            className="text-[#1B4D3E] text-sm font-medium hover:underline"
          >
            Check again
          </button>
        </div>
      </div>
    )
  }

  if (billingGate === 'picking-plan' || billingGate === 'starting-checkout') {
    return (
      <div className="min-h-screen bg-[#F7F5F0] px-4 py-10">
        <div className="w-full max-w-md mx-auto">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-[#646D7A] text-sm mb-8 hover:text-[#1A1A1A] transition-colors">
            <ArrowLeft size={16} /> Back
          </button>

          <div className="mb-6">
            <p className="text-[#1B4D3E] font-medium text-sm tracking-widest uppercase mb-2">Choose a plan</p>
            <h2 className="text-3xl text-[#1A1A1A]" style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}>
              Start your subscription
            </h2>
            <p className="text-[#646D7A] text-sm mt-2">One plan covers your whole account — 7-day free trial, cancel anytime.</p>
          </div>

          <div className="flex justify-center mb-6">
            <div className="inline-flex bg-white border border-[#E5E1D8] rounded-full p-1">
              {(['monthly', 'yearly'] as const).map(c => (
                <button
                  key={c}
                  onClick={() => setPickedCycle(c)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors capitalize ${pickedCycle === c ? 'bg-[#1B4D3E] text-white' : 'text-[#646D7A]'}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 mb-6">
            {BILLING_PLANS.map(p => {
              const price = pickedCycle === 'monthly' ? p.monthly : p.yearly
              const selected = pickedPlan === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => setPickedPlan(p.id)}
                  className={`w-full text-left bg-white border rounded-2xl p-5 flex items-center gap-4 transition-all ${selected ? 'border-[#1B4D3E] ring-1 ring-[#1B4D3E]' : 'border-[#E5E1D8] hover:border-[#1B4D3E]/50'}`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${selected ? 'bg-[#1B4D3E]' : 'bg-[#F7F5F0]'}`}>
                    <p.icon size={18} className={selected ? 'text-white' : 'text-[#1B4D3E]'} />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-[#1A1A1A] text-sm">{p.name}</p>
                    <p className="text-xs text-[#646D7A]">{p.blurb}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-[#1A1A1A]">${price}<span className="text-xs font-normal text-[#646D7A]">/{pickedCycle === 'monthly' ? 'mo' : 'yr'}</span></p>
                  </div>
                  {selected && <Check size={16} className="text-[#1B4D3E] flex-shrink-0" />}
                </button>
              )
            })}
          </div>

          {billingError && (
            <div className="flex items-start gap-2 bg-[#DC2626]/5 border border-[#DC2626]/20 rounded-xl px-4 py-3 mb-4">
              <AlertCircle size={15} className="text-[#DC2626] flex-shrink-0 mt-0.5" />
              <p className="text-sm text-[#DC2626]">{billingError}</p>
            </div>
          )}

          <button
            onClick={startCheckout}
            disabled={billingGate === 'starting-checkout'}
            className="w-full bg-[#1B4D3E] text-white rounded-xl py-3.5 text-sm font-medium hover:bg-[#2D6A56] transition-colors disabled:opacity-60"
          >
            {billingGate === 'starting-checkout' ? 'Starting checkout…' : 'Continue to checkout'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F7F5F0] px-4 py-10">
      <div className="w-full max-w-md mx-auto">

        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-[#646D7A] text-sm mb-8 hover:text-[#1A1A1A] transition-colors"
        >
          <ArrowLeft size={16} />
          Back
        </button>

        <div className="mb-8">
          <p className="text-[#1B4D3E] font-medium text-sm tracking-widest uppercase mb-2">
            Step 2 of 3
          </p>
          <h2
            className="text-3xl text-[#1A1A1A]"
            style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}
          >
            {isGuardian ? "Set up your parent's companion" : 'Set up your companion'}
          </h2>
          <p className="text-[#646D7A] text-sm mt-2">
            {isGuardian
              ? "This is what guides every check-in and conversation with your parent."
              : 'This is what guides every check-in and conversation with you.'}
          </p>
        </div>

        {isGuardian && existingParentNames.length > 0 && (
          <div className="flex items-start gap-2.5 bg-[#1B4D3E]/5 border border-[#1B4D3E]/15 rounded-xl px-4 py-3 mb-6 text-sm text-[#1A1A1A]">
            <Users size={16} className="text-[#1B4D3E] flex-shrink-0 mt-0.5" />
            <span>
              You're adding <strong>another</strong> companion.{' '}
              {existingParentNames.length === 1
                ? <>{existingParentNames[0]} is already set up and won't be affected.</>
                : <>{existingParentNames.join(', ')} are already set up and won't be affected.</>}
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">

          {/* Elder info */}
          <div className="bg-white rounded-2xl border border-[#E5E1D8] p-5">
            <h3 className="font-medium text-[#1A1A1A] text-sm mb-4">
              {isGuardian ? "Parent's details" : 'Your details'}
            </h3>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-[#646D7A] mb-1.5 uppercase tracking-wide">
                  Full name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Margaret Adeyemi"
                  className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#646D7A] focus:outline-none focus:border-[#1B4D3E] transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#646D7A] mb-1.5 uppercase tracking-wide">
                  Phone number
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+1 555 000 0000"
                  className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#646D7A] focus:outline-none focus:border-[#1B4D3E] transition-colors"
                />
                <p className="text-xs text-[#646D7A] mt-1.5">
                  Mae texts this number directly — works with iMessage or regular SMS, no app needed.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#646D7A] mb-1.5 uppercase tracking-wide">
                  Timezone
                </label>
                <select
                  required
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#1B4D3E] transition-colors appearance-none"
                >
                  <option value="">Select timezone</option>
                  {TIMEZONES.map(tz => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Guardian info */}
          <div className="bg-white rounded-2xl border border-[#E5E1D8] p-5">
            <h3 className="font-medium text-[#1A1A1A] text-sm mb-4">
              {isGuardian ? 'Your contact' : 'Emergency contact'}
            </h3>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-[#646D7A] mb-1.5 uppercase tracking-wide">
                  {isGuardian ? 'Your phone number (for alerts)' : "Family member's phone number (for alerts)"}
                </label>
                <input
                  type="tel"
                  required
                  value={guardianPhone}
                  onChange={e => setGuardianPhone(e.target.value)}
                  placeholder="+1 555 000 0001"
                  className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#646D7A] focus:outline-none focus:border-[#1B4D3E] transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#646D7A] mb-1.5 uppercase tracking-wide">
                  How should alerts &amp; summaries reach {isGuardian ? 'you' : 'them'}?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['imessage', 'gmail'] as const).map(ch => (
                    <label key={ch} className="flex items-center gap-2 bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 cursor-pointer has-[:checked]:border-[#1B4D3E] has-[:checked]:bg-white transition-all">
                      <input
                        type="radio"
                        name="notifyVia"
                        value={ch}
                        checked={notifyVia === ch}
                        onChange={() => setNotifyVia(ch)}
                        className="accent-[#1B4D3E]"
                      />
                      {ch === 'imessage' ? <MessageCircle size={14} className="text-[#646D7A]" /> : <Mail size={14} className="text-[#646D7A]" />}
                      <span className="text-sm text-[#1A1A1A]">{ch === 'imessage' ? 'iMessage' : 'Gmail'}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Active hours */}
          <div className="bg-white rounded-2xl border border-[#E5E1D8] p-5">
            <h3 className="font-medium text-[#1A1A1A] text-sm mb-1">Active hours</h3>
            <p className="text-xs text-[#646D7A] mb-4">
              Mae will only message within these hours.
            </p>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-[#646D7A] mb-1.5 uppercase tracking-wide">
                  From
                </label>
                <input
                  type="time"
                  value={activeFrom}
                  onChange={e => setActiveFrom(e.target.value)}
                  className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#1B4D3E] transition-colors"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-[#646D7A] mb-1.5 uppercase tracking-wide">
                  Until
                </label>
                <input
                  type="time"
                  value={activeTo}
                  onChange={e => setActiveTo(e.target.value)}
                  className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#1B4D3E] transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Reminders */}
          <div className="bg-white rounded-2xl border border-[#E5E1D8] p-5">
            <h3 className="font-medium text-[#1A1A1A] text-sm mb-1">Reminders</h3>
            <p className="text-xs text-[#646D7A] mb-4">
              Specific tasks the companion should track. Optional.
            </p>
            <div className="flex flex-col gap-2">
              {reminders.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={r}
                    onChange={e => updateReminder(i, e.target.value)}
                    placeholder='e.g. "Take blood pressure pill at 2:00 PM"'
                    className="flex-1 bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#646D7A] focus:outline-none focus:border-[#1B4D3E] transition-colors"
                  />
                  {reminders.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeReminder(i)}
                      className="p-2 text-[#646D7A] hover:text-[#DC2626] transition-colors"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addReminder}
                className="flex items-center gap-1.5 text-[#1B4D3E] text-sm font-medium mt-1 hover:underline"
              >
                <Plus size={15} />
                Add reminder
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-[#DC2626]/5 border border-[#DC2626]/20 rounded-xl px-4 py-3">
              <AlertCircle size={15} className="text-[#DC2626] flex-shrink-0 mt-0.5" />
              <p className="text-sm text-[#DC2626]">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-[#1B4D3E] text-white rounded-xl py-3.5 text-sm font-medium hover:bg-[#2D6A56] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? 'Setting up…' : 'Continue to Activation'}
          </button>
        </form>
      </div>
    </div>
  )
}
