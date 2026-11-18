// Dev-only stand-in for the preload bridge + capture module, so the renderer can be
// styled and screenshotted in a plain browser. Never bundled into the app build:
// main.tsx imports it only when import.meta.env.DEV and window.meet is undefined.
import type {
  CaptureSource,
  MeetApi,
  ModelOptions,
  PublicSettings,
  SessionInfo,
  SessionResult,
  SessionStatus,
  SettingsUpdate,
  TranscriptEvent,
  TranscriptSegment
} from '../../../shared/types'
import { DEFAULT_SETTINGS } from '../../../shared/defaults'
import type { CaptureHandle, CaptureLevels, CaptureOptions } from './captureClient'

interface MockState {
  hasApiKey: boolean
  apiKeyHint: string
  settings: Omit<typeof DEFAULT_SETTINGS, 'openaiApiKey'>
}

const SAMPLE_NOTES = `# Weekly sync
*2026-11-02 10:00 · 32 min*

## Summary
The team reviewed the **Q3 rollout** and agreed the beta is on track. Latency regressions
from the new \`transcoder\` service were discussed and triaged.

## Decisions
- Ship the beta to 10% of users on Friday
- Keep *dark launch* flags for two more weeks

## Action items
- [ ] **Priya** — fix the reconnect loop in \`ws-client\`
- [x] **Jordan** — publish the migration guide
- [ ] **Unassigned** — schedule the retro ([doc](https://example.com))

## Open questions
1. Do we need SOC2 sign-off before GA?
2. Who owns the on-call rotation next sprint?
`

const SCRIPT: { source: 'mic' | 'system'; text: string }[] = [
  { source: 'system', text: 'Morning everyone, shall we get started?' },
  {
    source: 'mic',
    text: 'Yes — quick agenda: rollout status, then the latency bug.'
  },
  {
    source: 'system',
    text: 'Rollout is on track. Beta flags are live for the internal org since Tuesday.'
  },
  {
    source: 'system',
    text: 'Sorry, joining late — did we already cover the transcoder regressions?'
  },
  {
    source: 'mic',
    text: 'Not yet. Priya, can you walk us through the p95 numbers?'
  },
  {
    source: 'system',
    text: 'Sure. p95 went from 180 to 240 milliseconds after the codec change; the flame graph points at the resampler.'
  },
  {
    source: 'system',
    text: 'I can pair on that this afternoon. The migration guide is published, by the way.'
  },
  {
    source: 'mic',
    text: 'Great. Decision: we ship the beta to ten percent on Friday.'
  },
  {
    source: 'system',
    text: 'Agreed. I will take the reconnect loop fix as an action item.'
  },
  { source: 'system', text: 'Works for me. Anything else before we wrap up?' }
]

function drawThumb(label: string, hue: number): string {
  const c = document.createElement('canvas')
  c.width = 220
  c.height = 130
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 220, 130)
  grad.addColorStop(0, `hsl(${hue} 45% 38%)`)
  grad.addColorStop(1, `hsl(${(hue + 50) % 360} 45% 22%)`)
  g.fillStyle = grad
  g.fillRect(0, 0, 220, 130)
  g.fillStyle = 'rgba(255,255,255,0.85)'
  g.font = '600 15px system-ui'
  g.fillText(label, 12, 70)
  return c.toDataURL('image/png')
}

function makeSources(): CaptureSource[] {
  return [
    {
      id: 'screen:1',
      name: 'Entire screen',
      kind: 'screen',
      thumbnailDataUrl: drawThumb('Screen 1', 215)
    },
    {
      id: 'screen:2',
      name: 'Screen 2',
      kind: 'screen',
      thumbnailDataUrl: drawThumb('Screen 2', 260)
    },
    {
      id: 'window:1',
      name: 'Zoom Meeting',
      kind: 'window',
      thumbnailDataUrl: drawThumb('Zoom', 200)
    },
    {
      id: 'window:2',
      name: 'Google Meet — weekly sync — Mozilla Firefox',
      kind: 'window',
      thumbnailDataUrl: drawThumb('Meet', 140)
    }
  ]
}

export function installDevMock(): void {
  const { openaiApiKey, ...settings } = DEFAULT_SETTINGS
  const state: MockState = {
    hasApiKey: Boolean(openaiApiKey) || /key/.test(location.search),
    apiKeyHint: 'sk-…a1b2',
    settings
  }

  const transcriptSubs = new Set<(e: TranscriptEvent) => void>()
  const statusSubs = new Set<(s: SessionStatus) => void>()
  let recording: SessionInfo | null = null
  let streamTimer: ReturnType<typeof setInterval> | undefined
  let clips: { source: 'mic' | 'system'; text: string }[] = []

  const publicSettings = (): PublicSettings => {
    return {
      ...state.settings,
      hasApiKey: state.hasApiKey,
      apiKeyHint: state.hasApiKey ? state.apiKeyHint : '',
      keyEncrypted: !/plain/.test(location.search)
    }
  }

  const emitStatus = (s: SessionStatus): void => statusSubs.forEach((cb) => cb(s))
  const emitTranscript = (e: TranscriptEvent): void => transcriptSubs.forEach((cb) => cb(e))
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  // While "recording", pretend a speech clip is saved every ~1.4s so the activity line fills in.
  const startStreaming = (): void => {
    let line = 0
    let micClips = 0
    let systemClips = 0
    clips = []
    streamTimer = setInterval(() => {
      const entry = SCRIPT[line % SCRIPT.length]
      clips.push(entry)
      if (entry.source === 'mic') micClips++
      else systemClips++
      emitTranscript({ type: 'activity', micClips, systemClips })
      line++
    }, 1400)
  }

  // After stop: transcribe the saved clips out of order with progress, one turn failing.
  const transcribeClips = async (): Promise<void> => {
    const captured = clips
    clips = []
    const total = captured.length
    emitStatus({ phase: 'transcribing', progress: { done: 0, total } })
    const order = captured.map((_, i) => i).sort((a, b) => (a % 3) - (b % 3) || a - b)
    let done = 0
    for (const i of order) {
      await sleep(500)
      const clip = captured[i]
      const failed = i === 3
      const segment: TranscriptSegment = {
        id: `turn-${i}`,
        source: clip.source,
        text: failed ? '[could not transcribe this turn]' : clip.text,
        startMs: i * 9000 + 1500,
        endMs: i * 9000 + 7500,
        final: !failed
      }
      emitTranscript({ type: 'segment', segment })
      done++
      emitStatus({ phase: 'transcribing', progress: { done, total } })
    }
  }

  const meet: MeetApi = {
    platform: 'linux',
    settings: {
      async get() {
        await sleep(120)
        return publicSettings()
      },
      async update(update: SettingsUpdate) {
        const { openaiApiKey, ...rest } = update
        Object.assign(state.settings, rest)
        if (openaiApiKey !== undefined) {
          state.hasApiKey = openaiApiKey !== ''
          if (openaiApiKey) state.apiKeyHint = `sk-…${openaiApiKey.slice(-4)}`
        }
        return publicSettings()
      },
      async listModels(): Promise<ModelOptions> {
        await sleep(600)
        return {
          transcription: [
            { id: 'gpt-transcribe', shutdownDate: null },
            { id: 'whisper-1', shutdownDate: '2027-03-01' }
          ],
          summary: [
            { id: 'gpt-6-luna', shutdownDate: null },
            { id: 'gpt-6-astra', shutdownDate: null },
            { id: 'gpt-5-mini', shutdownDate: null }
          ]
        }
      },
      async chooseOutputDir() {
        return '/home/dev/MeetRecorder'
      }
    },
    capture: {
      async listSources() {
        await sleep(250)
        return makeSources()
      },
      async selectSource() {
        // The mock always uses a synthetic capture source.
      }
    },
    session: {
      async start(req) {
        recording = {
          id: `s-${Date.now()}`,
          title: req.title,
          dir: `/home/dev/MeetRecorder/${req.title}`,
          startedAt: new Date().toISOString()
        }
        startStreaming()
        return recording
      },
      async stop(): Promise<SessionResult> {
        clearInterval(streamTimer)
        const info = recording ?? {
          id: 's-none',
          title: 'Meeting',
          dir: '/home/dev/MeetRecorder/none',
          startedAt: new Date().toISOString()
        }
        recording = null
        emitStatus({ phase: 'finalizing', message: 'Saving recording…' })
        await sleep(900)
        await transcribeClips()
        emitStatus({ phase: 'summarizing', message: 'Asking the model for notes…' })
        await sleep(1400)
        emitStatus({ phase: 'done' })
        return {
          info,
          videoPath: `${info.dir}/video.webm`,
          transcriptPath: `${info.dir}/transcript.md`,
          notesPath: `${info.dir}/notes.md`,
          notesMarkdown: SAMPLE_NOTES,
          error: /fail/.test(location.search) ? 'Notes model unavailable (mock error)' : undefined
        }
      },
      appendVideo() {
        // Browser previews do not write recordings.
      },
      onTranscript(cb) {
        transcriptSubs.add(cb)
        return () => transcriptSubs.delete(cb)
      },
      onStatus(cb) {
        statusSubs.add(cb)
        return () => statusSubs.delete(cb)
      }
    },
    audio: {
      push() {
        // Speech activity is generated by the mock timer.
      },
      commit() {
        // Synthetic clips are committed by the mock timer.
      }
    },
    sessions: {
      async list() {
        await sleep(200)
        return [
          {
            id: 's1',
            title: 'Weekly sync',
            dir: '/home/dev/MeetRecorder/weekly-sync',
            startedAt: new Date(Date.now() - 86400000).toISOString(),
            hasVideo: true,
            hasNotes: true
          },
          {
            id: 's2',
            title: 'Design review — mobile nav',
            dir: '/home/dev/MeetRecorder/design-review',
            startedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
            hasVideo: false,
            hasNotes: true
          },
          {
            id: 's3',
            title: '1:1 with Jordan',
            dir: '/home/dev/MeetRecorder/one-on-one',
            startedAt: new Date(Date.now() - 9 * 86400000).toISOString(),
            hasVideo: true,
            hasNotes: false
          }
        ]
      },
      async open(dir) {
        console.info('[devMock] open folder', dir)
      }
    }
  }

  const mockCapture = {
    async startCapture(opts: CaptureOptions): Promise<CaptureHandle> {
      await sleep(400)
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 180
      const g = canvas.getContext('2d')!
      let frame = 0
      const draw = (): void => {
        frame++
        g.fillStyle = `hsl(${(frame / 2) % 360} 35% 25%)`
        g.fillRect(0, 0, 320, 180)
        g.fillStyle = 'rgba(255,255,255,0.8)'
        g.font = '600 14px system-ui'
        g.fillText('mock preview — ' + opts.sourceId, 16, 96)
      }
      draw()
      const drawTimer = setInterval(draw, 100)
      const t0 = Date.now()
      return {
        previewStream: opts.recordVideo ? canvas.captureStream(10) : null,
        warnings:
          opts.sourceId === 'screen:2'
            ? ['System audio not available for this source; only the microphone is transcribed.']
            : [],
        levels(): CaptureLevels {
          const t = (Date.now() - t0) / 1000
          const mic = Math.abs(Math.sin(t * 2.1)) * 0.7
          const system = Math.abs(Math.sin(t * 1.3 + 1)) * 0.9
          return { mic, system, micSpeaking: mic > 0.35, systemSpeaking: system > 0.35 }
        },
        async stop() {
          clearInterval(drawTimer)
        }
      }
    },
    async listMicrophones(): Promise<MediaDeviceInfo[]> {
      const fake = (deviceId: string, label: string): MediaDeviceInfo =>
        ({
          deviceId,
          label,
          kind: 'audioinput',
          groupId: 'g1',
          toJSON: () => ({})
        }) as MediaDeviceInfo
      return [
        fake('default', 'Default — Built-in Microphone'),
        fake('usb-1', 'Blue Yeti USB'),
        fake('bt-1', 'AirPods Pro')
      ]
    }
  }

  ;(window as unknown as { meet: MeetApi }).meet = meet
  window.__meetMockCapture = mockCapture
}
