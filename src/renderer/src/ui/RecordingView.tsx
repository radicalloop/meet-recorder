import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { CaptureLevels } from './captureClient'
import { formatClock } from './format'
import type { Recorder } from './useRecorder'

const IDLE_LEVELS: CaptureLevels = { mic: 0, system: 0, micSpeaking: false, systemSpeaking: false }

function Meter({
  label,
  value,
  speaking
}: {
  label: string
  value: number
  speaking: boolean
}): JSX.Element {
  return (
    <div className="meter">
      <span className="meter-label">
        {label}
        <span className={'speak-dot' + (speaking ? ' speak-dot--on' : '')} aria-hidden="true" />
      </span>
      <div className="meter-track">
        <div
          className="meter-fill"
          style={{ transform: `scaleX(${Math.min(1, Math.max(0, value))})` }}
        />
      </div>
    </div>
  )
}

export function RecordingView({ recorder }: { recorder: Recorder }): JSX.Element {
  const [lastLevels, setLevels] = useState<CaptureLevels>(IDLE_LEVELS)
  const levels = recorder.handle ? lastLevels : IDLE_LEVELS
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const h = recorder.handle
    if (!h) return
    const t = setInterval(() => setLevels(h.levels()), 100)
    return () => clearInterval(t)
  }, [recorder.handle])

  useEffect(() => {
    const v = videoRef.current
    const stream = recorder.handle?.previewStream ?? null
    if (v && v.srcObject !== stream) v.srcObject = stream
  }, [recorder.handle])

  const clips = recorder.activity.micClips + recorder.activity.systemClips

  return (
    <div className="view recording">
      <div className="rec-hero">
        {recorder.handle?.previewStream ? (
          <video ref={videoRef} className="preview" muted autoPlay playsInline />
        ) : (
          <div className="preview preview--empty">No video preview</div>
        )}
      </div>
      <div className="rec-bar">
        <div className="rec-time">
          <div className="rec-timer" aria-label="Elapsed time">
            {formatClock(recorder.elapsedSec)}
          </div>
          <span className="rec-sub">
            {clips} speech {clips === 1 ? 'clip' : 'clips'} captured
          </span>
        </div>
        <div className="rec-meters">
          <Meter label="Mic" value={levels.mic} speaking={levels.micSpeaking} />
          <Meter label="Meeting audio" value={levels.system} speaking={levels.systemSpeaking} />
        </div>
        <button
          type="button"
          className="btn btn--danger btn--big"
          onClick={() => void recorder.stop()}
        >
          <span className="stop-square btn-icon" aria-hidden="true" />
          Stop
        </button>
      </div>
      <div className="rec-facts">
        {recorder.handle?.warnings.map((w, i) => (
          <p key={i} className="note note--warn">
            {w}
          </p>
        ))}
        {recorder.statusMessage && <p className="note">{recorder.statusMessage}</p>}
        <p className="note">
          Meet Recorder hides its own window from the recording. The transcript is created when you
          stop.
        </p>
      </div>
    </div>
  )
}
