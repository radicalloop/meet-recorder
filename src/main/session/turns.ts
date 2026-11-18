// Grouping speech clips into turns for file transcription (electron-free, unit-tested).
// Mic and meeting audio are separate recordings, so each request covers one channel;
// consecutive clips of a channel are sent together for more context.
import type { AudioSource } from '../../shared/types'
import { PCM_SAMPLE_RATE } from '../../shared/defaults'
import type { Clip } from './clips'

export interface Turn {
  id: string
  source: AudioSource
  startMs: number
  endMs: number
  clips: Clip[]
}

export interface GroupOptions {
  /** Max audio per turn; 5 min of 24 kHz PCM16 is ~14 MB, under the 25 MB upload limit. */
  maxAudioMs?: number
  /** Start a new turn after this much silence. */
  maxGapMs?: number
}

const BYTES_PER_MS = (PCM_SAMPLE_RATE * 2) / 1000

export function clipDurationMs(clip: Clip): number {
  return clip.bytes / BYTES_PER_MS
}

export function groupTurns(clips: Clip[], opts: GroupOptions = {}): Turn[] {
  const maxAudioMs = opts.maxAudioMs ?? 5 * 60_000
  const maxGapMs = opts.maxGapMs ?? 30_000
  const sorted = [...clips].sort((a, b) => a.startMs - b.startMs)
  const turns: Turn[] = []
  let audioMs = 0
  for (const clip of sorted) {
    const last = turns[turns.length - 1]
    const duration = clipDurationMs(clip)
    if (
      last &&
      last.source === clip.source &&
      clip.startMs - last.endMs <= maxGapMs &&
      audioMs + duration <= maxAudioMs
    ) {
      last.clips.push(clip)
      last.endMs = Math.max(last.endMs, clip.endMs)
      audioMs += duration
    } else {
      turns.push({
        id: `turn-${turns.length + 1}`,
        source: clip.source,
        startMs: clip.startMs,
        endMs: clip.endMs,
        clips: [clip]
      })
      audioMs = duration
    }
  }
  return turns
}

/** Mono PCM16 → WAV file. */
export function wavFromPcm(pcm: Buffer, sampleRate = PCM_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** Joins clip audio with short silences so the model hears the pauses between them. */
export function joinClips(parts: Buffer[], gapMs = 250): Buffer {
  const silence = Buffer.alloc(Math.round(gapMs * BYTES_PER_MS) & ~1)
  const out: Buffer[] = []
  parts.forEach((part, i) => {
    if (i > 0) out.push(silence)
    out.push(part)
  })
  return Buffer.concat(out)
}
