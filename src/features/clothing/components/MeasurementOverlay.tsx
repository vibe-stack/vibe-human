import { useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { clothingStore } from '../state/clothingStore'
import { sampleEdge } from '../geometry/patternSampling'
import type { PatternEdge, PatternPiece, Vec2 } from '../state/clothingTypes'

// ---------------------------------------------------------------------------
// MeasurementOverlay
// Absolutely positioned over the Pixi canvas; renders edge-length labels and
// the piece perimeter for selected pieces.  Uses the same camera math as the
// Pixi world container so labels stay locked to their edges.
// ---------------------------------------------------------------------------

function worldToScreen(world: Vec2, panX: number, panY: number, zoom: number, viewW: number, viewH: number): Vec2 {
  return {
    x: (world.x - panX) * zoom + viewW / 2,
    y: (world.y - panY) * zoom + viewH / 2,
  }
}

/** Arc-length of an edge by sampling (mm → cm). */
function edgeLengthCm(piece: PatternPiece, edge: PatternEdge): number {
  const pts = sampleEdge(piece, edge, 24)
  const toPt = piece.points[edge.to]
  if (toPt) pts.push({ x: toPt.x, y: toPt.y })
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x
    const dy = pts[i].y - pts[i - 1].y
    len += Math.hypot(dx, dy)
  }
  return len / 10 // mm → cm
}

/** Midpoint of an edge (for label placement). */
function edgeMidWorld(piece: PatternPiece, edge: PatternEdge): Vec2 {
  const pts = sampleEdge(piece, edge, 12)
  const toPt = piece.points[edge.to]
  if (toPt) pts.push({ x: toPt.x, y: toPt.y })
  const mid = Math.floor(pts.length / 2)
  return pts[mid] ?? { x: 0, y: 0 }
}

/** Outward normal direction at the midpoint (offset labels away from the fill). */
function edgeMidNormal(piece: PatternPiece, edge: PatternEdge): Vec2 {
  const from = piece.points[edge.from]
  const to = piece.points[edge.to]
  if (!from || !to) return { x: 0, y: -1 }
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  // Rotate 90° outward (we'll use the perpendicular, caller offsets label)
  return { x: -dy / len, y: dx / len }
}

export default function MeasurementOverlay() {
  const { garment, viewport2D, selectedPatternIds, activeClothingTool } = useSnapshot(clothingStore)
  const containerRef = useRef<HTMLDivElement>(null)
  const [viewSize, setViewSize] = useState({ w: 800, h: 600 })

  useEffect(() => {
    const el = containerRef.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setViewSize({ w: width, h: height })
    })
    ro.observe(el)
    setViewSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Show measurements when in edit-points mode OR when a piece is selected
  const showMeasurements =
    activeClothingTool === 'edit-points' ||
    activeClothingTool === 'select'

  if (!showMeasurements) return null

  const selIds = new Set<string>(
    selectedPatternIds.length
      ? [...selectedPatternIds]
      : garment.selectedPatternId
        ? [garment.selectedPatternId]
        : [],
  )
  if (selIds.size === 0) return null

  const { panX, panY, zoom } = viewport2D
  const { w, h } = viewSize

  const labels: Array<{ key: string; x: number; y: number; text: string; dim: boolean }> = []

  for (const pid of selIds) {
    const piece = garment.patterns[pid]
    if (!piece) continue

    let perimeter = 0
    for (const edge of piece.edges) {
      const len = edgeLengthCm(piece, edge)
      perimeter += len

      const mid = edgeMidWorld(piece, edge)
      const norm = edgeMidNormal(piece, edge)
      const screen = worldToScreen(mid, panX, panY, zoom, w, h)

      // Small offset in normal direction in screen space
      const offsetPx = 14
      const sx = screen.x + norm.x * offsetPx
      const sy = screen.y + norm.y * offsetPx

      // Skip labels that are way off screen
      if (sx < -60 || sx > w + 60 || sy < -60 || sy > h + 60) continue

      labels.push({
        key: `${pid}-${edge.id}`,
        x: sx,
        y: sy,
        text: `${len.toFixed(1)} cm`,
        dim: false,
      })
    }

    // Perimeter label: centre of bounding box
    const pts = Object.values(piece.points)
    if (pts.length > 0) {
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
      const sc = worldToScreen({ x: cx, y: cy }, panX, panY, zoom, w, h)
      if (sc.x >= -60 && sc.x <= w + 60 && sc.y >= -60 && sc.y <= h + 60) {
        labels.push({
          key: `${pid}-perimeter`,
          x: sc.x,
          y: sc.y,
          text: `⊙ ${perimeter.toFixed(1)} cm`,
          dim: true,
        })
      }
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {labels.map((l) => (
        <span
          key={l.key}
          style={{
            position: 'absolute',
            left: l.x,
            top: l.y,
            transform: 'translate(-50%, -50%)',
            fontSize: 10,
            fontFamily: "'Courier New', monospace",
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: l.dim ? 'rgba(255,255,255,0.35)' : 'rgba(255,220,80,0.92)',
            textShadow: '0 1px 3px rgba(0,0,0,0.9)',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}
        >
          {l.text}
        </span>
      ))}
    </div>
  )
}
