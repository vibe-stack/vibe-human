import { useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { clothingStore } from '../state/clothingStore'
import { evaluateEdgeAt } from '../geometry/patternSampling'
import { sampleEdge } from '../geometry/patternSampling'
import type { PatternEdge, PatternPiece, Vec2 } from '../state/clothingTypes'

// ---------------------------------------------------------------------------
// MeasurementOverlay
// Shows the length of the currently selected edge as an HTML label floating
// over the Pixi canvas.  Only visible when an edge is actively selected so the
// canvas stays clean at all other times.
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

/** True geometric midpoint of an edge at t=0.5. */
function edgeMidWorld(piece: PatternPiece, edge: PatternEdge): Vec2 {
  return evaluateEdgeAt(piece, edge, 0.5)
}

/** Outward normal at the edge midpoint (t=0.5), derived from the tangent there. */
function edgeMidNormal(piece: PatternPiece, edge: PatternEdge): Vec2 {
  // Finite-difference tangent at t=0.5
  const a = evaluateEdgeAt(piece, edge, 0.48)
  const b = evaluateEdgeAt(piece, edge, 0.52)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  // Rotate 90° CCW (for CCW-wound outlines this is outward; fine for labels)
  return { x: -dy / len, y: dx / len }
}

export default function MeasurementOverlay() {
  const { garment, viewport2D } = useSnapshot(clothingStore)
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

  // Only show when an edge is selected
  const { selectedPatternId, selectedEdgeId } = garment
  if (!selectedPatternId || !selectedEdgeId) return null

  const piece = garment.patterns[selectedPatternId]
  const edge = piece?.edges.find((e) => e.id === selectedEdgeId)
  if (!piece || !edge) return null

  const { panX, panY, zoom } = viewport2D
  const { w, h } = viewSize

  const len = edgeLengthCm(piece, edge)
  const mid = edgeMidWorld(piece, edge)
  const norm = edgeMidNormal(piece, edge)
  const screen = worldToScreen(mid, panX, panY, zoom, w, h)

  // Offset the label outward perpendicular to the edge
  const offsetPx = 18
  const lx = screen.x + norm.x * offsetPx
  const ly = screen.y + norm.y * offsetPx

  if (lx < -80 || lx > w + 80 || ly < -40 || ly > h + 40) return null

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}
    >
      <span
        style={{
          position: 'absolute',
          left: lx,
          top: ly,
          transform: 'translate(-50%, -50%)',
          fontSize: 11,
          fontFamily: "'Courier New', monospace",
          fontWeight: 700,
          letterSpacing: '0.04em',
          color: 'rgba(255,220,80,0.95)',
          textShadow: '0 1px 4px rgba(0,0,0,0.95)',
          whiteSpace: 'nowrap',
          userSelect: 'none',
          background: 'rgba(0,0,0,0.45)',
          padding: '1px 5px',
          borderRadius: 3,
        }}
      >
        {len.toFixed(1)} cm
      </span>
    </div>
  )
}
