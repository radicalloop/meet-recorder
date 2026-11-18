// Shared contract between main, preload and renderer.

export type AudioSource = 'mic' | 'system'

export interface Settings {
  openaiApiKey: string
  /** File transcription model (POST /v1/audio/transcriptions), run after the recording stops. */
  transcriptionModel: string
  /** Model used for the end-of-session notes. */
  summaryModel: string
  /** Root folder for sessions. Empty string = main process default (~/MeetRecorder). */
  outputDir: string
  /** Expected spoken languages (ISO 639-1), passed to the transcriber. Empty = auto. */
  languages: string[]
  recordVideo: boolean
  videoFps: number
  videoMaxHeight: number
  micDeviceId: string
}

/** Settings as seen by the renderer: the API key never leaves the main process. */
export type PublicSettings = Omit<Settings, 'openaiApiKey'> & {
  hasApiKey: boolean
  /** e.g. "sk-…a1b2", empty when no key. */
  apiKeyHint: string
  /** False when the OS keychain is unavailable and the key is stored in plain text. */
  keyEncrypted: boolean
}

export type SettingsUpdate = Partial<Settings>

export interface ModelOption {
  id: string
  /** YYYY-MM-DD from GET /v1/models, null when none announced. */
  shutdownDate: string | null
}

/** Models the API key can use, per role, newest first. */
export interface ModelOptions {
  transcription: ModelOption[]
  summary: ModelOption[]
}

export interface CaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnailDataUrl: string
}

export interface SessionStartRequest {
  title: string
}

export interface SessionInfo {
  id: string
  title: string
  /** Absolute path of the session folder. */
  dir: string
  /** ISO timestamp. */
  startedAt: string
}

/** One stretch of speech from one channel, transcribed after the recording stops. */
export interface TranscriptSegment {
  /** Stable id of the turn, e.g. "turn-12". */
  id: string
  source: AudioSource
  text: string
  /** Milliseconds since session start. */
  startMs: number
  endMs: number
  /** False only if transcription of this turn failed (text is then a placeholder). */
  final: boolean
}

export type TranscriptEvent =
  /** During recording: speech clips captured so far. */
  | { type: 'activity'; micClips: number; systemClips: number }
  /** After stop: a transcribed turn (upsert by segment.id; arrive out of order). */
  | { type: 'segment'; segment: TranscriptSegment }

export type SessionPhase =
  'idle' | 'recording' | 'finalizing' | 'transcribing' | 'summarizing' | 'done' | 'error'

export interface SessionStatus {
  phase: SessionPhase
  message?: string
  sessionId?: string
  /** Set during 'transcribing'. */
  progress?: { done: number; total: number }
}

export interface SessionResult {
  info: SessionInfo
  videoPath: string | null
  transcriptPath: string
  notesPath: string | null
  notesMarkdown: string | null
  error?: string
}

export interface SessionListItem {
  id: string
  title: string
  dir: string
  startedAt: string
  hasVideo: boolean
  hasNotes: boolean
}

/** Exposed by preload as `window.meet`. */
export interface MeetApi {
  platform: 'darwin' | 'win32' | 'linux' | string
  settings: {
    get(): Promise<PublicSettings>
    update(update: SettingsUpdate): Promise<PublicSettings>
    listModels(): Promise<ModelOptions>
    chooseOutputDir(): Promise<string | null>
  }
  capture: {
    listSources(): Promise<CaptureSource[]>
    /** Must be called before the renderer calls getDisplayMedia. */
    selectSource(id: string): Promise<void>
  }
  session: {
    start(req: SessionStartRequest): Promise<SessionInfo>
    /** Resolves after transcript + notes are written. */
    stop(): Promise<SessionResult>
    /** WebM chunk from MediaRecorder, appended to the session's video file. */
    appendVideo(chunk: ArrayBuffer): void
    onTranscript(cb: (e: TranscriptEvent) => void): () => void
    onStatus(cb: (s: SessionStatus) => void): () => void
  }
  audio: {
    /** 24 kHz mono PCM16 little-endian, speech only (client-side VAD). Saved as a clip. */
    push(source: AudioSource, pcm16: ArrayBuffer): void
    /** End of a speech clip; times in ms since session start. */
    commit(source: AudioSource, startMs: number, endMs: number): void
  }
  sessions: {
    list(): Promise<SessionListItem[]>
    open(dir: string): Promise<void>
  }
}
