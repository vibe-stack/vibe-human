import { useEffect } from 'react'
import { createDemoGarment } from './demo/createDemoGarment'
import { loadDemoGarment } from './state/clothingActions'
import ClothingThreeViewport from './components/ClothingThreeViewport'
import ClothingPatternEditor2D from './components/ClothingPatternEditor2D'

// ---------------------------------------------------------------------------
// ClothingWorkspace
// Occupies the central viewport area only (the far-right global settings
// sidebar is rendered by App.tsx and is untouched here).
//
// Layout: [3D viewport | 2D pattern editor]
// The 2D editor takes ~42% width so there's room for the 3D preview.
// ---------------------------------------------------------------------------

export default function ClothingWorkspace() {
  // Load the demo garment once on mount
  useEffect(() => {
    loadDemoGarment(createDemoGarment())
  }, [])

  return (
    <div style={{
      display: 'flex',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Left: 3D garment preview */}
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <ClothingThreeViewport />
      </div>

      {/* Divider */}
      <div style={{
        width: 1,
        background: 'rgba(255,255,255,0.08)',
        flexShrink: 0,
      }} />

      {/* Right: 2D pattern editor */}
      <div style={{
        width: '42%',
        minWidth: 420,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderLeft: '1px solid rgba(255,255,255,0.06)',
      }}>
        <ClothingPatternEditor2D />
      </div>
    </div>
  )
}
