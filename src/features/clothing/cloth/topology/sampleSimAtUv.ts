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

  const cA = y0 * cols + x0
  const cB = y0 * cols + x1
  const cC = y1 * cols + x0
  const cD = y1 * cols + x1
  const aOk = grid.active[cA]
  const bOk = grid.active[cB]
  const cOk = grid.active[cC]
  const dOk = grid.active[cD]

  // Fast path: all 4 active → ordinary bilinear lerp.
  if (aOk && bOk && cOk && dOk) {
    bilinear(positions, cA * 3, cB * 3, cC * 3, cD * 3, tx, ty, out)
    return out
  }

  // Mixed: weighted-average only the active corners. Weights are the
  // bilinear weights, but redistributed so they sum to 1 across the active
  // subset. If none are active (shouldn't happen for a vertex earcut emits)
  // we leave the previous out value.
  const wA = (1 - tx) * (1 - ty)
  const wB = tx * (1 - ty)
  const wC = (1 - tx) * ty
  const wD = tx * ty
  const wAe = aOk ? wA : 0
  const wBe = bOk ? wB : 0
  const wCe = cOk ? wC : 0
  const wDe = dOk ? wD : 0
  const wSum = wAe + wBe + wCe + wDe
  if (wSum < 1e-9) {
    // Last resort: pick whichever active corner exists.
    const fallback = aOk ? cA : bOk ? cB : cOk ? cC : dOk ? cD : -1
    if (fallback < 0) return out
    const o = fallback * 3
    out[0] = positions[o]; out[1] = positions[o + 1]; out[2] = positions[o + 2]
    return out
  }
  const inv = 1 / wSum
  const oA = cA * 3, oB = cB * 3, oC = cC * 3, oD = cD * 3
  out[0] = (positions[oA]     * wAe + positions[oB]     * wBe + positions[oC]     * wCe + positions[oD]     * wDe) * inv
  out[1] = (positions[oA + 1] * wAe + positions[oB + 1] * wBe + positions[oC + 1] * wCe + positions[oD + 1] * wDe) * inv
  out[2] = (positions[oA + 2] * wAe + positions[oB + 2] * wBe + positions[oC + 2] * wCe + positions[oD + 2] * wDe) * inv
  return out
}

function bilinear(
  p: Float32Array, ia: number, ib: number, ic: number, id: number,
  tx: number, ty: number, out: Float32Array | [number, number, number],
) {
  const ax = p[ia],     ay = p[ia + 1], az = p[ia + 2]
  const bx = p[ib],     by = p[ib + 1], bz = p[ib + 2]
  const cx = p[ic],     cy = p[ic + 1], cz = p[ic + 2]
  const dx = p[id],     dy = p[id + 1], dz = p[id + 2]
  const topX = ax + (bx - ax) * tx
  const topY = ay + (by - ay) * tx
  const topZ = az + (bz - az) * tx
  const botX = cx + (dx - cx) * tx
  const botY = cy + (dy - cy) * tx
  const botZ = cz + (dz - cz) * tx
  out[0] = topX + (botX - topX) * ty
  out[1] = topY + (botY - topY) * ty
  out[2] = topZ + (botZ - topZ) * ty
}

function clamp01(v: number) { return v < 0 ? 0 : v > 1 ? 1 : v }
