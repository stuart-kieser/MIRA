import { ArrowRight, Box, Building2, Lightbulb, Trees } from 'lucide-react'
import { SplatArtwork } from './SplatArtwork'

interface CaptureGuideProps {
  onStart: () => void
}

const subjects = [
  {
    icon: Box,
    title: 'Objects',
    copy: 'Keep the object still and walk around it. Make a second pass from higher up to capture the top and any details hidden in the first pass.',
  },
  {
    icon: Trees,
    title: 'Outdoor scenes',
    copy: 'Pick a bounded subject such as a garden, sculpture, or building exterior. Move along overlapping paths and work in even light when you can.',
  },
  {
    icon: Building2,
    title: 'Interiors',
    copy: 'Walk slowly around each area. If you cover several rooms, keep recording as you pass through a doorway so the views connect.',
  },
]

export function CaptureGuide({ onStart }: CaptureGuideProps) {
  return (
    <main className="main-content guide-page">
      <header className="page-header guide-header">
        <div>
          <span className="page-kicker">CAPTURE GUIDE</span>
          <h1>How to capture for 3D reconstruction</h1>
          <p>Record an object, an outdoor scene, or an interior with your phone.</p>
        </div>
        <button className="primary-button" onClick={onStart}>Start a capture <ArrowRight size={17} /></button>
      </header>

      <section className="guide-hero">
        <SplatArtwork className="guide-artwork" />
        <div className="guide-intro-copy">
          <h2>Move slowly and keep views overlapping.</h2>
          <p>Use the main rear camera at 1× and hold it steady. Keep recognizable features in view as you move, so Mira can match those details from one frame to the next.</p>
          <div className="guide-callout"><Lightbulb size={20} /><p><strong>Choose a still subject</strong> Avoid movement, glare, and abrupt changes in lighting.</p></div>
        </div>
      </section>

      <section className="guide-steps" aria-label="Capture tips by subject">
        {subjects.map(({ icon: Icon, title, copy }) => (
          <article key={title}>
            <div className="step-icon"><Icon size={22} /></div>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </section>

      <section className="guide-footer-card">
        <div><h2>Already have a video?</h2><p>Upload it and pick the reconstruction quality.</p></div>
        <button className="dark-button" onClick={onStart}>Choose video <ArrowRight size={17} /></button>
      </section>
    </main>
  )
}
