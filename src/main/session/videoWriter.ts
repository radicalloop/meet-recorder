// Ordered, backpressure-aware writer for MediaRecorder WebM chunks.
// The file is created lazily on the first chunk so an all-audio session leaves no video file.
import { createWriteStream, type WriteStream } from 'fs'
import { once } from 'events'

export class VideoWriter {
  private stream: WriteStream | null = null
  private chain: Promise<void> = Promise.resolve()
  private closed = false
  private failed = false

  constructor(private readonly path: string) {}

  append(chunk: Buffer): void {
    if (this.closed || this.failed || chunk.length === 0) return
    this.chain = this.chain
      .then(() => this.write(chunk))
      .catch(() => {
        this.failed = true
      })
  }

  private async write(chunk: Buffer): Promise<void> {
    if (!this.stream) this.stream = createWriteStream(this.path)
    if (!this.stream.write(chunk)) await once(this.stream, 'drain')
  }

  /** Flushes pending chunks and closes the file. Returns true when a file was written. */
  async end(): Promise<boolean> {
    this.closed = true
    await this.chain
    if (!this.stream) return false
    const stream = this.stream
    stream.end()
    await once(stream, 'close').catch(() => {})
    return !this.failed
  }
}
