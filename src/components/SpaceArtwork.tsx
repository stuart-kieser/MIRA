import { Box } from 'lucide-react'
import type { ProjectPalette } from '../types'

interface SpaceArtworkProps {
  palette: ProjectPalette
  processing?: boolean
}

const dots = [
  [11, 68, 3], [17, 44, 2], [22, 62, 2], [27, 34, 3], [31, 72, 2],
  [35, 48, 4], [39, 28, 2], [43, 61, 2], [48, 41, 3], [52, 70, 2],
  [56, 24, 3], [61, 52, 4], [65, 33, 2], [69, 66, 3], [73, 42, 2],
  [78, 25, 2], [82, 58, 4], [87, 37, 2], [91, 69, 2], [58, 78, 2],
]

export function SpaceArtwork({
  palette,
  processing = false,
}: SpaceArtworkProps) {
  return (
    <div className={`space-artwork palette-${palette}`} aria-hidden="true">
      <Box className="art-volume" size={76} strokeWidth={1.05} />
      <div className="art-dots">
        {dots.map(([left, top, size], index) => (
          <i
            key={index}
            style={{ left: `${left}%`, top: `${top}%`, width: size, height: size }}
          />
        ))}
      </div>
      {processing && <div className="art-scanline" />}
    </div>
  )
}
