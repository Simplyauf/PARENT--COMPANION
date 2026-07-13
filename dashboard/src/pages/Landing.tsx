import { useNavigate } from 'react-router-dom'
import { Shield, User } from 'lucide-react'
import heroImg from '../assets/hero.png'

export default function Landing() {
  const navigate = useNavigate()

  const select = (role: 'guardian' | 'elder') => {
    navigate('/auth', { state: { role } })
  }

  return (
    <div className="min-h-screen bg-[#F7F5F0] flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">

        <div className="text-center mb-6">
          <p className="text-[#1B4D3E] font-medium text-sm tracking-widest uppercase mb-4">
            Companion
          </p>

          {/* Hero illustration */}
          <div className="flex justify-center mb-4">
            <img
              src={heroImg}
              alt="Elderly people using their phones"
              className="w-full max-w-xs object-contain max-h-52"
            />
          </div>

          <h1
            className="text-4xl text-[#1A1A1A] leading-tight mb-3"
            style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}
          >
            Peace of mind,<br />
            <em style={{ fontStyle: 'italic' }}>one call away.</em>
          </h1>
          <p className="text-[#6B7280] text-sm leading-relaxed">
            An AI companion that checks in on your loved ones so you don't have to worry.
          </p>
        </div>

        <p className="text-center text-[#1A1A1A] font-medium mb-3">
          Who is setting up this companion?
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => select('guardian')}
            className="w-full bg-white border border-[#E5E1D8] rounded-xl p-5 text-left flex items-center gap-4 hover:border-[#1B4D3E] hover:shadow-sm transition-all duration-200 group"
          >
            <div className="w-10 h-10 rounded-full bg-[#F7F5F0] flex items-center justify-center group-hover:bg-[#1B4D3E] transition-colors">
              <Shield size={18} className="text-[#1B4D3E] group-hover:text-white transition-colors" />
            </div>
            <div>
              <p className="font-medium text-[#1A1A1A] text-sm">I am a Guardian</p>
              <p className="text-[#6B7280] text-xs mt-0.5">Setting this up for a family member</p>
            </div>
          </button>

          <button
            onClick={() => select('elder')}
            className="w-full bg-white border border-[#E5E1D8] rounded-xl p-5 text-left flex items-center gap-4 hover:border-[#1B4D3E] hover:shadow-sm transition-all duration-200 group"
          >
            <div className="w-10 h-10 rounded-full bg-[#F7F5F0] flex items-center justify-center group-hover:bg-[#1B4D3E] transition-colors">
              <User size={18} className="text-[#1B4D3E] group-hover:text-white transition-colors" />
            </div>
            <div>
              <p className="font-medium text-[#1A1A1A] text-sm">I am an Older Adult</p>
              <p className="text-[#6B7280] text-xs mt-0.5">Setting this up for myself</p>
            </div>
          </button>
        </div>

        <p className="text-center text-[#6B7280] text-xs mt-8">
          Already have an account?{' '}
          <button
            onClick={() => navigate('/auth')}
            className="text-[#1B4D3E] font-medium hover:underline"
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  )
}
