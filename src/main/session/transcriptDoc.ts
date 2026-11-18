// transcript.md rendering (electron-free, unit-tested).
import type { AudioSource, TranscriptSegment } from '../../shared/types'

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(Math.floor(total / 3600))}:${p(Math.floor((total % 3600) / 60))}:${p(total % 60)}`
}

export interface TranscriptLine {
  source: AudioSource
  startMs: number
  endMs: number
  text: string
}

/** Sort by start and merge consecutive same-channel segments when the gap is < `gapMs`. */
export function mergeSegments(segments: TranscriptSegment[], gapMs = 2000): TranscriptLine[] {
  const sorted = segments
    .filter((s) => s.text.trim().length > 0)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const lines: TranscriptLine[] = []
  for (const seg of sorted) {
    const last = lines[lines.length - 1]
    if (last && last.source === seg.source && seg.startMs - last.endMs < gapMs) {
      last.text = `${last.text} ${seg.text.trim()}`
      last.endMs = Math.max(last.endMs, seg.endMs)
    } else {
      lines.push({
        source: seg.source,
        startMs: seg.startMs,
        endMs: seg.endMs,
        text: seg.text.trim()
      })
    }
  }
  return lines
}

export interface TranscriptDocOptions {
  title: string
  /** ISO timestamp. */
  startedAt: string
  durationMs: number
  segments: TranscriptSegment[]
}

export function renderTranscript(opts: TranscriptDocOptions): string {
  const date = new Date(opts.startedAt)
  const p = (n: number): string => String(n).padStart(2, '0')
  const dateStr = isNaN(date.getTime())
    ? opts.startedAt
    : `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`
  const header = [
    `# ${opts.title.trim() || 'Meeting'}`,
    '',
    `- Date: ${dateStr}`,
    `- Duration: ${formatClock(opts.durationMs)}`,
    ''
  ]
  const lines = mergeSegments(opts.segments).map((l) => `**[${formatClock(l.startMs)}]** ${l.text}`)
  const body = lines.length > 0 ? lines.join('\n\n') : '_No speech was transcribed._'
  return `${header.join('\n')}\n${body}\n`
}
