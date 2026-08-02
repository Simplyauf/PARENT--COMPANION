import { useState, useEffect } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Mail } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function Auth() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const role = (location.state as { role?: string })?.role ?? 'guardian'

  // Co-guardian invite: stash the token so it survives the magic-link roundtrip
  useEffect(() => {
    const invite = searchParams.get('invite')
    if (invite) localStorage.setItem('companion_invite_token', invite)
  }, [searchParams])

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: { role },
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    navigate('/auth/check-inbox', { state: { email } })
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

        <div className="mb-8">
          <p className="text-[#1B4D3E] font-medium text-sm tracking-widest uppercase mb-2">
            {role === 'guardian' ? 'Guardian account' : 'Your account'}
          </p>
          <h2
            className="text-3xl text-[#1A1A1A]"
            style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}
          >
            What's your email?
          </h2>
          <p className="text-[#646D7A] text-sm mt-2">
            We'll send a magic link — no password needed, ever.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">
              Email address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-white border border-[#E5E1D8] rounded-xl px-4 py-3 text-sm text-[#1A1A1A] placeholder:text-[#646D7A] focus:outline-none focus:border-[#1B4D3E] transition-colors"
            />
          </div>

          {error && (
            <p className="text-sm text-[#DC2626] bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#1B4D3E] text-white rounded-xl py-3.5 text-sm font-medium flex items-center justify-center gap-2 hover:bg-[#2D6A56] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Mail size={16} />
            {loading ? 'Sending link…' : 'Send magic link'}
          </button>
        </form>

        <p className="text-center text-[#646D7A] text-xs mt-6 leading-relaxed">
          New or returning user — same flow. If you have an account we'll sign you in.
          If not, we'll create one.
        </p>
      </div>
    </div>
  )
}
