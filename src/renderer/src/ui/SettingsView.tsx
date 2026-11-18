import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { ModelOptions, PublicSettings, SettingsUpdate } from '../../../shared/types'
import { errorMessage } from './format'
import { ModelSelect } from './ModelSelect'

interface SettingsViewProps {
  settings: PublicSettings
  onSave(update: SettingsUpdate): Promise<unknown>
  firstRun: boolean
}

type KeyMode = 'keep' | 'set' | 'clear'

export function SettingsView({ settings, onSave, firstRun }: SettingsViewProps): JSX.Element {
  const [keyMode, setKeyMode] = useState<KeyMode>(settings.hasApiKey ? 'keep' : 'set')
  const [keyValue, setKeyValue] = useState('')
  const [transcriptionModel, setTranscriptionModel] = useState(settings.transcriptionModel)
  const [summaryModel, setSummaryModel] = useState(settings.summaryModel)
  const [outputDir, setOutputDir] = useState(settings.outputDir)
  const [languagesText, setLanguagesText] = useState(settings.languages.join(', '))
  const [recordVideo, setRecordVideo] = useState(settings.recordVideo)
  const [videoFps, setVideoFps] = useState(settings.videoFps)
  const [videoMaxHeight, setVideoMaxHeight] = useState(settings.videoMaxHeight)
  const [models, setModels] = useState<ModelOptions | null>(null)
  const [modelsLoading, setModelsLoading] = useState(settings.hasApiKey)
  const [modelsError, setModelsError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  const chooseDir = async (): Promise<void> => {
    const dir = await window.meet.settings.chooseOutputDir()
    if (dir !== null) setOutputDir(dir)
  }

  const loadModels = useCallback((): Promise<void> => {
    return window.meet.settings
      .listModels()
      .then((list) => {
        setModels(list)
        setModelsError('')
      })
      .catch((err) => {
        setModels(null)
        setModelsError(errorMessage(err))
      })
      .finally(() => setModelsLoading(false))
  }, [])

  // Reload when a key is added or replaced.
  useEffect(() => {
    if (settings.hasApiKey) void loadModels()
  }, [settings.hasApiKey, settings.apiKeyHint, loadModels])

  const refreshModels = (): void => {
    setModelsLoading(true)
    void loadModels()
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setSaveError('')
    const update: SettingsUpdate = {
      transcriptionModel: transcriptionModel.trim(),
      summaryModel: summaryModel.trim(),
      outputDir,
      languages: languagesText
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s !== ''),
      recordVideo,
      videoFps,
      videoMaxHeight
    }
    if (keyMode === 'set' && keyValue.trim() !== '') update.openaiApiKey = keyValue.trim()
    if (keyMode === 'clear') update.openaiApiKey = ''
    try {
      await onSave(update)
      setKeyMode('keep')
      setKeyValue('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setSaveError(errorMessage(err))
    }
    setSaving(false)
  }

  return (
    <div className="view view--narrow">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="view-title">Settings</h1>
          <p className="page-sub">Your OpenAI key, models and recording preferences.</p>
        </div>
      </header>

      {firstRun && !settings.hasApiKey && (
        <div className="callout callout--info">
          <strong>Welcome!</strong> Meet Recorder uses your own OpenAI account: paste an API key
          below to get started. Transcription costs{' '}
          <strong>$0.0045 per minute of speech per channel</strong> (your mic and the meeting audio
          are transcribed separately), plus a small amount for writing the notes. Only detected
          speech is sent.
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">OpenAI account</h2>
            <p className="card-desc">
              Audio goes straight from this computer to OpenAI using your key.
            </p>
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="set-key">
            API key
          </label>
          {settings.hasApiKey && keyMode === 'keep' && (
            <div className="field-row">
              <code className="key-hint">{settings.apiKeyHint}</code>
              <button type="button" className="btn btn--small" onClick={() => setKeyMode('set')}>
                Replace
              </button>
              <button type="button" className="btn btn--small" onClick={() => setKeyMode('clear')}>
                Remove
              </button>
            </div>
          )}
          {keyMode === 'clear' && (
            <div className="field-row">
              <span className="note note--warn">The key will be removed when you save.</span>
              <button type="button" className="btn btn--small" onClick={() => setKeyMode('keep')}>
                Undo
              </button>
            </div>
          )}
          {keyMode === 'set' && (
            <div className="field-row">
              <input
                id="set-key"
                className="input"
                type="password"
                placeholder="sk-…"
                autoComplete="off"
                value={keyValue}
                onChange={(e) => setKeyValue(e.target.value)}
              />
              {settings.hasApiKey && (
                <button type="button" className="btn btn--small" onClick={() => setKeyMode('keep')}>
                  Cancel
                </button>
              )}
            </div>
          )}
          {settings.hasApiKey && !settings.keyEncrypted && (
            <p className="note note--warn">OS keychain unavailable — key stored unencrypted.</p>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">Transcription &amp; notes</h2>
            <p className="card-desc">OpenAI models used after each recording.</p>
          </div>
          {settings.hasApiKey && (
            <button
              type="button"
              className="btn btn--small btn--ghost"
              disabled={modelsLoading}
              onClick={refreshModels}
            >
              {modelsLoading ? 'Loading…' : 'Refresh list'}
            </button>
          )}
        </div>
        {modelsError && (
          <p className="note note--error">
            Could not load your models ({modelsError}). Type a model ID instead.
          </p>
        )}
        <div className="grid-2">
          <ModelSelect
            label="Transcription model"
            value={transcriptionModel}
            options={models?.transcription ?? null}
            loading={modelsLoading}
            onChange={setTranscriptionModel}
          />
          <ModelSelect
            label="Notes model"
            value={summaryModel}
            options={models?.summary ?? null}
            loading={modelsLoading}
            onChange={setSummaryModel}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="set-langs">
            Spoken languages
          </label>
          <input
            id="set-langs"
            className="input"
            type="text"
            placeholder="Auto-detect"
            value={languagesText}
            onChange={(e) => setLanguagesText(e.target.value)}
          />
          <p className="note">
            Comma-separated ISO codes, e.g. “en, de”. Leave blank to auto-detect.
          </p>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">Recording</h2>
            <p className="card-desc">Video is saved locally and never uploaded.</p>
          </div>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={recordVideo}
            onChange={(e) => setRecordVideo(e.target.checked)}
          />
          Record video
        </label>
        <div className="grid-2">
          <label className="sub-field">
            <span>Frame rate</span>
            <select
              className="input"
              value={videoFps}
              disabled={!recordVideo}
              onChange={(e) => setVideoFps(Number(e.target.value))}
            >
              {[10, 15, 30].map((v) => (
                <option key={v} value={v}>
                  {v} fps
                </option>
              ))}
            </select>
          </label>
          <label className="sub-field">
            <span>Max resolution</span>
            <select
              className="input"
              value={videoMaxHeight}
              disabled={!recordVideo}
              onChange={(e) => setVideoMaxHeight(Number(e.target.value))}
            >
              {[720, 1080, 1440].map((v) => (
                <option key={v} value={v}>
                  {v}p
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="set-outdir">
            Save recordings to
          </label>
          <div className="field-row">
            <input
              id="set-outdir"
              className="input"
              type="text"
              readOnly
              value={outputDir}
              placeholder="~/MeetRecorder (default)"
            />
            <button type="button" className="btn" onClick={() => void chooseDir()}>
              Choose…
            </button>
          </div>
        </div>
      </section>

      {saveError && (
        <div className="callout callout--error" role="alert">
          {saveError}
        </div>
      )}
      <div className="form-footer">
        <span className="note note--ok" role="status">
          {saved ? 'Settings saved ✓' : ''}
        </span>
        <button
          type="button"
          className="btn btn--primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  )
}
