import { describe, expect, it } from 'vitest'
import { Vad, type VadEvent, type VadFrame } from './vad'

const RATE = 24000
const FRAME_MS = 20
const FRAME_SAMPLES = (RATE * FRAME_MS) / 1000 // 480

function frame(tMs: number, rms: number, fill = 1000): VadFrame {
  return { pcm: new Int16Array(FRAME_SAMPLES).fill(fill), rms, tMs }
}

/** Feeds frames [from, to) ms with the given rms, collecting events. */
function feed(vad: Vad, fromMs: number, toMs: number, rms: number, events: VadEvent[]): void {
  for (let t = fromMs; t < toMs; t += FRAME_MS) events.push(...vad.push(frame(t, rms)))
}

function commits(events: VadEvent[]): { startMs: number; endMs: number }[] {
  return events.filter((e) => e.type === 'commit')
}

function audioSamples(events: VadEvent[]): number {
  return events
    .filter((e) => e.type === 'audio')
    .reduce((n, e) => n + (e.type === 'audio' ? e.pcm.length : 0), 0)
}

const SPEECH = 0.3
const SILENCE = 0.001

describe('Vad', () => {
  it('emits nothing for silence', () => {
    const vad = new Vad()
    const events: VadEvent[] = []
    feed(vad, 0, 5000, SILENCE, events)
    events.push(...vad.flush())
    expect(events).toEqual([])
    expect(vad.speaking).toBe(false)
  })

  it('drops blips shorter than the minimum speech duration', () => {
    const vad = new Vad()
    const events: VadEvent[] = []
    feed(vad, 0, 1000, SILENCE, events)
    feed(vad, 1000, 1200, SPEECH, events) // 200 ms < 300 ms minimum
    feed(vad, 1200, 3000, SILENCE, events)
    events.push(...vad.flush())
    expect(events).toEqual([])
  })

  it('does not start on fewer than 3 consecutive voiced frames', () => {
    const vad = new Vad()
    const events: VadEvent[] = []
    for (let i = 0; i < 50; i++) {
      events.push(...vad.push(frame(i * 40, SPEECH)))
      events.push(...vad.push(frame(i * 40 + FRAME_MS, SILENCE)))
    }
    expect(vad.speaking).toBe(false)
  })

  it('emits an utterance with pre-roll and commits after the hangover', () => {
    const vad = new Vad()
    const events: VadEvent[] = []
    feed(vad, 0, 1000, SILENCE, events)
    expect(events).toEqual([])
    feed(vad, 1000, 1280, SPEECH, events)
    // 280 ms voiced: still buffered, nothing sent yet
    expect(events).toEqual([])
    feed(vad, 1280, 2000, SPEECH, events)
    expect(vad.speaking).toBe(true)
    expect(audioSamples(events)).toBeGreaterThan(0)
    feed(vad, 2000, 2800, SILENCE, events)
    expect(vad.speaking).toBe(false)
    const c = commits(events)
    expect(c).toHaveLength(1)
    // startMs includes up to 300 ms of pre-roll before speech at 1000 ms
    expect(c[0].startMs).toBeGreaterThanOrEqual(700)
    expect(c[0].startMs).toBeLessThanOrEqual(1000)
    expect(c[0].endMs).toBe(2000)
    // audio covers pre-roll + speech + hangover, batched in 100 ms chunks
    const expectedMs = 2700 - c[0].startMs
    expect(audioSamples(events)).toBe((expectedMs / 1000) * RATE)
    const audioEvents = events.filter((e) => e.type === 'audio')
    for (const e of audioEvents.slice(0, -1)) {
      if (e.type === 'audio') expect(e.pcm.length).toBe((100 / 1000) * RATE)
    }
    // commit is the last event
    expect(events[events.length - 1].type).toBe('commit')
  })

  it('force-splits at 15 s and continues the utterance', () => {
    const vad = new Vad()
    const events: VadEvent[] = []
    feed(vad, 0, 17000, SPEECH, events)
    feed(vad, 17000, 17800, SILENCE, events)
    const c = commits(events)
    expect(c).toHaveLength(2)
    expect(c[0].startMs).toBe(0)
    expect(c[0].endMs).toBeGreaterThanOrEqual(14900)
    expect(c[0].endMs).toBeLessThanOrEqual(15020)
    expect(c[1].startMs).toBe(c[0].endMs)
    expect(c[1].endMs).toBe(17000)
  })

  it('flush commits an open utterance', () => {
    const vad = new Vad()
    const events: VadEvent[] = []
    feed(vad, 0, 2000, SPEECH, events)
    expect(commits(events)).toHaveLength(0)
    events.push(...vad.flush())
    const c = commits(events)
    expect(c).toHaveLength(1)
    expect(c[0].endMs).toBe(2000)
    // flushing twice is a no-op
    expect(vad.flush()).toEqual([])
  })

  it('flush drops a pending utterance with too little speech', () => {
    const vad = new Vad()
    const events: VadEvent[] = []
    feed(vad, 0, 200, SPEECH, events) // 200 ms < 300 ms minimum
    expect(events).toEqual([])
    expect(vad.flush()).toEqual([])
  })

  it('adapts the noise floor so constant low noise stops counting as voice', () => {
    const vad = new Vad()
    const events: VadEvent[] = []
    // Below the absolute threshold: raises the noise floor without triggering.
    feed(vad, 0, 4000, 0.009, events)
    expect(events).toEqual([])
    // 0.02 > absThreshold but below the adapted noiseFloor * ratio (~0.0225)
    feed(vad, 4000, 6000, 0.02, events)
    events.push(...vad.flush())
    expect(events).toEqual([])
  })

  it('never emits bare silence between utterances', () => {
    const vad = new Vad()
    const events: VadEvent[] = []
    feed(vad, 0, 1000, SPEECH, events)
    feed(vad, 1000, 2000, SILENCE, events)
    const afterFirst = events.length
    feed(vad, 2000, 10000, SILENCE, events)
    expect(events.length).toBe(afterFirst)
  })
})
