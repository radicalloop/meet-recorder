import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionPhase, SessionResult, TranscriptSegment } from '../../../shared/types'
import { startCapture } from './captureClient'
import type { CaptureHandle, CaptureOptions } from './captureClient'
import { applyTranscriptEvent, EMPTY_ACTIVITY } from './transcript'
import type { ActivitySummary } from './transcript'
import { errorMessage } from './format'

export type RecorderView = 'setup' | 'recording' | 'processing' | 'result'

export interface StartOptions extends CaptureOptions {
  title: string
}

export interface Recorder {
  view: RecorderView
  phase: SessionPhase
  statusMessage: string
  elapsedSec: number
  activity: ActivitySummary
  segments: TranscriptSegment[]
  progress: { done: number; total: number } | null
  handle: CaptureHandle | null
  result: SessionResult | null
  startError: string
  stopError: string
  start(opts: StartOptions): Promise<void>
  stop(): Promise<void>
  reset(): void
}

export function useRecorder(): Recorder {
  const [view, setView] = useState<RecorderView>('setup')
  const [phase, setPhase] = useState<SessionPhase>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [elapsedSec, setElapsedSec] = useState(0)
  const [activity, setActivity] = useState<ActivitySummary>(EMPTY_ACTIVITY)
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [handle, setHandle] = useState<CaptureHandle | null>(null)
  const [result, setResult] = useState<SessionResult | null>(null)
  const [startError, setStartError] = useState('')
  const [stopError, setStopError] = useState('')
  const handleRef = useRef<CaptureHandle | null>(null)
  const startedAtRef = useRef(0)

  useEffect(() => {
    const offTranscript = window.meet.session.onTranscript((e) => {
      if (e.type === 'activity') {
        setActivity({ micClips: e.micClips, systemClips: e.systemClips })
      } else {
        setSegments((prev) => applyTranscriptEvent(prev, e))
      }
    })
    const offStatus = window.meet.session.onStatus((s) => {
      setPhase(s.phase)
      setStatusMessage(s.message ?? '')
      setProgress(s.progress ?? null)
    })
    return () => {
      offTranscript()
      offStatus()
    }
  }, [])

  useEffect(() => {
    if (view !== 'recording') return
    const t = setInterval(() => setElapsedSec((Date.now() - startedAtRef.current) / 1000), 500)
    return () => clearInterval(t)
  }, [view])

  const start = useCallback(async (opts: StartOptions) => {
    setStartError('')
    setStopError('')
    setActivity(EMPTY_ACTIVITY)
    setSegments([])
    setProgress(null)
    setResult(null)
    try {
      await window.meet.capture.selectSource(opts.sourceId)
      await window.meet.session.start({ title: opts.title })
    } catch (err) {
      setStartError(errorMessage(err))
      return
    }
    try {
      const h = await startCapture({
        sourceId: opts.sourceId,
        recordVideo: opts.recordVideo,
        videoFps: opts.videoFps,
        videoMaxHeight: opts.videoMaxHeight,
        micDeviceId: opts.micDeviceId
      })
      handleRef.current = h
      setHandle(h)
    } catch (err) {
      // Capture never started: tear the session down so main is not left recording.
      await window.meet.session.stop().catch(() => undefined)
      setStartError(errorMessage(err))
      setPhase('idle')
      setStatusMessage('')
      return
    }
    startedAtRef.current = Date.now()
    setElapsedSec(0)
    setPhase('recording')
    setView('recording')
  }, [])

  const stop = useCallback(async () => {
    setView('processing')
    setPhase('finalizing')
    setStatusMessage('')
    const h = handleRef.current
    handleRef.current = null
    setHandle(null)
    try {
      await h?.stop()
    } catch {
      // A capture teardown failure must not block transcription + notes.
    }
    try {
      const res = await window.meet.session.stop()
      setResult(res)
      setPhase(res.error ? 'error' : 'done')
    } catch (err) {
      setStopError(errorMessage(err))
      setPhase('error')
    }
    setView('result')
  }, [])

  const reset = useCallback(() => {
    setView('setup')
    setPhase('idle')
    setStatusMessage('')
    setActivity(EMPTY_ACTIVITY)
    setSegments([])
    setProgress(null)
    setResult(null)
    setStartError('')
    setStopError('')
    setElapsedSec(0)
  }, [])

  return {
    view,
    phase,
    statusMessage,
    elapsedSec,
    activity,
    segments,
    progress,
    handle,
    result,
    startError,
    stopError,
    start,
    stop,
    reset
  }
}
