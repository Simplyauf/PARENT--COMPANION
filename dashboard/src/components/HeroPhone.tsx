import { useEffect, useState } from 'react'

type Turn = { from: 'mae' | 'them'; text: string }

const SCRIPT: Turn[] = [
  { from: 'mae', text: "Hey Azeez, hope you're having a great morning so far! Just wanted to check in and see how your day is starting out." },
  { from: 'them', text: "A little stressed, just moved into my house and it's still empty" },
  { from: 'mae', text: "That's a big step though! What's the first thing you're planning to get for the place?" },
  { from: 'them', text: 'Rugs, curtain rings, a proper bed frame' },
  { from: 'mae', text: "Sounds like a plan. I'll check back and see how the house is coming along." },
]

const TYPE_DELAY_MS = 900
const READ_DELAY_MS = 1400
const LOOP_PAUSE_MS = 3200

export default function HeroPhone() {
  const [shown, setShown] = useState(0)
  const [typing, setTyping] = useState(false)

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      setShown(SCRIPT.length)
      return
    }

    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []

    function playFrom(i: number) {
      if (cancelled) return
      if (i >= SCRIPT.length) {
        timers.push(setTimeout(() => {
          setShown(0)
          setTyping(false)
          playFrom(0)
        }, LOOP_PAUSE_MS))
        return
      }
      const turn = SCRIPT[i]
      const delay = turn.from === 'mae' ? TYPE_DELAY_MS : READ_DELAY_MS
      if (turn.from === 'mae') setTyping(true)
      timers.push(setTimeout(() => {
        if (cancelled) return
        setTyping(false)
        setShown(i + 1)
        timers.push(setTimeout(() => playFrom(i + 1), delay))
      }, turn.from === 'mae' ? TYPE_DELAY_MS : 0))
    }

    playFrom(0)
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [])

  return (
    <div className="relative mx-auto w-full max-w-[280px] select-none">
      {/* Phone frame */}
      <div className="relative rounded-[2.6rem] bg-[#111214] p-2 shadow-[0_30px_60px_-20px_rgba(27,77,62,0.35)]">
        <div className="relative overflow-hidden rounded-[2.1rem] bg-white aspect-[9/19.5]">
          {/* Dynamic island */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 h-5 w-24 rounded-full bg-black" />

          {/* Status bar */}
          <div className="relative flex items-center justify-between px-6 pt-3 pb-1 text-[11px] font-semibold text-black">
            <span>9:41</span>
            <div className="flex items-center gap-1">
              <svg width="15" height="11" viewBox="0 0 15 11" fill="none"><path d="M1 8.5L1 9.5C1 9.78 1.22 10 1.5 10H2.5C2.78 10 3 9.78 3 9.5V8.5C3 8.22 2.78 8 2.5 8H1.5C1.22 8 1 8.22 1 8.5Z" fill="black"/><path d="M5 6.5V9.5C5 9.78 5.22 10 5.5 10H6.5C6.78 10 7 9.78 7 9.5V6.5C7 6.22 6.78 6 6.5 6H5.5C5.22 6 5 6.22 5 6.5Z" fill="black"/><path d="M9 4.5V9.5C9 9.78 9.22 10 9.5 10H10.5C10.78 10 11 9.78 11 9.5V4.5C11 4.22 10.78 4 10.5 4H9.5C9.22 4 9 4.22 9 4.5Z" fill="black"/><path d="M13 1.5V9.5C13 9.78 13.22 10 13.5 10H14.5C14.78 10 15 9.78 15 9.5V1.5C15 1.22 14.78 1 14.5 1H13.5C13.22 1 13 1.22 13 1.5Z" fill="black" fill-opacity="0.3"/></svg>
              <svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M8 0C10.9 0 13.5 1.1 15.4 2.9C15.6 3.1 15.6 3.4 15.4 3.6L14.3 4.7C14.1 4.9 13.8 4.9 13.6 4.7C12.1 3.3 10.1 2.5 8 2.5C5.9 2.5 3.9 3.3 2.4 4.7C2.2 4.9 1.9 4.9 1.7 4.7L0.6 3.6C0.4 3.4 0.4 3.1 0.6 2.9C2.5 1.1 5.1 0 8 0Z" fill="black"/><path d="M8 5C9.5 5 10.9 5.6 12 6.6C12.2 6.8 12.2 7.1 12 7.3L10.9 8.4C10.7 8.6 10.4 8.6 10.2 8.4C9.6 7.9 8.8 7.6 8 7.6C7.2 7.6 6.4 7.9 5.8 8.4C5.6 8.6 5.3 8.6 5.1 8.4L4 7.3C3.8 7.1 3.8 6.8 4 6.6C5.1 5.6 6.5 5 8 5Z" fill="black"/><circle cx="8" cy="10" r="1" fill="black"/></svg>
              <svg width="22" height="11" viewBox="0 0 22 11" fill="none"><rect x="1" y="1" width="18" height="9" rx="2" stroke="black" strokeWidth="1"/><rect x="2.5" y="2.5" width="14" height="6" rx="1" fill="black"/><path d="M21 4V7C21.6 6.7 22 6 22 5.5C22 5 21.6 4.3 21 4Z" fill="black"/></svg>
            </div>
          </div>

          {/* Contact header */}
          <div className="flex flex-col items-center pt-2 pb-2 border-b border-black/5">
            <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white text-sm font-serif font-medium">
              M
            </div>
            <span className="mt-1 text-[13px] font-semibold text-black">Mae</span>
          </div>

          {/* Messages */}
          <div className="flex flex-col gap-1.5 px-3 py-3 h-[calc(100%-88px)] overflow-hidden">
            {SCRIPT.slice(0, shown).map((turn, i) => (
              <div
                key={i}
                className={`imsg-bubble-in max-w-[78%] px-3 py-2 text-[12.5px] leading-snug ${
                  turn.from === 'mae'
                    ? 'self-start bg-[#E9E9EB] text-black rounded-2xl rounded-bl-md'
                    : 'self-end bg-[#007AFF] text-white rounded-2xl rounded-br-md'
                }`}
              >
                {turn.text}
              </div>
            ))}
            {typing && (
              <div className="imsg-bubble-in self-start bg-[#E9E9EB] rounded-2xl rounded-bl-md px-3.5 py-2.5 flex items-center gap-1">
                <span className="imsg-typing-dot w-1.5 h-1.5 rounded-full bg-black/40" />
                <span className="imsg-typing-dot w-1.5 h-1.5 rounded-full bg-black/40" />
                <span className="imsg-typing-dot w-1.5 h-1.5 rounded-full bg-black/40" />
              </div>
            )}
          </div>

          {/* Input bar */}
          <div className="absolute bottom-0 inset-x-0 flex items-center gap-2 px-3 py-2 border-t border-black/5 bg-white">
            <div className="flex-1 h-7 rounded-full border border-black/10 flex items-center px-3">
              <span className="text-[11px] text-black/35">iMessage</span>
            </div>
            <div className="w-6 h-6 rounded-full bg-[#007AFF] flex items-center justify-center flex-shrink-0">
              <svg width="10" height="10" viewBox="0 0 18 18" fill="none"><path d="M9 5L9 13M9 5L6 8M9 5L12 8" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
