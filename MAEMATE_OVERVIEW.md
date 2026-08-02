# MaeMate — Mae, the AI Companion for Aging Parents

**One line:** Mae texts your elderly parent like a caring friend — checks in daily, remembers their life, notices when something's wrong, and tells the family before it becomes a crisis.

No app for the elder. No new device. Just iMessage/SMS on the phone they already have.

---

## The Cast

| Who | What they use | What they get |
|---|---|---|
| **Elder** ("parent") | Their existing phone — texts & voice notes | A friend who checks in, remembers, and follows up |
| **Guardian** (son/daughter) | PWA dashboard (installable, magic-link login) | Activity feed, alerts, weekly summaries, controls |
| **Mae** | Runs on our server 24/7 | Its own phone number, memory per elder, judgment |

---

## User Journeys

### 1 · Guardian onboarding (~3 minutes)
1. Landing page → "I am a Guardian" → magic-link email sign-in (no passwords, ever)
2. Setup wizard: parent's name, phone, timezone, active hours, starter facts ("loves gardening", "takes BP medication"), optional reminders
3. Guard-rails: parent's number can't be the guardian's own number (validated)
4. Activation: Mae sends the first hello — **outbound-first by design**, the elder only ever has to reply
5. Dashboard is live: activity feed, facts, reminders, guardians, summary schedule

### 2 · The elder's daily rhythm
- **Heartbeat loop** wakes every 45 min and *decides* (LLM judgment, not cron): is it a good moment to check in? Respects the elder's timezone, active hours (never at night), a max of 3 self-initiated messages/day, and recent conversation mood.
- Elder replies by **text or voice note** (voice is transcribed — Whisper, ~100 languages incl. Yoruba, Hausa, Igbo; Mae replies in whatever language the elder uses).
- Every exchange is sentiment-analyzed and logged to the guardian's activity feed.

### 3 · A real conversation, not a bot script
During any chat Mae can, mid-conversation:
- **Remember** — "my grandson Tobi visits Sundays" → saved to permanent memory
- **Track** — "I take Peristamo for my headaches" → standing reminder
- **Commit** — "I see the doctor at 3pm tomorrow" → schedules itself to ask how it went
- **React like a human** — substantive message → warm reply; "Okay thanks 👍" → a ❤️ tapback instead of a reply; sometimes just silence. Real friends don't answer everything.

### 4 · Follow-ups that don't pester (conversation etiquette engine)
- A follow-up ("How was Lagos?") fires **once**. Ignored topic = dropped topic — Mae moves on like a normal person.
- Several follow-ups due at once are **merged into one natural message**, never a burst.
- Follow-ups overdue by 48h expire silently — the moment has passed.
- **Unanswered streak policy:** after 3 unanswered messages Mae goes quiet (the 3rd is short and zero-pressure: "no need to reply if all's well"). 12 quiet hours later → guardians get a gentle heads-up to check in personally. No guardians → nobody is spammed; Mae retries softly after 3 days. Any reply resets everything.

### 5 · When something's wrong
- Every inbound message is screened. Concerning but manageable ("headache, taking my meds") → **⚠️ check-in alert** to guardians. Genuinely serious (fall, chest pain, not eating, despair) → **🚨 emergency alert**.
- Alerts fan out to **all** guardians on each one's preferred channel (iMessage or email). No guardians linked → no alerts fire.

### 6 · The family layer
- **Multi-parent:** one guardian can care for several elders — each has fully isolated memory, schedule, and history.
- **Co-guardians:** invite siblings by email; they get their own dashboard access and alerts. Primary can remove; invite links auto-accept after magic-link sign-in.
- **Weekly summary:** mood overview, notable moments, stats, and a suggested action — generated from the week's real conversations.

### 7 · Guardian controls
- **Check in now** — Mae texts the elder on demand.
- **Pause** — 3 days / 1 week / 2 weeks. Mae stops initiating but still replies if the elder texts first. After 4 days paused, guardians get one reminder that they can resume.
- Edit facts, reminders, active hours, summary schedule from the dashboard.

---

## Feature Status

| | Feature | Status |
|---|---|---|
| ✅ | Outbound iMessage/SMS w/ auto-fallback (Claw Messenger) | live, verified |
| ✅ | Two-way conversation w/ per-elder memory | live, verified |
| ✅ | Agent tools: save_fact, create_reminder, schedule_followup | live, verified |
| ✅ | Self-scheduled follow-ups (fires once, expires, merges) | live, verified |
| ✅ | Tapback reactions & judgment silence | live, verified |
| ✅ | Voice-note transcription (Whisper via Groq) | live, verified |
| ✅ | Sentiment + emergency-severity screening | live |
| ✅ | Scam shield — detects money/OTP/prize scams, warns elder, alerts guardians | built |
| ✅ | Human-style memory recall ("the other day", never timestamps) | built |
| ✅ | Heartbeat autonomy (LLM decides, guardrails in code) | live, verified |
| ✅ | Don't-pester policy + guardian escalation | built |
| ✅ | Pause / resume | built |
| ✅ | Multi-parent, co-guardian invites | built |
| ✅ | Weekly summary generation | built (on-demand) |
| ⏳ | Email alerts/invites (Resend) | needs API key |
| ⏳ | Scheduled summary *delivery* (cron send) | not wired |
| ⏳ | Production deploy (EC2 + pm2 + ffmpeg) | pending |
| 🔮 | Voice calls (Dograh + Twilio) | Phase 2 |

**Stack:** Fastify + TypeScript · Supabase Postgres + Drizzle · Groq Llama 3.3 70B + Whisper · Claw Messenger (iMessage/SMS) · React PWA + Tailwind · Resend

---

## Real-World Companion Patterns We Haven't Built Yet

Honest gap analysis — the conversational patterns real elders/companions have that Mae doesn't cover yet, roughly ordered by value-for-effort:

### 1. Timed reminder *delivery* ("it's 9am — did you take your BP meds?")
We store reminders and Mae knows about them, but nothing fires **at the exact time**. Real medication adherence needs a scheduled nudge, not ambient awareness. *Small build: reminders get an optional time-of-day; heartbeat delivers them.*

### 2. Family relay ("tell Kemi to call me")
Elders constantly use intermediaries to pass messages. Mae should catch this intent and ping the guardian — and the reverse: a guardian types a message in the dashboard, Mae weaves it into conversation ("Kemi says she'll visit Saturday!"). This makes Mae the family's connective tissue rather than a parallel channel. *Medium build: one new agent tool + a dashboard box.*

### 3. Special dates (birthdays, anniversaries, holidays)
A friend who forgets your birthday isn't much of a friend. Facts can store dates but nothing *acts* on them — birthday wishes, "merry Christmas", remembering a late spouse's anniversary gently. *Small build: date-typed facts + heartbeat awareness.*

### 4. Photo messages
Grandparents love sending photos (and receiving grandkid photos). Inbound images currently fall on the floor — only audio attachments are handled. A vision model could let Mae respond to "look at my garden!" properly. *Medium build: image attachment → vision model description → normal pipeline.*

### 5. Repetition & confusion as a health signal
Real companions notice when someone asks the same question three times in a week or seems disoriented — often the earliest dementia signal. We log everything but don't analyze *across* conversations for cognitive patterns. This could be a genuinely differentiating (and sensitive — needs care) feature. *Larger build: periodic cross-conversation analysis job.*

### ~~6. Scam shield~~ ✅ Built
Mae now detects scam patterns in what the elder shares (money requests, bank details, OTP codes, "locked account" calls, prize wins, urgent-payment pressure), gently urges them not to send anything until family confirms, and fires a "Possible SCAM targeting them" alert to guardians automatically.

### 7. Rituals (morning/night rhythm)
Many elders want a predictable "good morning ☀️" — ritual, not randomness. Heartbeat timing is deliberately unpredictable; an opt-in daily ritual message at a fixed time would complement it. *Small build.*

### 8. Loneliness engagement (games, stories, faith)
Riddles, trivia, "tell me about your day in 1965", prayer times, church reminders. The model already *wants* to do this (it spontaneously offered a riddle in testing). Costs nothing to encourage in the persona — huge for the "companionship" half of the promise, not just the "monitoring" half. *Prompt-only.*

### 9. Guardian ↔ Mae chat
Guardians will want to ask Mae questions too: "how has mum really been this month?" A dashboard chat over the elder's history (privacy-scoped) turns the activity feed into a conversation. *Medium build.*

### 10. Elder-initiated everything
Today the elder can reply and chat freely — but if Mae's number gets lost in their messages, there's no "text START to talk to Mae" re-entry ritual, and no printed fridge card with the number. Low-tech, high-adoption detail for the demographic. *Ops, not code.*

---

*Generated 2026-07-15 · Mae is a working prototype: every "live, verified" feature above has been proven end-to-end on a real phone.*
