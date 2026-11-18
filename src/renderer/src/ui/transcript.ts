import type { TranscriptEvent, TranscriptSegment } from '../../../shared/types'
import { formatClock } from './format'

/** Speech captured so far, from the latest 'activity' event. */
export interface ActivitySummary {
  micClips: number
  systemClips: number
}

export const EMPTY_ACTIVITY: ActivitySummary = { micClips: 0, systemClips: 0 }

/**
 * Pure reducer for the post-stop transcript: upserts 'segment' events by id (they arrive
 * out of order) and keeps rows sorted by startMs. 'activity' events leave the list untouched.
 */
export function applyTranscriptEvent(
  segments: TranscriptSegment[],
  event: TranscriptEvent
): TranscriptSegment[] {
  if (event.type !== 'segment') return segments
  const seg = event.segment
  const next = segments.slice()
  const i = next.findIndex((s) => s.id === seg.id)
  if (i >= 0) next[i] = seg
  else next.push(seg)
  next.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))
  return next
}

/** Plain-text transcript for the clipboard: one "[hh:mm:ss] text" line per turn. */
export function transcriptClipboardText(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${formatClock(s.startMs / 1000)}] ${s.text}`).join('\n')
}
