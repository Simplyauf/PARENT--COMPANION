import WebSocket from 'ws'
import { db } from '../db/index.js'
import { parents, activityLogs, guardianParentLinks } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { analyzeTranscript, COMPANION_NAME } from './llm.js'
import { dispatchAlert } from './notifications.js'
import { runAgentTurn } from './agent.js'
import { transcribeVoiceNote } from './voice.js'

const GUEST_MESSAGE_CAP = 8

const WS_URL = `wss://claw-messenger.onrender.com/ws?key=${process.env.CLAW_API_KEY}`
const PING_INTERVAL_MS = 25_000
const RECONNECT_MAX_MS = 30_000

let ws: WebSocket | null = null
let reconnectDelay = 1000
let pingTimer: ReturnType<typeof setInterval> | null = null
let msgCounter = 0
let lastSeen = 0

const STALE_MS = 65_000 // 2+ missed ping/pong cycles = connection is dead

// ─── Connect + auto-reconnect ─────────────────────────────────────────────────

export function connectClaw() {
  if (!process.env.CLAW_API_KEY) {
    console.warn('[claw] CLAW_API_KEY not set — iMessage disabled')
    return
  }
  connect()
}

function connect() {
  console.log('[claw] connecting…')
  ws = new WebSocket(WS_URL)

  ws.on('open', () => {
    console.log('[claw] connected')
    reconnectDelay = 1000
    lastSeen = Date.now()

    // Keepalive ping + staleness watchdog: a half-dead connection never emits
    // 'close', so if we stop hearing ANYTHING (even pongs), force a reconnect
    pingTimer = setInterval(() => {
      if (Date.now() - lastSeen > STALE_MS) {
        console.warn('[claw] connection stale (no traffic) — forcing reconnect')
        ws?.terminate()
        return
      }
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, PING_INTERVAL_MS)
  })

  ws.on('message', (raw) => {
    lastSeen = Date.now()
    let msg: Record<string, unknown>
    try { msg = JSON.parse(raw.toString()) } catch { return }
    handleMessage(msg)
  })

  ws.on('pong', () => { lastSeen = Date.now() })

  ws.on('close', () => {
    console.warn(`[claw] disconnected — reconnecting in ${reconnectDelay}ms`)
    clearInterval(pingTimer!)
    setTimeout(connect, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS)
  })

  ws.on('error', (err) => {
    console.error('[claw] ws error:', err.message)
  })
}

// ─── Inbound message handler ──────────────────────────────────────────────────

async function handleMessage(msg: Record<string, unknown>) {
  if (msg.type === 'pong') return
  if (msg.type === 'status') return

  if (msg.type === 'reaction') {
    // Parent tapped a reaction on one of our messages — nice signal, no action needed
    console.log(`[claw] reaction from ${msg.from}: ${msg.reactionType} (added: ${msg.added})`)
    return
  }

  if (msg.type === 'message') {
    const from = msg.from as string
    const inboundMessageId = (msg.messageId ?? msg.id) as string | undefined
    let text = (msg.text as string) ?? ''
    const attachments = (msg.attachments as { url: string; mimeType: string }[] | undefined) ?? []
    if (!from) return

    // Look up parent by phone number — auto-provision a guest if this is an
    // unregistered number texting Mae directly (the public "Try Free" line).
    // No guardian, no subscription, full agent experience up to the cap below.
    let parent = await db.query.parents.findFirst({ where: eq(parents.phone, from) })
    if (!parent) {
      const [created] = await db.insert(parents).values({
        name: 'Guest',
        phone: from,
        isGuest: true,
        selfSetup: true,
      }).returning()
      parent = created
      console.log(`[claw] auto-provisioned guest from unregistered number ${from}`)
    }

    // Guest already used their free preview — cheap static reply, skip
    // analysis and the agent entirely so a spammed number can't run up cost
    if (parent.isGuest && parent.guestMessageCount >= GUEST_MESSAGE_CAP) {
      await sendMessage(parent.phone, "Hey! You've reached the end of your free preview with me — if you'd like real daily check-ins (for yourself or someone you care about), head to maemate.com to keep this going 💛")
        .catch(err => console.error('[claw] guest cap reminder send failed:', err.message))
      return
    }

    // They replied — clear any unresponsiveness escalation state
    if (parent.noReplyAlertedAt) {
      await db.update(parents).set({ noReplyAlertedAt: null }).where(eq(parents.id, parent.id))
    }

    // Voice notes: transcribe and treat like typed text
    const audioAttachments = attachments.filter(a => a.mimeType?.startsWith('audio/'))
    for (const audio of audioAttachments) {
      try {
        const transcript = await transcribeVoiceNote(audio.url, audio.mimeType)
        console.log(`[voice] transcribed voice note from ${parent.name}: "${transcript.slice(0, 80)}"`)
        text = text ? `${text}\n${transcript}` : transcript
      } catch (err) {
        console.error('[voice] transcription failed:', (err as Error).message)
      }
    }

    if (!text) {
      // Voice note we couldn't understand (or unsupported attachment) — say so
      // instead of silently ignoring an elderly person's message
      if (audioAttachments.length) {
        await sendMessage(parent.phone, "Sorry, I couldn't quite hear that voice note — could you try sending it again?")
          .catch(err => console.error('[voice] apology send failed:', err.message))
      }
      return
    }

    const analysis = await analyzeTranscript(text)

    const [inboundLog] = await db.insert(activityLogs).values({
      parentId: parent.id,
      type: 'message',
      direction: 'inbound',
      summary: analysis.summary,
      sentiment: analysis.sentiment,
      rawTranscript: text,
    }).returning({ id: activityLogs.id })

    if (analysis.sentiment === 'alert') {
      const links = await db.query.guardianParentLinks.findMany({
        where: eq(guardianParentLinks.parentId, parent.id),
        with: { guardian: true, parent: true },
      })
      await Promise.allSettled(
        links.map(l =>
          dispatchAlert({
            guardianEmail: l.guardian.email,
            guardianPhone: l.guardian.phone ?? undefined,
            parentPhone: l.parent.phone,
            notifyVia: l.notifyVia,
            parentName: l.parent.name,
            summary: analysis.scam
              ? `Possible SCAM targeting them — ${analysis.summary} ${COMPANION_NAME} has warned them not to send anything; a personal call would help.`
              : analysis.summary,
            isEmergency: analysis.emergency === true,
          })
        )
      )
    }

    // Guests still get the same full agent experience up to the cap — only
    // the message count is limited, not the quality of any given reply
    let guestCapReached = false
    if (parent.isGuest) {
      const newCount = parent.guestMessageCount + 1
      guestCapReached = newCount === GUEST_MESSAGE_CAP
      await db.update(parents).set({ guestMessageCount: newCount }).where(eq(parents.id, parent.id))
    }

    // Agentic reply — the companion talks back, remembers, and schedules follow-ups
    try {
      const reply = await runAgentTurn(parent, text, inboundLog.id, inboundMessageId, {
        emergency: analysis.emergency === true,
        scam: analysis.scam === true,
        guestCapReached,
      })
      if (reply) console.log(`[agent] replied to ${parent.name}: "${reply.slice(0, 80)}"`)
    } catch (err) {
      console.error('[agent] reply failed:', (err as Error).message)
    }
  }

  if (msg.type === 'send.result' && !(msg as any).ok) {
    console.error('[claw] send failed:', msg.error ?? msg.status)
  }
}

// ─── Send a tapback reaction ──────────────────────────────────────────────────

export type ReactionType = 'love' | 'like' | 'dislike' | 'laugh' | 'emphasize' | 'question'

export function sendReaction(messageId: string, reactionType: ReactionType): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return reject(new Error('Claw Messenger not connected'))
    }
    ws.send(JSON.stringify({ type: 'reaction', messageId, reactionType, remove: false }), (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// ─── Send a message ───────────────────────────────────────────────────────────

export function sendMessage(to: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return reject(new Error('Claw Messenger not connected'))
    }

    const id = `msg-${++msgCounter}-${Date.now()}`

    const payload = {
      type: 'send',
      id,
      to,
      parts: [{ type: 'text', value: text }],
      service: 'iMessage',
    }

    ws.send(JSON.stringify(payload), (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// ─── Register a phone number with Claw Messenger ──────────────────────────────
// Must be called when a new parent is added so inbound replies are routed to us

export async function registerPhone(phone: string) {
  const res = await fetch('https://claw-messenger.onrender.com/api/routes', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CLAW_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ phone_number: phone }),
  })

  const body = await res.json() as { ok: boolean; already_claimed?: boolean }
  if (!body.ok) throw new Error(`Failed to register phone ${phone}`)
  console.log(`[claw] registered ${phone}${body.already_claimed ? ' (already claimed)' : ''}`)
}
