// Client-side voice activity detection. Pure (no DOM/electron) so it is unit-testable.
// Silence is never emitted on its own: audio flows out only once an utterance has
// accumulated enough speech, in ~batchMs chunks, followed by a single commit.

export interface VadOptions {
  sampleRate: number
  /** Pre-roll kept before the first voiced frame. */
  preRollMs: number
  /** Consecutive voiced frames needed to tentatively open an utterance. */
  startFrames: number
  /** Minimum voiced time before anything is emitted (drops blips). */
  minSpeechMs: number
  /** Silence that ends an utterance. */
  hangoverMs: number
  /** Force a commit + reopen when an utterance reaches this length. */
  maxUtteranceMs: number
  /** Target size of emitted audio batches. */
  batchMs: number
  /** Absolute RMS floor below which a frame is never voiced. */
  absThreshold: number
  /** Voiced when rms > noiseFloor * noiseRatio (and > absThreshold). */
  noiseRatio: number
}

export const DEFAULT_VAD_OPTIONS: VadOptions = {
  sampleRate: 24000,
  preRollMs: 300,
  startFrames: 3,
  minSpeechMs: 300,
  hangoverMs: 700,
  maxUtteranceMs: 15000,
  batchMs: 100,
  absThreshold: 0.01,
  noiseRatio: 2.5
}

export interface VadFrame {
  pcm: Int16Array
  rms: number
  /** Start of the frame, ms since capture start. */
  tMs: number
}

export type VadEvent =
  { type: 'audio'; pcm: Int16Array } | { type: 'commit'; startMs: number; endMs: number }

type Mode = 'idle' | 'pending' | 'active'

export class Vad {
  private opts: VadOptions
  private mode: Mode = 'idle'
  private noiseFloor = 0.003
  private voicedRun = 0
  private preRoll: VadFrame[] = []
  private preRollSamples = 0
  /** Frames buffered while pending (pre-roll + current utterance so far). */
  private held: VadFrame[] = []
  /** Samples accumulated while active, flushed in batchMs chunks. */
  private pending: Int16Array[] = []
  private pendingSamples = 0
  private startMs = 0
  private voicedMs = 0
  private silenceMs = 0
  private lastVoicedEndMs = 0

  constructor(options?: Partial<VadOptions>) {
    this.opts = { ...DEFAULT_VAD_OPTIONS, ...options }
  }

  get speaking(): boolean {
    return this.mode === 'active'
  }

  push(frame: VadFrame): VadEvent[] {
    const o = this.opts
    const durMs = (frame.pcm.length / o.sampleRate) * 1000
    const frameEnd = frame.tMs + durMs
    const voiced = frame.rms > Math.max(o.absThreshold, this.noiseFloor * o.noiseRatio)
    // Adapt the noise floor: fast downward, slowly upward on non-speech (so a
    // constant hum eventually stops counting as voice), and barely at all during
    // speech (long utterances must not raise the floor past the voice level).
    if (frame.rms < this.noiseFloor) {
      this.noiseFloor += (frame.rms - this.noiseFloor) * 0.2
    } else {
      this.noiseFloor += (frame.rms - this.noiseFloor) * (voiced ? 0.0005 : 0.02)
    }
    this.noiseFloor = Math.max(this.noiseFloor, 0.0005)

    const events: VadEvent[] = []

    if (this.mode === 'idle') {
      this.pushPreRoll(frame)
      this.voicedRun = voiced ? this.voicedRun + 1 : 0
      if (this.voicedRun >= o.startFrames) {
        this.mode = 'pending'
        this.held = [...this.preRoll]
        this.startMs = this.held[0].tMs
        this.voicedMs = this.voicedRun * durMs
        this.silenceMs = 0
        this.lastVoicedEndMs = frameEnd
        this.voicedRun = 0
      }
      return events
    }

    if (this.mode === 'pending') {
      this.pushPreRoll(frame)
      this.held.push(frame)
      if (voiced) {
        this.voicedMs += durMs
        this.silenceMs = 0
        this.lastVoicedEndMs = frameEnd
      } else {
        this.silenceMs += durMs
      }
      if (this.voicedMs >= o.minSpeechMs) {
        this.mode = 'active'
        for (const f of this.held) this.queue(f.pcm, events)
        this.held = []
      } else if (this.silenceMs >= o.hangoverMs) {
        // Too little speech: drop the blip.
        this.reset()
      }
      return events
    }

    // active
    this.queue(frame.pcm, events)
    if (voiced) {
      this.silenceMs = 0
      this.lastVoicedEndMs = frameEnd
    } else {
      this.silenceMs += durMs
    }
    if (this.silenceMs >= o.hangoverMs) {
      this.commit(events, Math.max(this.lastVoicedEndMs, this.startMs + durMs))
      this.reset()
    } else if (frameEnd - this.startMs >= o.maxUtteranceMs) {
      this.commit(events, frameEnd)
      // Split mid-speech: the next utterance continues immediately, already active.
      this.startMs = frameEnd
      this.voicedMs = o.minSpeechMs
    }
    return events
  }

  /** Close an open utterance (e.g. on stop); pending blips are dropped. Idempotent. */
  flush(): VadEvent[] {
    const events: VadEvent[] = []
    if (this.mode === 'active') {
      this.commit(events, Math.max(this.lastVoicedEndMs, this.startMs + 1))
    }
    this.reset()
    return events
  }

  private pushPreRoll(frame: VadFrame): void {
    const maxSamples = (this.opts.preRollMs / 1000) * this.opts.sampleRate
    this.preRoll.push(frame)
    this.preRollSamples += frame.pcm.length
    while (
      this.preRoll.length > 1 &&
      this.preRollSamples - this.preRoll[0].pcm.length >= maxSamples
    ) {
      this.preRollSamples -= this.preRoll[0].pcm.length
      this.preRoll.shift()
    }
  }

  private queue(pcm: Int16Array, events: VadEvent[]): void {
    this.pending.push(pcm)
    this.pendingSamples += pcm.length
    const batchSamples = Math.round((this.opts.batchMs / 1000) * this.opts.sampleRate)
    while (this.pendingSamples >= batchSamples) {
      events.push({ type: 'audio', pcm: this.takePending(batchSamples) })
    }
  }

  private takePending(count: number): Int16Array {
    const out = new Int16Array(count)
    let filled = 0
    while (filled < count) {
      const head = this.pending[0]
      const take = Math.min(head.length, count - filled)
      out.set(head.subarray(0, take), filled)
      filled += take
      if (take === head.length) this.pending.shift()
      else this.pending[0] = head.subarray(take)
    }
    this.pendingSamples -= count
    return out
  }

  private commit(events: VadEvent[], endMs: number): void {
    if (this.pendingSamples > 0) {
      events.push({ type: 'audio', pcm: this.takePending(this.pendingSamples) })
    }
    events.push({ type: 'commit', startMs: Math.round(this.startMs), endMs: Math.round(endMs) })
  }

  private reset(): void {
    this.mode = 'idle'
    this.held = []
    this.pending = []
    this.pendingSamples = 0
    this.voicedRun = 0
    this.voicedMs = 0
    this.silenceMs = 0
  }
}
