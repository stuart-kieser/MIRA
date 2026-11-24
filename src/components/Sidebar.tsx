import {
  Aperture,
  CircleHelp,
  BadgeDollarSign,
  LayoutGrid,
  Plus,
  Settings,
  LogOut,
  Users,
} from 'lucide-react'
import type { AppView } from '../types'
import { Brand } from './Brand'

interface SidebarProps {
  activeView: AppView
  processingCount: number
  userName: string
  userEmail: string
  onNavigate: (view: AppView) => void
  onNewCapture: () => void
  onSignOut: () => void
}

const navItems = [
  { id: 'spaces' as const, label: 'My scans', icon: LayoutGrid },
  { id: 'captures' as const, label: 'How to capture', icon: Aperture },
  { id: 'shared' as const, label: 'Shared with me', icon: Users },
  { id: 'billing' as const, label: 'Usage & billing', icon: BadgeDollarSign },
]

export function Sidebar({
  activeView,
  processingCount,
  userName,
  userEmail,
  onNavigate,
  onNewCapture,
  onSignOut,
}: SidebarProps) {
  const initials = userName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  return (
    <aside className="sidebar">
      <div className="sidebar-brand-row">
        <Brand />
        <span className="beta-pill">BETA</span>
      </div>

      <button className="new-capture-button" onClick={onNewCapture}>
        <Plus size={18} strokeWidth={2.4} />
        New capture
      </button>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <p className="nav-eyebrow">Workspace</p>
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`nav-item ${activeView === id ? 'active' : ''}`}
            onClick={() => onNavigate(id)}
          >
            <Icon size={19} />
            <span>{label}</span>
            {id === 'spaces' && processingCount > 0 && (
              <span className="nav-count">{processingCount}</span>
            )}
          </button>
        ))}
        <button
          className={`nav-item mobile-settings-nav ${activeView === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <Settings size={19} />
          <span>Settings</span>
        </button>
      </nav>

      <div className="sidebar-spacer" />

      <div className="storage-card">
        <div className="storage-icon"><BadgeDollarSign size={18} /></div>
        <div>
          <p>Pay only per generated scan</p>
          <div className="storage-track"><i style={{ width: '20%' }} /></div>
          <button onClick={() => onNavigate('billing')}>Buy scan tokens</button>
        </div>
      </div>

      <nav className="sidebar-nav sidebar-nav-bottom" aria-label="Support navigation">
        <button
          className={`nav-item ${activeView === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <Settings size={19} />
          <span>Settings</span>
        </button>
        <a className="nav-item" href="mailto:hello@mira.space">
          <CircleHelp size={19} />
          <span>Help & feedback</span>
        </a>
      </nav>

      <div className="profile-row">
        <div className="profile-avatar">{initials || 'M'}</div>
        <div>
          <strong>{userName}</strong>
          <span>{userEmail}</span>
        </div>
        <button className="profile-signout" onClick={onSignOut} aria-label="Sign out" title="Sign out"><LogOut size={15} /></button>
      </div>
    </aside>
  )
}
