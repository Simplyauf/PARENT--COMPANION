import { useLocation, useNavigate } from 'react-router-dom'
import { Mail, ArrowLeft } from 'lucide-react'

export default function CheckInbox() {
  const location = useLocation()
  const navigate = useNavigate()
  const email = (location.state as { email?: string })?.email ?? 'your email'

  return (
    <div className="min-h-screen bg-[#F7F5F0] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md text-center">

        <div className="w-16 h-16 rounded-2xl bg-[#1B4D3E] flex items-center justify-center mx-auto mb-6">
          <Mail size={28} className="text-white" />
        </div>

        <h2
          className="text-3xl text-[#1A1A1A] mb-3"
          style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}
        >
          Check your inbox
        </h2>

        <p className="text-[#6B7280] text-sm leading-relaxed mb-2">
          We sent a magic link to
        </p>
        <p className="text-[#1A1A1A] font-medium text-sm mb-6">{email}</p>

        <p className="text-[#6B7280] text-sm leading-relaxed mb-8">
          Tap the link in the email and you'll be signed in instantly.
          The link expires in 1 hour.
        </p>

        <div className="bg-white border border-[#E5E1D8] rounded-2xl p-4 text-left mb-6">
          <p className="text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-2">
            Can't find it?
          </p>
          <ul className="text-sm text-[#6B7280] space-y-1.5">
            <li>• Check your spam or junk folder</li>
            <li>• Make sure you typed the right email</li>
            <li>• Wait up to 2 minutes for delivery</li>
          </ul>
        </div>

        <button
          onClick={() => navigate('/auth')}
          className="flex items-center justify-center gap-1.5 text-[#1B4D3E] text-sm font-medium hover:underline mx-auto"
        >
          <ArrowLeft size={15} />
          Try a different email
        </button>
      </div>
    </div>
  )
}
