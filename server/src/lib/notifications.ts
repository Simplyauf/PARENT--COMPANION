import { Resend } from 'resend'

function getResend() {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[notifications] RESEND_API_KEY not set — email alerts disabled')
    return null
  }
  return new Resend(process.env.RESEND_API_KEY)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertPayload = {
  guardianEmail: string
  guardianPhone?: string
  notifyVia: 'imessage' | 'gmail'
  parentName: string
  summary: string
  isEmergency: boolean
}

export type SummaryPayload = {
  guardianEmail: string
  guardianPhone?: string
  notifyVia: 'imessage' | 'gmail'
  parentName: string
  weekOf: string
  overallMood: string
  moodSentence: string
  notableMoments: string[]
  companionNote: string
  stats: { checkins: number; calls: number; alerts: number }
}

// ─── Gmail via Resend ─────────────────────────────────────────────────────────

export async function sendAlertEmail(payload: AlertPayload) {
  const subject = payload.isEmergency
    ? `🚨 Emergency alert — ${payload.parentName}`
    : `⚠️ Check-in alert — ${payload.parentName}`

  const resend = getResend()
  if (!resend) return
  await resend.emails.send({
    from: 'Companion <alerts@companion.app>',
    to: payload.guardianEmail,
    subject,
    html: `
      <div style="font-family: 'DM Sans', system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #F7F5F0;">
        <p style="font-family: Georgia, serif; font-size: 22px; color: #1B4D3E; margin: 0 0 16px;">
          ${payload.isEmergency ? 'Emergency Alert' : 'Check-in Alert'}
        </p>
        <p style="color: #1A1A1A; font-size: 15px; line-height: 1.6; margin: 0 0 12px;">
          Companion flagged something during ${payload.parentName}'s check-in:
        </p>
        <blockquote style="border-left: 3px solid #DC2626; margin: 0 0 20px; padding: 12px 16px; background: white; border-radius: 8px; color: #1A1A1A; font-size: 15px;">
          ${payload.summary}
        </blockquote>
        <p style="color: #6B7280; font-size: 13px;">
          Log in to your Companion dashboard for the full activity log.
        </p>
      </div>
    `,
  })
}

export async function sendSummaryEmail(payload: SummaryPayload) {
  const momentsHtml = payload.notableMoments
    .map(m => `<li style="margin-bottom: 10px; color: #1A1A1A;">${m}</li>`)
    .join('')

  const resend = getResend()
  if (!resend) return
  await resend.emails.send({
    from: 'Companion <summaries@companion.app>',
    to: payload.guardianEmail,
    subject: `${payload.parentName}'s weekly summary — ${payload.weekOf}`,
    html: `
      <div style="font-family: 'DM Sans', system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #F7F5F0;">
        <p style="color: #1B4D3E; font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; margin: 0 0 8px;">
          Week of ${payload.weekOf}
        </p>
        <h1 style="font-family: Georgia, serif; font-size: 26px; color: #1A1A1A; margin: 0 0 24px; font-weight: 500;">
          ${payload.parentName}'s weekly summary
        </h1>

        <div style="background: white; border-radius: 14px; padding: 20px; margin-bottom: 16px;">
          <p style="color: #6B7280; font-size: 11px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; margin: 0 0 8px;">Overall mood</p>
          <p style="color: #1A1A1A; font-size: 16px; font-weight: 600; margin: 0 0 4px; text-transform: capitalize;">${payload.overallMood}</p>
          <p style="color: #6B7280; font-size: 14px; margin: 0;">${payload.moodSentence}</p>
        </div>

        <div style="display: flex; gap: 12px; margin-bottom: 16px;">
          ${[
            { label: 'Check-ins', value: payload.stats.checkins },
            { label: 'Calls made', value: payload.stats.calls },
            { label: 'Alerts', value: payload.stats.alerts },
          ].map(s => `
            <div style="flex: 1; background: white; border-radius: 14px; padding: 16px; text-align: center;">
              <p style="font-family: 'DM Mono', monospace; font-size: 22px; color: #1A1A1A; margin: 0 0 4px;">${s.value}</p>
              <p style="color: #6B7280; font-size: 12px; margin: 0;">${s.label}</p>
            </div>
          `).join('')}
        </div>

        <div style="background: white; border-radius: 14px; padding: 20px; margin-bottom: 16px;">
          <p style="color: #6B7280; font-size: 11px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; margin: 0 0 12px;">Notable moments</p>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.7;">
            ${momentsHtml}
          </ul>
        </div>

        <div style="background: #1B4D3E; border-radius: 14px; padding: 20px;">
          <p style="color: rgba(247,245,240,0.6); font-size: 11px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; margin: 0 0 8px;">Companion note</p>
          <p style="color: white; font-size: 14px; line-height: 1.7; margin: 0;">${payload.companionNote}</p>
        </div>
      </div>
    `,
  })
}

// ─── iMessage via Claw Messenger WebSocket ────────────────────────────────────

import { sendMessage as clawSend } from './claw.js'

export async function sendIMessageAlert(phone: string, message: string) {
  await clawSend(phone, message)
}

export async function sendIMessageCheckin(phone: string, message: string) {
  await clawSend(phone, message)
}

// ─── Dispatch helper — chooses channel automatically ─────────────────────────

export async function dispatchAlert(payload: AlertPayload) {
  const msg = payload.isEmergency
    ? `🚨 Emergency alert for ${payload.parentName}: ${payload.summary}`
    : `⚠️ Check-in alert for ${payload.parentName}: ${payload.summary}`

  if (payload.notifyVia === 'imessage' && payload.guardianPhone) {
    await sendIMessageAlert(payload.guardianPhone, msg)
  } else {
    await sendAlertEmail(payload)
  }
}
