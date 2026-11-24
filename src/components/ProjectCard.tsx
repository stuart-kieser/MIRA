import { Activity, Clock3, MoreHorizontal, Play, Rotate3D, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SpaceProject } from '../types'
import { SpaceArtwork } from './SpaceArtwork'

interface ProjectCardProps {
  project: SpaceProject
  onOpen: (project: SpaceProject) => void
  onDelete: (id: string) => void
  onViewMetrics: (project: SpaceProject) => void
}

const relativeDate = (date: string) => {
  const days = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(new Date(date))
}

export function ProjectCard({ project, onOpen, onDelete, onViewMetrics }: ProjectCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const isReady = project.status === 'ready'

  return (
    <article className="project-card">
      <button
        className="project-art-button"
        onClick={() => onOpen(project)}
        disabled={project.status === 'processing'}
        aria-label={`${isReady ? 'Open' : 'View'} ${project.name}`}
      >
        <SpaceArtwork
          palette={project.palette}
          processing={project.status === 'processing'}
        />
        {isReady && (
          <span className="explore-badge">
            <Rotate3D size={15} /> Explore
          </span>
        )}
        {project.status === 'processing' && (
          <div className="processing-overlay">
            <div className="processing-orbit"><i /><i /></div>
            <strong>{project.processingMode === 'remote' ? (project.progress < 20 ? 'Submitted' : 'Processing') : `${Math.round(project.progress)}%`}</strong>
          </div>
        )}
        {project.status === 'draft' && (
          <div className="draft-overlay">
            <Play size={18} fill="currentColor" />
            Re-import model
          </div>
        )}
        {project.status === 'failed' && (
          <div className="failed-overlay">
            <strong>Build failed</strong>
            <span>Try a different capture</span>
          </div>
        )}
      </button>

      <div className="project-info">
        <div>
          <h3>{project.name}</h3>
          <p>{project.location}</p>
        </div>
        <div className="card-menu" ref={menuRef}>
          <button
            className="icon-button subtle"
            aria-label="Project menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={20} />
          </button>
          {menuOpen && (
            <div className="popover-menu">
              <button onClick={() => onOpen(project)} disabled={!isReady}>
                <Rotate3D size={15} /> Open scan
              </button>
              <button className="danger" onClick={() => onDelete(project.id)}>
                <Trash2 size={15} /> Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {project.status === 'processing' ? (
        <div className="project-progress-block">
          <div className="project-progress-label">
            <span>{project.stage}</span>
            {project.processingMode !== 'remote' && <span>~{Math.max(2, Math.round((100 - project.progress) / 3))} min</span>}
          </div>
          <div className="progress-track"><i style={{ width: `${project.progress}%` }} /></div>
          {project.metrics && <button className="metrics-report-button live" onClick={() => onViewMetrics(project)}>
            <Activity size={13} /> View live metrics
          </button>}
        </div>
      ) : project.status === 'failed' ? (
        <div className="project-failed-block" title={project.errorMessage}>
          <span>{project.errorMessage || 'We could not finish processing this space.'}</span>
          {project.metrics && (
            <button className="metrics-report-button" onClick={() => onViewMetrics(project)}>
              <Activity size={13} /> Diagnostics
            </button>
          )}
        </div>
      ) : (
        <div className="project-meta">
          <span><Clock3 size={14} /> Updated {relativeDate(project.updatedAt)}</span>
          {project.metrics ? (
            <button className="metrics-report-button" onClick={() => onViewMetrics(project)}>
              <Activity size={13} /> Build report
            </button>
          ) : null}
        </div>
      )}
    </article>
  )
}
