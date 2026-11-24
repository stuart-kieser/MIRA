import { ArrowRight, Box, Building2, Check, ScanLine, ShieldCheck, Trees, UploadCloud } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Brand } from './Brand'
import { SplatArtwork } from './SplatArtwork'

export function LandingPage() {
  return (
    <div className="marketing-page">
      <nav className="marketing-nav">
        <Link to="/" aria-label="Mira home"><Brand /></Link>
        <div className="marketing-nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#pricing">Pricing</a>
          <Link to="/login">Sign in</Link>
          <Link className="marketing-cta" to="/register">Create your free scan</Link>
        </div>
      </nav>

      <main>
        <section className="marketing-hero">
          <div className="marketing-hero-copy">
            <span className="marketing-eyebrow">3D digital reconstruction</span>
            <h1>Reconstruct the real world in 3D.</h1>
            <p>Record with your phone and Mira turns the footage into a digital 3D scene you can explore in your browser.</p>
            <ul className="capture-subjects" aria-label="What you can capture">
              <li><Box size={17} /> Objects</li>
              <li><Trees size={17} /> Outdoor scenes</li>
              <li><Building2 size={17} /> Interiors</li>
            </ul>
            <div className="marketing-actions">
              <Link className="marketing-primary" to="/register">Create your first scan free <ArrowRight size={17} /></Link>
              <a className="marketing-secondary" href="#how-it-works">See how capture works</a>
            </div>
            <div className="marketing-proof"><span><Check size={14} /> No specialist camera</span><span><Check size={14} /> First scan free</span><span><Check size={14} /> Private by default</span></div>
          </div>
          <SplatArtwork className="marketing-scene" animate />
        </section>

        <section className="marketing-steps" id="how-it-works">
          <h2>From phone video to 3D</h2>
          <div className="step-grid">
            <article><span><UploadCloud size={22} /></span><h3>Record from several angles</h3><p>Circle an object or move through a scene. Keep nearby features in view as you move.</p></article>
            <article><span><ScanLine size={22} /></span><h3>Mira reconstructs it</h3><p>Mira aligns the camera views and builds a 3D scene with Gaussian splatting.</p></article>
            <article><span><ShieldCheck size={22} /></span><h3>Explore in your browser</h3><p>Open the finished scan from your private library and inspect it from new angles.</p></article>
          </div>
        </section>

        <section className="marketing-pricing" id="pricing">
          <div><span className="section-label">SIMPLE PAY-PER-SCAN</span><h2>Your first scene is on us.</h2><p>After your free reconstruction, pay only when you build. Higher qualities use more frames and training time, so their price increases with detail.</p></div>
          <div className="pricing-card"><strong>1</strong><span>free generated scan</span><p>All five quality choices are available. See the exact price before uploading every later scan.</p><Link to="/register">Start free <ArrowRight size={16} /></Link></div>
        </section>
      </main>
      <footer className="marketing-footer"><Brand /><span>3D reconstruction from everyday video.</span><p>© {new Date().getFullYear()} Mira</p></footer>
    </div>
  )
}
