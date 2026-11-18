// Thin indirection over the capture module so a dev-only mock (devMock.ts) can
// stand in when the renderer runs in a plain browser without the preload bridge.
import {
  startCapture as realStartCapture,
  listMicrophones as realListMicrophones
} from '../capture'
import type { CaptureHandle, CaptureLevels, CaptureOptions } from '../capture'

export type { CaptureHandle, CaptureLevels, CaptureOptions }

export interface MockCaptureModule {
  startCapture(opts: CaptureOptions): Promise<CaptureHandle>
  listMicrophones(): Promise<MediaDeviceInfo[]>
}

declare global {
  interface Window {
    __meetMockCapture?: MockCaptureModule
  }
}

export function startCapture(opts: CaptureOptions): Promise<CaptureHandle> {
  return (window.__meetMockCapture?.startCapture ?? realStartCapture)(opts)
}

export function listMicrophones(): Promise<MediaDeviceInfo[]> {
  return (window.__meetMockCapture?.listMicrophones ?? realListMicrophones)()
}
