// Registers every IPC handler in src/shared/ipc.ts except the capture:* ones.
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import type { AudioSource, SessionStartRequest, SettingsUpdate } from '../../shared/types'
import { listModels } from '../openai'
import { SettingsStore } from '../settings'
import { resolveOutputDir } from '../settings/logic'
import { SessionManager } from './manager'
import { isInside, listSessions } from './files'

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  return Buffer.alloc(0)
}

export function registerSessionIpc(getWindow: () => BrowserWindow | null): void {
  const store = new SettingsStore()
  const manager = new SessionManager({
    emitTranscript: (e) => getWindow()?.webContents.send(IPC.evtTranscript, e),
    emitStatus: (s) => getWindow()?.webContents.send(IPC.evtStatus, s)
  })

  ipcMain.handle(IPC.settingsGet, () => store.getPublic())
  ipcMain.handle(IPC.settingsUpdate, (_e, update: SettingsUpdate) => store.update(update ?? {}))
  ipcMain.handle(IPC.settingsListModels, () => {
    const key = store.get().openaiApiKey
    if (!key) throw new Error('Add your OpenAI API key in Settings first.')
    return listModels(key)
  })
  ipcMain.handle(IPC.settingsChooseOutputDir, async () => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    const dir = result.canceled ? undefined : result.filePaths[0]
    if (!dir) return null
    store.update({ outputDir: dir })
    return dir
  })

  // While recording, keep the app's own window out of screen capture (macOS sharingType none,
  // Windows WDA_EXCLUDEFROMCAPTURE): otherwise the live preview captures itself endlessly and
  // the app shows up in the recorded video. The renderer starts capturing after start resolves.
  const hideFromCapture = (hidden: boolean): void => getWindow()?.setContentProtection(hidden)

  ipcMain.handle(IPC.sessionStart, async (_e, req: SessionStartRequest) => {
    const settings = store.get()
    const title = typeof req?.title === 'string' ? req.title : ''
    hideFromCapture(true)
    try {
      return await manager.start(
        { title },
        settings,
        resolveOutputDir(settings.outputDir),
        app.getVersion()
      )
    } catch (err) {
      hideFromCapture(false)
      throw err
    }
  })
  ipcMain.handle(IPC.sessionStop, () => {
    hideFromCapture(false)
    return manager.stop()
  })
  ipcMain.on(IPC.sessionAppendVideo, (_e, chunk: unknown) => manager.appendVideo(toBuffer(chunk)))

  ipcMain.on(IPC.audioPush, (_e, source: AudioSource, pcm16: unknown) => {
    if (source === 'mic' || source === 'system') manager.pushAudio(source, toBuffer(pcm16))
  })
  ipcMain.on(IPC.audioCommit, (_e, source: AudioSource, startMs: number, endMs: number) => {
    if (
      (source === 'mic' || source === 'system') &&
      Number.isFinite(startMs) &&
      Number.isFinite(endMs)
    ) {
      manager.commitAudio(source, startMs, endMs)
    }
  })

  ipcMain.handle(IPC.sessionsList, () => listSessions(resolveOutputDir(store.get().outputDir)))
  ipcMain.handle(IPC.sessionsOpen, async (_e, dir: string) => {
    const root = resolveOutputDir(store.get().outputDir)
    if (typeof dir !== 'string' || !isInside(root, dir)) {
      throw new Error('Only session folders can be opened.')
    }
    await shell.openPath(dir)
  })

  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting || !manager.active) return
    event.preventDefault()
    quitting = true
    void manager.finalizeForQuit().finally(() => app.quit())
  })
}
