// Pure PCM math. These functions are embedded into the AudioWorklet source via
// `toString()` (see worklet.ts), so each must be fully self-contained: no imports,
// no references to other module-level bindings.

/** Average all channels of one render quantum into a mono Float32Array. */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const n = channels[0].length
  const out = new Float32Array(n)
  for (const ch of channels) {
    for (let i = 0; i < n; i++) out[i] += ch[i]
  }
  const inv = 1 / channels.length
  for (let i = 0; i < n; i++) out[i] *= inv
  return out
}

/** Float32 [-1, 1] to Int16 LE with clamping. */
export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/** RMS of Int16 PCM normalised to 0..1. */
export function rmsInt16(pcm: Int16Array): number {
  if (pcm.length === 0) return 0
  let sum = 0
  for (let i = 0; i < pcm.length; i++) {
    const s = pcm[i] / 0x8000
    sum += s * s
  }
  return Math.sqrt(sum / pcm.length)
}

/**
 * Streaming linear-interpolation resampler. Keeps fractional position and
 * unconsumed tail samples between process() calls so chunked input produces
 * the same output as one big chunk.
 */
export class LinearResampler {
  private ratio: number
  private buf: Float32Array
  private pos: number

  constructor(inRate: number, outRate: number) {
    this.ratio = inRate / outRate
    this.buf = new Float32Array(0)
    this.pos = 0
  }

  process(input: Float32Array): Float32Array {
    const n = this.buf.length + input.length
    const buf = new Float32Array(n)
    buf.set(this.buf)
    buf.set(input, this.buf.length)
    const out: number[] = []
    let p = this.pos
    while (p < n - 1) {
      const i = Math.floor(p)
      const f = p - i
      out.push(buf[i] + (buf[i + 1] - buf[i]) * f)
      p += this.ratio
    }
    const keep = Math.min(Math.floor(p), n > 0 ? n - 1 : 0)
    this.buf = buf.slice(keep)
    this.pos = p - keep
    return Float32Array.from(out)
  }
}
