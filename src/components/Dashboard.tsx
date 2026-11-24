import { ArrowDownAZ, ChevronDown, Plus, Search, Sparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { SpaceProject } from '../types'
import { ProjectCard } from './ProjectCard'
import { SplatArtwork } from './SplatArtwork'

interface DashboardProps {
  projects: SpaceProject[]
  userName: string
  onNewCapture: () => void
  onOpenProject: (project: SpaceProject) => void
  onDeleteProject: (id: string) => void
  onViewMetrics: (project: SpaceProject) => void
}

export function Dashboard({
  projects,
  userName,
  onNewCapture,
  onOpenProject,
  onDeleteProject,
  onViewMetrics,
}: DashboardProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'name'>('recent')

  const visibleProjects = useMemo(() => {
    const filtered = projects.filter((project) =>
      `${project.name} ${project.location}`.toLowerCase().includes(query.toLowerCase()),
    )
    return [...filtered].sort((a, b) =>
      sort === 'recent'
        ? new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        : a.name.localeCompare(b.name),
    )
  }, [projects, query, sort])

  const processingCount = projects.filter((project) => project.status === 'processing').length

  return (
    <main className="main-content">
      <header className="page-header">
        <div>
          <span className="page-kicker">3D RECONSTRUCTION</span>
          <h1>Welcome, {userName.split(' ')[0] || 'there'}.</h1>
        </div>
        <button className="primary-button desktop-new-button" onClick={onNewCapture}>
          <Plus size={18} /> New capture
        </button>
      </header>

      <section className="welcome-card">
        <div className="welcome-copy">
          <h2>Capture an object or a scene in 3D.</h2>
          <p>Film a sculpture, a garden, or a room. Open the finished scan in your browser and explore it from new angles.</p>
          <div className="welcome-actions">
            <button className="dark-button" onClick={onNewCapture}>
              Start a new scan <span>→</span>
            </button>
            <button className="text-button" onClick={() => document.getElementById('spaces-grid')?.scrollIntoView({ behavior: 'smooth' })}>
              View your scans
            </button>
          </div>
        </div>
        <SplatArtwork className="welcome-visual" />
      </section>

      <section className="library-section" id="spaces-grid">
        <div className="section-heading-row">
          <div>
            <h2>Your scans</h2>
            <p>
              {projects.length} {projects.length === 1 ? 'scan' : 'scans'}
              {processingCount > 0 && ` · ${processingCount} processing`}
            </p>
          </div>
          <div className="library-controls">
            <label className="search-control">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search scans"
                aria-label="Search scans"
              />
              {query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={15} /></button>}
            </label>
            <label className="sort-control">
              <ArrowDownAZ size={16} />
              <select value={sort} onChange={(event) => setSort(event.target.value as 'recent' | 'name')}>
                <option value="recent">Last updated</option>
                <option value="name">Name</option>
              </select>
              <ChevronDown size={14} />
            </label>
          </div>
        </div>

        {visibleProjects.length > 0 ? (
          <div className="project-grid">
            {visibleProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={onOpenProject}
                onDelete={onDeleteProject}
                onViewMetrics={onViewMetrics}
              />
            ))}
            <button className="add-space-card" onClick={onNewCapture}>
              <span><Plus size={25} /></span>
              <strong>Add a scan</strong>
              <p>Upload a phone video or a finished splat.</p>
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="first-space-empty">
            <span><Sparkles size={24} /></span>
            <h3>Your first scan starts with a phone video</h3>
            <p>Your account includes one free generated scan. Upload a steady phone video when you are ready.</p>
            <button className="dark-button" onClick={onNewCapture}><Plus size={16} /> Create your first scan</button>
          </div>
        ) : (
          <div className="empty-search">
            <Search size={27} />
            <h3>No scans found</h3>
            <p>Try a different name or location.</p>
            <button className="text-button" onClick={() => setQuery('')}>Clear search</button>
          </div>
        )}
      </section>
    </main>
  )
}
