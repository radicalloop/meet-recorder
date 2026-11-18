import type { JSX } from 'react'
import type { SessionPhase } from '../../../shared/types'
import { TranscriptList } from './TranscriptList'
import type { Recorder } from './useRecorder'

const STEPS: { phase: SessionPhase; label: string }[] = [
  { phase: 'finalizing', label: 'Saving recording' },
  { phase: 'transcribing', label: 'Transcribing' },
  { phase: 'summarizing', label: 'Writing notes' }
]

type StepState = 'todo' | 'active' | 'done'

function stepState(index: number, phase: SessionPhase): StepState {
  if (phase === 'done') return 'done'
  const current = STEPS.findIndex((s) => s.phase === phase)
  const at = current < 0 ? 0 : current
  if (index < at) return 'done'
  if (index === at) return 'active'
  return 'todo'
}

export function ProcessingView({ recorder }: { recorder: Recorder }): JSX.Element {
  const { phase, progress, segments, statusMessage } = recorder

  return (
    <div className="view processing">
      <div className="stepper" role="status" aria-label="Processing the recording">
        {STEPS.map((step, i) => {
          const state = stepState(i, phase)
          return (
            <div key={step.phase} className={`step step--${state}`}>
              <span className="step-title">
                <span className={`step-mark step-mark--${state}`} aria-hidden="true">
                  {state === 'done' ? '✓' : ''}
                </span>
                {step.label}
              </span>
              {step.phase === 'transcribing' && state === 'active' && progress && (
                <>
                  <div className="progress">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${progress.total > 0 ? (100 * progress.done) / progress.total : 0}%`
                      }}
                    />
                  </div>
                  <span className="note">
                    {progress.done} of {progress.total} turns
                  </span>
                </>
              )}
            </div>
          )
        })}
      </div>
      {statusMessage && <p className="note">{statusMessage}</p>}
      <TranscriptList
        segments={segments}
        className="transcript--fill"
        emptyText="Transcribed turns appear here as they finish."
      />
    </div>
  )
}
