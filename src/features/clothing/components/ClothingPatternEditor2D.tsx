import { useEffect, useState } from 'react'
import ClothingToolbar from './ClothingToolbar'
import PatternCanvas from '../pixi/PatternCanvas'

// ---------------------------------------------------------------------------
// ClothingPatternEditor2D
// Vertical stack: toolbar at top, Pixi canvas fills remaining space.
// ---------------------------------------------------------------------------

export default function ClothingPatternEditor2D() {
  const [isMobileViewport, setIsMobileViewport] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px), (pointer: coarse)')
    const update = () => setIsMobileViewport(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    }}>
      <ClothingToolbar />
      <div style={{
        flex: isMobileViewport ? '0 0 70%' : 1,
        minHeight: 0,
        height: isMobileViewport ? '70%' : undefined,
        position: 'relative',
      }}>
        <PatternCanvas />
      </div>
    </div>
  )
}
