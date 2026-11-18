import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { TranscribeAudioOptions } from '../openai'
import type { SessionStatus, Settings, TranscriptEvent } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/defaults'
import { SessionManager } from './manager'

const mocks = vi.hoisted(() => ({
  transcribeAudio: vi.fn<(opts: TranscribeAudioOptions) => Promise<string>>(async () => 'Hello.'),
  summarize: vi.fn(async () => '# Notes\n\nGreat meeting.'),
  listModels: vi.fn()
}))

vi.mock('../openai', () => ({
  transcribeAudio: mocks.transcribeAudio,
  summarize: mocks.summarize,
  listModels: mocks.listModels,
  describeError: (err: unknown) => (err instanceof Error ? err.message : String(err))
}))

class AuthError extends Error {
  name = 'OpenAIAuthError'
}

const settings: Settings = { ...DEFAULT_SETTINGS, openaiApiKey: 'sk-test' }
/** 1 s of 24 kHz PCM16 with a recognisable byte value. */
const pcm = (fill: number, ms = 1000): Buffer => Buffer.alloc(48 * ms, fill)

describe('SessionManager lifecycle', () => {
  let outputDir: string
  let transcripts: TranscriptEvent[]
  let statuses: SessionStatus[]
  let manager: SessionManager

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.transcribeAudio.mockImplementation(async () => 'Hello.')
    mocks.summarize.mockResolvedValue('# Notes\n\nGreat meeting.')
    outputDir = await mkdtemp(join(tmpdir(), 'meetrec-'))
    transcripts = []
    statuses = []
    manager = new SessionManager({
      emitTranscript: (e) => transcripts.push(e),
      emitStatus: (s) => statuses.push(s)
    })
  })

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true })
  })

  /** Mic speech at 1 s, meeting audio at 3 s and again at 5 s. */
  async function recordConversation(): Promise<string> {
    const info = await manager.start({ title: 'Sync' }, settings, outputDir, '1.0.0')
    manager.appendVideo(Buffer.from('webm-1'))
    manager.pushAudio('mic', pcm(1))
    manager.commitAudio('mic', 1000, 2000)
    manager.pushAudio('system', pcm(2))
    manager.commitAudio('system', 3000, 4000)
    manager.pushAudio('system', pcm(3))
    manager.commitAudio('system', 5000, 6000)
    manager.appendVideo(Buffer.from('webm-2'))
    return info.dir
  }

  it('records clips, transcribes per turn, writes transcript + notes', async () => {
    const dir = await recordConversation()
    const result = await manager.stop()

    // Two turns: mic, and the two system clips joined.
    expect(mocks.transcribeAudio).toHaveBeenCalledTimes(2)
    const wavs = mocks.transcribeAudio.mock.calls.map(([o]) => o.wav)
    for (const wav of wavs) expect(wav.subarray(0, 4).toString()).toBe('RIFF')
    const sizes = wavs.map((w) => w.length - 44).sort((a, b) => a - b)
    expect(sizes).toEqual([48_000, 48_000 * 2 + 12_000]) // second has a 250 ms gap
    const opts = mocks.transcribeAudio.mock.calls[0][0]
    expect(opts.model).toBe('gpt-transcribe')
    expect(opts.prompt).toContain('"Sync"')
    expect(opts.prompt).not.toContain('Participants')

    expect(statuses.map((s) => s.phase)).toEqual([
      'recording',
      'finalizing',
      'transcribing',
      'transcribing',
      'transcribing',
      'summarizing',
      'done'
    ])
    expect(statuses.filter((s) => s.progress).at(-1)?.progress).toEqual({ done: 2, total: 2 })

    const activity = transcripts.filter((e) => e.type === 'activity').at(-1)
    expect(activity).toEqual({ type: 'activity', micClips: 1, systemClips: 2 })
    const segments = transcripts.flatMap((e) => (e.type === 'segment' ? [e.segment] : []))
    expect(segments.map((s) => s.source).sort()).toEqual(['mic', 'system'])

    const transcript = await readFile(join(dir, 'transcript.md'), 'utf8')
    expect(transcript).toContain('**[00:00:01]** Hello.')
    expect(transcript).toContain('**[00:00:03]** Hello.')
    expect(await readFile(join(dir, 'notes.md'), 'utf8')).toContain('Great meeting.')
    expect(await readFile(join(dir, 'recording.webm'), 'utf8')).toBe('webm-1webm-2')
    expect(existsSync(join(dir, 'audio'))).toBe(false) // clips removed after success
    expect(result.notesMarkdown).toBe('# Notes\n\nGreat meeting.')
    expect(result.error).toBeUndefined()
    expect(manager.active).toBe(false)
  })

  it('keeps the clips and marks the turn when one turn fails', async () => {
    mocks.transcribeAudio.mockImplementation(async (o) => {
      if (o.wav.length > 60_000) throw new Error('server error')
      return 'Hello.'
    })
    const dir = await recordConversation()
    const result = await manager.stop()
    const failed = transcripts.flatMap((e) =>
      e.type === 'segment' && !e.segment.final ? [e.segment] : []
    )
    expect(failed).toHaveLength(1)
    expect(await readFile(join(dir, 'transcript.md'), 'utf8')).toContain('could not be transcribed')
    expect(existsSync(join(dir, 'audio', 'system.pcm'))).toBe(true)
    expect(result.notesPath).not.toBeNull()
    expect(result.error).toContain('1 of 2 parts')
    expect(result.error).toContain('server error')
  })

  it('stops after an auth error and skips the summary', async () => {
    mocks.transcribeAudio.mockRejectedValue(new AuthError('bad key'))
    await recordConversation()
    const result = await manager.stop()
    expect(mocks.summarize).not.toHaveBeenCalled()
    expect(result.error).toContain('OpenAI rejected the API key (bad key)')
    expect(statuses.at(-1)?.phase).toBe('error')
  })

  it("shows OpenAI's reason when every turn fails", async () => {
    mocks.transcribeAudio.mockRejectedValue(
      Object.assign(new Error('You exceeded your current quota'), {
        name: 'OpenAIRequestError',
        status: 429
      })
    )
    await recordConversation()
    const result = await manager.stop()
    expect(result.error).toContain('Transcription failed: You exceeded your current quota.')
    expect(result.error).toContain('speech clips were saved')
    expect(mocks.summarize).not.toHaveBeenCalled()
  })

  it('reports when no speech was captured', async () => {
    const info = await manager.start({ title: 'Quiet' }, settings, outputDir, '1.0.0')
    const result = await manager.stop()
    expect(mocks.transcribeAudio).not.toHaveBeenCalled()
    expect(mocks.summarize).not.toHaveBeenCalled()
    expect(result.error).toBe('No speech was detected in this recording.')
    expect(result.videoPath).toBeNull()
    expect(await readdir(info.dir)).toContain('transcript.md')
  })

  it('still writes the transcript when the summary fails', async () => {
    mocks.summarize.mockRejectedValue(new Error('summary down'))
    const dir = await recordConversation()
    const result = await manager.stop()
    expect(result.notesPath).toBeNull()
    expect(result.error).toBe(
      'The transcript was saved, but writing the notes failed: summary down'
    )
    expect(existsSync(join(dir, 'transcript.md'))).toBe(true)
  })

  it('refuses to start without a key or twice', async () => {
    await expect(
      manager.start({ title: 'x' }, { ...settings, openaiApiKey: ' ' }, outputDir, '1')
    ).rejects.toThrow('API key')
    await manager.start({ title: 'x' }, settings, outputDir, '1')
    await expect(manager.start({ title: 'y' }, settings, outputDir, '1')).rejects.toThrow(
      'already in progress'
    )
    await manager.stop()
  })

  it('ignores input when idle', () => {
    manager.pushAudio('mic', pcm(1))
    manager.commitAudio('mic', 0, 1000)
    manager.appendVideo(Buffer.from('x'))
    expect(transcripts).toEqual([])
  })

  it('on quit keeps the video and clips without transcribing', async () => {
    const dir = await recordConversation()
    await manager.finalizeForQuit()
    expect(mocks.transcribeAudio).not.toHaveBeenCalled()
    expect(existsSync(join(dir, 'recording.webm'))).toBe(true)
    expect(existsSync(join(dir, 'audio', 'mic.pcm'))).toBe(true)
    const index = await readFile(join(dir, 'audio', 'clips.jsonl'), 'utf8')
    expect(index.trim().split('\n')).toHaveLength(3)
    expect(manager.active).toBe(false)
  })
})
