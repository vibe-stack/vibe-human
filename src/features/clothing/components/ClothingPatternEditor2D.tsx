import ClothingToolbar from './ClothingToolbar'
import MeasurementOverlay from './MeasurementOverlay'
import PatternCanvas from '../pixi/PatternCanvas'

// ---------------------------------------------------------------------------
// ClothingPatternEditor2D
// Vertical stack: toolbar at top (unless hideToolbar), Pixi canvas fills rest.
//
// On mobile the parent (App.tsx) renders ClothingToolbar separately as a
// sticky element above this component and passes hideToolbar={true} so there
// is no duplicate toolbar.
// ---------------------------------------------------------------------------

export default function ClothingPatternEditor2D({ hideToolbar }: { hideToolbar?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    }}>
      {!hideToolbar && <ClothingToolbar />}
      <div style={{
        flex: 1,
        minHeight: 0,
        position: 'relative',
      }}>
        <PatternCanvas />
        <MeasurementOverlay />
      </div>
    </div>
  )
}
