import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { MessageCircle, ArrowLeft, Check, AlertCircle } from 'lucide-react'
import { requestCheckin, previewCheckin } from '../lib/api'

const AGENT_PHONE = (import.meta.env.VITE_AGENT_PHONE as string) ?? '+14153238173'

function formatPhone(p: string) {
  // +14153238173 → +1 (415) 323-8173
  const m = p.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : p
}

export default function Activate() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { parentId?: string; parentName?: string } | null
  const parentId = state?.parentId
  const firstName = state?.parentName?.split(' ')[0]

  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  // Draft the first message up front so the guardian can see exactly what
  // their parent will receive before anything actually sends
  const [previewText, setPreviewText] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  useEffect(() => {
    if (!parentId) return
    setPreviewLoading(true)
    previewCheckin(parentId)
      .then(({ text }) => setPreviewText(text))
      .catch(() => { /* fall back to generating fresh at send time */ })
      .finally(() => setPreviewLoading(false))
  }, [parentId])

  const handleActivate = async () => {
    if (!parentId || status === 'sending' || status === 'sent') return
    setStatus('sending')
    setError('')
    try {
      await requestCheckin(parentId, previewText ?? undefined)
      setStatus('sent')
    } catch (err) {
      setError((err as Error).message || 'Could not send — try again')
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F5F0] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">

        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-[#646D7A] text-sm mb-8 hover:text-[#1A1A1A] transition-colors"
        >
          <ArrowLeft size={16} />
          Back
        </button>

        <div className="text-center mb-10">
          <p className="text-[#1B4D3E] font-medium text-sm tracking-widest uppercase mb-4">
            Step 3 of 3
          </p>
          <h2
            className="text-3xl text-[#1A1A1A] mb-3"
            style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}
          >
            Say hello to {firstName ?? 'your parent'}
          </h2>
          <p className="text-[#646D7A] text-sm leading-relaxed">
            Mae — {firstName ? `${firstName}'s` : 'their'} AI companion — sends the first text. {firstName ?? 'Your parent'} doesn't have to do anything but reply.
          </p>
        </div>

        {/* Visual instruction */}
        <div className="bg-white border border-[#E5E1D8] rounded-2xl p-6 mb-6">
          <div className="flex flex-col gap-3">
            {[
              { step: '1', text: 'Tap the button — Mae texts them a warm hello right now' },
              { step: '2', text: `A message from Mae (${formatPhone(AGENT_PHONE)}) arrives on their phone` },
              { step: '3', text: 'They just reply — the friendship begins from there' },
            ].map(({ step, text }) => (
              <div key={step} className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#1B4D3E] text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                  {step}
                </span>
                <p className="text-sm text-[#1A1A1A]">{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Message preview — see exactly what your parent will receive */}
        <div className="mb-6">
          <p className="text-xs font-medium text-[#646D7A] uppercase tracking-widest mb-2">
            What {firstName ?? 'they'}'ll see
          </p>
          {previewLoading && !previewText ? (
            <div className="bg-[#EDEAE2] rounded-2xl rounded-bl-sm px-4 py-3 w-fit animate-pulse">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#646D7A]/50" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#646D7A]/50" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#646D7A]/50" />
              </div>
            </div>
          ) : (
            <div className="bg-[#EDEAE2] rounded-2xl rounded-bl-sm px-4 py-3 max-w-[85%]">
              <p className="text-sm text-[#1A1A1A] leading-relaxed">
                {previewText ?? `Hi ${firstName ?? 'there'}! ${firstName ? "Your family" : "Someone in your family"} asked me to check in — just wanted to say hello and see how you're doing.`}
              </p>
            </div>
          )}
        </div>

        {status === 'error' && (
          <div className="flex items-start gap-2 bg-[#DC2626]/5 border border-[#DC2626]/20 rounded-xl px-4 py-3 mb-4">
            <AlertCircle size={15} className="text-[#DC2626] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-[#DC2626]">{error}</p>
          </div>
        )}

        <button
          onClick={handleActivate}
          disabled={!parentId || status === 'sending' || status === 'sent'}
          className={`w-full rounded-xl py-4 text-sm font-medium flex items-center justify-center gap-2.5 transition-colors mb-4 ${
            status === 'sent'
              ? 'bg-[#059669] text-white cursor-default'
              : 'bg-[#1B4D3E] text-white hover:bg-[#2D6A56] disabled:opacity-60'
          }`}
        >
          {status === 'idle' && <><MessageCircle size={18} /> Send {firstName ? `${firstName}'s` : 'the'} First Hello</>}
          {status === 'sending' && <>Sending…</>}
          {status === 'sent' && <><Check size={18} /> Sent! Check {firstName ? `${firstName}'s` : 'their'} phone</>}
          {status === 'error' && <><MessageCircle size={18} /> Try again</>}
        </button>

        {status === 'sent' && (
          <button
            onClick={() => navigate('/dashboard')}
            className="w-full bg-white border border-[#E5E1D8] text-[#1A1A1A] rounded-xl py-3.5 text-sm font-medium hover:border-[#1B4D3E] transition-colors mb-4"
          >
            Go to dashboard
          </button>
        )}

        {!parentId && (
          <p className="text-center text-xs text-[#D97706] mb-4">
            No parent selected — go back and complete setup first, or activate later from the dashboard.
          </p>
        )}

        <button
          onClick={() => navigate('/dashboard')}
          className="w-full text-[#646D7A] text-sm py-2 hover:text-[#1A1A1A] transition-colors"
        >
          Skip for now — I'll do this later
        </button>

        <div className="mt-6 bg-[#F7F5F0] border border-[#E5E1D8] rounded-xl px-4 py-3">
          <p className="text-xs text-[#646D7A] leading-relaxed">
            <span className="font-medium text-[#1A1A1A]">Good to know:</span> {firstName ?? 'your parent'} should
            always <span className="font-medium text-[#1A1A1A]">reply in Mae's message thread</span>.
            Starting a brand-new conversation may not reach Mae if their iMessage is set to send
            from an email address instead of their phone number.
          </p>
        </div>
      </div>
    </div>
  )
}
