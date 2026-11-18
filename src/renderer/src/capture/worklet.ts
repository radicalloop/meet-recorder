import { downmixToMono, floatToInt16, rmsInt16, LinearResampler } from './pcm'

export interface WorkletFrameMessage {
  /** Int16 LE mono PCM at the target rate, ~frameMs long. */
  pcm: ArrayBuffer
  /** 0..1 RMS of the frame. */
  rms: number
}

// The worklet source is built as a string and loaded from a Blob URL so it works
// identically in `electron-vite dev` and in the packaged build (no separate asset
// to resolve). The pure helpers are embedded via toString(); they are bound to
// local names so bundler minification cannot break references.
function buildWorkletSource(): string {
  return `
'use strict'
const downmixToMono = ${downmixToMono.toString()}
const floatToInt16 = ${floatToInt16.toString()}
const rmsInt16 = ${rmsInt16.toString()}
const LinearResampler = ${LinearResampler.toString()}

class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const { targetRate, frameMs } = options.processorOptions
    this.resampler = new LinearResampler(sampleRate, targetRate)
    this.frameSamples = Math.round((targetRate * frameMs) / 1000)
    this.pending = new Int16Array(this.frameSamples)
    this.filled = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0 || input[0].length === 0) return true
    const pcm = floatToInt16(this.resampler.process(downmixToMono(input)))
    let offset = 0
    while (offset < pcm.length) {
      const take = Math.min(pcm.length - offset, this.frameSamples - this.filled)
      this.pending.set(pcm.subarray(offset, offset + take), this.filled)
      this.filled += take
      offset += take
      if (this.filled === this.frameSamples) {
        const frame = this.pending.slice()
        this.port.postMessage({ pcm: frame.buffer, rms: rmsInt16(frame) }, [frame.buffer])
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-processor', PcmProcessor)
`
}

let cachedUrl: string | null = null

/** Blob URL of the worklet module. Requires blob: in the CSP script-src/worker-src. */
export function workletUrl(): string {
  if (!cachedUrl) {
    cachedUrl = URL.createObjectURL(
      new Blob([buildWorkletSource()], { type: 'application/javascript' })
    )
  }
  return cachedUrl
}

export const WORKLET_PROCESSOR_NAME = 'pcm-processor'
