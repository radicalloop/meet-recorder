// Shared helpers for the OpenAI Responses API (plain Node, global fetch).

export class OpenAIAuthError extends Error {
  constructor(message = 'Invalid API key') {
    super(message)
    this.name = 'OpenAIAuthError'
  }
}

export class OpenAIRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'OpenAIRequestError'
  }
}

/** Human-readable reason for a failed OpenAI call, including HTTP status or network cause. */
export function describeError(err: unknown): string {
  return rawDescription(err).replace(/[.\s]+$/, '') // callers add their own punctuation
}

function rawDescription(err: unknown): string {
  if (err instanceof OpenAIRequestError) return `OpenAI returned ${err.status}: ${err.message}`
  if (err instanceof Error) {
    if (err.name === 'AbortError') return 'the request to OpenAI timed out'
    const cause = (err as { cause?: { message?: string; code?: string } }).cause
    const detail = cause?.code ?? cause?.message
    return detail ? `${err.message} (${detail})` : err.message
  }
  return String(err)
}

export const DEFAULT_BASE_URL = 'https://api.openai.com'

export function apiUrl(baseUrl: string | undefined, path: string): string {
  return `${(baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')}${path}`
}

function errorMessage(bodyText: string, status: number): string {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } }
    if (parsed.error?.message) return parsed.error.message
  } catch {
    // keep the raw body
  }
  return bodyText || `OpenAI request failed (${status})`
}

export async function postResponses(opts: {
  apiKey: string
  baseUrl?: string
  body: Record<string, unknown>
  timeoutMs: number
}): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
  try {
    const res = await fetch(apiUrl(opts.baseUrl, '/v1/responses'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(opts.body),
      signal: controller.signal
    })
    const text = await res.text()
    if (res.status === 401 || res.status === 403) {
      throw new OpenAIAuthError(errorMessage(text, res.status))
    }
    if (!res.ok) throw new OpenAIRequestError(res.status, errorMessage(text, res.status))
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
  }
}

/** Concatenated output_text parts of a Responses API result. */
export function extractOutputText(resp: unknown): string {
  const r = resp as { output?: unknown; output_text?: unknown }
  if (typeof r.output_text === 'string' && r.output_text.length > 0) return r.output_text
  let text = ''
  if (Array.isArray(r.output)) {
    for (const item of r.output) {
      const msg = item as { type?: string; content?: unknown }
      if (msg.type !== 'message' || !Array.isArray(msg.content)) continue
      for (const part of msg.content) {
        const p = part as { type?: string; text?: string }
        if (p.type === 'output_text' && typeof p.text === 'string') text += p.text
      }
    }
  }
  return text
}
