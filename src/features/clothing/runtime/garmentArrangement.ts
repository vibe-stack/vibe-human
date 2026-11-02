import type { PatternDocument } from '../document/types'
import type { ClothSimMesh } from '../simulation/types'
import type { PanelMetadata } from './garmentLibrary'

// Garment arrangement: wraps flat pattern panels around the body before sewing.
//
// A front and a back depth map of the bind-pose skin are rasterised in the
// frontal plane, dilated (so panels clear protrusions such as the nose or
// chest) and gap-filled. Each panel row is then laid along the body's depth
// profile by *arc length*, so a panel arrives curved around the torso and limbs
// at nearly its flat size. Sewing then only has to close the side seams instead
// of dragging flat sheets half a metre across the body, which is what makes
// automatic attachment reliable on arbitrary characters.

const CELL = 0.008
const DILATE_RADIUS = 0.018
const LAYER_GAP = 0.016
const BASE_GAP = 0.014
const MIN_HALF_SEPARATION = 0.02

export type BodyDepthMaps = {
  minX: number
  minY: number
  cols: number
  rows: number
  centerZ: number
  front: Float32Array
  back: Float32Array
  /** Cumulative arc length along each row from the body midline (front / back). */
  frontArc: Float32Array
  backArc: Float32Array
  midCol: number
}

export function buildBodyDepthMaps(vertices: Float32Array, indices: Uint32Array, centerZ: number): BodyDepthMaps {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < vertices.length; i += 3) {
    minX = Math.min(minX, vertices[i]); maxX = Math.max(maxX, vertices[i])
    minY = Math.min(minY, vertices[i + 1]); maxY = Math.max(maxY, vertices[i + 1])
  }
  const margin = 0.4
  minX = Math.min(minX, -maxX) - margin
  maxX = Math.max(maxX, -minX) + margin
  minY -= 0.1
  maxY += 0.1
  const cols = Math.ceil((maxX - minX) / CELL) + 1
  const rows = Math.ceil((maxY - minY) / CELL) + 1
  const front = new Float32Array(cols * rows).fill(-Infinity)
  const back = new Float32Array(cols * rows).fill(Infinity)

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3
    const ax = vertices[a], ay = vertices[a + 1], az = vertices[a + 2]
    const bx = vertices[b], by = vertices[b + 1], bz = vertices[b + 2]
    const cx = vertices[c], cy = vertices[c + 1], cz = vertices[c + 2]
    // Splat vertices so edge-on triangles still mark the silhouette.
    splat(front, back, cols, rows, minX, minY, ax, ay, az)
    splat(front, back, cols, rows, minX, minY, bx, by, bz)
    splat(front, back, cols, rows, minX, minY, cx, cy, cz)
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(det) < 1e-12) continue
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / CELL))
    const c1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx, cx) - minX) / CELL))
    const r0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - minY) / CELL))
    const r1 = Math.min(rows - 1, Math.ceil((Math.max(ay, by, cy) - minY) / CELL))
    for (let r = r0; r <= r1; r += 1) {
      const py = minY + r * CELL
      for (let col = c0; col <= c1; col += 1) {
        const px = minX + col * CELL
        const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det
        const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det
        const w2 = 1 - w0 - w1
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue
        const z = w0 * az + w1 * bz + w2 * cz
        const cell = r * cols + col
        if (z > front[cell]) front[cell] = z
        if (z < back[cell]) back[cell] = z
      }
    }
  }

  const dilatedFront = dilate(front, cols, rows, Math.round(DILATE_RADIUS / CELL), 1)
  const dilatedBack = dilate(back, cols, rows, Math.round(DILATE_RADIUS / CELL), -1)
  fillEmpty(dilatedFront, cols, rows, centerZ)
  fillEmpty(dilatedBack, cols, rows, centerZ)
  smoothKeepingClearance(dilatedFront, cols, rows, 1)
  smoothKeepingClearance(dilatedBack, cols, rows, -1)
  for (let i = 0; i < dilatedFront.length; i += 1) {
    dilatedFront[i] = Math.max(dilatedFront[i], centerZ + MIN_HALF_SEPARATION)
    dilatedBack[i] = Math.min(dilatedBack[i], centerZ - MIN_HALF_SEPARATION)
  }

  const midCol = Math.round((0 - minX) / CELL)
  return {
    minX,
    minY,
    cols,
    rows,
    centerZ,
    front: dilatedFront,
    back: dilatedBack,
    frontArc: arcLengths(dilatedFront, cols, rows, midCol),
    backArc: arcLengths(dilatedBack, cols, rows, midCol),
    midCol,
  }
}

/**
 * Place every particle of the freshly compiled garment onto the depth maps.
 * Uses the particle's flat (pattern) position: x is mapped by arc length from
 * the midline, y is kept, z follows the body surface plus a layer gap.
 */
export function arrangeGarmentOnBody(mesh: ClothSimMesh, document: PatternDocument, maps: BodyDepthMaps) {
  const { positions, prevPositions, velocities, panelIds, particleCount } = mesh
  for (let particle = 0; particle < particleCount; particle += 1) {
    const panel = document.panels[panelIds[particle]]
    const meta = panel?.metadata as PanelMetadata | undefined
    if (!meta) continue
    const o = particle * 3
    const flatX = positions[o]
    const y = positions[o + 1]
    const row = clampInt(Math.round((y - maps.minY) / CELL), 0, maps.rows - 1)
    const front = meta.side === 'front'
    const arc = front ? maps.frontArc : maps.backArc
    const depth = front ? maps.front : maps.back
    const x = xForArcLength(arc, maps, row, flatX)
    const col = (x - maps.minX) / CELL
    const surface = sampleRow(depth, maps, row, col)
    const gap = BASE_GAP + meta.layer * LAYER_GAP
    positions[o] = x
    positions[o + 2] = front ? surface + gap : surface - gap
    prevPositions[o] = positions[o]
    prevPositions[o + 1] = positions[o + 1]
    prevPositions[o + 2] = positions[o + 2]
    velocities[o] = 0
    velocities[o + 1] = 0
    velocities[o + 2] = 0
  }
}

function splat(front: Float32Array, back: Float32Array, cols: number, rows: number, minX: number, minY: number, x: number, y: number, z: number) {
  const col = Math.round((x - minX) / CELL)
  const row = Math.round((y - minY) / CELL)
  if (col < 0 || row < 0 || col >= cols || row >= rows) return
  const cell = row * cols + col
  if (z > front[cell]) front[cell] = z
  if (z < back[cell]) back[cell] = z
}

/** Max (sign=1) / min (sign=-1) filter over a disc, ignoring empty cells. */
function dilate(source: Float32Array, cols: number, rows: number, radius: number, sign: 1 | -1) {
  const empty = sign > 0 ? -Infinity : Infinity
  const out = new Float32Array(source.length).fill(empty)
  const offsets: Array<[number, number]> = []
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) if (dx * dx + dy * dy <= radius * radius) offsets.push([dx, dy])
  }
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let best = empty
      for (const [dx, dy] of offsets) {
        const rr = r + dy, cc = c + dx
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue
        const value = source[rr * cols + cc]
        if (sign > 0 ? value > best : value < best) best = value
      }
      out[r * cols + c] = best
    }
  }
  return out
}

/** Fill empty cells with the nearest filled value along their row, else column, else centre. */
function fillEmpty(map: Float32Array, cols: number, rows: number, centerZ: number) {
  const isEmpty = (v: number) => !Number.isFinite(v)
  for (let r = 0; r < rows; r += 1) {
    let last = NaN
    const left = new Float32Array(cols)
    const leftDist = new Int32Array(cols)
    let dist = 0
    for (let c = 0; c < cols; c += 1) {
      const v = map[r * cols + c]
      if (!isEmpty(v)) { last = v; dist = 0 } else dist += 1
      left[c] = last
      leftDist[c] = Number.isNaN(last) ? 1 << 30 : dist
    }
    last = NaN
    dist = 0
    for (let c = cols - 1; c >= 0; c -= 1) {
      const v = map[r * cols + c]
      if (!isEmpty(v)) { last = v; dist = 0; continue }
      dist += 1
      const rightDist = Number.isNaN(last) ? 1 << 30 : dist
      if (leftDist[c] === 1 << 30 && rightDist === 1 << 30) continue
      map[r * cols + c] = leftDist[c] <= rightDist ? left[c] : last
    }
  }
  for (let c = 0; c < cols; c += 1) {
    let last = NaN
    for (let r = 0; r < rows; r += 1) {
      const v = map[r * cols + c]
      if (!isEmpty(v)) last = v
      else if (!Number.isNaN(last)) map[r * cols + c] = last
    }
    last = NaN
    for (let r = rows - 1; r >= 0; r -= 1) {
      const v = map[r * cols + c]
      if (!isEmpty(v)) last = v
      else if (!Number.isNaN(last)) map[r * cols + c] = last
    }
  }
  for (let i = 0; i < map.length; i += 1) if (isEmpty(map[i])) map[i] = centerZ
}

/** Box blur that never moves the surface closer to the body than before. */
function smoothKeepingClearance(map: Float32Array, cols: number, rows: number, sign: 1 | -1) {
  const original = map.slice()
  const scratch = new Float32Array(map.length)
  for (let pass = 0; pass < 3; pass += 1) {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        let sum = 0
        let count = 0
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const rr = r + dy, cc = c + dx
            if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue
            sum += map[rr * cols + cc]
            count += 1
          }
        }
        scratch[r * cols + c] = sum / count
      }
    }
    map.set(scratch)
  }
  for (let i = 0; i < map.length; i += 1) map[i] = sign > 0 ? Math.max(map[i], original[i]) : Math.min(map[i], original[i])
}

function arcLengths(map: Float32Array, cols: number, rows: number, midCol: number) {
  const arc = new Float32Array(map.length)
  for (let r = 0; r < rows; r += 1) {
    const base = r * cols
    arc[base + midCol] = 0
    for (let c = midCol + 1; c < cols; c += 1) {
      arc[base + c] = arc[base + c - 1] + Math.hypot(CELL, map[base + c] - map[base + c - 1])
    }
    for (let c = midCol - 1; c >= 0; c -= 1) {
      arc[base + c] = arc[base + c + 1] - Math.hypot(CELL, map[base + c] - map[base + c + 1])
    }
  }
  return arc
}

function xForArcLength(arc: Float32Array, maps: BodyDepthMaps, row: number, target: number) {
  const base = row * maps.cols
  const step = target >= 0 ? 1 : -1
  let c = maps.midCol
  while (c + step >= 0 && c + step < maps.cols) {
    const next = arc[base + c + step]
    if ((step > 0 && next >= target) || (step < 0 && next <= target)) {
      const current = arc[base + c]
      const t = next === current ? 0 : (target - current) / (next - current)
      return maps.minX + (c + step * t) * CELL
    }
    c += step
  }
  return maps.minX + c * CELL + (target - arc[base + c])
}

function sampleRow(map: Float32Array, maps: BodyDepthMaps, row: number, col: number) {
  const c0 = clampInt(Math.floor(col), 0, maps.cols - 1)
  const c1 = clampInt(c0 + 1, 0, maps.cols - 1)
  const t = Math.min(1, Math.max(0, col - c0))
  const base = row * maps.cols
  return map[base + c0] * (1 - t) + map[base + c1] * t
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
