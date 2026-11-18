import { describe, expect, it } from 'vitest'
import { downmixToMono, floatToInt16, rmsInt16, LinearResampler } from './pcm'

describe('downmixToMono', () => {
  it('returns the single channel untouched', () => {
    const ch = Float32Array.from([0.1, -0.2, 0.3])
    expect(downmixToMono([ch])).toBe(ch)
  })

  it('averages multiple channels', () => {
    const a = Float32Array.from([1, 0, -1])
    const b = Float32Array.from([0, 0.5, -0.5])
    const mono = downmixToMono([a, b])
    expect(Array.from(mono)).toEqual([0.5, 0.25, -0.75])
  })
})

describe('floatToInt16', () => {
  it('converts and clamps', () => {
    const out = floatToInt16(Float32Array.from([0, 1, -1, 2, -2, 0.5]))
    // Int16Array assignment truncates toward zero.
    expect(Array.from(out)).toEqual([0, 32767, -32768, 32767, -32768, Math.trunc(0.5 * 32767)])
  })
})

describe('rmsInt16', () => {
  it('is 0 for silence and ~amplitude for a square wave', () => {
    expect(rmsInt16(new Int16Array(100))).toBe(0)
    const half = new Int16Array(100).fill(16384)
    expect(rmsInt16(half)).toBeCloseTo(0.5, 3)
  })

  it('handles empty input', () => {
    expect(rmsInt16(new Int16Array(0))).toBe(0)
  })
})

describe('LinearResampler', () => {
  it('is identity-like at ratio 1', () => {
    const r = new LinearResampler(24000, 24000)
    const input = Float32Array.from([0, 1, 2, 3, 4])
    // One sample is held back for interpolation continuity.
    expect(Array.from(r.process(input))).toEqual([0, 1, 2, 3])
    expect(Array.from(r.process(Float32Array.from([5])))).toEqual([4])
  })

  it('halves the rate at 48k -> 24k on a linear ramp', () => {
    const r = new LinearResampler(48000, 24000)
    const input = Float32Array.from({ length: 100 }, (_, i) => i)
    const out = r.process(input)
    expect(out.length).toBe(50)
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(2 * i, 6)
  })

  it('produces the same output chunked as in one call', () => {
    const signal = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 7))
    const whole = new LinearResampler(44100, 24000).process(signal)
    const chunked = new LinearResampler(44100, 24000)
    const parts: number[] = []
    for (let i = 0; i < signal.length; i += 128) {
      parts.push(...chunked.process(signal.slice(i, i + 128)))
    }
    expect(parts.length).toBe(whole.length)
    for (let i = 0; i < parts.length; i++) expect(parts[i]).toBeCloseTo(whole[i], 6)
  })

  it('keeps the output rate correct over time', () => {
    const r = new LinearResampler(48000, 24000)
    let total = 0
    for (let i = 0; i < 100; i++) total += r.process(new Float32Array(128)).length
    // 12800 input samples -> ~6400 output samples
    expect(Math.abs(total - 6400)).toBeLessThanOrEqual(1)
  })
})
