import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, Plus, X, MessageCircle, Mail, AlertCircle } from 'lucide-react'
import { createParent } from '../lib/api'

const TIMEZONES = [
  { value: 'America/New_York', label: 'America/New_York (EST)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST)' },
  { value: 'America/Denver', label: 'America/Denver (MST)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST)' },
  { value: 'Europe/London', label: 'Europe/London (GMT)' },
  { value: 'Africa/Lagos', label: 'Africa/Lagos (WAT)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
]

export default function Setup() {
  const navigate = useNavigate()
  const location = useLocation()
  const role = (location.state as { role: string })?.role ?? 'guardian'
  const isGuardian = role === 'guardian'

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
      setError((err as Error).message || 'Something went wrong — try again')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F5F0] px-4 py-10">
      <div className="w-full max-w-md mx-auto">

        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-[#6B7280] text-sm mb-8 hover:text-[#1A1A1A] transition-colors"
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
          <p className="text-[#6B7280] text-sm mt-2">
            {isGuardian
              ? "This is what guides every check-in and conversation with your parent."
              : 'This is what guides every check-in and conversation with you.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">

          {/* Elder info */}
          <div className="bg-white rounded-2xl border border-[#E5E1D8] p-5">
            <h3 className="font-medium text-[#1A1A1A] text-sm mb-4">
              {isGuardian ? "Parent's details" : 'Your details'}
            </h3>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6B7280] mb-1.5 uppercase tracking-wide">
                  Full name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Margaret Adeyemi"
                  className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#6B7280] focus:outline-none focus:border-[#1B4D3E] transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B7280] mb-1.5 uppercase tracking-wide">
                  Phone number
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+1 555 000 0000"
                  className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#6B7280] focus:outline-none focus:border-[#1B4D3E] transition-colors"
                />
                <p className="text-xs text-[#6B7280] mt-1.5">
                  Companion texts this number directly — works with iMessage or regular SMS, no app needed.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B7280] mb-1.5 uppercase tracking-wide">
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
                <label className="block text-xs font-medium text-[#6B7280] mb-1.5 uppercase tracking-wide">
                  {isGuardian ? 'Your phone number (for alerts)' : "Family member's phone number (for alerts)"}
                </label>
                <input
                  type="tel"
                  required
                  value={guardianPhone}
                  onChange={e => setGuardianPhone(e.target.value)}
                  placeholder="+1 555 000 0001"
                  className="w-full bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#6B7280] focus:outline-none focus:border-[#1B4D3E] transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B7280] mb-1.5 uppercase tracking-wide">
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
                      {ch === 'imessage' ? <MessageCircle size={14} className="text-[#6B7280]" /> : <Mail size={14} className="text-[#6B7280]" />}
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
            <p className="text-xs text-[#6B7280] mb-4">
              Companion will only call or message within these hours.
            </p>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-[#6B7280] mb-1.5 uppercase tracking-wide">
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
                <label className="block text-xs font-medium text-[#6B7280] mb-1.5 uppercase tracking-wide">
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
            <p className="text-xs text-[#6B7280] mb-4">
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
                    className="flex-1 bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#6B7280] focus:outline-none focus:border-[#1B4D3E] transition-colors"
                  />
                  {reminders.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeReminder(i)}
                      className="p-2 text-[#6B7280] hover:text-[#DC2626] transition-colors"
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
