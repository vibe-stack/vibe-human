import type { BendConstraint, DistanceConstraint } from '../solver/types'

/** A regular grid sampling of a pattern piece, masked to the piece's
 *  inside (outer outline minus holes). */
export type ClothGrid = {
  cols: number
  rows: number
  /** Width and depth in WORLD units (metres). */
  worldWidth: number
  worldDepth: number
  /** Pattern-space bounding box minimums + extents (for UV mapping). */
  patternMinX: number
  patternMinY: number
  patternWidth: number
  patternDepth: number
  /** Spacing in world units. */
  spacingX: number
  spacingZ: number
  /** active[row*cols + col] === true iff that cell is inside the piece. */
  active: boolean[]
  /** Initial particle positions (cloth local frame, y=0 plane). */
  positions: Float32Array
  /** Distance + bending constraints to feed to the solver. */
  distances: DistanceConstraint[]
  bends: BendConstraint[]
}
