// IPC channel names shared by the main process and preload bridge.
// invoke = ipcRenderer.invoke / ipcMain.handle; send = ipcRenderer.send / ipcMain.on;
// event = webContents.send / ipcRenderer.on.
export const IPC = {
  settingsGet: 'settings:get', // invoke
  settingsUpdate: 'settings:update', // invoke (SettingsUpdate)
  settingsListModels: 'settings:listModels', // invoke
  settingsChooseOutputDir: 'settings:chooseOutputDir', // invoke

  captureListSources: 'capture:listSources', // invoke
  captureSelectSource: 'capture:selectSource', // invoke (id)

  sessionStart: 'session:start', // invoke (SessionStartRequest)
  sessionStop: 'session:stop', // invoke
  sessionAppendVideo: 'session:appendVideo', // send (ArrayBuffer)

  audioPush: 'audio:push', // send (AudioSource, ArrayBuffer)
  audioCommit: 'audio:commit', // send (AudioSource, startMs, endMs)

  sessionsList: 'sessions:list', // invoke
  sessionsOpen: 'sessions:open', // invoke (dir)

  evtTranscript: 'evt:transcript', // event (TranscriptEvent)
  evtStatus: 'evt:status' // event (SessionStatus)
} as const
