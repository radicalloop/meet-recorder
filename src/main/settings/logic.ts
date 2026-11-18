// Pure settings logic (electron-free, unit-tested). Persistence lives in ./index.ts.
import { homedir } from 'os'
import { join } from 'path'
import type { PublicSettings, Settings, SettingsUpdate } from '../../shared/types'

export const ALLOWED_VIDEO_HEIGHTS = [720, 1080, 1440]

export function resolveOutputDir(dir: string): string {
  const trimmed = dir.trim()
  return trimmed || join(homedir(), 'MeetRecorder')
}

/** e.g. "sk-…a1b2"; empty when there is no key. */
export function apiKeyHint(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return `${key.slice(0, 2)}…`
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}

/** Live/realtime transcribers only work over WebSocket, not POST /v1/audio/transcriptions. */
function isLiveModel(model: string): boolean {
  return /live|realtime/i.test(model)
}

/** Validating merge; also used to sanitize whatever was persisted on disk. */
export function applyUpdate(current: Settings, update: SettingsUpdate): Settings {
  const next = { ...current }
  if (typeof update.openaiApiKey === 'string') next.openaiApiKey = update.openaiApiKey.trim()
  for (const field of ['transcriptionModel', 'summaryModel'] as const) {
    const value = update[field]
    if (typeof value !== 'string' || !value.trim()) continue
    // Settings saved before the switch to file transcription still hold gpt-live-transcribe.
    if (field === 'transcriptionModel' && isLiveModel(value)) continue
    next[field] = value.trim()
  }
  if (typeof update.outputDir === 'string') next.outputDir = update.outputDir.trim()
  if (Array.isArray(update.languages)) {
    next.languages = update.languages
      .filter((l): l is string => typeof l === 'string')
      .map((l) => l.trim().toLowerCase())
      .filter((l) => /^[a-z]{2,3}$/.test(l))
  }
  if (typeof update.recordVideo === 'boolean') next.recordVideo = update.recordVideo
  if (typeof update.videoFps === 'number' && Number.isFinite(update.videoFps))
    next.videoFps = Math.min(30, Math.max(5, Math.round(update.videoFps)))
  if (
    typeof update.videoMaxHeight === 'number' &&
    ALLOWED_VIDEO_HEIGHTS.includes(update.videoMaxHeight)
  )
    next.videoMaxHeight = update.videoMaxHeight
  if (typeof update.micDeviceId === 'string') next.micDeviceId = update.micDeviceId
  return next
}

export function toPublic(settings: Settings, keyEncrypted: boolean): PublicSettings {
  const { openaiApiKey, ...rest } = settings
  return {
    ...rest,
    outputDir: resolveOutputDir(settings.outputDir),
    hasApiKey: openaiApiKey.length > 0,
    apiKeyHint: apiKeyHint(openaiApiKey),
    keyEncrypted
  }
}
