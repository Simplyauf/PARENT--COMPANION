// LLM client — Vertex AI (Gemini), replacing Groq.
// Auth via GOOGLE_APPLICATION_CREDENTIALS (service account JSON, see
// server/credentials/vertex-service-account.json — gitignored).

import { GoogleGenAI, type Content, type Part, type Tool } from '@google/genai'
import type { ChatMessage, ToolDef, ToolCall } from './llm.js'

const MODEL = process.env.VERTEX_MODEL ?? 'gemini-2.5-flash'

let client: GoogleGenAI | undefined

function getClient(): GoogleGenAI {
  if (client) return client
  if (!process.env.GOOGLE_CLOUD_PROJECT) throw new Error('GOOGLE_CLOUD_PROJECT not set')
  client = new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1',
  })
  return client
}

// Gemini has no "tool" role and no system role in `contents` — system
// messages become `systemInstruction`, assistant tool-calls become `model`
// parts with functionCall, and tool results become `user` parts with
// functionResponse. Track call id -> function name so tool-result messages
// (which only carry a tool_call_id) can populate FunctionResponse.name.
function toGeminiContents(messages: ChatMessage[]): { systemInstruction: string; contents: Content[] } {
  const systemParts: string[] = []
  const contents: Content[] = []
  const nameByCallId = new Map<string, string>()

  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content) systemParts.push(m.content)
      continue
    }

    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.content ?? '' }] })
      continue
    }

    if (m.role === 'assistant') {
      const parts: Part[] = []
      if (m.content) parts.push({ text: m.content })
      for (const call of m.tool_calls ?? []) {
        nameByCallId.set(call.id, call.function.name)
        parts.push({
          functionCall: {
            id: call.id,
            name: call.function.name,
            args: JSON.parse(call.function.arguments || '{}'),
          },
        })
      }
      contents.push({ role: 'model', parts })
      continue
    }

    if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            id: m.tool_call_id,
            name: m.tool_call_id ? nameByCallId.get(m.tool_call_id) : undefined,
            response: { result: m.content ?? '' },
          },
        }],
      })
    }
  }

  return { systemInstruction: systemParts.join('\n\n'), contents }
}

function toGeminiTools(tools: ToolDef[]): Tool[] {
  return [{
    functionDeclarations: tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parametersJsonSchema: t.function.parameters,
    })),
  }]
}

export async function vertexChat(
  messages: ChatMessage[],
  opts: { tools?: ToolDef[]; jsonMode?: boolean; temperature?: number } = {}
): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  const { systemInstruction, contents } = toGeminiContents(messages)

  const response = await getClient().models.generateContent({
    model: MODEL,
    contents,
    config: {
      ...(systemInstruction ? { systemInstruction } : {}),
      temperature: opts.temperature ?? 0.7,
      ...(opts.tools ? { tools: toGeminiTools(opts.tools) } : {}),
      ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  })

  const calls = response.functionCalls
  if (calls?.length) {
    return {
      content: response.text ?? null,
      tool_calls: calls.map((fc, i) => ({
        id: fc.id ?? `${fc.name}_${i}`,
        type: 'function' as const,
        function: { name: fc.name ?? '', arguments: JSON.stringify(fc.args ?? {}) },
      })),
    }
  }

  return { content: response.text ?? null }
}
