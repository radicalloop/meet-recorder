// Must not import 'electron' (unit-tested under plain Node with vitest).
export type { TranscribeAudioOptions } from './transcribe'
export { transcribeAudio } from './transcribe'
export type { SummarizeOptions } from './summary'
export { summarize } from './summary'
export { listModels } from './models'
export { OpenAIAuthError, describeError } from './responses'
