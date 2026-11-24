import {
  ArrowLeft,
  BadgeDollarSign,
  Camera,
  Check,
  FileBox,
  FileVideo2,
  Info,
  LoaderCircle,
  RotateCcw,
  SlidersHorizontal,
  UploadCloud,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { buildModeOptions } from '../buildModes'
import { captureTips } from '../data'
import { reconstructionApi } from '../services/reconstruction'
import { billingApi, formatMoney, type ScanAccess } from '../services/api'
import type { BuildMode, CaptureDraft } from '../types'
import { Capture } from './Capture'

interface UploadDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (draft: CaptureDraft) => void
}

const videoExtensions = ['mp4', 'mov', 'm4v', 'webm', 'miracapture']
const modelExtensions = ['ply', 'splat', 'ksplat', 'spz', 'sog']
const maxVideoSize = 3 * 1024 * 1024 * 1024
const maxModelSize = 1.5 * 1024 * 1024 * 1024
const downscaleOptions = [8, 4, 2, 1] as const

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function UploadDialog({ open, onClose, onCreate }: UploadDialogProps) {
  const [kind, setKind] = useState<CaptureDraft['kind']>('walkthrough')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [buildMode, setBuildMode] = useState<BuildMode>('preview')
  const [supportedBuildModes, setSupportedBuildModes] = useState<BuildMode[] | null>(null)
  const [advancedSupported, setAdvancedSupported] = useState<boolean | null>(null)
  const [maxTargetFrames, setMaxTargetFrames] = useState(1200)
  const [advancedTuning, setAdvancedTuning] = useState(false)
  const [targetFrames, setTargetFrames] = useState(180)
  const [trainSteps, setTrainSteps] = useState(4000)
  const [downscaleFactor, setDownscaleFactor] = useState<1 | 2 | 4 | 8>(4)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [scanAccess, setScanAccess] = useState<ScanAccess | null>(null)
  const [accessError, setAccessError] = useState('')
  const [purchasing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const billingMode: BuildMode = advancedTuning ? 'maximum' : buildMode

  useEffect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', escape)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', escape)
      document.body.style.overflow = ''
    }
  }, [open, onClose, submitting])

  useEffect(() => {
    if (!open) {
      setCameraOpen(false)
      setFile(null)
      setName('')
      setLocation('')
      setError('')
      setKind('walkthrough')
      setBuildMode('preview')
      setSupportedBuildModes(null)
      setAdvancedSupported(null)
      setMaxTargetFrames(1200)
      setAdvancedTuning(false)
      setTargetFrames(180)
      setTrainSteps(4000)
      setDownscaleFactor(4)
      setSubmitting(false)
      setScanAccess(null)
      setAccessError('')
    }
  }, [open])

  useEffect(() => {
    if (!open || !file || kind !== 'walkthrough' || !reconstructionApi.isConfigured) return
    let cancelled = false
    setScanAccess(null)
    setAccessError('')
    void billingApi.quote(billingMode)
      .then((access) => { if (!cancelled) setScanAccess(access) })
      .catch((caught) => { if (!cancelled) setAccessError(caught instanceof Error ? caught.message : 'Could not check scan access.') })
    return () => { cancelled = true }
  }, [billingMode, file, kind, open])

  useEffect(() => {
    if (!open || !reconstructionApi.isConfigured) return
    let cancelled = false
    void reconstructionApi.capabilities()
      .then((capabilities) => {
        if (!cancelled) {
          setSupportedBuildModes(capabilities.buildModes)
          setAdvancedSupported(capabilities.advancedTuning)
          setMaxTargetFrames(capabilities.maxTargetFrames)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSupportedBuildModes([])
          setAdvancedSupported(false)
        }
      })
    return () => { cancelled = true }
  }, [open])

  if (!open) return null

  const validateAndSet = (candidate?: File) => {
    if (!candidate) return
    const extension = candidate.name.split('.').pop()?.toLowerCase() || ''
    const allowed = kind === 'walkthrough' ? videoExtensions : modelExtensions
    const limit = kind === 'walkthrough' ? maxVideoSize : maxModelSize
    if (!allowed.includes(extension)) {
      setError(`Choose a ${allowed.map((value) => `.${value}`).join(', ')} file.`)
      return
    }
    if (candidate.size > limit) {
      setError(`This file is over the ${kind === 'walkthrough' ? '3 GB' : '1.5 GB'} limit.`)
      return
    }
    setError('')
    setFile(candidate)
    if (!name) setName(candidate.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '))
  }

  const switchKind = (next: CaptureDraft['kind']) => {
    setKind(next)
    setFile(null)
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const submit = () => {
    if (!file || !name.trim() || (kind === 'walkthrough' && reconstructionApi.isConfigured && !scanAccess?.allowed)) return
    setSubmitting(true)
    window.setTimeout(() => {
      onCreate({
        file,
        name,
        location,
        kind,
        buildMode: advancedTuning ? 'maximum' : buildMode,
        tuning: advancedTuning ? { targetFrames, trainSteps, downscaleFactor } : undefined,
      })
      onClose()
    }, 650)
  }

  const accept = kind === 'walkthrough'
    ? '.mp4,.mov,.m4v,.webm,.miracapture,video/mp4,video/quicktime,video/webm'
    : '.ply,.splat,.ksplat,.spz,.sog'
  const buildModeIndex = Math.max(0, buildModeOptions.findIndex((mode) => mode.id === buildMode))
  const selectedBuildMode = buildModeOptions[buildModeIndex]
  const billingLabel = advancedTuning ? 'Advanced' : selectedBuildMode.name
  const buildQualityProgress = (buildModeIndex / (buildModeOptions.length - 1)) * 100
  const buildModeSupported = !reconstructionApi.isConfigured || supportedBuildModes?.includes(billingMode) === true
  const advancedReady = !advancedTuning || advancedSupported === true
  const accessReady = kind !== 'walkthrough' || !reconstructionApi.isConfigured || scanAccess?.allowed === true

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !submitting && onClose()}>
      <section className="upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title">
        <div className="modal-topbar">
          <div>
            <h2 id="upload-title">{cameraOpen ? 'Record a video' : file ? 'Name your scan' : 'New 3D scan'}</h2>
          </div>
          <button className="icon-button" onClick={onClose} disabled={submitting} aria-label="Close"><X size={21} /></button>
        </div>

        {cameraOpen ? (
          <Capture onBack={() => setCameraOpen(false)} onUse={(capture) => {
            validateAndSet(capture)
            setCameraOpen(false)
          }} />
        ) : !file ? (
          <>
            <div className="upload-tabs" role="tablist">
              <button className={kind === 'walkthrough' ? 'active' : ''} onClick={() => switchKind('walkthrough')}>
                <FileVideo2 size={17} /> Phone video
              </button>
              <button className={kind === 'model' ? 'active' : ''} onClick={() => switchKind('model')}>
                <FileBox size={17} /> Finished splat
              </button>
            </div>

            <button
              className={`drop-zone ${dragging ? 'dragging' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                validateAndSet(event.dataTransfer.files[0])
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept={accept}
                onChange={(event) => validateAndSet(event.target.files?.[0])}
                hidden
              />
              <span className="drop-icon"><UploadCloud size={28} /></span>
              <strong>{dragging ? 'Drop it here' : kind === 'walkthrough' ? 'Drop your capture file here' : 'Drop your Gaussian splat here'}</strong>
              <p>or <u>choose a file</u> from your computer</p>
              <small>
                {kind === 'walkthrough'
                  ? 'MP4, MOV, WebM or MIRA capture · Up to 3 GB'
                  : 'PLY, SPZ, SPLAT, KSPLAT or SOG · Up to 1.5 GB'}
              </small>
            </button>

            {kind === 'walkthrough' && (
              <button className="secondary-button capture-open-button" onClick={() => setCameraOpen(true)}>
                <Camera size={17} /> Open camera
              </button>
            )}

            {error && <div className="upload-error"><Info size={16} />{error}</div>}

            <div className="capture-tip-grid">
              {kind === 'walkthrough' ? captureTips.map((tip) => (
                <div key={tip}><Check size={15} /> {tip}</div>
              )) : (
                <div className="format-note">
                  <Info size={16} />
                  <span>Mira renders Gaussian-splat PLY data—not an ordinary polygon or point-cloud PLY.</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="details-step">
            <button className="back-link" onClick={() => setFile(null)} disabled={submitting}>
              <ArrowLeft size={15} /> Choose a different file
            </button>
            <div className="selected-file">
              <span>{kind === 'walkthrough' ? <FileVideo2 size={22} /> : <FileBox size={22} />}</span>
              <div><strong>{file.name}</strong><p>{formatBytes(file.size)}</p></div>
              <Check size={18} className="file-check" />
            </div>
            <label className="field-label">
              Scan name <span>Required</span>
              <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Sandstone garden arch" maxLength={60} />
            </label>
            <label className="field-label">
              Location <span>Optional</span>
              <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="e.g. Gardens, Cape Town" maxLength={80} />
            </label>
            {kind === 'walkthrough' && (
              <fieldset className="build-quality-fieldset">
                <legend>Build quality <span>{advancedTuning ? 'Custom controls' : 'Five levels'}</span></legend>
                <div className="build-quality-summary" aria-live="polite">
                  <span className="build-quality-icon"><SlidersHorizontal size={18} /></span>
                  <div>
                    <strong>
                      {advancedTuning ? 'Advanced tuning' : selectedBuildMode.name}
                      {!advancedTuning && selectedBuildMode.recommended && <i>Recommended</i>}
                      {advancedTuning && <i>Maximum billing tier</i>}
                      {!buildModeSupported && supportedBuildModes !== null && <i>Update pending</i>}
                    </strong>
                    <p>{advancedTuning ? 'Trade frame coverage, training time, and source resolution independently.' : selectedBuildMode.description}</p>
                    <small>{advancedTuning ? `${targetFrames} frames · ${trainSteps.toLocaleString()} steps · ${downscaleFactor === 1 ? 'full resolution' : `${downscaleFactor}× downscale`}` : selectedBuildMode.detail}</small>
                  </div>
                </div>
                <input
                  className="build-quality-slider"
                  type="range"
                  min="0"
                  max={buildModeOptions.length - 1}
                  step="1"
                  value={buildModeIndex}
                  disabled={advancedTuning}
                  aria-label="Build quality"
                  aria-valuetext={selectedBuildMode.name}
                  style={{
                    background: `linear-gradient(to right, var(--blue) ${buildQualityProgress}%, var(--line) ${buildQualityProgress}%)`,
                  }}
                  onChange={(event) => {
                    const nextMode = buildModeOptions[Number(event.target.value)]
                    if (nextMode) {
                      setBuildMode(nextMode.id)
                      setTargetFrames(nextMode.tuning.targetFrames)
                      setTrainSteps(nextMode.tuning.trainSteps)
                      setDownscaleFactor(nextMode.tuning.downscaleFactor)
                    }
                  }}
                />
                <div className="build-quality-ticks">
                  {buildModeOptions.map((mode) => (
                    <button
                      type="button"
                      disabled={advancedTuning}
                      className={`${buildMode === mode.id ? 'active' : ''} ${supportedBuildModes !== null && !supportedBuildModes.includes(mode.id) ? 'unavailable' : ''}`}
                      onClick={() => {
                        setBuildMode(mode.id)
                        setTargetFrames(mode.tuning.targetFrames)
                        setTrainSteps(mode.tuning.trainSteps)
                        setDownscaleFactor(mode.tuning.downscaleFactor)
                      }}
                      key={mode.id}
                    >
                      <i />
                      <span>{mode.name}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={`advanced-tuning-toggle ${advancedTuning ? 'active' : ''}`}
                  aria-pressed={advancedTuning}
                  onClick={() => setAdvancedTuning((current) => !current)}
                >
                  <SlidersHorizontal size={15} />
                  <span><strong>Advanced tuning</strong><small>Control frames, iterations, and resolution</small></span>
                  <i>{advancedTuning ? 'On' : 'Off'}</i>
                </button>
                {advancedTuning && (
                  <div className="advanced-tuning-panel">
                    <label>
                      <span><strong>Sampled frames</strong><output>{targetFrames}</output></span>
                      <input type="range" min="60" max={maxTargetFrames} step="20" value={targetFrames} aria-label="Sampled frames" onChange={(event) => setTargetFrames(Number(event.target.value))} />
                      <small>Distributed over the whole video. More frames make COLMAP substantially slower.</small>
                    </label>
                    <label>
                      <span><strong>Training steps</strong><output>{trainSteps.toLocaleString()}</output></span>
                      <input type="range" min="1000" max="15000" step="500" value={trainSteps} aria-label="Training steps" onChange={(event) => setTrainSteps(Number(event.target.value))} />
                      <small>Fewer steps finish sooner but reduce refinement and fine detail.</small>
                    </label>
                    <label>
                      <span><strong>Image downscale</strong><output>{downscaleFactor === 1 ? 'Full resolution' : `${downscaleFactor}× smaller`}</output></span>
                      <input type="range" min="0" max={downscaleOptions.length - 1} step="1" value={downscaleOptions.indexOf(downscaleFactor)} aria-label="Image downscale" onChange={(event) => setDownscaleFactor(downscaleOptions[Number(event.target.value)] || 4)} />
                      <small>More downscaling lowers VRAM use and speeds every training step.</small>
                    </label>
                    <button type="button" className="advanced-reset" onClick={() => { setTargetFrames(400); setTrainSteps(15000); setDownscaleFactor(1) }}><RotateCcw size={13} /> Reset to Maximum</button>
                    {advancedSupported === false && <p className="advanced-worker-warning"><Info size={14} /> Advanced tuning is currently unavailable.</p>}
                  </div>
                )}
              </fieldset>
            )}
            <div className="processing-note">
              <Info size={17} />
              <p>
                {kind === 'walkthrough'
                  ? !buildModeSupported
                    ? supportedBuildModes === null
                      ? 'Checking available quality levels…'
                      : 'Could not check processing options. Close this dialog and try again.'
                    : 'Your capture will enter the processing queue. Find the result in My scans when it’s ready.'
                  : 'The file stays in this browser for this prototype and opens directly in the spatial viewer.'}
              </p>
            </div>
            {kind === 'walkthrough' && reconstructionApi.isConfigured && (
              <div className={`scan-access-card ${scanAccess?.allowed ? 'allowed' : scanAccess ? 'payment' : ''}`}>
                <BadgeDollarSign size={19} />
                <div>
                  <strong>{scanAccess?.reason === 'development' ? 'Development build — no charge' : scanAccess?.reason === 'free' ? 'Your free scan' : scanAccess?.reason === 'credit' ? 'Paid credit ready' : scanAccess ? `${formatMoney(scanAccess.priceCents, scanAccess.currency)} for this ${billingLabel} scan` : 'Checking scan allowance…'}</strong>
                  <p>{scanAccess?.allowed ? 'Your credit is deducted when your capture is successfully submitted.' : scanAccess ? 'Order a credit by EFT in Usage & billing. You can submit once payment is confirmed.' : accessError || 'Confirming your account and selected quality.'}</p>
                </div>
              </div>
            )}
            {scanAccess && !scanAccess.allowed ? (
              <button className="submit-capture purchase" disabled={purchasing || !scanAccess.billingAvailable} onClick={() => {
                window.location.assign('/app?view=billing')
              }}>
                Get credits by EFT
              </button>
            ) : (
              <button className="submit-capture" disabled={!name.trim() || submitting || (kind === 'walkthrough' && (!buildModeSupported || !advancedReady || !accessReady))} onClick={submit}>
              {submitting ? <><LoaderCircle size={18} className="spin" /> Adding scan…</> : kind === 'walkthrough' ? 'Submit scan' : 'Open in 3D viewer'}
            </button>
            )}
            {accessError && <div className="upload-error"><Info size={16} />{accessError}</div>}
          </div>
        )}
      </section>
    </div>
  )
}
