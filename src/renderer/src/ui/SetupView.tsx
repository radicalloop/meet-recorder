import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { CaptureSource, PublicSettings, SettingsUpdate } from '../../../shared/types'
import { listMicrophones } from './captureClient'
import { errorMessage } from './format'
import type { StartOptions } from './useRecorder'

interface SetupViewProps {
  settings: PublicSettings
  onUpdateSettings(update: SettingsUpdate): void
  onStart(opts: StartOptions): Promise<void>
  startError: string
  onOpenSettings(): void
}

export function SetupView({
  settings,
  onUpdateSettings,
  onStart,
  startError,
  onOpenSettings
}: SetupViewProps): JSX.Element {
  const [title, setTitle] = useState(() => `Meeting – ${new Date().toLocaleString()}`)
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [sourcesError, setSourcesError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [starting, setStarting] = useState(false)

  const loadSources = useCallback((): void => {
    void window.meet.capture.listSources().then(
      (list) => {
        const sorted = [...list].sort((a, b) =>
          a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'screen' ? -1 : 1
        )
        setSources(sorted)
        setSourcesError('')
        setSelectedId((cur) => (sorted.some((s) => s.id === cur) ? cur : (sorted[0]?.id ?? '')))
      },
      (err: unknown) => setSourcesError(errorMessage(err))
    )
  }, [])

  useEffect(() => {
    loadSources()
  }, [loadSources])

  useEffect(() => {
    listMicrophones()
      .then((list) =>
        setMics(
          [...list].sort(
            (a, b) => Number(b.deviceId === 'default') - Number(a.deviceId === 'default')
          )
        )
      )
      .catch(() => setMics([]))
  }, [])

  const canStart = settings.hasApiKey && selectedId !== '' && !starting

  const handleStart = async (): Promise<void> => {
    if (!canStart) return
    setStarting(true)
    try {
      await onStart({
        title: title.trim() || 'Meeting',
        sourceId: selectedId,
        recordVideo: settings.recordVideo,
        videoFps: settings.videoFps,
        videoMaxHeight: settings.videoMaxHeight,
        micDeviceId: settings.micDeviceId
      })
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="view view--narrow">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="view-title">New recording</h1>
          <p className="page-sub">
            Choose what to capture. The transcript and notes are created when you stop.
          </p>
        </div>
      </header>
      {!settings.hasApiKey && (
        <div className="callout callout--warn">
          An OpenAI API key is required before recording.{' '}
          <button type="button" className="link" onClick={onOpenSettings}>
            Add it in Settings
          </button>
        </div>
      )}
      {startError && (
        <div className="callout callout--error" role="alert">
          Could not start recording: {startError}
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">What to record</h2>
            <p className="card-desc">A screen or window with the meeting in it.</p>
          </div>
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={() => {
              setSourcesError('')
              loadSources()
            }}
          >
            Refresh
          </button>
        </div>
        {sourcesError && <p className="note note--error">{sourcesError}</p>}
        {sources.length === 0 && !sourcesError && <p className="note">Looking for screens…</p>}
        <div className="source-grid" role="radiogroup" aria-label="Capture source">
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === selectedId}
              className={'source' + (s.id === selectedId ? ' source--selected' : '')}
              onClick={() => setSelectedId(s.id)}
            >
              {s.thumbnailDataUrl ? (
                <img className="source-thumb" src={s.thumbnailDataUrl} alt="" />
              ) : (
                <span className="source-thumb source-thumb--empty">No preview</span>
              )}
              <span className="source-name" title={s.name}>
                {s.name}
              </span>
              <span className="source-kind">{s.kind}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="grid-2">
          <div className="field">
            <label className="field-label" htmlFor="setup-title">
              Title
            </label>
            <input
              id="setup-title"
              className="input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="setup-mic">
              Microphone
            </label>
            <select
              id="setup-mic"
              className="input"
              value={settings.micDeviceId}
              onChange={(e) => onUpdateSettings({ micDeviceId: e.target.value })}
            >
              <option value="">System default</option>
              {mics
                .filter((m) => m.deviceId !== '')
                .map((m, i) => (
                  <option key={m.deviceId || i} value={m.deviceId}>
                    {m.label || `Microphone ${i + 1}`}
                  </option>
                ))}
            </select>
            <p className="note">
              Use headphones so your mic doesn’t pick up the meeting audio twice.
            </p>
          </div>
        </div>
      </section>

      <div className="form-footer">
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.recordVideo}
            onChange={(e) => onUpdateSettings({ recordVideo: e.target.checked })}
          />
          Record video
        </label>

        <button
          type="button"
          className="btn btn--primary btn--big"
          disabled={!canStart}
          onClick={() => void handleStart()}
        >
          <span className="rec-dot btn-icon" aria-hidden="true" />
          {starting ? 'Starting…' : 'Start recording'}
        </button>
      </div>
    </div>
  )
}
