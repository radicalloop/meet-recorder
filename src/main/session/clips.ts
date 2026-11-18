// Speech clips saved during recording: raw PCM appended per source to audio/<source>.pcm,
// with an index (offset/length/timing) kept in memory and mirrored to audio/clips.jsonl.
import { createWriteStream, mkdirSync, type WriteStream } from 'fs'
import { appendFile, open, rm, type FileHandle } from 'fs/promises'
import { join } from 'path'
import type { AudioSource } from '../../shared/types'

export interface Clip {
  id: number
  source: AudioSource
  /** Milliseconds since session start. */
  startMs: number
  endMs: number
  /** Byte range in audio/<source>.pcm (PCM16 mono 24 kHz). */
  offset: number
  bytes: number
}

interface Channel {
  stream: WriteStream
  written: number
  /** Start offset of the clip being received, null between clips. */
  clipOffset: number | null
}

export class ClipRecorder {
  readonly audioDir: string
  private channels = new Map<AudioSource, Channel>()
  private list: Clip[] = []
  private indexChain: Promise<void> = Promise.resolve()
  private writeError: Error | null = null

  constructor(sessionDir: string) {
    this.audioDir = join(sessionDir, 'audio')
    // Synchronous so the PCM streams below can never open before the folder exists.
    mkdirSync(this.audioDir, { recursive: true })
  }

  private channel(source: AudioSource): Channel {
    let ch = this.channels.get(source)
    if (!ch) {
      const stream = createWriteStream(join(this.audioDir, `${source}.pcm`))
      stream.on('error', (err) => (this.writeError ??= err))
      ch = { stream, written: 0, clipOffset: null }
      this.channels.set(source, ch)
    }
    return ch
  }

  push(source: AudioSource, pcm16: Buffer): void {
    if (pcm16.length === 0) return
    const ch = this.channel(source)
    if (ch.clipOffset === null) ch.clipOffset = ch.written
    ch.stream.write(pcm16)
    ch.written += pcm16.length
  }

  /** Closes the current clip of `source`; null when no audio arrived since the last commit. */
  commit(source: AudioSource, startMs: number, endMs: number): Clip | null {
    const ch = this.channels.get(source)
    if (!ch || ch.clipOffset === null) return null
    const clip: Clip = {
      id: this.list.length,
      source,
      startMs,
      endMs: Math.max(startMs, endMs),
      offset: ch.clipOffset,
      bytes: ch.written - ch.clipOffset
    }
    ch.clipOffset = null
    this.list.push(clip)
    this.indexChain = this.indexChain
      .then(() => appendFile(join(this.audioDir, 'clips.jsonl'), JSON.stringify(clip) + '\n'))
      .catch(() => {})
    return clip
  }

  clips(): Clip[] {
    return [...this.list]
  }

  counts(): Record<AudioSource, number> {
    return {
      mic: this.list.filter((c) => c.source === 'mic').length,
      system: this.list.filter((c) => c.source === 'system').length
    }
  }

  /** Flushes and closes the PCM files and the index. Audio of an unfinished clip is ignored. */
  async close(): Promise<void> {
    await Promise.all(
      [...this.channels.values()].map(
        (ch) =>
          new Promise<void>((resolve) => {
            if (ch.stream.closed) return resolve()
            ch.stream.once('error', () => resolve())
            ch.stream.end(() => resolve())
          })
      )
    )
    await this.indexChain
    if (this.writeError) throw new Error(`Could not save speech audio: ${this.writeError.message}`)
  }

  /** Opens the PCM files for reading clip ranges. Call after close(). */
  async openReader(): Promise<ClipReader> {
    const handles = new Map<AudioSource, FileHandle>()
    for (const source of this.channels.keys()) {
      handles.set(source, await open(join(this.audioDir, `${source}.pcm`), 'r'))
    }
    return {
      async read(clip: Clip): Promise<Buffer> {
        const handle = handles.get(clip.source)
        if (!handle) throw new Error(`No audio for ${clip.source}`)
        const buf = Buffer.alloc(clip.bytes)
        const { bytesRead } = await handle.read(buf, 0, clip.bytes, clip.offset)
        return buf.subarray(0, bytesRead)
      },
      async close(): Promise<void> {
        await Promise.all([...handles.values()].map((h) => h.close()))
      }
    }
  }

  /** Deletes the saved clips (after a successful transcription). */
  async remove(): Promise<void> {
    await rm(this.audioDir, { recursive: true, force: true })
  }
}

export interface ClipReader {
  read(clip: Clip): Promise<Buffer>
  close(): Promise<void>
}
