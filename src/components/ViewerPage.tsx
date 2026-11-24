import {
  ArrowLeft,
  Box,
  Camera,
  Check,
  CircleHelp,
  Download,
  Expand,
  Eye,
  Gauge,
  Home,
  Info,
  Link,
  LoaderCircle,
  Orbit,
  Pause,
  Play,
  Share2,
  X,
  ZoomIn,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SpaceProject } from '../types'
import { Brand } from './Brand'
import { SpatialCanvas, type ViewerControlMode } from './SpatialCanvas'

interface ViewerPageProps {
  project: SpaceProject
  onBack: () => void
}

export function ViewerPage({ project, onBack }: ViewerPageProps) {
  const [loadState, setLoadState] = useState({ loading: true, progress: 0, error: '' })
  const [focusSignal, setFocusSignal] = useState(0)
  const [autoOrbit, setAutoOrbit] = useState(false)
  const [controlMode, setControlMode] = useState<ViewerControlMode>('orbit')
  const [infoOpen, setInfoOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const handleLoadState = useCallback((state: { loading: boolean; progress: number; error?: string }) => {
    setLoadState({ loading: state.loading, progress: state.progress, error: state.error || '' })
  }, [])
  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas
  }, [])

  useEffect(() => {
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'r') setFocusSignal((value) => value + 1)
      if (event.key === 'Escape' && document.fullscreenElement) void document.exitFullscreen()
    }
    window.addEventListener('keydown', keyHandler)
    return () => window.removeEventListener('keydown', keyHandler)
  }, [])

  const share = async () => {
    const shareData = { title: `${project.name} · Mira`, text: `Explore ${project.name} in 3D`, url: window.location.href }
    if (navigator.share) {
      try { await navigator.share(shareData); return } catch { /* User cancelled. */ }
    }
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const captureFrame = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const anchor = document.createElement('a')
    anchor.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-view.png`
    anchor.href = canvas.toDataURL('image/png')
    anchor.click()
  }

  const downloadModel = () => {
    if (!project.modelUrl) return
    const anchor = document.createElement('a')
    anchor.download = project.modelFileName || `${project.name}.splat`
    anchor.href = project.modelUrl
    anchor.click()
  }

  const selectControlMode = (mode: ViewerControlMode) => {
    setControlMode(mode)
    setAutoOrbit(false)
  }

  const toggleTour = () => {
    if (!autoOrbit) setControlMode('orbit')
    setAutoOrbit((value) => !value)
  }

  return (
    <div className="viewer-page" ref={rootRef}>
      <SpatialCanvas
        project={project}
        focusSignal={focusSignal}
        autoOrbit={autoOrbit}
        controlMode={controlMode}
        onLoadState={handleLoadState}
        onCanvasReady={handleCanvasReady}
      />

      <header className="viewer-topbar">
        <div className="viewer-topbar-left">
          <button className="viewer-back" onClick={onBack} aria-label="Back to spaces"><ArrowLeft size={19} /></button>
          <Brand />
          <span className="viewer-divider" />
          <div className="viewer-title">
            <strong>{project.name}</strong>
            <span>{project.location}</span>
          </div>
        </div>
        <div className="viewer-topbar-right">
          <span className="quality-status"><i /> HIGH QUALITY</span>
          <button className="viewer-action" onClick={captureFrame}><Camera size={17} /><span>Snapshot</span></button>
          <button className="viewer-action" onClick={share}>
            {copied ? <Check size={17} /> : <Share2 size={17} />}
            <span>{copied ? 'Link copied' : 'Share'}</span>
          </button>
        </div>
      </header>

      <div className="viewer-toolrail">
        <button onClick={() => setFocusSignal((value) => value + 1)} title="Reset view (R)"><Home size={19} /></button>
        <button onClick={toggleTour} className={autoOrbit ? 'active' : ''} title="Auto orbit">
          {autoOrbit ? <Pause size={19} /> : <Orbit size={19} />}
        </button>
        <span />
        <button onClick={() => setFocusSignal((value) => value + 1)} title="Fit scene"><ZoomIn size={19} /></button>
        <button onClick={() => void rootRef.current?.requestFullscreen()} title="Fullscreen"><Expand size={19} /></button>
        <button onClick={() => setInfoOpen((value) => !value)} className={infoOpen ? 'active' : ''} title="Scene information"><Info size={19} /></button>
      </div>

      <div className="viewer-mode-switch">
        <button
          className={controlMode === 'orbit' && !autoOrbit ? 'active' : ''}
          aria-pressed={controlMode === 'orbit' && !autoOrbit}
          onClick={() => selectControlMode('orbit')}
        >
          <Orbit size={17} /> Orbit
        </button>
        <button
          className={controlMode === 'look' ? 'active' : ''}
          aria-pressed={controlMode === 'look'}
          onClick={() => selectControlMode('look')}
        >
          <Eye size={17} /> Look
        </button>
        <button className={autoOrbit ? 'active' : ''} aria-pressed={autoOrbit} onClick={toggleTour}>
          {autoOrbit ? <Pause size={16} /> : <Play size={16} />} Tour
        </button>
      </div>

      <div className="viewer-hint">
        <span><i className="mouse-icon" /> {controlMode === 'look' ? 'Drag to look' : 'Drag to orbit'}</span>
        <span><i className="scroll-icon" /> {controlMode === 'look' ? 'Scroll to move' : 'Scroll to zoom'}</span>
        <span><kbd>R</kbd> Reset view</span>
      </div>

      {loadState.loading && (
        <div className="viewer-loading">
          <div className="loading-mark"><LoaderCircle size={30} className="spin" /></div>
          <strong>Building your view</strong>
          <p>{project.modelUrl ? 'Loading Gaussian scene…' : 'Placing every captured detail…'}</p>
          <div className="viewer-load-track"><i style={{ width: `${loadState.progress}%` }} /></div>
          <small>{Math.round(loadState.progress)}%</small>
        </div>
      )}

      {loadState.error && (
        <div className="viewer-error">
          <span><CircleHelp size={20} /></span>
          <div><strong>This splat did not load</strong><p>{loadState.error}</p></div>
          <button onClick={onBack}>Choose another file</button>
        </div>
      )}

      {infoOpen && (
        <aside className="scene-info-panel">
          <div className="scene-info-title"><div><span>SCENE DETAILS</span><h2>{project.name}</h2></div><button onClick={() => setInfoOpen(false)}><X size={19} /></button></div>
          <div className="scene-preview"><Box size={38} /><span>Gaussian scene</span></div>
          <div className="scene-stats">
            <div><span><Eye size={16} /> Splats</span><strong>{project.splatCount || 'Preview'}</strong></div>
            <div><span><Gauge size={16} /> Build time</span><strong>{project.processingMinutes ? `${project.processingMinutes} min` : 'Imported'}</strong></div>
          </div>
          <div className="scene-file-block">
            <span>SOURCE</span>
            <p>{project.modelFileName || project.videoFileName || 'Mira sample capture'}</p>
            <small>{project.modelFormat ? project.modelFormat.toUpperCase() : 'GAUSSIAN SPLAT · WEB OPTIMIZED'}</small>
          </div>
          <div className="scene-panel-actions">
            <button onClick={share}><Link size={16} /> Copy viewing link</button>
            {project.modelUrl && <button onClick={downloadModel}><Download size={16} /> Download source model</button>}
          </div>
        </aside>
      )}
    </div>
  )
}
