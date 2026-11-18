import { PCM_SAMPLE_RATE } from '../../../shared/defaults'
import type { AudioSource } from '../../../shared/types'
import { Vad } from './vad'
import { workletUrl, WORKLET_PROCESSOR_NAME, type WorkletFrameMessage } from './worklet'
import { downmixToMono, floatToInt16, rmsInt16, LinearResampler } from './pcm'

export interface CaptureOptions {
  /** Already passed to window.meet.capture.selectSource by the caller. */
  sourceId: string
  recordVideo: boolean
  videoFps: number
  videoMaxHeight: number
  /** Empty = default microphone. */
  micDeviceId: string
}

export interface CaptureLevels {
  /** 0..1 RMS-ish level for meters. */
  mic: number
  system: number
  micSpeaking: boolean
  systemSpeaking: boolean
}

export interface CaptureHandle {
  /** Flushes the last MediaRecorder chunk and final VAD commits, then stops all tracks. */
  stop(): Promise<void>
  levels(): CaptureLevels
  /** e.g. "System audio not available on this platform; only the microphone is transcribed." */
  warnings: string[]
  /** Live preview of the captured screen (for the UI), null when recordVideo is false. */
  previewStream: MediaStream | null
}

const FRAME_MS = 20
const MONITOR_LABEL = /^monitor of /i

interface Pipeline {
  vad: Vad
  level: number
  stop(): void
}

/**
 * Starts screen + system audio + mic capture. Call after window.meet.session.start().
 */
export async function startCapture(opts: CaptureOptions): Promise<CaptureHandle> {
  const warnings: string[] = []
  const t0 = performance.now()
  const now = (): number => performance.now() - t0

  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: opts.videoFps, height: { max: opts.videoMaxHeight } },
    audio: true
  })
  const videoTrack = displayStream.getVideoTracks()[0] ?? null

  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(opts.micDeviceId ? { deviceId: { exact: opts.micDeviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  })

  // System audio: from the display stream where the platform supports loopback,
  // otherwise (Linux) from a PulseAudio/PipeWire monitor device.
  let systemStream: MediaStream | null = null
  let systemTrack: MediaStreamTrack | null = displayStream.getAudioTracks()[0] ?? null
  // macOS returns an already-ended track when the System Audio Recording permission is missing.
  if (systemTrack?.readyState === 'ended') systemTrack = null
  if (!systemTrack && window.meet.platform === 'linux') {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const monitor = devices.find((d) => d.kind === 'audioinput' && MONITOR_LABEL.test(d.label))
    if (monitor) {
      try {
        systemStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: monitor.deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        })
        systemTrack = systemStream.getAudioTracks()[0] ?? null
      } catch {
        systemTrack = null
      }
    }
  }
  if (!systemTrack) {
    warnings.push(
      window.meet.platform === 'darwin'
        ? 'System audio unavailable — allow Meet Recorder under System Settings › Privacy & Security › Screen & System Audio Recording. Only your microphone is transcribed.'
        : 'System audio unavailable — only your microphone is transcribed.'
    )
  }

  const ctx = new AudioContext()
  let workletReady = true
  try {
    await ctx.audioWorklet.addModule(workletUrl())
  } catch {
    workletReady = false
  }

  // Output must stay connected to the destination or Chromium stops pulling the
  // graph; gain 0 avoids echoing the capture to the speakers.
  const mute = ctx.createGain()
  mute.gain.value = 0
  mute.connect(ctx.destination)

  let stopped = false

  function createPipeline(source: AudioSource, node: MediaStreamAudioSourceNode): Pipeline {
    const vad = new Vad({ sampleRate: PCM_SAMPLE_RATE })
    const pipeline: Pipeline = { vad, level: 0, stop: () => {} }
    let nextTMs: number | null = null

    const onFrame = (msg: WorkletFrameMessage): void => {
      if (stopped) return
      const pcm = new Int16Array(msg.pcm)
      const durMs = (pcm.length / PCM_SAMPLE_RATE) * 1000
      if (nextTMs === null) nextTMs = Math.max(0, now() - durMs)
      const tMs = nextTMs
      nextTMs += durMs
      pipeline.level = msg.rms
      for (const ev of vad.push({ pcm, rms: msg.rms, tMs })) {
        if (ev.type === 'audio') window.meet.audio.push(source, ev.pcm.buffer as ArrayBuffer)
        else window.meet.audio.commit(source, ev.startMs, ev.endMs)
      }
    }

    if (workletReady) {
      const worklet = new AudioWorkletNode(ctx, WORKLET_PROCESSOR_NAME, {
        processorOptions: { targetRate: PCM_SAMPLE_RATE, frameMs: FRAME_MS }
      })
      worklet.port.onmessage = (e: MessageEvent<WorkletFrameMessage>) => onFrame(e.data)
      node.connect(worklet)
      worklet.connect(mute)
      pipeline.stop = () => {
        worklet.port.onmessage = null
        node.disconnect(worklet)
        worklet.disconnect()
      }
    } else {
      pipeline.stop = attachScriptProcessor(ctx, node, mute, onFrame)
    }
    return pipeline
  }

  const micNode = ctx.createMediaStreamSource(micStream)
  const micPipe = createPipeline('mic', micNode)
  let sysPipe: Pipeline | null = null
  let sysNode: MediaStreamAudioSourceNode | null = null
  if (systemTrack) {
    sysNode = ctx.createMediaStreamSource(systemStream ?? new MediaStream([systemTrack]))
    sysPipe = createPipeline('system', sysNode)
  }

  // Recording: display video (when enabled) + one mixed audio track.
  const mixDest = ctx.createMediaStreamDestination()
  micNode.connect(mixDest)
  sysNode?.connect(mixDest)

  const recordTracks: MediaStreamTrack[] = []
  if (opts.recordVideo && videoTrack) recordTracks.push(videoTrack)
  recordTracks.push(...mixDest.stream.getAudioTracks())
  const mimeType = pickMimeType(opts.recordVideo && videoTrack !== null)
  const recorder = new MediaRecorder(new MediaStream(recordTracks), {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 2_500_000,
    audioBitsPerSecond: 128_000
  })
  let sendChain = Promise.resolve()
  recorder.ondataavailable = (e) => {
    if (e.data.size === 0) return
    const blob = e.data
    sendChain = sendChain.then(async () => {
      window.meet.session.appendVideo(await blob.arrayBuffer())
    })
  }
  const recorderStopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })
  recorder.onerror = () => warnings.push('Recording error — the video file may be incomplete.')
  recorder.start(1000)

  if (videoTrack) {
    videoTrack.addEventListener('ended', () => {
      if (stopped) return
      warnings.push('Screen sharing was ended from the system UI — audio capture continues.')
    })
  }

  let stopPromise: Promise<void> | null = null
  const doStop = async (): Promise<void> => {
    // Close open utterances before tearing the graph down.
    for (const [source, pipe] of [
      ['mic', micPipe],
      ['system', sysPipe]
    ] as [AudioSource, Pipeline | null][]) {
      if (!pipe) continue
      for (const ev of pipe.vad.flush()) {
        if (ev.type === 'audio') window.meet.audio.push(source, ev.pcm.buffer as ArrayBuffer)
        else window.meet.audio.commit(source, ev.startMs, ev.endMs)
      }
    }
    stopped = true
    micPipe.stop()
    sysPipe?.stop()
    if (recorder.state !== 'inactive') recorder.stop()
    await recorderStopped
    await sendChain
    for (const stream of [displayStream, micStream, systemStream]) {
      stream?.getTracks().forEach((t) => t.stop())
    }
    await ctx.close().catch(() => {})
  }

  return {
    stop: () => (stopPromise ??= doStop()),
    levels: () => ({
      mic: micPipe.level,
      system: sysPipe?.level ?? 0,
      micSpeaking: micPipe.vad.speaking,
      systemSpeaking: sysPipe?.vad.speaking ?? false
    }),
    warnings,
    previewStream: opts.recordVideo && videoTrack ? new MediaStream([videoTrack]) : null
  }
}

export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'audioinput' && !MONITOR_LABEL.test(d.label))
}

function pickMimeType(withVideo: boolean): string | null {
  const candidates = withVideo
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['audio/webm;codecs=opus', 'audio/webm']
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? null
}

/** Fallback when the AudioWorklet cannot load (e.g. blob: blocked by CSP). */
function attachScriptProcessor(
  ctx: AudioContext,
  node: MediaStreamAudioSourceNode,
  sink: AudioNode,
  onFrame: (msg: WorkletFrameMessage) => void
): () => void {
  const resampler = new LinearResampler(ctx.sampleRate, PCM_SAMPLE_RATE)
  const frameSamples = Math.round((PCM_SAMPLE_RATE * FRAME_MS) / 1000)
  const pending = new Int16Array(frameSamples)
  let filled = 0
  const sp = ctx.createScriptProcessor(1024, 1, 1)
  sp.onaudioprocess = (e) => {
    const channels: Float32Array[] = []
    for (let i = 0; i < e.inputBuffer.numberOfChannels; i++) {
      channels.push(e.inputBuffer.getChannelData(i))
    }
    const pcm = floatToInt16(resampler.process(downmixToMono(channels)))
    let offset = 0
    while (offset < pcm.length) {
      const take = Math.min(pcm.length - offset, frameSamples - filled)
      pending.set(pcm.subarray(offset, offset + take), filled)
      filled += take
      offset += take
      if (filled === frameSamples) {
        const frame = pending.slice()
        onFrame({ pcm: frame.buffer, rms: rmsInt16(frame) })
        filled = 0
      }
    }
  }
  node.connect(sp)
  sp.connect(sink)
  return () => {
    sp.onaudioprocess = null
    node.disconnect(sp)
    sp.disconnect()
  }
}
