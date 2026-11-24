import { ArrowLeft, Camera, Download, ScanLine, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { recordTrackedCapture, supportsTrackedCapture } from '../services/trackedCapture'
import './Capture.css'

interface CaptureProps {
  onBack: () => void
  onUse: (file: File) => void
}

export function Capture({ onBack, onUse }: CaptureProps) {
  const [trackedAvailable, setTrackedAvailable] = useState(false)
  const [mode, setMode] = useState<'video' | 'tracked' | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [recording, setRecording] = useState<{ file: File; url: string } | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const finish = useRef<HTMLButtonElement>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const active = useRef<AbortController | null>(null)
  const url = useRef<string | null>(null)
  const canRecordVideo = typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined'

  useEffect(() => {
    let disposed = false
    void supportsTrackedCapture().then((supported) => {
      if (!disposed) setTrackedAvailable(supported)
    }).catch(() => undefined)
    return () => {
      disposed = true
      active.current?.abort()
      if (url.current) URL.revokeObjectURL(url.current)
    }
  }, [])

  const save = (file: File) => {
    if (url.current) URL.revokeObjectURL(url.current)
    url.current = URL.createObjectURL(file)
    setRecording({ file, url: url.current })
  }

  const start = async (next: 'video' | 'tracked') => {
    if (active.current) return
    const controller = new AbortController()
    const { signal } = controller
    active.current = controller
    setError('')
    setMode(next)
    setStatus('Opening camera…')
    let stream: MediaStream | undefined
    let limitTimer: number | undefined
    try {
      if (next === 'tracked' && overlay.current && finish.current) {
        if (video.current) video.current.srcObject = null
        const file = await recordTrackedCapture(overlay.current, finish.current, signal, (message) => {
          if (!signal.aborted) setStatus(message)
        })
        signal.throwIfAborted()
        save(file)
        return
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      signal.throwIfAborted()
      if (video.current) video.current.srcObject = stream
      const mimeType = ['video/webm;codecs=vp8', 'video/mp4', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type))
      const mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
      const stop = () => { if (mediaRecorder.state !== 'inactive') mediaRecorder.stop() }
      const chunks: Blob[] = []
      let bytes = 0
      const capture = new Promise<File>((resolve, reject) => {
        mediaRecorder.ondataavailable = ({ data }) => {
          if (!data.size) return
          bytes += data.size
          chunks.push(data)
          if (bytes >= 1024 ** 3) stop()
        }
        mediaRecorder.onerror = () => reject(new Error('The browser could not finish recording. Try again or upload a video.'))
        mediaRecorder.onstop = () => {
          const type = mediaRecorder.mimeType || chunks[0]?.type || mimeType
          if (!bytes || !type || !/^video\/(mp4|webm)(;|$)/i.test(type)) {
            reject(new Error('No usable video was recorded. Try again or upload a video.'))
            return
          }
          const extension = type.startsWith('video/mp4') ? 'mp4' : 'webm'
          resolve(new File(chunks, `Walkthrough.${extension}`, { type }))
        }
        mediaRecorder.start(1000)
      })
      recorder.current = mediaRecorder
      signal.addEventListener('abort', stop, { once: true })
      setStatus('Recording')
      limitTimer = window.setTimeout(stop, 15 * 60_000)
      const file = await capture
      signal.throwIfAborted()
      save(file)
    } catch (caught) {
      if (!signal.aborted) {
        if (caught instanceof DOMException && next === 'video') {
          setError('Could not start recording. Check camera permissions or upload a video.')
        } else {
          setError(caught instanceof Error ? caught.message : 'Capture could not start. Try uploading a video.')
        }
      }
    } finally {
      window.clearTimeout(limitTimer)
      stream?.getTracks().forEach((track) => track.stop())
      recorder.current = null
      if (video.current) video.current.srcObject = null
      active.current = null
      if (!signal.aborted) {
        setMode(null)
        setStatus('')
      }
    }
  }

  const isTracked = recording?.file.name.endsWith('.miracapture')
  return (
    <div className="capture-panel">
      <button className="back-link" onClick={onBack} disabled={mode !== null}><ArrowLeft size={15} /> Back to files</button>
      {!recording && (
        <div className="capture-monitor">
          <video ref={video} autoPlay playsInline muted hidden={mode !== 'video'} aria-label="Camera preview" />
          {mode !== 'video' && <Camera size={34} aria-hidden="true" />}
        </div>
      )}
      {recording && !isTracked && <video className="capture-playback" src={recording.url} playsInline controls aria-label="Recorded video" />}
      {error && <p className="upload-error" role="alert">{error}</p>}
      {recording ? (
        <>
          <p>{isTracked ? 'Tracked capture ready.' : 'Video ready.'}</p>
          <div className="capture-controls">
            <button className="primary-button" onClick={() => onUse(recording.file)}>Use capture</button>
            <a className="secondary-button" href={recording.url} download={recording.file.name}><Download size={16} /> Save copy</a>
            <button className="secondary-button" onClick={() => {
              URL.revokeObjectURL(recording.url)
              url.current = null
              setRecording(null)
            }}>Record again</button>
          </div>
        </>
      ) : (
        <>
          <p role="status">{status || 'Move slowly and keep nearby surfaces in view. Video records without audio.'}</p>
          <div className="capture-controls">
            {mode === 'video' ? (
              <button className="primary-button" disabled={status !== 'Recording'} onClick={() => {
                setStatus('Saving recording…')
                if (recorder.current?.state === 'recording') recorder.current.stop()
              }}><Square size={16} /> Finish recording</button>
            ) : (
              <>
                {canRecordVideo && <button className="primary-button" disabled={mode !== null} onClick={() => void start('video')}><Camera size={17} /> Record video</button>}
                {trackedAvailable && <button className="secondary-button" disabled={mode !== null} onClick={() => void start('tracked')}><ScanLine size={17} /> Record with tracking</button>}
              </>
            )}
          </div>
          {!canRecordVideo && <p>Browser recording needs a compatible camera and a secure connection. You can upload an existing video instead.</p>}
        </>
      )}
      <div ref={overlay} className="capture-xr-overlay" hidden={mode !== 'tracked'}>
        <div className="capture-xr-controls">
          <p role="status">{status}</p>
          <button ref={finish} className="primary-button"><Square size={16} /> Finish tracked capture</button>
        </div>
      </div>
    </div>
  )
}
