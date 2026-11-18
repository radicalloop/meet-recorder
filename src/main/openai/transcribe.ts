// File transcription (POST /v1/audio/transcriptions). gpt-transcribe returns text only — no
// timestamps — so callers send one turn per request to keep its start time.
import { apiUrl, OpenAIAuthError, OpenAIRequestError } from './responses'

export interface TranscribeAudioOptions {
  apiKey: string
  model: string
  /** Complete WAV file (≤ 25 MB). */
  wav: Buffer
  /** Context about the recording (e.g. its title). */
  prompt?: string
  /** ISO 639-1 codes; omitted when empty. */
  languages: string[]
  baseUrl?: string
  /** Attempts on 429/5xx/network errors. */
  attempts?: number
}

const TIMEOUT_MS = 120_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function requestOnce(opts: TranscribeAudioOptions): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(opts.wav)], { type: 'audio/wav' }), 'turn.wav')
  form.append('model', opts.model)
  if (opts.prompt) form.append('prompt', opts.prompt)
  for (const lang of opts.languages) form.append('languages[]', lang)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(apiUrl(opts.baseUrl, '/v1/audio/transcriptions'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
      signal: controller.signal
    })
    const body = await res.text()
    let parsed: { text?: unknown; error?: { message?: string } } = {}
    try {
      parsed = JSON.parse(body)
    } catch {
      // non-JSON error bodies are reported raw below
    }
    const message = parsed.error?.message ?? (body || `Transcription failed (${res.status})`)
    if (res.status === 401 || res.status === 403) throw new OpenAIAuthError(message)
    if (!res.ok) throw new OpenAIRequestError(res.status, message)
    return typeof parsed.text === 'string' ? parsed.text.trim() : ''
  } finally {
    clearTimeout(timer)
  }
}

function retryable(err: unknown): boolean {
  if (err instanceof OpenAIAuthError) return false
  if (err instanceof OpenAIRequestError) return err.status === 429 || err.status >= 500
  return true // network errors and timeouts
}

/** Transcribes one WAV file. Throws OpenAIAuthError on a bad key, the last error otherwise. */
export async function transcribeAudio(opts: TranscribeAudioOptions): Promise<string> {
  const attempts = opts.attempts ?? 3
  for (let attempt = 1; ; attempt++) {
    try {
      return await requestOnce(opts)
    } catch (err) {
      if (attempt >= attempts || !retryable(err)) throw err
      await sleep(1000 * 2 ** (attempt - 1))
    }
  }
}
