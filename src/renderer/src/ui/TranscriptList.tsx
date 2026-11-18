import type { JSX } from 'react'
import type { TranscriptSegment } from '../../../shared/types'
import { formatTimestamp } from './format'

export function TranscriptList({
  segments,
  emptyText,
  className
}: {
  segments: TranscriptSegment[]
  emptyText: string
  className?: string
}): JSX.Element {
  return (
    <div className={'transcript' + (className ? ` ${className}` : '')}>
      {segments.length === 0 && <p className="transcript-empty">{emptyText}</p>}
      {segments.map((seg) => (
        <div key={seg.id} className={'seg' + (seg.final ? '' : ' seg--failed')}>
          <span className="seg-time">{formatTimestamp(seg.startMs)}</span>
          <span className="seg-text">
            {!seg.final && (
              <span
                className="seg-warn"
                role="img"
                aria-label="Transcription failed"
                title="This turn could not be transcribed"
              >
                ⚠
              </span>
            )}
            {seg.text}
          </span>
        </div>
      ))}
    </div>
  )
}
