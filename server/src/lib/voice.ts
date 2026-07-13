// Voice note transcription — download the audio attachment, convert to a
// Whisper-friendly format if needed, transcribe via Groq's whisper-large-v3
// (same free API key; handles Yoruba, Hausa, Igbo, pidgin, and ~100 languages).

import { writeFile, readFile, unlink } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { tmpdir } from 'os'
import { join } from 'path'

const exec = promisify(execFile)

const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const WHISPER_MODEL = 'whisper-large-v3'

// Formats Groq's Whisper endpoint accepts directly
const DIRECT_OK = new Set(['mp3', 'm4a', 'ogg', 'opus', 'wav', 'webm', 'flac', 'mp4', 'mpeg', 'mpga'])

const MIME_EXT: Record<string, string> = {
  'audio/x-caf': 'caf',
  'audio/caf': 'caf',
  'audio/amr': 'amr',
  'audio/3gpp': '3gp',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
}

async function toWav(inPath: string, outPath: string): Promise<boolean> {
  // Prefer ffmpeg (EC2/Linux: `apt install ffmpeg`), fall back to macOS afconvert
  try {
    await exec('ffmpeg', ['-y', '-i', inPath, '-ar', '16000', '-ac', '1', outPath])
    return true
  } catch { /* ffmpeg missing or failed */ }
  try {
    await exec('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', inPath, outPath])
    return true
  } catch { /* afconvert missing or failed */ }
  return false
}

export async function transcribeVoiceNote(url: string, mimeType: string): Promise<string> {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set')

  const res = await fetch(url)
  if (!res.ok) throw new Error(`audio download failed: HTTP ${res.status}`)
  const audio = Buffer.from(await res.arrayBuffer())

  const ext = MIME_EXT[mimeType.toLowerCase().split(';')[0]] ?? 'bin'
  let uploadName = `voice.${ext}`
  let uploadData: Buffer = audio
  const tmpFiles: string[] = []

  // Convert formats Whisper can't ingest (Apple .caf voice notes, AMR, …)
  if (!DIRECT_OK.has(ext)) {
    const inPath = join(tmpdir(), `companion-vn-${Date.now()}.${ext}`)
    const outPath = inPath.replace(`.${ext}`, '.wav')
    tmpFiles.push(inPath, outPath)
    await writeFile(inPath, audio)

    if (await toWav(inPath, outPath)) {
      uploadData = await readFile(outPath)
      uploadName = 'voice.wav'
    } else {
      console.warn(`[voice] no converter for .${ext} — attempting direct upload`)
    }
  }

  try {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(uploadData)]), uploadName)
    form.append('model', WHISPER_MODEL)

    const groqRes = await fetch(GROQ_TRANSCRIBE_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: form,
    })

    if (!groqRes.ok) {
      throw new Error(`Groq transcription ${groqRes.status}: ${await groqRes.text()}`)
    }

    const data = await groqRes.json() as { text: string }
    return data.text.trim()
  } finally {
    await Promise.allSettled(tmpFiles.map(f => unlink(f)))
  }
}
