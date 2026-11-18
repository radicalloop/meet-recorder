import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type { MeetApi, SessionStatus, TranscriptEvent } from '../shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const meet: MeetApi = {
  platform: process.platform,
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (update) => ipcRenderer.invoke(IPC.settingsUpdate, update),
    listModels: () => ipcRenderer.invoke(IPC.settingsListModels),
    chooseOutputDir: () => ipcRenderer.invoke(IPC.settingsChooseOutputDir)
  },
  capture: {
    listSources: () => ipcRenderer.invoke(IPC.captureListSources),
    selectSource: (id) => ipcRenderer.invoke(IPC.captureSelectSource, id)
  },
  session: {
    start: (req) => ipcRenderer.invoke(IPC.sessionStart, req),
    stop: () => ipcRenderer.invoke(IPC.sessionStop),
    appendVideo: (chunk) => ipcRenderer.send(IPC.sessionAppendVideo, chunk),
    onTranscript: (cb) => subscribe<TranscriptEvent>(IPC.evtTranscript, cb),
    onStatus: (cb) => subscribe<SessionStatus>(IPC.evtStatus, cb)
  },
  audio: {
    push: (source, pcm16) => ipcRenderer.send(IPC.audioPush, source, pcm16),
    commit: (source, startMs, endMs) => ipcRenderer.send(IPC.audioCommit, source, startMs, endMs)
  },
  sessions: {
    list: () => ipcRenderer.invoke(IPC.sessionsList),
    open: (dir) => ipcRenderer.invoke(IPC.sessionsOpen, dir)
  }
}

contextBridge.exposeInMainWorld('meet', meet)
