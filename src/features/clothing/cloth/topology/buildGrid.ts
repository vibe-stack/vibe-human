import type { PatternPiece } from '../../state/clothingTypes'
import type { BendConstraint, DistanceConstraint } from '../solver/types'
import type { ClothGrid } from './types'

/**
 * Build a regular grid of particles + PBD constraints from a pattern piece.
 * Everything is in cloth-local space (origin at center, y=0).
 */

const PATTERN_UNIT_SCALE = 0.004

type GridParams = {
  /** Target world-space spacing between particles (metres). */
  spacing: number
  /** Bend constraint stiffness compliance (higher = floppier). */
  bendCompliance: number
  /** Distance constraint compliance. */
  distanceCompliance: number
  /** Min/max particles per dimension. */
  minDim: number
  maxDim: number
}

export function buildGrid(piece: PatternPiece, params: GridParams): ClothGrid {
  const patternBounds = boundsOf(piece)
  const worldWidth = patternBounds.width * PATTERN_UNIT_SCALE
  const worldDepth = patternBounds.depth * PATTERN_UNIT_SCALE

  const cols = clampInt(
    Math.round(Math.max(worldWidth, 0.08) / params.spacing) + 1,
    params.minDim, params.maxDim,
  )
  const rows = clampInt(
    Math.round(Math.max(worldDepth, 0.08) / params.spacing) + 1,
    params.minDim, params.maxDim,
  )

  const spacingX = worldWidth / (cols - 1)
  const spacingZ = worldDepth / (rows - 1)

  const active = buildActiveMask(cols, rows, piece, patternBounds)

  const positions = new Float32Array(cols * rows * 3)
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = (r * cols + c) * 3
      const u = c / (cols - 1)
      const v = r / (rows - 1)
      positions[i]     = (u - 0.5) * worldWidth
      positions[i + 1] = 0
      positions[i + 2] = (v - 0.48) * worldDepth
    }
  }

  const distances: DistanceConstraint[] = []
  const bends: BendConstraint[] = []
  const diag = Math.hypot(spacingX, spacingZ)

  const idx = (c: number, r: number) => r * cols + c
  const has = (c: number, r: number) =>
    c >= 0 && c < cols && r >= 0 && r < rows && active[idx(c, r)]

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!has(c, r)) continue
      // Structural
      if (has(c + 1, r)) distances.push({ a: idx(c, r), b: idx(c + 1, r), rest: spacingX, compliance: params.distanceCompliance })
      if (has(c, r + 1)) distances.push({ a: idx(c, r), b: idx(c, r + 1), rest: spacingZ, compliance: params.distanceCompliance })
      // Shear
      if (has(c + 1, r + 1)) distances.push({ a: idx(c, r), b: idx(c + 1, r + 1), rest: diag, compliance: params.distanceCompliance * 1.4 })
      if (has(c + 1, r - 1)) distances.push({ a: idx(c, r), b: idx(c + 1, r - 1), rest: diag, compliance: params.distanceCompliance * 1.4 })
      // Bending (over-the-shoulder neighbour)
      if (has(c - 1, r) && has(c + 1, r)) {
        bends.push({ a: idx(c - 1, r), b: idx(c, r), c: idx(c + 1, r), rest: spacingX * 2, compliance: params.bendCompliance })
      }
      if (has(c, r - 1) && has(c, r + 1)) {
        bends.push({ a: idx(c, r - 1), b: idx(c, r), c: idx(c, r + 1), rest: spacingZ * 2, compliance: params.bendCompliance })
      }
    }
  }

  return {
    cols, rows,
    worldWidth, worldDepth,
    patternMinX: patternBounds.minX,
    patternMinY: patternBounds.minY,
    patternWidth: patternBounds.width,
    patternDepth: patternBounds.depth,
    spacingX, spacingZ,
    active,
    positions,
    distances,
    bends,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function boundsOf(piece: PatternPiece) {
  const points = Object.values(piece.points)
  if (!points.length) return { minX: -140, minY: -140, width: 280, depth: 280 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, width: maxX - minX || 1, depth: maxY - minY || 1 }
}

function buildActiveMask(
  cols: number, rows: number,
  piece: PatternPiece,
  bounds: { minX: number; minY: number; width: number; depth: number },
): boolean[] {
  const mask = new Array<boolean>(cols * rows).fill(true)
  if (!piece.closed) return mask
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const u = c / (cols - 1)
      const v = r / (rows - 1)
      const px = bounds.minX + u * bounds.width
      const py = bounds.minY + v * bounds.depth
      mask[r * cols + c] = pointInPiece({ x: px, y: py }, piece)
    }
  }
  return mask
}

function pointInPiece(pt: { x: number; y: number }, piece: PatternPiece): boolean {
  const outer = piece.edges.map((e) => piece.points[e.from]).filter(Boolean)
  if (outer.length < 3) return false
  if (!pointInPolygon(pt, outer as { x: number; y: number }[])) return false
  for (const holeEdges of piece.holes ?? []) {
    const hole = holeEdges.map((e) => piece.points[e.from]).filter(Boolean) as { x: number; y: number }[]
    if (hole.length >= 3 && pointInPolygon(pt, hole)) return false
  }
  return true
}

function pointInPolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    const intersect = (a.y > p.y) !== (b.y > p.y) &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    if (intersect) inside = !inside
  }
  return inside
}

function clampInt(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(v)))
}
