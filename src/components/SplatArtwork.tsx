import { useEffect, useRef } from 'react'

const width = 900
const height = 620
const radius = 196
const heroRadius = 292
const turn = 2 * Math.PI
const tilt = Math.PI / 9
const rotationSpeed = turn / 70_000

const globePoints = Array.from({ length: 27 }, (_, row) => {
  const latitude = -Math.PI / 2 + (row + 1) * Math.PI / 28
  const ringRadius = Math.cos(latitude)
  const count = Math.round(92 * ringRadius)
  return Array.from({ length: count }, (_, column) => {
    const longitude = (column + (row % 2) / 2) * turn / count
    return {
      x: Math.cos(longitude) * ringRadius,
      y: Math.sin(latitude),
      z: Math.sin(longitude) * ringRadius,
      // Vary the density of brighter points so the globe's rotation is visible.
      highlight: Math.cos(longitude * 3 + latitude * 2) * Math.cos(longitude - latitude * 3) > 0.22,
    }
  })
}).flat()

function drawGlobe(context: CanvasRenderingContext2D, rotation: number, globeRadius: number) {
  const sine = Math.sin(rotation)
  const cosine = Math.cos(rotation)
  const tiltSine = Math.sin(tilt)
  const tiltCosine = Math.cos(tilt)
  context.clearRect(0, 0, width, height)

  for (const back of [true, false]) {
    for (const point of globePoints) {
      const rotatedX = point.x * cosine - point.z * sine
      const depth = point.x * sine + point.z * cosine
      if ((depth < 0) !== back) continue

      const perspective = 1 / (1 - depth * 0.17)
      const x = width / 2 + (rotatedX * tiltCosine - point.y * tiltSine) * globeRadius * perspective
      const y = height / 2 - (rotatedX * tiltSine + point.y * tiltCosine) * globeRadius * perspective
      context.globalAlpha = back ? 0.09 : 0.27 + depth * (point.highlight ? 0.47 : 0.23)
      context.fillStyle = point.highlight ? '#a4ceff' : '#6297d4'
      context.beginPath()
      context.arc(x, y, (point.highlight ? 1.85 : 1.35) * 0.9 * perspective, 0, turn)
      context.fill()
    }
  }
  context.globalAlpha = 1
}

export function SplatArtwork({ className = '', animate = false }: { className?: string; animate?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return

    let angle = 1.1
    const globeRadius = animate ? heroRadius : radius
    const resizeCanvas = () => {
      const bounds = element.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const pixelWidth = Math.max(1, Math.round(bounds.width * pixelRatio))
      const pixelHeight = Math.max(1, Math.round(bounds.height * pixelRatio))
      if (element.width !== pixelWidth) element.width = pixelWidth
      if (element.height !== pixelHeight) element.height = pixelHeight
      context.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0)
      drawGlobe(context, angle, globeRadius)
    }
    resizeCanvas()
    const resizeObserver = new ResizeObserver(resizeCanvas)
    resizeObserver.observe(element)
    window.addEventListener('resize', resizeCanvas)
    const stopResizing = () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', resizeCanvas)
    }
    if (!animate) return stopResizing

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let visible = false
    let frame = 0
    let lastDraw: number | undefined

    const tick = (time: number) => {
      if (lastDraw === undefined || time - lastDraw >= 32) {
        angle = (angle + Math.min(time - (lastDraw ?? time), 100) * rotationSpeed) % turn
        drawGlobe(context, angle, globeRadius)
        lastDraw = time
      }
      frame = window.requestAnimationFrame(tick)
    }

    const updateAnimation = () => {
      window.cancelAnimationFrame(frame)
      lastDraw = undefined
      if (visible && !reducedMotion.matches && !document.hidden) {
        frame = window.requestAnimationFrame(tick)
      }
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      updateAnimation()
    })
    observer.observe(element)
    reducedMotion.addEventListener('change', updateAnimation)
    document.addEventListener('visibilitychange', updateAnimation)
    return () => {
      stopResizing()
      observer.disconnect()
      reducedMotion.removeEventListener('change', updateAnimation)
      document.removeEventListener('visibilitychange', updateAnimation)
      window.cancelAnimationFrame(frame)
    }
  }, [animate])

  return (
    <div className={`splat-artwork ${className}`} aria-hidden="true">
      <canvas ref={canvas} width={width} height={height} />
    </div>
  )
}
