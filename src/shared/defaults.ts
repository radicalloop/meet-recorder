import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  openaiApiKey: '',
  transcriptionModel: 'gpt-transcribe',
  summaryModel: 'gpt-6-astra',
  outputDir: '',
  languages: [],
  recordVideo: true,
  videoFps: 15,
  videoMaxHeight: 1080,
  micDeviceId: ''
}

/** Format of the speech clips sent by the renderer. */
export const PCM_SAMPLE_RATE = 24000
