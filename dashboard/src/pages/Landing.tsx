import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, User, ArrowRight, Check, ChevronDown, Heart, Users, Sparkles, Globe2, Smartphone, Mail, MessageCircle, Menu, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import HeroPhone from '../components/HeroPhone'

const AGENT_PHONE = (import.meta.env.VITE_AGENT_PHONE as string) ?? '+14153238173'

const TRUST_SIGNALS = [
  { icon: Smartphone, text: 'No app for them to install' },
  { icon: Globe2, text: '100+ languages, voice notes included' },
  { icon: Shield, text: 'Cancel anytime, no contracts' },
]

const PLANS = [
  {
    name: 'Basic',
    tagline: 'One companion, one person',
    icon: Heart,
    monthly: { price: 12, launchPrice: 8.4 },
    yearly: { price: 120, launchPrice: 84, equivalentPerMonth: 10 },
    features: [
      'Mae checks in every day by text, plus voice notes in their own language',
      'Remembers what matters: health, hobbies, family',
      'Alerts you the moment something feels off, like a mood change, distress, or a possible scam',
      "Weekly summary of what happened and how they're doing",
      '1 account with full access',
    ],
    highlight: false,
  },
  {
    name: 'Family',
    tagline: 'When more than one person wants to stay in the loop',
    icon: Users,
    monthly: { price: 22, launchPrice: 15.4 },
    yearly: { price: 216, launchPrice: 151.2, equivalentPerMonth: 18 },
    features: [
      'Everything in Basic',
      "Up to 5 people can log in: siblings, a spouse, whoever's involved",
      'Urgent alerts reach everyone added, not just one inbox',
      'More frequent check-ins, no daily limit',
      'One shared activity feed for the whole family',
    ],
    highlight: true,
  },
]

const FAQS = [
  {
    q: 'Does my parent need to download an app or learn new technology?',
    a: 'No. Mae texts and takes voice notes on the phone they already have, so there is no app to install and no account for them to manage.',
  },
  {
    q: 'What app does Mae use to text my parent?',
    a: "Right now Mae reaches them over iMessage, with SMS as a fallback if they're not on an iPhone. WhatsApp support is on the way.",
  },
  {
    q: 'Is Mae a real person?',
    a: "No. Mae is an AI companion, built to check in like a caring friend would rather than read from a script.",
  },
  {
    q: "What happens if Mae notices something's wrong?",
    a: 'Mae flags mood changes, distress, or a possible scam attempt and alerts every guardian on the account right away.',
  },
  {
    q: 'Can more than one family member stay in the loop?',
    a: 'Yes. The Family plan lets you invite co-guardians, so siblings or a spouse all get the same updates and alerts.',
  },
  {
    q: "What if my parent doesn't speak English?",
    a: 'Mae understands and replies in whatever language they use, including voice notes.',
  },
  {
    q: 'Can I pause or cancel anytime?',
    a: 'Yes. Pause check-ins anytime from the dashboard, and cancel your subscription anytime. No lock-in, no contracts.',
  },
  {
    q: 'Does Mae make phone calls?',
    a: 'Not yet. Today Mae checks in by text and voice note, with phone call check-ins coming soon.',
  },
]

export default function Landing() {
  const navigate = useNavigate()
  const [signedIn, setSignedIn] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('monthly')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSignedIn(!!session))
  }, [])

  const select = (role: 'guardian' | 'elder') => {
    navigate('/auth', { state: { role } })
  }

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <main className="min-h-screen bg-bg">
      {/* Nav */}
      <nav className="sticky top-0 z-10 bg-bg/90 backdrop-blur border-b border-border">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <img src="/logo_3.png" alt="MaeMate" width={400} height={139} className="h-8 w-auto" />
          <div className="flex items-center gap-4 sm:gap-6 text-sm">
            <button onClick={() => scrollTo('pricing')} className="text-muted hover:text-text transition-colors hidden sm:inline">
              Pricing
            </button>
            <button onClick={() => scrollTo('faq')} className="text-muted hover:text-text transition-colors hidden sm:inline">
              FAQ
            </button>
            <button
              onClick={() => setMobileMenuOpen(o => !o)}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              className="sm:hidden text-text p-1 -m-1"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <button onClick={() => navigate('/auth')} className="text-text font-semibold hover:text-primary transition-colors">
              Login
            </button>
            <a
              href={`sms:${AGENT_PHONE}`}
              className="bg-primary text-white text-sm font-semibold px-4 py-2 rounded-full hover:bg-primary-light transition-colors inline-block"
            >
              Try MaeMate for Free
            </a>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="sm:hidden border-t border-border bg-bg px-4 py-2 flex flex-col">
            <button
              onClick={() => { scrollTo('pricing'); setMobileMenuOpen(false) }}
              className="text-left py-3 text-text font-medium border-b border-border"
            >
              Pricing
            </button>
            <button
              onClick={() => { scrollTo('faq'); setMobileMenuOpen(false) }}
              className="text-left py-3 text-text font-medium"
            >
              FAQ
            </button>
          </div>
        )}
      </nav>

      {/* Hero — the phone's right edge and the nav button sit at roughly the
          same horizontal position (~80% from left), so this is a near-
          vertical curve rather than a long diagonal sweep. Only makes
          visual sense pre-scroll, so it lives here (not sticky like nav). */}
      <section className="relative flex flex-col items-center justify-center px-4 py-12 lg:py-20">
        <div className="absolute right-[17%] top-[-40px] w-[70px] h-[280px] pointer-events-none hidden lg:block z-20">
          <svg viewBox="0 0 70 280" className="w-full h-full text-accent" fill="none">
            <path
              d="M40 260C55 220 15 160 35 90C45 55 30 30 55 10"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              markerEnd="url(#hero-arrowhead)"
            />
            <defs>
              <marker id="hero-arrowhead" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                <path d="M0 0L8 4L0 8Z" fill="currentColor" />
              </marker>
            </defs>
          </svg>
          <p
            className="absolute left-[-30px] top-[110px] text-accent text-base -rotate-3 whitespace-nowrap"
            style={{ fontFamily: 'Fraunces, Georgia, serif', fontStyle: 'italic' }}
          >
            no signup required!
          </p>
        </div>
        <div className="w-full max-w-md lg:max-w-5xl">
          {signedIn && (
            <button
              onClick={() => navigate('/dashboard')}
              className="w-full mb-6 bg-primary text-white rounded-xl py-2.5 sm:py-3.5 px-3 sm:px-4 text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5 sm:gap-2 leading-tight hover:bg-primary-light transition-colors"
            >
              You're already signed in, open your dashboard
              <ArrowRight size={14} className="flex-shrink-0 sm:hidden" />
              <ArrowRight size={16} className="flex-shrink-0 hidden sm:block" />
            </button>
          )}

          <div className="lg:grid lg:grid-cols-2 lg:gap-16 lg:items-center">
            <div className="lg:order-1">
              <div className="text-center lg:text-left mb-6">
                <h1
                  className="text-4xl lg:text-5xl text-text leading-tight mb-3"
                  style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500 }}
                >
                  Peace of mind,<br />
                  <em style={{ fontStyle: 'italic' }}>one call away.</em>
                </h1>
                <p className="text-muted text-sm lg:text-base leading-relaxed lg:max-w-sm">
                  An AI companion that checks in on your loved ones so you don't have to worry.
                </p>
              </div>

              <p id="hero-select" className="text-center lg:text-left text-text font-medium mb-3 scroll-mt-24">
                Who is setting up this companion?
              </p>

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => select('guardian')}
                  className="w-full bg-surface border border-border rounded-xl p-5 text-left flex items-center gap-4 hover:border-primary hover:shadow-sm transition-all duration-200 group"
                >
                  <div className="w-10 h-10 rounded-full bg-bg flex items-center justify-center group-hover:bg-primary transition-colors">
                    <Shield size={18} className="text-primary group-hover:text-white transition-colors" />
                  </div>
                  <div>
                    <p className="font-medium text-text text-sm">I am a Guardian</p>
                    <p className="text-muted text-xs mt-0.5">Setting this up for a family member</p>
                  </div>
                </button>

                <button
                  onClick={() => select('elder')}
                  className="w-full bg-surface border border-border rounded-xl p-5 text-left flex items-center gap-4 hover:border-primary hover:shadow-sm transition-all duration-200 group"
                >
                  <div className="w-10 h-10 rounded-full bg-bg flex items-center justify-center group-hover:bg-primary transition-colors">
                    <User size={18} className="text-primary group-hover:text-white transition-colors" />
                  </div>
                  <div>
                    <p className="font-medium text-text text-sm">I am an Older Adult</p>
                    <p className="text-muted text-xs mt-0.5">Setting this up for myself</p>
                  </div>
                </button>
              </div>

              <p className="text-center lg:text-left text-muted text-xs mt-8">
                Already have an account?{' '}
                <button onClick={() => navigate('/auth')} className="text-primary font-medium hover:underline">
                  Sign in
                </button>
              </p>
            </div>

            <div className="flex justify-center mb-6 lg:mb-0 lg:order-2">
              <HeroPhone />
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="px-4 py-10 bg-primary">
        <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-center gap-x-10 gap-y-5">
          {TRUST_SIGNALS.map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-2.5 text-bg text-sm font-medium">
              <Icon size={18} className="text-bg/70" />
              {text}
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-4 py-20 bg-gradient-to-b from-surface to-bg">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-4">
            <span className="inline-flex items-center gap-1.5 bg-accent text-white text-xs font-semibold px-4 py-1.5 rounded-full shadow-sm">
              <Sparkles size={13} />
              Launch offer: 30% off your first {cycle === 'monthly' ? '3 months' : 'year'}
            </span>
          </div>
          <h2 className="text-4xl font-serif font-medium text-text text-center mb-3">
            Simple pricing, no surprises
          </h2>
          <p className="text-muted text-sm text-center mb-8">
            Less than a coffee run a week · Cancel anytime, no contracts
          </p>

          <div className="flex justify-center mb-14">
            <div className="inline-flex bg-surface border border-border rounded-full p-1">
              <button
                onClick={() => setCycle('monthly')}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  cycle === 'monthly' ? 'bg-primary text-white' : 'text-muted'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setCycle('yearly')}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  cycle === 'yearly' ? 'bg-primary text-white' : 'text-muted'
                }`}
              >
                Yearly
                <span className={cycle === 'yearly' ? 'text-white/80' : 'text-accent'}>2 months free</span>
              </button>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-6 max-w-4xl mx-auto items-stretch">
            <div className="rounded-2xl p-7 border border-dashed border-border bg-surface shadow-sm flex flex-col">
              <div className="w-11 h-11 rounded-full flex items-center justify-center mb-4 bg-bg">
                <MessageCircle size={20} className="text-primary" />
              </div>
              <h3 className="text-2xl font-serif font-medium text-text mb-1">Free</h3>
              <p className="text-muted text-xs mb-5">Try Mae yourself, right now</p>

              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-4xl font-semibold text-text">$0</span>
              </div>
              <div className="mb-5" />

              <ul className="space-y-3 mb-7 flex-1">
                {['No account needed', 'Text Mae directly, right now', 'A handful of messages to get a feel for her'].map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-text">
                    <Check size={16} className="text-primary flex-shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <a
                href={`sms:${AGENT_PHONE}`}
                className="w-full rounded-xl py-3.5 text-sm font-semibold transition-colors text-center bg-bg text-text border border-border hover:border-primary"
              >
                Text Mae now
              </a>
            </div>

            {PLANS.map((plan) => {
              const billing = plan[cycle]
              return (
                <div
                  key={plan.name}
                  className={`rounded-2xl p-7 border relative transition-transform duration-200 flex flex-col ${
                    plan.highlight
                      ? 'bg-gradient-to-b from-primary/[0.06] to-surface border-primary shadow-xl sm:scale-105'
                      : 'bg-surface border-border shadow-sm hover:shadow-md'
                  }`}
                >
                  {plan.highlight && (
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-primary text-white text-xs font-semibold px-4 py-1.5 rounded-full shadow">
                      Most popular
                    </span>
                  )}

                  <div className={`w-11 h-11 rounded-full flex items-center justify-center mb-4 ${plan.highlight ? 'bg-primary' : 'bg-bg'}`}>
                    <plan.icon size={20} className={plan.highlight ? 'text-white' : 'text-primary'} />
                  </div>

                  <h3 className="text-2xl font-serif font-medium text-text mb-1">{plan.name}</h3>
                  <p className="text-muted text-xs mb-5">{plan.tagline}</p>

                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-4xl font-semibold text-text">${billing.launchPrice.toFixed(2)}</span>
                    <span className="text-muted text-sm">/{cycle === 'monthly' ? 'mo' : 'yr'}</span>
                  </div>
                  <p className="text-xs mb-1 flex items-center gap-2">
                    <span className="text-muted line-through">${billing.price}/{cycle === 'monthly' ? 'mo' : 'yr'}</span>
                    <span className="text-accent font-semibold">Save 30%</span>
                  </p>
                  {cycle === 'yearly' && 'equivalentPerMonth' in billing && (
                    <p className="text-muted text-xs mb-5">≈ ${billing.equivalentPerMonth.toFixed(2)}/mo, billed yearly</p>
                  )}
                  {cycle === 'monthly' && <div className="mb-5" />}

                  <ul className="space-y-3 mb-7 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-sm text-text">
                        <Check size={16} className="text-primary flex-shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() =>
                      signedIn
                        ? navigate('/setup', { state: { role: 'guardian', plan: plan.name.toLowerCase(), cycle } })
                        : navigate('/auth')
                    }
                    className={`w-full rounded-xl py-3.5 text-sm font-semibold transition-colors ${
                      plan.highlight
                        ? 'bg-primary text-white hover:bg-primary-light shadow-md'
                        : 'bg-bg text-text border border-border hover:border-primary'
                    }`}
                  >
                    Start 7-Day Free Trial
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="px-4 py-20 border-t border-border">
        <div className="max-w-2xl mx-auto">
          <span className="block text-center text-accent text-xs font-semibold tracking-widest uppercase mb-3">FAQ</span>
          <h2 className="text-4xl font-serif font-medium text-text text-center mb-12">Questions, answered</h2>

          <div className="flex flex-col gap-3">
            {FAQS.map((item, i) => (
              <div
                key={item.q}
                className={`bg-surface border rounded-xl overflow-hidden transition-colors ${openFaq === i ? 'border-primary' : 'border-border'}`}
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between gap-4 p-5 text-left"
                >
                  <span className="text-sm font-medium text-text">{item.q}</span>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${openFaq === i ? 'bg-primary' : 'bg-bg'}`}>
                    <ChevronDown
                      size={14}
                      className={`transition-transform ${openFaq === i ? 'rotate-180 text-white' : 'text-muted'}`}
                    />
                  </div>
                </button>
                {openFaq === i && <p className="px-5 pb-5 text-sm text-muted leading-relaxed">{item.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-4 py-10 border-t border-border">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <img src="/logo_3.png" alt="MaeMate" width={400} height={139} className="h-6 w-auto opacity-80" />
            <span className="text-muted text-xs">&copy; {new Date().getFullYear()} MaeMate</span>
          </div>

          <div className="flex items-center gap-5 text-sm">
            <a
              href="mailto:hello.maemate@gmail.com"
              className="flex items-center gap-1.5 text-muted hover:text-primary transition-colors"
            >
              <Mail size={15} />
              hello.maemate@gmail.com
            </a>
            <a
              href="https://wa.me/2348149660220"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-muted hover:text-primary transition-colors"
            >
              <MessageCircle size={15} />
              WhatsApp
            </a>
          </div>
        </div>
      </footer>
    </main>
  )
}
