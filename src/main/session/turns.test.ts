import { describe, expect, it } from 'vitest'
import type { AudioSource } from '../../shared/types'
import type { Clip } from './clips'
import { groupTurns, joinClips, wavFromPcm } from './turns'

let nextId = 0
function clip(source: AudioSource, startMs: number, endMs: number): Clip {
  return { id: nextId++, source, startMs, endMs, offset: 0, bytes: (endMs - startMs) * 48 }
}

describe('groupTurns', () => {
  it('joins consecutive clips of one channel and splits on channel change', () => {
    const clips = [
      clip('system', 0, 2000),
      clip('system', 2500, 4000),
      clip('mic', 4500, 6000),
      clip('system', 7000, 8000)
    ]
    const turns = groupTurns(clips)
    expect(turns.map((t) => [t.source, t.clips.length, t.startMs, t.endMs])).toEqual([
      ['system', 2, 0, 4000],
      ['mic', 1, 4500, 6000],
      ['system', 1, 7000, 8000]
    ])
    expect(turns.map((t) => t.id)).toEqual(['turn-1', 'turn-2', 'turn-3'])
  })

  it('starts a new turn after a long silence or when the audio cap is reached', () => {
    const clips = [clip('mic', 0, 1000), clip('mic', 40_000, 41_000), clip('mic', 41_500, 43_000)]
    const turns = groupTurns(clips, { maxAudioMs: 2000 })
    expect(turns.map((t) => t.clips.length)).toEqual([1, 1, 1])
    const relaxed = groupTurns(clips, { maxAudioMs: 10_000 })
    expect(relaxed.map((t) => t.clips.length)).toEqual([1, 2])
  })
})

describe('wav helpers', () => {
  it('writes a valid 24 kHz mono PCM16 header', () => {
    const wav = wavFromPcm(Buffer.alloc(480))
    expect(wav.length).toBe(44 + 480)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(4)).toBe(36 + 480)
    expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ')
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(24)).toBe(24_000)
    expect(wav.readUInt32LE(28)).toBe(48_000)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.readUInt32LE(40)).toBe(480)
  })

  it('joins clips with sample-aligned silence', () => {
    const joined = joinClips([Buffer.alloc(10, 1), Buffer.alloc(10, 2)], 250)
    expect(joined.length).toBe(10 + 12_000 + 10)
    expect(joined[10]).toBe(0)
    expect(joined.at(-1)).toBe(2)
  })
})
