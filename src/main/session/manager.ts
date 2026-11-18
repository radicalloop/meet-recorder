// Session lifecycle: recording (video + speech clips), then
// transcription of the clips after stop, transcript.md and notes.md.
// Electron-free so the whole lifecycle is unit-testable with the openai module mocked.
import { mkdir, readdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { describeError, summarize, transcribeAudio } from '../openai'
import type {
  AudioSource,
  SessionInfo,
  SessionResult,
  SessionStartRequest,
  SessionStatus,
  Settings,
  TranscriptEvent,
  TranscriptSegment
} from '../../shared/types'
import { dedupeName, sessionFolderName } from './naming'
import { ClipRecorder } from './clips'
import { groupTurns, joinClips, wavFromPcm, type Turn } from './turns'
import { renderTranscript } from './transcriptDoc'
import { VideoWriter } from './videoWriter'

export interface ManagerEvents {
  emitTranscript(e: TranscriptEvent): void
  emitStatus(s: SessionStatus): void
}

const TRANSCRIBE_CONCURRENCY = 4
const FAILED_TURN_TEXT = '[This part could not be transcribed]'

interface ActiveSession {
  info: SessionInfo
  startedAtMs: number
  settings: Settings
  clips: ClipRecorder
  video: VideoWriter
  accepting: boolean
}

function isAuthError(err: unknown): boolean {
  return err instanceof Error && err.name === 'OpenAIAuthError'
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await worker(items[next++])
  })
  await Promise.all(lanes)
}

export class SessionManager {
  private session: ActiveSession | null = null
  private finalizing = false

  constructor(
    private readonly events: ManagerEvents,
    private readonly now: () => number = Date.now
  ) {}

  get active(): boolean {
    return this.session !== null
  }

  async start(
    req: SessionStartRequest,
    settings: Settings,
    outputDir: string,
    appVersion: string
  ): Promise<SessionInfo> {
    if (this.session) throw new Error('A recording is already in progress.')
    const apiKey = settings.openaiApiKey.trim()
    if (!apiKey) throw new Error('Add your OpenAI API key in Settings before recording.')

    const title = req.title.trim() || 'Meeting'
    const startedAtMs = this.now()
    await mkdir(outputDir, { recursive: true })
    const existing = new Set(await readdir(outputDir))
    const folder = dedupeName(sessionFolderName(new Date(startedAtMs), title), (n) =>
      existing.has(n)
    )
    const dir = join(outputDir, folder)
    await mkdir(dir)

    const info: SessionInfo = {
      id: randomUUID(),
      title,
      dir,
      startedAt: new Date(startedAtMs).toISOString()
    }
    await writeFile(
      join(dir, 'session.json'),
      JSON.stringify(
        {
          id: info.id,
          title,
          startedAt: info.startedAt,
          models: {
            transcription: settings.transcriptionModel,
            summary: settings.summaryModel
          },
          version: appVersion
        },
        null,
        2
      ) + '\n'
    )

    this.session = {
      info,
      startedAtMs,
      settings: { ...settings, openaiApiKey: apiKey },
      clips: new ClipRecorder(dir),
      video: new VideoWriter(join(dir, 'recording.webm')),
      accepting: true
    }
    this.events.emitStatus({ phase: 'recording', sessionId: info.id })
    return info
  }

  appendVideo(chunk: Buffer): void {
    if (!this.session?.accepting) return
    this.session.video.append(chunk)
  }

  pushAudio(source: AudioSource, pcm16: Buffer): void {
    if (!this.session?.accepting) return
    this.session.clips.push(source, pcm16)
  }

  commitAudio(source: AudioSource, startMs: number, endMs: number): void {
    const session = this.session
    if (!session?.accepting) return
    if (!session.clips.commit(source, startMs, endMs)) return
    const counts = session.clips.counts()
    this.events.emitTranscript({
      type: 'activity',
      micClips: counts.mic,
      systemClips: counts.system
    })
  }

  /** Transcribes every turn; failed turns get placeholder text and `final: false`. */
  private async transcribeTurns(
    session: ActiveSession,
    turns: Turn[]
  ): Promise<{
    segments: TranscriptSegment[]
    failed: number
    authError: boolean
    /** Reason of the first failure, shown to the user. */
    firstError: string | null
  }> {
    const { info, settings } = session
    const prompt = `Recording of a meeting titled "${info.title}".`
    const segments: TranscriptSegment[] = []
    let failed = 0
    let authError = false
    let firstError: string | null = null
    let done = 0
    const progress = (): void =>
      this.events.emitStatus({
        phase: 'transcribing',
        sessionId: info.id,
        progress: { done, total: turns.length }
      })
    progress()

    const reader = await session.clips.openReader()
    try {
      await runPool(turns, TRANSCRIBE_CONCURRENCY, async (turn) => {
        let text = FAILED_TURN_TEXT
        let ok = false
        if (!authError) {
          try {
            const pcm = joinClips(await Promise.all(turn.clips.map((c) => reader.read(c))))
            text = await transcribeAudio({
              apiKey: settings.openaiApiKey,
              model: settings.transcriptionModel,
              wav: wavFromPcm(pcm),
              prompt,
              languages: settings.languages
            })
            ok = true
          } catch (err) {
            if (isAuthError(err)) authError = true
            firstError ??= describeError(err)
          }
        }
        if (!ok) failed++
        done++
        // A turn that was only noise comes back empty; drop it.
        if (ok && !text) {
          progress()
          return
        }
        const segment: TranscriptSegment = {
          id: turn.id,
          source: turn.source,
          text,
          startMs: turn.startMs,
          endMs: turn.endMs,
          final: ok
        }
        segments.push(segment)
        this.events.emitTranscript({ type: 'segment', segment })
        progress()
      })
    } finally {
      await reader.close()
    }
    return { segments, failed, authError, firstError }
  }

  async stop(): Promise<SessionResult> {
    const session = this.session
    if (!session || this.finalizing) throw new Error('No recording in progress.')
    this.finalizing = true
    const { info, settings } = session
    try {
      this.events.emitStatus({ phase: 'finalizing', sessionId: info.id })
      session.accepting = false
      const durationMs = this.now() - session.startedAtMs
      const [wroteVideo, clipsError] = await Promise.all([
        session.video.end(),
        session.clips.close().then(
          () => null,
          (err: Error) => err
        )
      ])
      const videoPath = wroteVideo ? join(info.dir, 'recording.webm') : null
      if (clipsError) {
        this.events.emitStatus({ phase: 'error', message: clipsError.message, sessionId: info.id })
        return {
          info,
          videoPath,
          transcriptPath: '',
          notesPath: null,
          notesMarkdown: null,
          error: `${clipsError.message} The video recording was saved.`
        }
      }

      const turns = groupTurns(session.clips.clips())
      const { segments, failed, authError, firstError } = await this.transcribeTurns(session, turns)

      const transcriptMarkdown = renderTranscript({
        title: info.title,
        startedAt: info.startedAt,
        durationMs,
        segments
      })
      const transcriptPath = join(info.dir, 'transcript.md')
      await writeFile(transcriptPath, transcriptMarkdown)
      // The clips are only needed to retry transcription; the video keeps the full audio.
      if (failed === 0) await session.clips.remove().catch(() => {})

      const result: SessionResult = {
        info,
        videoPath,
        transcriptPath,
        notesPath: null,
        notesMarkdown: null
      }

      const transcribed = segments.filter((s) => s.final)
      if (transcribed.length === 0) {
        const kept = 'The video and speech clips were saved in the session folder.'
        result.error = authError
          ? `OpenAI rejected the API key (${firstError}). Check it in Settings. ${kept}`
          : turns.length === 0
            ? 'No speech was detected in this recording.'
            : `Transcription failed: ${firstError}. ${kept}`
        this.events.emitStatus({ phase: 'error', message: result.error, sessionId: info.id })
        return result
      }

      this.events.emitStatus({ phase: 'summarizing', sessionId: info.id })
      try {
        const notes = await summarize({
          apiKey: settings.openaiApiKey,
          model: settings.summaryModel,
          title: info.title,
          startedAt: info.startedAt,
          durationMs,
          transcriptMarkdown
        })
        const notesPath = join(info.dir, 'notes.md')
        await writeFile(notesPath, notes)
        result.notesPath = notesPath
        result.notesMarkdown = notes
        if (failed > 0) {
          result.error = `${failed} of ${turns.length} parts could not be transcribed (${firstError}); the notes may be incomplete.`
        }
        this.events.emitStatus({ phase: 'done', message: result.error, sessionId: info.id })
      } catch (err) {
        result.error = `The transcript was saved, but writing the notes failed: ${describeError(err)}`
        this.events.emitStatus({ phase: 'error', message: result.error, sessionId: info.id })
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.events.emitStatus({ phase: 'error', message, sessionId: info.id })
      throw err
    } finally {
      this.session = null
      this.finalizing = false
    }
  }

  /** On app quit: save the video and speech clips; transcription is skipped. */
  async finalizeForQuit(): Promise<void> {
    const session = this.session
    if (!session || this.finalizing) return
    this.finalizing = true
    session.accepting = false
    try {
      await Promise.all([session.video.end(), session.clips.close()])
    } catch {
      // best effort on quit
    } finally {
      this.session = null
      this.finalizing = false
    }
  }
}
