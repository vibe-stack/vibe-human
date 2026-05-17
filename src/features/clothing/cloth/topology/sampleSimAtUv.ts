import type { ClothGrid } from './types'

/**
 * Bilinearly sample the sim grid at a pattern-space UV. Used to drive the
 * high-res visual mesh from the coarse sim particles.
 *
 * `positions` is the solver's Float32Array (world-space).
 * Writes the result into `out` (length-3 array) and returns it.
 */
export function sampleSimAtUv(
  positions: Float32Array,
  grid: ClothGrid,
  u: number, v: number,
  out: Float32Array | [number, number, number],
) {
  const cols = grid.cols, rows = grid.rows
  const gx = clamp01(u) * (cols - 1)
  const gy = clamp01(v) * (rows - 1)
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const x1 = x0 + 1 < cols ? x0 + 1 : x0
  const y1 = y0 + 1 < rows ? y0 + 1 : y0
  const tx = gx - x0
  const ty = gy - y0

  // Indices
  const ia = (y0 * cols + x0) * 3
  const ib = (y0 * cols + x1) * 3
  const ic = (y1 * cols + x0) * 3
  const id = (y1 * cols + x1) * 3

  // Bilinear lerp on each component.
  const ax = positions[ia],     ay = positions[ia + 1], az = positions[ia + 2]
  const bx = positions[ib],     by = positions[ib + 1], bz = positions[ib + 2]
  const cx = positions[ic],     cy = positions[ic + 1], cz = positions[ic + 2]
  const dx = positions[id],     dy = positions[id + 1], dz = positions[id + 2]

  const topX = ax + (bx - ax) * tx
  const topY = ay + (by - ay) * tx
  const topZ = az + (bz - az) * tx
  const botX = cx + (dx - cx) * tx
  const botY = cy + (dy - cy) * tx
  const botZ = cz + (dz - cz) * tx

  out[0] = topX + (botX - topX) * ty
  out[1] = topY + (botY - topY) * ty
  out[2] = topZ + (botZ - topZ) * ty
  return out
}

function clamp01(v: number) { return v < 0 ? 0 : v > 1 ? 1 : v }
