import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { PublicSettings, SettingsUpdate } from '../../shared/types'
import { errorMessage } from './ui/format'
import { TopBar } from './ui/TopBar'
import type { Tab } from './ui/TopBar'
import { SetupView } from './ui/SetupView'
import { RecordingView } from './ui/RecordingView'
import { ProcessingView } from './ui/ProcessingView'
import { ResultView } from './ui/ResultView'
import { SessionsView } from './ui/SessionsView'
import { SettingsView } from './ui/SettingsView'
import { useRecorder } from './ui/useRecorder'

export default function App(): JSX.Element {
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<Tab>('record')
  const [firstRun, setFirstRun] = useState(false)
  const recorder = useRecorder()

  useEffect(() => {
    window.meet.settings
      .get()
      .then((s) => {
        setSettings(s)
        if (!s.hasApiKey) {
          setFirstRun(true)
          setTab('settings')
        }
      })
      .catch((err) => setLoadError(errorMessage(err)))
  }, [])

  const updateSettings = useCallback(async (update: SettingsUpdate): Promise<PublicSettings> => {
    const next = await window.meet.settings.update(update)
    setSettings(next)
    return next
  }, [])

  if (!settings) {
    return (
      <div className="app-loading">{loadError ? `Failed to load settings: ${loadError}` : '…'}</div>
    )
  }

  return (
    <div className="app">
      <TopBar
        tab={tab}
        onTab={setTab}
        phase={recorder.phase}
        elapsedSec={recorder.elapsedSec}
        progress={recorder.progress}
      />
      <main className="app-main">
        {tab === 'record' &&
          (recorder.view === 'setup' ? (
            <SetupView
              settings={settings}
              onUpdateSettings={(u) => void updateSettings(u)}
              onStart={recorder.start}
              startError={recorder.startError}
              onOpenSettings={() => setTab('settings')}
            />
          ) : recorder.view === 'result' ? (
            <ResultView
              result={recorder.result}
              segments={recorder.segments}
              stopError={recorder.stopError}
              onNew={recorder.reset}
            />
          ) : recorder.view === 'processing' ? (
            <ProcessingView recorder={recorder} />
          ) : (
            <RecordingView recorder={recorder} />
          ))}
        {tab === 'sessions' && <SessionsView />}
        {tab === 'settings' && (
          <SettingsView settings={settings} onSave={updateSettings} firstRun={firstRun} />
        )}
      </main>
    </div>
  )
}
