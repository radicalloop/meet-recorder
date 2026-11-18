// Settings persistence in userData/settings.json; API key encrypted via safeStorage when possible.
import { app, safeStorage } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { DEFAULT_SETTINGS } from '../../shared/defaults'
import type { PublicSettings, Settings, SettingsUpdate } from '../../shared/types'
import { applyUpdate, toPublic } from './logic'

function canEncrypt(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  if (
    process.platform === 'linux' &&
    typeof safeStorage.getSelectedStorageBackend === 'function' &&
    safeStorage.getSelectedStorageBackend() === 'basic_text'
  ) {
    return false
  }
  return true
}

export class SettingsStore {
  private readonly file: string
  private settings: Settings
  private keyEncrypted = false

  constructor() {
    this.file = join(app.getPath('userData'), 'settings.json')
    this.settings = this.load()
  }

  private load(): Settings {
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
    let key = typeof raw.openaiApiKey === 'string' ? raw.openaiApiKey : ''
    if (key && raw.keyEncrypted === true) {
      try {
        key = safeStorage.decryptString(Buffer.from(key, 'base64'))
        this.keyEncrypted = true
      } catch {
        key = ''
      }
    }
    return applyUpdate(DEFAULT_SETTINGS, { ...raw, openaiApiKey: key } as SettingsUpdate)
  }

  /** Full settings including the decrypted key. Never send to the renderer. */
  get(): Settings {
    return { ...this.settings }
  }

  getPublic(): PublicSettings {
    const encrypted = this.settings.openaiApiKey ? this.keyEncrypted : canEncrypt()
    return toPublic(this.settings, encrypted)
  }

  update(update: SettingsUpdate): PublicSettings {
    this.settings = applyUpdate(this.settings, update)
    this.persist()
    return this.getPublic()
  }

  private persist(): void {
    const { openaiApiKey, ...rest } = this.settings
    let storedKey = openaiApiKey
    this.keyEncrypted = false
    if (openaiApiKey && canEncrypt()) {
      storedKey = safeStorage.encryptString(openaiApiKey).toString('base64')
      this.keyEncrypted = true
    }
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(
      this.file,
      JSON.stringify({ ...rest, openaiApiKey: storedKey, keyEncrypted: this.keyEncrypted }, null, 2)
    )
  }
}
