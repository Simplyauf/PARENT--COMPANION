import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Phone, Settings, Clock, Plus, X, AlertCircle,
  ChevronRight, MessageCircle, PhoneCall, LayoutGrid,
  Activity, Save, ChevronDown, Mail, Check, UserPlus, Crown, User, CreditCard, ExternalLink, LogOut,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  getParents, getParent, getActivity, getGuardians, getWeeklySummary,
  addFact as apiAddFact, deleteFact, addReminder as apiAddReminder, deleteReminder,
  updateParent, updateSchedule, inviteGuardian, removeGuardian as apiRemoveGuardian,
  requestCheckin, ApiError, getSubscription, getCustomerPortal,
  type ApiParent, type ApiFact, type ApiReminder, type ApiLogEntry,
  type ApiGuardian, type ApiWeeklySummary, type ApiSubscription,
} from '../lib/api'

// Subtle texture on the deep-green body: a faint dot grid + a soft top glow
const greenTexture: React.CSSProperties = {
  backgroundColor: '#1A3A31',
  backgroundImage: [
    'radial-gradient(ellipse 85% 55% at 50% -10%, rgba(247,245,240,0.14), transparent 65%)',
    'radial-gradient(ellipse 70% 50% at 105% 100%, rgba(94,141,124,0.25), transparent 60%)',
    'radial-gradient(rgba(247,245,240,0.11) 1.2px, transparent 1.9px)',
  ].join(', '),
  backgroundSize: 'auto, auto, 24px 24px',
}

type Tab = 'overview' | 'activity' | 'settings'

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

const sentimentDot: Record<ApiLogEntry['sentiment'], string> = {
  positive: 'bg-[#059669]',
  neutral: 'bg-[#D97706]',
  alert: 'bg-[#DC2626]',
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'No contact yet'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

function dateLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  if (d >= today) return 'Today'
  if (d >= yesterday) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('overview')
  const [userId, setUserId] = useState<string | null>(null)
  const [parents, setParents] = useState<ApiParent[] | null>(null)
  const [currentParentId, setCurrentParentId] = useState<string | null>(null)
  const [parentDropdownOpen, setParentDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)

  const [facts, setFacts] = useState<ApiFact[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [newValue, setNewValue] = useState('')
  const [addingFact, setAddingFact] = useState(false)
  const [checkinState, setCheckinState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [pauseBusy, setPauseBusy] = useState(false)
  const [subscription, setSubscription] = useState<ApiSubscription | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)

  const [activity, setActivity] = useState<ApiLogEntry[]>([])

  const [showSummary, setShowSummary] = useState(false)
  const [summary, setSummary] = useState<ApiWeeklySummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  // Settings
  const [activeFrom, setActiveFrom] = useState('09:00')
  const [activeTo, setActiveTo] = useState('20:00')
  const [summaryFreq, setSummaryFreq] = useState<'weekly' | 'monthly'>('weekly')
  const [summaryDay, setSummaryDay] = useState('sunday')
  const [summaryMonthDay, setSummaryMonthDay] = useState('1')
  const [summaryTime, setSummaryTime] = useState('18:00')
  const [reminders, setReminders] = useState<ApiReminder[]>([])
  const [newReminder, setNewReminder] = useState('')
  const [settingsSaved, setSettingsSaved] = useState(false)

  // Guardians
  const [guardians, setGuardians] = useState<ApiGuardian[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteNotifyVia, setInviteNotifyVia] = useState<'imessage' | 'gmail'>('imessage')
  const [inviteState, setInviteState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [inviteError, setInviteError] = useState<string | null>(null)

  const [loadError, setLoadError] = useState<string | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [redirectIn, setRedirectIn] = useState(5)

  // Session-expired card: count down 5s, then off to sign-in
  useEffect(() => {
    if (!sessionExpired) return
    const timer = setInterval(() => {
      setRedirectIn(s => {
        if (s <= 1) { clearInterval(timer); navigate('/auth') }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [sessionExpired, navigate])

  const currentParent = parents?.find(p => p.id === currentParentId) ?? parents?.[0] ?? null

  // ─── Initial load: auth guard + parents list ────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/auth'); return }
      setUserId(session.user.id)

      try {
        const list = await getParents()
        if (list.length === 0) { navigate('/setup', { state: { role: 'guardian' } }); return }
        setParents(list)
        setCurrentParentId(list[0].id)
      } catch (err) {
        // Stale/expired session — show the expiry card, then send to sign-in
        if (err instanceof ApiError && err.status === 401) {
          await supabase.auth.signOut()
          setSessionExpired(true)
          return
        }
        setLoadError((err as Error).message)
      }
    })()
  }, [navigate])

  // ─── Per-parent data: detail (facts, reminders, schedule), guardians, activity
  const loadParentData = useCallback(async (parentId: string) => {
    try {
      const [detail, guardianList, logs] = await Promise.all([
        getParent(parentId),
        getGuardians(parentId),
        getActivity(parentId),
      ])
      setFacts(detail.companionFacts)
      setReminders(detail.reminders)
      setActiveFrom(detail.activeHoursFrom.slice(0, 5))
      setActiveTo(detail.activeHoursTo.slice(0, 5))
      const sched = detail.summarySchedule?.[0]
      if (sched) {
        setSummaryFreq(sched.frequency)
        setSummaryTime(sched.sendAt.slice(0, 5))
        if (sched.dayOfWeek != null) setSummaryDay(DAY_NAMES[sched.dayOfWeek] ?? 'sunday')
        if (sched.dayOfMonth != null) setSummaryMonthDay(String(sched.dayOfMonth))
      }
      setGuardians(guardianList)
      setActivity(logs)
    } catch (err) {
      setLoadError((err as Error).message)
    }

    // Billing is fetched separately — a missing/errored subscription
    // shouldn't block the rest of the dashboard from loading
    try {
      setSubscription(await getSubscription(parentId))
    } catch {
      setSubscription(null)
    }
  }, [])

  useEffect(() => {
    if (currentParentId) loadParentData(currentParentId)
  }, [currentParentId, loadParentData])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setParentDropdownOpen(false)
      }
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ─── Mutations ───────────────────────────────────────────────────────────────

  const removeFact = async (id: string) => {
    if (!currentParent) return
    setFacts(f => f.filter(x => x.id !== id))
    try { await deleteFact(currentParent.id, id) } catch { loadParentData(currentParent.id) }
  }

  const addFact = async () => {
    if (!newLabel.trim() || !newValue.trim() || !currentParent) return
    try {
      const fact = await apiAddFact(currentParent.id, newLabel.trim(), newValue.trim())
      setFacts(f => [...f, fact])
      setNewLabel(''); setNewValue(''); setAddingFact(false)
    } catch (err) {
      setLoadError((err as Error).message)
    }
  }

  const openBillingPortal = async () => {
    if (portalLoading) return
    setPortalLoading(true)
    try {
      const { url } = await getCustomerPortal()
      window.open(url, '_blank')
    } catch (err) {
      setLoadError((err as Error).message)
    } finally {
      setPortalLoading(false)
    }
  }

  const handlePause = async (days: number) => {
    if (!currentParent || pauseBusy) return
    setPauseBusy(true)
    try {
      await updateParent(currentParent.id, { pauseDays: days })
      const list = await getParents()
      setParents(list)
    } catch (err) {
      setLoadError((err as Error).message)
    } finally {
      setPauseBusy(false)
    }
  }

  const handleCheckinNow = async () => {
    if (!currentParent || checkinState !== 'idle') return
    setCheckinState('sending')
    try {
      await requestCheckin(currentParent.id)
      setCheckinState('sent')
      getActivity(currentParent.id).then(setActivity).catch(() => {})
      setTimeout(() => setCheckinState('idle'), 4000)
    } catch (err) {
      setLoadError((err as Error).message)
      setCheckinState('idle')
    }
  }

  const saveSettings = async () => {
    if (!currentParent) return
    try {
      await Promise.all([
        updateParent(currentParent.id, { activeHoursFrom: activeFrom, activeHoursTo: activeTo }),
        updateSchedule(currentParent.id, summaryFreq === 'weekly'
          ? { frequency: 'weekly', dayOfWeek: DAY_NAMES.indexOf(summaryDay), sendAt: summaryTime }
          : { frequency: 'monthly', dayOfMonth: summaryMonthDay === 'last' ? undefined : parseInt(summaryMonthDay), sendAt: summaryTime }
        ),
      ])
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 2000)
    } catch (err) {
      setLoadError((err as Error).message)
    }
  }

  const addReminderItem = async () => {
    if (!newReminder.trim() || !currentParent) return
    try {
      const reminder = await apiAddReminder(currentParent.id, newReminder.trim())
      setReminders(r => [...r, reminder])
      setNewReminder('')
    } catch (err) {
      setLoadError((err as Error).message)
    }
  }

  const removeReminderItem = async (id: string) => {
    if (!currentParent) return
    setReminders(r => r.filter(x => x.id !== id))
    try { await deleteReminder(currentParent.id, id) } catch { loadParentData(currentParent.id) }
  }

  const sendInvite = async () => {
    if (!inviteEmail.trim() || !currentParent || inviteState !== 'idle') return
    setInviteError(null)
    setInviteState('sending')
    try {
      await inviteGuardian(currentParent.id, inviteEmail.trim(), inviteNotifyVia)
      setInviteState('sent')
      setTimeout(() => { setInviteState('idle'); setInviteEmail('') }, 3000)
    } catch (err) {
      setInviteError((err as Error).message)
      setInviteState('idle')
    }
  }

  const removeGuardian = async (guardianId: string) => {
    if (!currentParent) return
    setGuardians(g => g.filter(x => x.guardianId !== guardianId))
    try { await apiRemoveGuardian(currentParent.id, guardianId) } catch { loadParentData(currentParent.id) }
  }

  const openSummary = () => {
    setShowSummary(true)
    if (!currentParent) return
    setSummaryLoading(true)
    setSummary(null)
    getWeeklySummary(currentParent.id)
      .then(setSummary)
      .catch(err => setSummary({ message: (err as Error).message }))
      .finally(() => setSummaryLoading(false))
  }

  const tabs: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutGrid },
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'settings', label: 'Settings', icon: Settings },
  ]

  // ─── Session expired ─────────────────────────────────────────────────────────
  if (sessionExpired) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={greenTexture}>
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
          <div className="w-12 h-12 rounded-full bg-[#1B4D3E]/10 flex items-center justify-center mx-auto mb-4">
            <Clock size={22} className="text-[#1B4D3E]" />
          </div>
          <h2 className="text-xl text-[#1A1A1A] mb-2" style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}>
            Session expired
          </h2>
          <p className="text-sm text-[#646D7A] mb-6">
            For your security, you've been signed out. Taking you back to sign-in in {redirectIn}s…
          </p>
          <button
            onClick={() => navigate('/auth')}
            className="w-full bg-[#1B4D3E] text-white rounded-xl py-3 text-sm font-medium hover:bg-[#2D6A56] transition-colors"
          >
            Sign in now
          </button>
        </div>
      </div>
    )
  }

  // ─── Loading / error states ──────────────────────────────────────────────────
  if (!parents || !currentParent) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={greenTexture}>
        {loadError ? (
          <div className="text-center px-6">
            <AlertCircle size={24} className="text-[#F87171] mx-auto mb-3" />
            <p className="text-sm text-white mb-1">Couldn't load your dashboard</p>
            <p className="text-xs text-[#B8C5BE]">{loadError}</p>
          </div>
        ) : (
          <p className="text-sm text-[#B8C5BE] animate-pulse">Loading MaeMate…</p>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={greenTexture}>

      {/* Brand watermark — giant faint interlocking rings, desktop only */}
      <div aria-hidden className="pointer-events-none fixed -left-56 top-32 hidden lg:flex opacity-[0.05]">
        <div className="w-[520px] h-[520px] rounded-full border-[52px] border-[#F7F5F0]" />
        <div className="w-[520px] h-[520px] rounded-full border-[52px] border-[#F7F5F0] -ml-44" />
      </div>

      {/* Header */}
      <header className="bg-white border-b border-[#E5E1D8] px-4 py-3 sticky top-0 z-10">
        <div className="max-w-lg lg:max-w-2xl mx-auto">

          {/* Row 1: logo + tabs (tabs hidden on mobile) */}
          <div className="flex items-center justify-between gap-3">
            <img src="/logo_3.png" alt="MaeMate" width={400} height={139} className="h-8 w-auto rounded" />

            <div className="flex items-center gap-2">
              {/* Desktop tabs — hidden below sm */}
              <div className="hidden sm:flex items-center gap-1 bg-[#F7F5F0] rounded-xl p-1">
                {tabs.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4D3E]/50 ${
                      tab === id ? 'bg-white text-[#1A1A1A] shadow-sm' : 'text-[#646D7A] hover:text-[#1A1A1A]'
                    }`}
                  >
                    <Icon size={13} />
                    {label}
                  </button>
                ))}
              </div>

              {/* Account menu */}
              <div className="relative" ref={accountMenuRef}>
                <button
                  onClick={() => setAccountMenuOpen(o => !o)}
                  className="w-8 h-8 rounded-full bg-[#1B4D3E]/10 flex items-center justify-center hover:bg-[#1B4D3E]/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4D3E]/50"
                  aria-label="Account menu"
                >
                  <User size={14} className="text-[#1B4D3E]" />
                </button>

                {accountMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-44 bg-white rounded-xl shadow-lg border border-[#E5E1D8] py-1.5 z-20">
                    <button
                      onClick={async () => {
                        await supabase.auth.signOut()
                        navigate('/')
                      }}
                      className="w-full flex items-center gap-2 px-3.5 py-2.5 text-sm text-[#1A1A1A] hover:bg-[#F7F5F0] transition-colors"
                    >
                      <LogOut size={14} className="text-[#646D7A]" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </header>

      {/* Parent switcher — floats on the green */}
      <div className="max-w-lg lg:max-w-2xl mx-auto px-4 pt-5">
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setParentDropdownOpen(o => !o)}
              className="flex items-center gap-2 bg-white rounded-xl px-4 py-2.5 shadow-sm hover:ring-2 hover:ring-white/30 transition-all w-full"
            >
              <span className="w-2 h-2 rounded-full bg-[#059669] flex-shrink-0" />
              <span className="text-sm font-medium text-[#1A1A1A] flex-1 text-left">
                {currentParent.name}
              </span>
              <span className="text-xs text-[#646D7A]">{parents.length} parent{parents.length !== 1 ? 's' : ''}</span>
              <ChevronDown size={14} className={`text-[#646D7A] transition-transform ${parentDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {parentDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-[#E5E1D8] rounded-2xl shadow-lg overflow-hidden z-20">
                {parents.map(parent => (
                  <button
                    key={parent.id}
                    onClick={() => { setCurrentParentId(parent.id); setParentDropdownOpen(false) }}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#F7F5F0] transition-colors ${
                      parent.id === currentParentId ? 'bg-[#F7F5F0]' : ''
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${parent.isActive ? 'bg-[#059669]' : 'bg-[#646D7A]'}`} />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#1A1A1A]">{parent.name}</p>
                      <p className="text-xs text-[#646D7A]">Last contact {timeAgo(parent.lastContact)}</p>
                    </div>
                    {parent.id === currentParentId && <Check size={14} className="text-[#1B4D3E]" />}
                  </button>
                ))}
                <div className="border-t border-[#E5E1D8]">
                  <button
                    onClick={() => { setParentDropdownOpen(false); navigate('/setup', { state: { role: 'guardian' } }) }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#F7F5F0] transition-colors"
                  >
                    <div className="w-2 h-2 rounded-full border border-dashed border-[#646D7A] flex-shrink-0" />
                    <p className="text-sm font-medium text-[#1B4D3E]">Add another parent</p>
                  </button>
                </div>
              </div>
            )}
          </div>

      </div>

      <div className="max-w-lg lg:max-w-2xl mx-auto px-4 py-6 pb-24 sm:pb-6 flex flex-col gap-4">

        {loadError && (
          <div className="flex items-start gap-2 bg-white border border-[#DC2626]/30 rounded-xl px-4 py-3">
            <AlertCircle size={15} className="text-[#DC2626] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-[#DC2626] flex-1">{loadError}</p>
            <button onClick={() => setLoadError(null)} className="text-[#646D7A] hover:text-[#1A1A1A]"><X size={14} /></button>
          </div>
        )}

        {/* ── OVERVIEW TAB ── */}
        {tab === 'overview' && (
          <>
            <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-2.5 h-2.5 rounded-full ${currentParent.isActive ? 'bg-[#059669]' : 'bg-[#646D7A]'}`} />
                <span className={`text-sm font-medium ${currentParent.isActive ? 'text-[#059669]' : 'text-[#646D7A]'}`}>
                  {currentParent.isActive ? 'Mae Active' : 'Mae Paused'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl text-[#1A1A1A]" style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}>
                    {currentParent.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Clock size={13} className="text-[#646D7A]" />
                    <p className="text-sm text-[#646D7A]">
                      Checks in <span className="text-[#1A1A1A] font-medium">{currentParent.activeHoursFrom.slice(0, 5)}–{currentParent.activeHoursTo.slice(0, 5)}</span>
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-[#646D7A]">Last contact</p>
                  <p className="text-sm font-medium text-[#1A1A1A] mt-0.5">{timeAgo(currentParent.lastContact)}</p>
                </div>
              </div>
            </div>

            <button
              onClick={openSummary}
              className="w-full bg-white border border-[#E5E1D8] rounded-2xl p-4 flex items-center justify-between text-left hover:border-[#1B4D3E] transition-colors"
            >
              <div>
                <p className="text-[#1A1A1A] text-sm font-medium">Weekly summary</p>
                <p className="text-[#646D7A] text-xs mt-0.5">How {currentParent.name}'s week has been</p>
              </div>
              <div className="flex items-center gap-1 bg-[#1B4D3E] text-white text-xs font-medium px-3 py-1.5 rounded-lg">
                View <ChevronRight size={13} />
              </div>
            </button>

            <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5">
              <div className="mb-4">
                <p className="font-medium text-[#1A1A1A] text-sm">Mae's profile</p>
                <p className="text-xs text-[#646D7A] mt-0.5">Key facts that help {currentParent.name}'s companion feel personal. The companion also learns these on its own from conversations.</p>
              </div>
              <div className="flex flex-col gap-2">
                {facts.length === 0 && (
                  <p className="text-xs text-[#646D7A] bg-[#F7F5F0] rounded-xl px-4 py-3">
                    Nothing yet — add a fact, or let the companion learn them from conversations.
                  </p>
                )}
                {facts.map(fact => (
                  <div key={fact.id} className="flex items-center justify-between bg-[#F7F5F0] rounded-xl px-4 py-2.5 group">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[#646D7A] w-24 flex-shrink-0">{fact.label}</span>
                      <span className="text-sm text-[#1A1A1A]">{fact.value}</span>
                    </div>
                    <button onClick={() => removeFact(fact.id)} className="opacity-0 group-hover:opacity-100 text-[#646D7A] hover:text-[#DC2626] transition-all">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              {addingFact ? (
                <div className="mt-3 flex flex-col gap-2">
                  <input type="text" value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Label (e.g. Hobby)" className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#646D7A] focus:outline-none focus:border-[#1B4D3E] transition-colors" />
                  <input type="text" value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="Value (e.g. Painting)" className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#646D7A] focus:outline-none focus:border-[#1B4D3E] transition-colors" />
                  <div className="flex gap-2">
                    <button onClick={addFact} className="flex-1 text-sm font-medium text-white bg-[#1B4D3E] px-4 py-2.5 rounded-xl hover:bg-[#2D6A56] transition-colors">Add</button>
                    <button onClick={() => setAddingFact(false)} className="text-sm text-[#646D7A] px-4 py-2.5 hover:text-[#1A1A1A]">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setAddingFact(true)} className="mt-3 flex items-center gap-1.5 text-sm text-[#1B4D3E] font-medium hover:underline">
                  <Plus size={14} /> Add a fact
                </button>
              )}
            </div>

            <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5">
              <p className="font-medium text-[#1A1A1A] text-sm mb-1">Check in now</p>
              <p className="text-xs text-[#646D7A] mb-4">Skips the schedule — Mae texts {currentParent.name} right away.</p>
              <button
                onClick={handleCheckinNow}
                disabled={checkinState !== 'idle'}
                className={`w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl text-sm font-medium transition-all ${
                  checkinState !== 'idle'
                    ? 'bg-[#F7F5F0] border border-[#E5E1D8] text-[#646D7A] cursor-not-allowed'
                    : 'bg-[#F7F5F0] border border-[#E5E1D8] text-[#1A1A1A] hover:border-[#1B4D3E] hover:bg-white'
                }`}
              >
                {checkinState === 'sending' && <><MessageCircle size={16} className="text-[#D97706]" /> Texting {currentParent.name}…</>}
                {checkinState === 'sent' && <><Check size={16} className="text-[#059669]" /> Check-in sent!</>}
                {checkinState === 'idle' && <><Phone size={16} /> Send a Check-in Text Now</>}
              </button>
            </div>

            <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5">
              {currentParent.pausedUntil && new Date(currentParent.pausedUntil) > new Date() ? (
                <>
                  <p className="font-medium text-[#1A1A1A] text-sm mb-1">Mae is paused</p>
                  <p className="text-xs text-[#646D7A] mb-4">
                    No check-ins until{' '}
                    {new Date(currentParent.pausedUntil).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' })}.
                    Mae still replies if {currentParent.name} texts first.
                  </p>
                  <button
                    onClick={() => handlePause(0)}
                    disabled={pauseBusy}
                    className="w-full py-3 rounded-xl text-sm font-medium bg-[#1B4D3E] text-white hover:bg-[#2D6A56] transition-colors disabled:opacity-60"
                  >
                    Resume messages now
                  </button>
                </>
              ) : (
                <>
                  <p className="font-medium text-[#1A1A1A] text-sm mb-1">Need a break?</p>
                  <p className="text-xs text-[#646D7A] mb-3">
                    Pause Mae's check-ins for a while. Mae will still reply if {currentParent.name} texts first.
                  </p>
                  <div className="flex gap-2">
                    {[{ label: '3 days', days: 3 }, { label: '1 week', days: 7 }, { label: '2 weeks', days: 14 }].map(opt => (
                      <button
                        key={opt.days}
                        onClick={() => handlePause(opt.days)}
                        disabled={pauseBusy}
                        className="flex-1 py-2.5 rounded-xl text-xs font-medium bg-[#F7F5F0] border border-[#E5E1D8] text-[#1A1A1A] hover:border-[#1B4D3E] hover:bg-white transition-all disabled:opacity-60"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ── ACTIVITY TAB ── */}
        {tab === 'activity' && (
          <div className="flex flex-col gap-3">
            <div>
              <p className="font-medium text-[#F7F5F0] text-sm">Recent check-ins</p>
              <p className="text-xs text-[#B8C5BE] mt-0.5">Every call and message with {currentParent.name}, logged automatically.</p>
            </div>
            {activity.length === 0 && (
              <div className="bg-white border border-[#E5E1D8] rounded-2xl px-5 py-8 text-center">
                <p className="text-sm text-[#646D7A]">No activity yet — Mae will start checking in soon.</p>
              </div>
            )}
            {(() => {
              const grouped = activity.reduce<Record<string, ApiLogEntry[]>>((acc, entry) => {
                const label = dateLabel(entry.createdAt)
                if (!acc[label]) acc[label] = []
                acc[label].push(entry)
                return acc
              }, {})
              return Object.entries(grouped).map(([date, entries]) => (
                <div key={date}>
                  <p className="text-xs font-medium text-[#B8C5BE] uppercase tracking-wide mb-2 px-1">{date}</p>
                  <div className="bg-white border border-[#E5E1D8] rounded-2xl overflow-hidden">
                    {entries.map((entry, i) => (
                      <div key={entry.id} className={`px-5 py-4 flex items-start gap-3 ${i > 0 ? 'border-t border-[#E5E1D8]' : ''}`}>
                        <span className={`w-2 h-2 rounded-full ${sentimentDot[entry.sentiment]} flex-shrink-0 mt-1.5`} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {entry.type === 'call' ? <PhoneCall size={12} className="text-[#646D7A]" /> : <MessageCircle size={12} className="text-[#646D7A]" />}
                            <span className="text-xs font-medium text-[#646D7A]">{timeLabel(entry.createdAt)}</span>
                            <span className="text-xs text-[#646D7A] capitalize">
                              {entry.direction === 'outbound' ? 'Mae' : currentParent.name.split(' ')[0]}
                            </span>
                          </div>
                          <p className="text-sm text-[#1A1A1A] leading-relaxed">{entry.summary}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            })()}
          </div>
        )}

        {/* ── SETTINGS TAB ── */}
        {tab === 'settings' && (
          <div className="flex flex-col gap-4">
            <div>
              <p className="font-medium text-[#F7F5F0] text-sm">Settings</p>
              <p className="text-xs text-[#B8C5BE] mt-0.5">Managing {currentParent.name}'s companion.</p>
            </div>

            {/* Guardians */}
            <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5">
              <div className="mb-4">
                <p className="font-medium text-[#1A1A1A] text-sm">Guardians</p>
                <p className="text-xs text-[#646D7A] mt-0.5">
                  Everyone who receives updates about {currentParent.name}.
                </p>
              </div>

              <div className="flex flex-col gap-2 mb-4">
                {guardians.map(guardian => (
                  <div key={guardian.id} className="flex items-center gap-3 bg-[#F7F5F0] rounded-xl px-4 py-3">
                    <div className="w-8 h-8 rounded-full bg-[#1B4D3E] flex items-center justify-center flex-shrink-0">
                      {guardian.role === 'primary'
                        ? <Crown size={14} className="text-white" />
                        : <User size={14} className="text-white" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-[#1A1A1A]">
                          {guardian.name}
                          {guardian.guardianId === userId && <span className="text-[#646D7A] font-normal"> (you)</span>}
                        </p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          guardian.role === 'primary'
                            ? 'bg-[#1B4D3E]/10 text-[#1B4D3E]'
                            : 'bg-[#F7F5F0] border border-[#E5E1D8] text-[#646D7A]'
                        }`}>
                          {guardian.role === 'primary' ? 'Primary' : 'Co-guardian'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {guardian.notifyVia === 'gmail'
                          ? <Mail size={11} className="text-[#646D7A]" />
                          : <MessageCircle size={11} className="text-[#646D7A]" />
                        }
                        <p className="text-xs text-[#646D7A]">
                          Updates via {guardian.notifyVia === 'gmail' ? 'Gmail' : 'iMessage'}
                        </p>
                      </div>
                    </div>
                    {guardian.role !== 'primary' && (
                      <button
                        onClick={() => removeGuardian(guardian.guardianId)}
                        className="text-[#646D7A] hover:text-[#DC2626] transition-colors p-1"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Invite */}
              <div className="border-t border-[#E5E1D8] pt-4">
                <p className="text-xs font-medium text-[#1A1A1A] mb-1 flex items-center gap-1.5">
                  <UserPlus size={13} />
                  Invite a co-guardian
                </p>
                <p className="text-xs text-[#646D7A] mb-3">
                  They'll receive an email invitation with a magic link to join — no password needed.
                </p>
                <div className="flex flex-col gap-2">
                  <div>
                    <label className="block text-xs font-medium text-[#646D7A] mb-1.5 uppercase tracking-wide">
                      Their email address
                    </label>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      placeholder="sister@example.com"
                      className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#646D7A] focus:outline-none focus:border-[#1B4D3E] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#646D7A] mb-1.5 uppercase tracking-wide">
                      Where should updates (alerts & summaries) be sent to them?
                    </label>
                    <div className="flex gap-2">
                      {(['imessage', 'gmail'] as const).map(channel => (
                        <button
                          key={channel}
                          onClick={() => setInviteNotifyVia(channel)}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium border transition-all ${
                            inviteNotifyVia === channel
                              ? 'bg-[#1B4D3E] text-white border-[#1B4D3E]'
                              : 'bg-[#F7F5F0] text-[#646D7A] border-[#E5E1D8] hover:border-[#1B4D3E]'
                          }`}
                        >
                          {channel === 'gmail' ? <Mail size={13} /> : <MessageCircle size={13} />}
                          {channel === 'gmail' ? 'Gmail' : 'iMessage'}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-[#646D7A] mt-1.5">
                      {inviteNotifyVia === 'gmail'
                        ? 'Emergency alerts and weekly summaries go to their Gmail inbox.'
                        : 'Emergency alerts and weekly summaries go to their iMessage.'}
                    </p>
                  </div>
                  {inviteError && (
                    <p className="text-xs text-[#DC2626]">{inviteError}</p>
                  )}
                  <button
                    onClick={sendInvite}
                    disabled={inviteState !== 'idle' || !inviteEmail.trim()}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-[#1B4D3E] text-white hover:bg-[#2D6A56] transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-1"
                  >
                    {inviteState === 'sent' && <><Check size={14} /> Invitation sent!</>}
                    {inviteState === 'sending' && 'Sending…'}
                    {inviteState === 'idle' && <><UserPlus size={14} /> Send invitation</>}
                  </button>
                </div>
              </div>
            </div>

            {/* Billing */}
            <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <CreditCard size={16} className="text-[#1B4D3E]" />
                <p className="font-medium text-[#1A1A1A] text-sm">Billing</p>
              </div>

              {!subscription ? (
                <>
                  <p className="text-xs text-[#646D7A] mb-3">No active subscription on your account.</p>
                  <button
                    onClick={() => navigate('/setup', { state: { role: 'guardian' } })}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-[#1B4D3E] text-white hover:bg-[#2D6A56] transition-colors"
                  >
                    <CreditCard size={14} />
                    Choose a plan
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between bg-[#F7F5F0] rounded-xl px-4 py-3 mb-3">
                    <div>
                      <p className="text-sm font-medium text-[#1A1A1A] capitalize">{subscription.plan} · {subscription.cycle}</p>
                      <p className="text-xs text-[#646D7A] mt-0.5">
                        {subscription.status === 'trialing' && subscription.trialEndsAt &&
                          `Trial ends ${new Date(subscription.trialEndsAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`}
                        {subscription.status === 'active' && subscription.renewsAt &&
                          `Renews ${new Date(subscription.renewsAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`}
                        {subscription.status === 'past_due' && 'Payment issue — please update your card'}
                        {(subscription.status === 'cancelled' || subscription.status === 'expired') &&
                          `${subscription.status === 'cancelled' ? 'Cancelled' : 'Expired'}${subscription.endsAt ? ` · access ends ${new Date(subscription.endsAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}` : ''}`}
                      </p>
                    </div>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize flex-shrink-0 ${
                      subscription.status === 'active' || subscription.status === 'trialing'
                        ? 'bg-[#059669]/10 text-[#059669]'
                        : subscription.status === 'past_due'
                        ? 'bg-[#D97706]/10 text-[#D97706]'
                        : 'bg-[#DC2626]/10 text-[#DC2626]'
                    }`}>
                      {subscription.status.replace('_', ' ')}
                    </span>
                  </div>
                  <button
                    onClick={openBillingPortal}
                    disabled={portalLoading || !subscription}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-[#F7F5F0] border border-[#E5E1D8] text-[#1A1A1A] hover:border-[#1B4D3E] transition-colors disabled:opacity-60"
                  >
                    <ExternalLink size={14} />
                    {portalLoading ? 'Opening…' : 'Manage subscription'}
                  </button>
                </>
              )}
            </div>

            {/* Active hours */}
            <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5">
              <p className="font-medium text-[#1A1A1A] text-sm mb-1">Active hours</p>
              <p className="text-xs text-[#646D7A] mb-4">
                Mae will only contact {currentParent.name} within this window.
              </p>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-[#646D7A] mb-1.5 uppercase tracking-wide">From</label>
                  <input type="time" value={activeFrom} onChange={e => setActiveFrom(e.target.value)} className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#1B4D3E] transition-colors" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-[#646D7A] mb-1.5 uppercase tracking-wide">Until</label>
                  <input type="time" value={activeTo} onChange={e => setActiveTo(e.target.value)} className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#1B4D3E] transition-colors" />
                </div>
              </div>
            </div>

            {/* Summary schedule */}
            <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5">
              <p className="font-medium text-[#1A1A1A] text-sm mb-1">Summary reports</p>
              <p className="text-xs text-[#646D7A] mb-4">
                When to send the digest to all guardians via their chosen channel.
              </p>

              {/* Frequency toggle */}
              <div className="flex gap-2 mb-4">
                {(['weekly', 'monthly'] as const).map(freq => (
                  <button
                    key={freq}
                    onClick={() => setSummaryFreq(freq)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                      summaryFreq === freq
                        ? 'bg-[#1B4D3E] text-white border-[#1B4D3E]'
                        : 'bg-[#F7F5F0] text-[#646D7A] border-[#E5E1D8] hover:border-[#1B4D3E] hover:text-[#1A1A1A]'
                    }`}
                  >
                    {freq.charAt(0).toUpperCase() + freq.slice(1)}
                  </button>
                ))}
              </div>

              {/* Weekly: pick day + time */}
              {summaryFreq === 'weekly' && (
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#646D7A] mb-1.5 uppercase tracking-wide">Day</label>
                    <div className="grid grid-cols-7 gap-1">
                      {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day, i) => (
                        <button
                          key={day}
                          onClick={() => setSummaryDay(DAY_NAMES[i])}
                          className={`py-2 rounded-lg text-xs font-medium border transition-all ${
                            summaryDay === DAY_NAMES[i]
                              ? 'bg-[#1B4D3E] text-white border-[#1B4D3E]'
                              : 'bg-[#F7F5F0] text-[#646D7A] border-[#E5E1D8] hover:border-[#1B4D3E]'
                          }`}
                        >
                          {day[0]}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-[#646D7A] mt-1.5 capitalize">Every {summaryDay}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#646D7A] mb-1.5 uppercase tracking-wide">Time</label>
                    <input
                      type="time"
                      value={summaryTime}
                      onChange={e => setSummaryTime(e.target.value)}
                      className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#1B4D3E] transition-colors"
                    />
                  </div>
                </div>
              )}

              {/* Monthly: pick day of month + time */}
              {summaryFreq === 'monthly' && (
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#646D7A] mb-1.5 uppercase tracking-wide">Day of month</label>
                    <select
                      value={summaryMonthDay}
                      onChange={e => setSummaryMonthDay(e.target.value)}
                      className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#1B4D3E] transition-colors appearance-none"
                    >
                      {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                        <option key={d} value={String(d)}>
                          {d === 1 ? '1st' : d === 2 ? '2nd' : d === 3 ? '3rd' : `${d}th`} of every month
                        </option>
                      ))}
                      <option value="last">Last day of every month</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#646D7A] mb-1.5 uppercase tracking-wide">Time</label>
                    <input
                      type="time"
                      value={summaryTime}
                      onChange={e => setSummaryTime(e.target.value)}
                      className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#1B4D3E] transition-colors"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Reminders */}
            <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5">
              <p className="font-medium text-[#1A1A1A] text-sm mb-1">Reminders</p>
              <p className="text-xs text-[#646D7A] mb-4">Tasks the companion tracks and follows up on.</p>
              <div className="flex flex-col gap-2">
                {reminders.map(r => (
                  <div key={r.id} className="flex items-center justify-between bg-[#F7F5F0] rounded-xl px-4 py-2.5 group">
                    <p className="text-sm text-[#1A1A1A]">{r.text}</p>
                    <button onClick={() => removeReminderItem(r.id)} className="opacity-0 group-hover:opacity-100 text-[#646D7A] hover:text-[#DC2626] transition-all">
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2 mt-1">
                  <input
                    type="text"
                    value={newReminder}
                    onChange={e => setNewReminder(e.target.value)}
                    placeholder='e.g. "Check blood sugar at 8AM"'
                    onKeyDown={e => { if (e.key === 'Enter') addReminderItem() }}
                    className="flex-1 bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#646D7A] focus:outline-none focus:border-[#1B4D3E] transition-colors"
                  />
                  <button onClick={addReminderItem} className="px-4 py-2.5 bg-[#1B4D3E] text-white rounded-xl hover:bg-[#2D6A56] transition-colors">
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={saveSettings}
              className="w-full bg-[#1B4D3E] text-white rounded-xl py-3.5 text-sm font-medium flex items-center justify-center gap-2 hover:bg-[#2D6A56] transition-colors"
            >
              <Save size={15} />
              {settingsSaved ? 'Saved!' : 'Save settings'}
            </button>
          </div>
        )}
      </div>

      {/* ── BOTTOM NAV (mobile only) ── */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-[#E5E1D8] z-10 safe-area-inset-bottom">
        <div className="flex">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`relative flex-1 flex flex-col items-center gap-1 pt-3 pb-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1B4D3E]/50 ${
                tab === id ? 'text-[#1B4D3E]' : 'text-[#646D7A]'
              }`}
            >
              <Icon size={21} strokeWidth={tab === id ? 2 : 1.5} />
              <span className="text-[10px] font-medium">{label}</span>
              {tab === id && (
                <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#1B4D3E]" />
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* ── WEEKLY SUMMARY MODAL ── */}
      {showSummary && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowSummary(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative bg-white rounded-t-3xl p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#E5E1D8] mx-auto mb-6" />
            <div className="flex items-start justify-between mb-6">
              <div>
                <p className="text-xs font-medium text-[#1B4D3E] uppercase tracking-widest mb-1">Last 7 days</p>
                <h2 className="text-2xl text-[#1A1A1A]" style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}>
                  {currentParent.name}'s weekly summary
                </h2>
              </div>
              <button onClick={() => setShowSummary(false)} className="p-2 text-[#646D7A] hover:text-[#1A1A1A]">
                <X size={18} />
              </button>
            </div>

            {summaryLoading && (
              <p className="text-sm text-[#646D7A] text-center py-10 animate-pulse">
                Mae is writing the summary…
              </p>
            )}

            {!summaryLoading && summary && 'message' in summary && (
              <p className="text-sm text-[#646D7A] text-center py-10">{summary.message}</p>
            )}

            {!summaryLoading && summary && !('message' in summary) && (
              <>
                <div className="bg-[#F7F5F0] rounded-2xl p-4 mb-4">
                  <p className="text-xs font-medium text-[#646D7A] uppercase tracking-wide mb-2">Overall mood</p>
                  <p className="text-sm font-medium text-[#1A1A1A] capitalize">{summary.overallMood}</p>
                  <p className="text-xs text-[#646D7A] mt-0.5">{summary.moodSentence}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {[
                    { label: 'Check-ins', value: String(summary.stats.checkins) },
                    { label: 'Alerts', value: String(summary.stats.alerts) },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-[#F7F5F0] rounded-2xl p-4 text-center">
                      <p className="text-xl font-medium text-[#1A1A1A]" style={{ fontFamily: 'DM Mono, monospace' }}>{value}</p>
                      <p className="text-xs text-[#646D7A] mt-1">{label}</p>
                    </div>
                  ))}
                </div>
                <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5 mb-4">
                  <p className="text-xs font-medium text-[#646D7A] uppercase tracking-wide mb-3">Notable moments</p>
                  <div className="flex flex-col gap-3">
                    {summary.notableMoments.map((text, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <span className="w-2 h-2 rounded-full bg-[#059669] flex-shrink-0 mt-1.5" />
                        <p className="text-sm text-[#1A1A1A] leading-relaxed">{text}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-[#1B4D3E] rounded-2xl p-5">
                  <p className="text-xs font-medium text-white/60 uppercase tracking-wide mb-2">Mae's note</p>
                  <p className="text-sm text-white leading-relaxed">{summary.companionNote}</p>
                </div>
              </>
            )}
            <div className="h-6" />
          </div>
        </div>
      )}
    </div>
  )
}
