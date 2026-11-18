import { describe, expect, it } from 'vitest'
import { workletUrl } from './worklet'

describe('worklet source', () => {
  it('builds a syntactically valid module that registers the processor', async () => {
    const url = workletUrl()
    const res = await fetch(url)
    const src = await res.text()
    const registered: string[] = []
    const frames: { pcm: ArrayBuffer; rms: number }[] = []
    const sandbox = {
      sampleRate: 48000,
      AudioWorkletProcessor: class {
        port = {
          postMessage: (m: { pcm: ArrayBuffer; rms: number }) => frames.push(m)
        }
      },
      registerProcessor: (name: string, cls: unknown) => {
        registered.push(name)
        // instantiate and feed one quantum
        const Proc = cls as new (o: unknown) => {
          process(inputs: Float32Array[][]): boolean
        }
        const p = new Proc({ processorOptions: { targetRate: 24000, frameMs: 20 } })
        // 48 quanta of 128 samples @48k -> 6144 in -> 3072 out -> 6 full 480-sample frames
        for (let i = 0; i < 48; i++) {
          expect(
            p.process([[new Float32Array(128).fill(0.5), new Float32Array(128).fill(0.5)]])
          ).toBe(true)
        }
      }
    }
    const fn = new Function(...Object.keys(sandbox), src)
    fn(...Object.values(sandbox))
    expect(registered).toEqual(['pcm-processor'])
    expect(frames.length).toBe(6)
    expect(new Int16Array(frames[0].pcm).length).toBe(480)
    expect(frames[frames.length - 1].rms).toBeCloseTo(0.5, 1)
  })
})
