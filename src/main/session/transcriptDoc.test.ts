import { describe, expect, it } from 'vitest'
import type { TranscriptSegment } from '../../shared/types'
import { formatClock, mergeSegments, renderTranscript } from './transcriptDoc'

function seg(
  partial: Partial<TranscriptSegment> & Pick<TranscriptSegment, 'startMs' | 'endMs' | 'text'>
): TranscriptSegment {
  return { id: 'x', source: 'mic', final: true, ...partial }
}

describe('formatClock', () => {
  it('renders hh:mm:ss', () => {
    expect(formatClock(0)).toBe('00:00:00')
    expect(formatClock(61_500)).toBe('00:01:01')
    expect(formatClock(3_600_000 + 125_000)).toBe('01:02:05')
  })
})

describe('mergeSegments', () => {
  it('merges consecutive same-channel segments with a gap < 2 s', () => {
    const lines = mergeSegments([
      seg({ startMs: 0, endMs: 1000, text: 'Hello' }),
      seg({ startMs: 2500, endMs: 3000, text: 'world' })
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('Hello world')
    expect(lines[0].endMs).toBe(3000)
  })

  it('does not merge across channels or gaps >= 2 s', () => {
    const lines = mergeSegments([
      seg({ startMs: 0, endMs: 1000, text: 'Hello' }),
      seg({ startMs: 1500, endMs: 2000, text: 'Hi', source: 'system' }),
      seg({ startMs: 4100, endMs: 5000, text: 'Still there?', source: 'system' })
    ])
    expect(lines.map((l) => l.text)).toEqual(['Hello', 'Hi', 'Still there?'])
  })

  it('sorts by start and drops empty text', () => {
    const lines = mergeSegments([
      seg({ startMs: 5000, endMs: 6000, text: 'second' }),
      seg({ startMs: 0, endMs: 1000, text: '   ' }),
      seg({ startMs: 1000, endMs: 2000, text: 'first' })
    ])
    expect(lines.map((l) => l.text)).toEqual(['first', 'second'])
  })
})

describe('renderTranscript', () => {
  it('includes header and formatted lines', () => {
    const startedAt = new Date(2026, 9, 30, 10, 0).toISOString()
    const md = renderTranscript({
      title: 'Weekly sync',
      startedAt,
      durationMs: 90_000,
      segments: [
        seg({ startMs: 1000, endMs: 2000, text: 'Hello everyone.' }),
        seg({ startMs: 10_000, endMs: 12_000, text: 'Hi!', source: 'system' })
      ]
    })
    expect(md).toContain('# Weekly sync')
    expect(md).toContain('- Date: 2026-10-30 10:00')
    expect(md).toContain('- Duration: 00:01:30')
    expect(md).toContain('**[00:00:01]** Hello everyone.')
    expect(md).toContain('**[00:00:10]** Hi!')
  })

  it('handles an empty transcript', () => {
    const md = renderTranscript({
      title: '',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      segments: []
    })
    expect(md).toContain('# Meeting')
    expect(md).toContain('_No speech was transcribed._')
  })
})
