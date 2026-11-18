import { describe, expect, it } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'
import { DEFAULT_SETTINGS } from '../../shared/defaults'
import { apiKeyHint, applyUpdate, resolveOutputDir, toPublic } from './logic'

describe('resolveOutputDir', () => {
  it('defaults to ~/MeetRecorder', () => {
    expect(resolveOutputDir('')).toBe(join(homedir(), 'MeetRecorder'))
    expect(resolveOutputDir('  ')).toBe(join(homedir(), 'MeetRecorder'))
    expect(resolveOutputDir('/tmp/x')).toBe('/tmp/x')
  })
})

describe('apiKeyHint', () => {
  it('shows prefix and last 4 chars only', () => {
    expect(apiKeyHint('sk-proj-abcdefa1b2')).toBe('sk-…a1b2')
    expect(apiKeyHint('')).toBe('')
    expect(apiKeyHint('short')).toBe('sh…')
  })
})

describe('applyUpdate', () => {
  it('trims the key; empty string clears, undefined keeps', () => {
    const withKey = applyUpdate(DEFAULT_SETTINGS, { openaiApiKey: '  sk-x  ' })
    expect(withKey.openaiApiKey).toBe('sk-x')
    expect(applyUpdate(withKey, {}).openaiApiKey).toBe('sk-x')
    expect(applyUpdate(withKey, { openaiApiKey: '' }).openaiApiKey).toBe('')
  })

  it('clamps fps to 5–30 and only accepts allowed heights', () => {
    expect(applyUpdate(DEFAULT_SETTINGS, { videoFps: 1 }).videoFps).toBe(5)
    expect(applyUpdate(DEFAULT_SETTINGS, { videoFps: 60 }).videoFps).toBe(30)
    expect(applyUpdate(DEFAULT_SETTINGS, { videoFps: 24 }).videoFps).toBe(24)
    expect(applyUpdate(DEFAULT_SETTINGS, { videoMaxHeight: 999 }).videoMaxHeight).toBe(
      DEFAULT_SETTINGS.videoMaxHeight
    )
    expect(applyUpdate(DEFAULT_SETTINGS, { videoMaxHeight: 1440 }).videoMaxHeight).toBe(1440)
  })

  it('filters languages to ISO-639-ish codes', () => {
    const next = applyUpdate(DEFAULT_SETTINGS, { languages: ['EN', ' hi ', 'nonsense', ''] })
    expect(next.languages).toEqual(['en', 'hi'])
  })

  it('ignores empty model names', () => {
    const next = applyUpdate(DEFAULT_SETTINGS, { transcriptionModel: '  ' })
    expect(next.transcriptionModel).toBe(DEFAULT_SETTINGS.transcriptionModel)
  })

  it('drops live transcription models persisted by older versions', () => {
    const next = applyUpdate(DEFAULT_SETTINGS, { transcriptionModel: 'gpt-live-transcribe' })
    expect(next.transcriptionModel).toBe(DEFAULT_SETTINGS.transcriptionModel)
  })
})

describe('toPublic', () => {
  it('never exposes the key', () => {
    const pub = toPublic({ ...DEFAULT_SETTINGS, openaiApiKey: 'sk-proj-secret-a1b2' }, true)
    expect(JSON.stringify(pub)).not.toContain('secret')
    expect(pub.hasApiKey).toBe(true)
    expect(pub.apiKeyHint).toBe('sk-…a1b2')
    expect(pub.keyEncrypted).toBe(true)
    expect(pub.outputDir).toBe(join(homedir(), 'MeetRecorder'))
  })
})
