import type { ModelOption, ModelOptions } from '../../shared/types'
import { apiUrl, OpenAIAuthError, OpenAIRequestError } from './responses'

const TIMEOUT_MS = 15_000

export interface ModelEntry {
  id?: string
  created?: number
  shutdown_date?: string | null
}

/** File transcription models; live/realtime ones only work over WebSocket. */
function isTranscriptionModel(id: string): boolean {
  return (/transcribe/.test(id) || id.startsWith('whisper')) && !/live|realtime/.test(id)
}

/** Text models that can write the notes through the Responses API. */
function isNotesModel(id: string): boolean {
  if (!/^(gpt-|o\d)/.test(id)) return false
  return !/transcribe|tts|realtime|live|audio|image|search|embedding|moderation|instruct|codex/.test(
    id
  )
}

/** Dated snapshots (e.g. "gpt-5-2025-08-07") duplicate their alias and clutter the list. */
function isSnapshot(id: string): boolean {
  return /-\d{4}-\d{2}-\d{2}$/.test(id)
}

/** Splits /v1/models into dropdown options per role, newest first; retired models are dropped. */
export function classifyModels(entries: ModelEntry[], today = new Date()): ModelOptions {
  const todayIso = today.toISOString().slice(0, 10)
  const usable = entries
    .filter((e): e is ModelEntry & { id: string } => typeof e.id === 'string')
    .filter((e) => !isSnapshot(e.id))
    .filter((e) => !e.shutdown_date || e.shutdown_date > todayIso)
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id))
  const option = (e: ModelEntry & { id: string }): ModelOption => ({
    id: e.id,
    shutdownDate: e.shutdown_date ?? null
  })
  return {
    transcription: usable.filter((e) => isTranscriptionModel(e.id)).map(option),
    summary: usable.filter((e) => isNotesModel(e.id)).map(option)
  }
}

/** Models this API key can use, grouped for the Settings dropdowns. */
export async function listModels(apiKey: string, baseUrl?: string): Promise<ModelOptions> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(apiUrl(baseUrl, '/v1/models'), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    })
    if (res.status === 401) throw new OpenAIAuthError('Invalid API key')
    if (!res.ok) throw new OpenAIRequestError(res.status, 'Could not load the model list')
    const data = (await res.json()) as { data?: ModelEntry[] }
    return classifyModels(data.data ?? [])
  } finally {
    clearTimeout(timer)
  }
}
