import ClothingToolbar from './ClothingToolbar'
import PatternCanvas from '../pixi/PatternCanvas'

// ---------------------------------------------------------------------------
// ClothingPatternEditor2D
// Vertical stack: toolbar at top, Pixi canvas fills remaining space.
// ---------------------------------------------------------------------------

export default function ClothingPatternEditor2D() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    }}>
      <ClothingToolbar />
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <PatternCanvas />
      </div>
    </div>
  )
}
