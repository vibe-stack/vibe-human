// TODO: earcut is the recommended library for robust polygon triangulation.
// It is already installed as a transitive dep.  Import and use it below.
import earcut from 'earcut'
import type { PatternPiece, Vec2 } from '../state/clothingTypes'
import { samplePatternOutline } from './patternSampling'

export type TriangulationResult = {
  vertices: Vec2[]
  indices: number[]
}

/**
 * Triangulate a closed PatternPiece outline using earcut.
 * Assumes a simple, non-self-intersecting closed polygon.
 */
export function triangulatePattern(piece: PatternPiece): TriangulationResult {
  const outline = samplePatternOutline(piece, 12)

  if (outline.length < 3) {
    return { vertices: outline, indices: [] }
  }

  // earcut expects a flat [x0,y0, x1,y1, ...] array
  const flat: number[] = []
  for (const pt of outline) {
    flat.push(pt.x, pt.y)
  }

  const rawIndices = earcut(flat, undefined, 2)
  return { vertices: outline, indices: Array.from(rawIndices) }
}
