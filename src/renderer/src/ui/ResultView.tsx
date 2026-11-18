import { useState } from 'react'
import type { JSX } from 'react'
import type { SessionResult, TranscriptSegment } from '../../../shared/types'
import { formatDate } from './format'
import { Markdown } from './MarkdownView'
import { TranscriptList } from './TranscriptList'
import { transcriptClipboardText } from './transcript'

interface ResultViewProps {
  result: SessionResult | null
  segments: TranscriptSegment[]
  stopError: string
  onNew(): void
}

type ResultTab = 'notes' | 'transcript'

/** notes.md starts with "# <title>", which the page header already shows. */
function withoutTitle(markdown: string): string {
  return markdown.replace(/^# .*\n+/, '')
}

export function ResultView({ result, segments, stopError, onNew }: ResultViewProps): JSX.Element {
  const [tab, setTab] = useState<ResultTab>('notes')
  const [copied, setCopied] = useState(false)

  const copyText =
    tab === 'notes' ? (result?.notesMarkdown ?? '') : transcriptClipboardText(segments)

  const copy = async (): Promise<void> => {
    if (!copyText) return
    await navigator.clipboard.writeText(copyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="view view--narrow">
      {result ? (
        <>
          <header className="page-head">
            <div className="page-head-text">
              <h1 className="view-title">{result.info.title}</h1>
              <p className="page-sub">{formatDate(result.info.startedAt)}</p>
            </div>
            <div className="result-actions">
              <button
                type="button"
                className="btn"
                onClick={() => void window.meet.sessions.open(result.info.dir)}
              >
                Open folder
              </button>
              <button
                type="button"
                className="btn"
                disabled={!copyText}
                onClick={() => void copy()}
              >
                {copied ? 'Copied ✓' : tab === 'notes' ? 'Copy notes' : 'Copy transcript'}
              </button>
              <button type="button" className="btn btn--primary" onClick={onNew}>
                New recording
              </button>
            </div>
          </header>
          {result.error && (
            <div className="callout callout--error" role="alert">
              {result.error}
            </div>
          )}
          <nav className="tabs tabs--result" aria-label="Result">
            {(['notes', 'transcript'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={'tab' + (tab === t ? ' tab--active' : '')}
                aria-current={tab === t ? 'page' : undefined}
                onClick={() => setTab(t)}
              >
                {t === 'notes' ? 'Notes' : 'Transcript'}
              </button>
            ))}
          </nav>
          {tab === 'notes' ? (
            result.notesMarkdown ? (
              <div className="panel">
                <Markdown source={withoutTitle(result.notesMarkdown)} />
              </div>
            ) : (
              <div className="empty-state">
                <p className="empty-state-title">No notes for this session</p>
                <p className="note">The video and any transcript are in the session folder.</p>
              </div>
            )
          ) : (
            <TranscriptList segments={segments} emptyText="No speech was transcribed." />
          )}
        </>
      ) : (
        <>
          <div className="callout callout--error" role="alert">
            Stopping failed: {stopError || 'unknown error'}
          </div>
          <div className="result-actions">
            <button type="button" className="btn btn--primary" onClick={onNew}>
              New recording
            </button>
          </div>
        </>
      )}
    </div>
  )
}
