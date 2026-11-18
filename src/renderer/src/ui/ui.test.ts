import { describe, expect, it } from 'vitest'
import { parseMarkdown, parseInline, inlineText } from './markdown'
import { applyTranscriptEvent, transcriptClipboardText } from './transcript'
import { errorMessage, formatClock, formatTimestamp } from './format'
import type { TranscriptSegment } from '../../../shared/types'

describe('parseMarkdown', () => {
  it('parses headings, paragraphs and lists', () => {
    const blocks = parseMarkdown(
      '# Title\n\nHello world\n\n- one\n- [x] two\n\n1. first\n2. second'
    )
    expect(blocks).toHaveLength(4)
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 })
    expect(blocks[1]).toMatchObject({ kind: 'paragraph' })
    expect(blocks[2]).toMatchObject({ kind: 'list', ordered: false })
    expect(blocks[3]).toMatchObject({ kind: 'list', ordered: true })
    const list = blocks[2] as Extract<(typeof blocks)[number], { kind: 'list' }>
    expect(list.items[0].checked).toBeNull()
    expect(list.items[1].checked).toBe(true)
  })

  it('never produces raw HTML tokens', () => {
    const blocks = parseMarkdown('<script>alert(1)</script> **<b>bold</b>**')
    const para = blocks[0] as Extract<(typeof blocks)[number], { kind: 'paragraph' }>
    // Everything stays plain text; React escapes it on render.
    expect(inlineText(para.inlines)).toContain('<script>alert(1)</script>')
  })

  it('renders links as their text only', () => {
    const inlines = parseInline('see [the doc](https://example.com) now')
    expect(inlineText(inlines)).toBe('see the doc now')
  })

  it('parses bold, italic and code', () => {
    const inlines = parseInline('a **b** *c* `d`')
    expect(inlines.map((i) => i.kind)).toEqual(['text', 'bold', 'text', 'italic', 'text', 'code'])
  })
})

describe('applyTranscriptEvent', () => {
  const seg = (id: string, startMs: number, text = '', final = true): TranscriptSegment => ({
    id,
    source: 'system',
    text,
    startMs,
    endMs: startMs,
    final
  })

  it('upserts by id and keeps out-of-order rows sorted by startMs', () => {
    let list = applyTranscriptEvent([], { type: 'segment', segment: seg('turn-2', 200) })
    list = applyTranscriptEvent(list, { type: 'segment', segment: seg('turn-1', 100) })
    expect(list.map((s) => s.id)).toEqual(['turn-1', 'turn-2'])
    list = applyTranscriptEvent(list, { type: 'segment', segment: seg('turn-2', 200, 'hi') })
    expect(list).toHaveLength(2)
    expect(list[1].text).toBe('hi')
  })

  it('keeps failed turns (final: false) in the list', () => {
    const list = applyTranscriptEvent([], {
      type: 'segment',
      segment: seg('turn-1', 100, '[failed]', false)
    })
    expect(list[0].final).toBe(false)
  })

  it('ignores activity events', () => {
    const list = [seg('turn-1', 100)]
    const next = applyTranscriptEvent(list, {
      type: 'activity',
      micClips: 2,
      systemClips: 3
    })
    expect(next).toBe(list)
  })
})

describe('transcriptClipboardText', () => {
  it('formats one [hh:mm:ss] text line per turn', () => {
    const segs: TranscriptSegment[] = [
      {
        id: 'turn-0',
        source: 'mic',
        text: 'Hello',
        startMs: 5000,
        endMs: 7000,
        final: true
      },
      {
        id: 'turn-1',
        source: 'system',
        text: 'Hi there',
        startMs: 3_665_000,
        endMs: 3_670_000,
        final: true
      }
    ]
    expect(transcriptClipboardText(segs)).toBe('[00:00:05] Hello\n[01:01:05] Hi there')
  })
})

describe('formatting helpers', () => {
  it('formats clocks and timestamps', () => {
    expect(formatClock(754)).toBe('00:12:34')
    expect(formatTimestamp(65000)).toBe('1:05')
    expect(formatTimestamp(3_665_000)).toBe('1:01:05')
  })
})

describe('errorMessage', () => {
  it('strips the ipcRenderer.invoke wrapper', () => {
    const err = new Error(
      "Error invoking remote method 'session:start': Error: Add your OpenAI API key in Settings before recording."
    )
    expect(errorMessage(err)).toBe('Add your OpenAI API key in Settings before recording.')
    expect(errorMessage(new Error('plain'))).toBe('plain')
  })
})
