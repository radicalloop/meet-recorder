import type { JSX } from 'react'
import type { SessionPhase } from '../../../shared/types'
import { formatClock } from './format'

export type Tab = 'record' | 'sessions' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'record', label: 'Record' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'settings', label: 'Settings' }
]

export function StatusPill({
  phase,
  elapsedSec,
  progress
}: {
  phase: SessionPhase
  elapsedSec: number
  progress: { done: number; total: number } | null
}): JSX.Element | null {
  switch (phase) {
    case 'recording':
      return (
        <span className="pill pill--rec">
          <span className="pill-dot" aria-hidden="true" />
          REC {formatClock(elapsedSec)}
        </span>
      )
    case 'finalizing':
      return <span className="pill pill--busy">Finalizing…</span>
    case 'transcribing':
      return (
        <span className="pill pill--busy">
          Transcribing…{progress ? ` ${progress.done}/${progress.total}` : ''}
        </span>
      )
    case 'summarizing':
      return <span className="pill pill--busy">Writing notes…</span>
    case 'done':
      return <span className="pill pill--done">Done</span>
    case 'error':
      return <span className="pill pill--error">Error</span>
    default:
      return null
  }
}

export function TopBar({
  tab,
  onTab,
  phase,
  elapsedSec,
  progress
}: {
  tab: Tab
  onTab(tab: Tab): void
  phase: SessionPhase
  elapsedSec: number
  progress: { done: number; total: number } | null
}): JSX.Element {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="topbar-title">
          <span className="brand-mark" aria-hidden="true" />
          Meet Recorder
        </span>
        <StatusPill phase={phase} elapsedSec={elapsedSec} progress={progress} />
      </div>
      <nav className="tabs" aria-label="Main">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={'tab' + (tab === t.id ? ' tab--active' : '')}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </header>
  )
}
