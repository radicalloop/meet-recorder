import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { SessionListItem } from '../../../shared/types'
import { errorMessage, formatDate } from './format'

export function SessionsView(): JSX.Element {
  const [items, setItems] = useState<SessionListItem[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    window.meet.sessions
      .list()
      .then(setItems)
      .catch((err) => setError(errorMessage(err)))
  }, [])

  return (
    <div className="view view--narrow">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="view-title">Sessions</h1>
          <p className="page-sub">Past recordings with their video, transcript and notes.</p>
        </div>
      </header>
      {error && <div className="callout callout--error">{error}</div>}
      {items === null && !error && <p className="note">Loading…</p>}
      {items?.length === 0 && (
        <div className="empty-state">
          <p className="empty-state-title">No sessions yet</p>
          <p className="note">Recordings you make will show up here.</p>
        </div>
      )}
      <ul className="session-list">
        {items?.map((s) => (
          <li key={s.id} className="session-item">
            <div className="session-lead">
              <span className="session-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="1.5" y="3.5" width="9" height="9" rx="2" stroke="currentColor" />
                  <path d="M10.5 7l4-2.5v7l-4-2.5" stroke="currentColor" strokeLinejoin="round" />
                </svg>
              </span>
              <div className="session-main">
                <span className="session-title">{s.title}</span>
                <span className="note">{formatDate(s.startedAt)}</span>
              </div>
            </div>
            <div className="session-meta">
              {s.hasVideo && <span className="badge">Video</span>}
              {s.hasNotes && <span className="badge">Notes</span>}
              <button
                type="button"
                className="btn btn--small"
                onClick={() => void window.meet.sessions.open(s.dir)}
              >
                Open folder
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
