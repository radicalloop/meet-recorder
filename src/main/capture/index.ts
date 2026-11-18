// Registers the capture IPC (source listing/selection) and the display-media handler
// that answers the renderer's getDisplayMedia with the chosen source plus system
// audio where the platform supports it: loopback on Windows, and on macOS 15+ through the
// native system picker (Electron 44 returns a silent track for loopback with a custom picker
// on macOS — electron/electron#52738 — so the app's own source grid is skipped there).
import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron'
import { IPC } from '../../shared/ipc'
import type { CaptureSource } from '../../shared/types'

const PORTAL_SOURCE_ID = 'portal'

/** Platforms where the OS dialog chooses the source instead of the app's grid. */
function usesSystemDialog(): boolean {
  return isWayland() || process.platform === 'darwin'
}

function isWayland(): boolean {
  return (
    process.platform === 'linux' &&
    (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY)
  )
}

/**
 * Chromium flags needed for screen capture on Linux (PipeWire/Wayland).
 * Call before app.whenReady().
 */
export function applyCaptureCommandLineSwitches(): void {
  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer')
  }
}

export function registerCapture(): void {
  let selected: { id: string; name: string } | null = null

  ipcMain.handle(IPC.captureListSources, async (): Promise<CaptureSource[]> => {
    if (usesSystemDialog()) {
      // The xdg-desktop-portal (Wayland) or macOS picker owns source selection; getSources
      // here would pop the system dialog. Defer it to the display-media handler.
      return [
        {
          id: PORTAL_SOURCE_ID,
          name:
            process.platform === 'darwin' ? 'Choose in macOS dialog' : 'Choose in system dialog',
          kind: 'screen',
          thumbnailDataUrl: ''
        }
      ]
    }
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 }
    })
    const ownIds = new Set(
      BrowserWindow.getAllWindows().map((w) => {
        try {
          return w.getMediaSourceId()
        } catch {
          return ''
        }
      })
    )
    return sources
      .filter((s) => !ownIds.has(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen') ? 'screen' : 'window',
        thumbnailDataUrl: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL()
      }))
  })

  ipcMain.handle(IPC.captureSelectSource, async (_e, id: string) => {
    if (typeof id !== 'string' || id.length === 0) {
      selected = null
      return
    }
    if (id === PORTAL_SOURCE_ID) {
      selected = { id: PORTAL_SOURCE_ID, name: 'Screen' }
      return
    }
    // Re-list to validate the id and capture the display name for the handler.
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 }
    })
    const match = sources.find((s) => s.id === id)
    selected = match ? { id: match.id, name: match.name } : { id, name: 'Screen' }
  })

  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      void (async () => {
        try {
          let video = selected
          if (!video) {
            callback(null)
            return
          }
          if (video.id === PORTAL_SOURCE_ID) {
            // On Wayland this triggers the portal dialog and resolves to the
            // source the user picked there.
            const sources = await desktopCapturer.getSources({ types: ['screen'] })
            if (sources.length === 0) {
              callback(null)
              return
            }
            video = { id: sources[0].id, name: sources[0].name }
          }
          // Linux has no loopback; the renderer falls back to a PipeWire/Pulse monitor.
          // On macOS < 15 (no system picker) loopback may come back silent; the renderer warns.
          const wantAudio = request.audioRequested && process.platform !== 'linux'
          callback({ video, ...(wantAudio ? { audio: 'loopback' } : {}) })
        } catch {
          callback(null)
        }
      })()
    },
    // macOS 15+: native picker, which also grants the System Audio Recording permission.
    // Older macOS and other platforms fall back to the handler above.
    { useSystemPicker: process.platform === 'darwin' }
  )
}
