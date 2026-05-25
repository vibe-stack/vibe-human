import * as THREE from 'three'
import type { GeneratedStrand, HairMaterialSettings, Vec3Tuple } from './types'

export type HairCardMesh = {
  geometry: THREE.BufferGeometry
  atlas: THREE.CanvasTexture
  atlasCanvas: HTMLCanvasElement
  cardCount: number
}

type RuntimeStrand = {
  source: GeneratedStrand
  points: THREE.Vector3[]
  root: THREE.Vector3
  tip: THREE.Vector3
  length: number
  weight: number
  u: number
  v: number
}

type RootFrame = {
  center: THREE.Vector3
  uAxis: THREE.Vector3
  vAxis: THREE.Vector3
  nAxis: THREE.Vector3
  minU: number
  maxU: number
  minV: number
  maxV: number
}

type CardRing = {
  center: THREE.Vector3
  tangent: THREE.Vector3
  right: THREE.Vector3
  normal: THREE.Vector3
  halfWidth: number
  crown: number
}

type HairCard = {
  rings: CardRing[]
  tileIndex: number
}

const ATLAS_TILE_PX = 256
const ATLAS_COLS = 4
const ATLAS_ROWS = 2
const ATLAS_W = ATLAS_COLS * ATLAS_TILE_PX
const ATLAS_H = ATLAS_ROWS * ATLAS_TILE_PX
const TILE_UV_PAD = 1 / ATLAS_TILE_PX

const LENGTH_SEGMENTS = 6
const WIDTH_SEGMENTS = 2

const LOCAL_LAYERS = [
  { lift: 0.0010, width: 1.55, length: 0.90, crown: 0.38, tile: 0 },
  { lift: 0.0065, width: 1.28, length: 1.00, crown: 0.60, tile: 2 },
  { lift: 0.0130, width: 1.05, length: 1.10, crown: 0.82, tile: 1 },
]

function tupleToVector(p: Vec3Tuple) {
  return new THREE.Vector3(p[0], p[1], p[2])
}

function clamp01(v: number) {
  return THREE.MathUtils.clamp(v, 0, 1)
}

function smoothstep(edge0: number, edge1: number, v: number) {
  const t = clamp01((v - edge0) / Math.max(edge1 - edge0, 1e-6))
  return t * t * (3 - 2 * t)
}

function hashU32(v: number) {
  v = ((v >>> 16) ^ v) * 0x45d9f3b
  v = ((v >>> 16) ^ v) * 0x45d9f3b
  return ((v >>> 16) ^ v) >>> 0
}

function mulberry32(seed: number) {
  return () => {
    let s = (seed += 0x6d2b79f5)
    s = Math.imul(s ^ (s >>> 15), s | 1)
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61)
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296
  }
}

function quantile(values: number[], q: number) {
  if (!values.length) return 0
  values.sort((a, b) => a - b)
  const raw = clamp01(q) * (values.length - 1)
  const lo = Math.floor(raw)
  const hi = Math.min(values.length - 1, lo + 1)
  return values[lo] * (1 - raw + lo) + values[hi] * (raw - lo)
}

function pathLength(points: readonly THREE.Vector3[]) {
  let len = 0
  for (let i = 1; i < points.length; i += 1) len += points[i].distanceTo(points[i - 1])
  return len
}

function samplePolyline(points: readonly THREE.Vector3[], t: number, target: THREE.Vector3) {
  if (points.length === 0) return target.set(0, 0, 0)
  if (points.length === 1) return target.copy(points[0])
  const raw = clamp01(t) * (points.length - 1)
  const lo = Math.floor(raw)
  const hi = Math.min(points.length - 1, lo + 1)
  return target.copy(points[lo]).lerp(points[hi], raw - lo)
}

function makeRuntimeStrands(strands: readonly GeneratedStrand[]) {
  const runtime: RuntimeStrand[] = []
  for (const source of strands) {
    if (source.points.length < 2) continue
    if (source.flyawayMask > 0.92) continue
    const points = source.points.map(tupleToVector)
    const root = points[0]
    const tip = points[points.length - 1]
    const length = Math.max(pathLength(points), root.distanceTo(tip))
    if (length <= 1e-5) continue
    const density = Math.max(source.rootDensity, source.rootOcclusion ?? 0)
    const hairline = source.edgeDistance < 0.014 ? 0.25 : 0
    const weight = Math.max(0.08, density * 1.1 + source.lengthScale * 0.4 + hairline - source.flyawayMask * 0.15)
    runtime.push({ source, points, root, tip, length, weight, u: 0, v: 0 })
  }
  return runtime
}

function averageFlow(strands: readonly RuntimeStrand[]) {
  const flow = new THREE.Vector3()
  const delta = new THREE.Vector3()
  for (const strand of strands) {
    delta.copy(strand.tip).sub(strand.root)
    const len = delta.length()
    if (len > 1e-6) flow.addScaledVector(delta, strand.weight / len)
  }
  if (flow.lengthSq() <= 1e-10) flow.set(0, 1, 0)
  return flow.normalize()
}

function stableRight(axis: THREE.Vector3) {
  const helper = Math.abs(axis.y) > 0.88 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const right = new THREE.Vector3().crossVectors(axis, helper)
  if (right.lengthSq() <= 1e-10) right.set(1, 0, 0)
  return right.normalize()
}

function covarianceAxis(strands: readonly RuntimeStrand[], center: THREE.Vector3, forbidden: readonly THREE.Vector3[] = []) {
  const axis = new THREE.Vector3(1, 0.37, -0.21).normalize()
  const offset = new THREE.Vector3()
  const next = new THREE.Vector3()
  for (let iter = 0; iter < 12; iter += 1) {
    next.set(0, 0, 0)
    for (const strand of strands) {
      offset.copy(strand.root).sub(center)
      for (const b of forbidden) offset.addScaledVector(b, -offset.dot(b))
      next.addScaledVector(offset, offset.dot(axis) * strand.weight)
    }
    for (const b of forbidden) next.addScaledVector(b, -next.dot(b))
    if (next.lengthSq() <= 1e-12) break
    axis.copy(next.normalize())
  }
  if (axis.lengthSq() <= 1e-10) axis.set(1, 0, 0)
  return axis.normalize()
}

function buildRootFrame(strands: RuntimeStrand[]) {
  const center = new THREE.Vector3()
  let total = 0
  for (const strand of strands) {
    center.addScaledVector(strand.root, strand.weight)
    total += strand.weight
  }
  center.multiplyScalar(1 / Math.max(1e-6, total))

  const uAxis = covarianceAxis(strands, center)
  const vAxis = covarianceAxis(strands, center, [uAxis])
  if (vAxis.lengthSq() <= 1e-10) vAxis.copy(stableRight(uAxis))
  const nAxis = new THREE.Vector3().crossVectors(uAxis, vAxis)
  if (nAxis.lengthSq() <= 1e-10) nAxis.copy(averageFlow(strands))
  nAxis.normalize()
  if (nAxis.dot(averageFlow(strands)) < 0) nAxis.multiplyScalar(-1)

  const offset = new THREE.Vector3()
  const us: number[] = []
  const vs: number[] = []
  for (const strand of strands) {
    offset.copy(strand.root).sub(center)
    strand.u = offset.dot(uAxis)
    strand.v = offset.dot(vAxis)
    us.push(strand.u)
    vs.push(strand.v)
  }

  return {
    center, uAxis, vAxis, nAxis,
    minU: quantile(us, 0.01),
    maxU: quantile(us, 0.99),
    minV: quantile(vs, 0.01),
    maxV: quantile(vs, 0.99),
  } satisfies RootFrame
}

function gridSize(strandCount: number, complexity: number) {
  const c = smoothstep(0.05, 1, complexity)
  const density = Math.min(5, Math.floor(Math.sqrt(strandCount) / 38))
  return {
    cols: THREE.MathUtils.clamp(Math.round(THREE.MathUtils.lerp(9, 14, c)) + density, 9, 18),
    rows: THREE.MathUtils.clamp(Math.round(THREE.MathUtils.lerp(5, 8, c)) + Math.floor(density * 0.5), 5, 10),
  }
}

function buildCells(strands: RuntimeStrand[], frame: RootFrame, complexity: number) {
  const { cols, rows } = gridSize(strands.length, complexity)
  const cells: RuntimeStrand[][] = Array.from({ length: cols * rows }, () => [])

  // Expand grid bounds by half a cell so edge cards extend slightly beyond
  // the outermost strands, covering the gap between hairline strands and skin.
  const halfCellU = (frame.maxU - frame.minU) / (cols * 2)
  const halfCellV = (frame.maxV - frame.minV) / (rows * 2)
  const minU = frame.minU - halfCellU
  const maxU = frame.maxU + halfCellU
  const minV = frame.minV - halfCellV
  const maxV = frame.maxV + halfCellV
  const invU = 1 / Math.max(1e-6, maxU - minU)
  const invV = 1 / Math.max(1e-6, maxV - minV)

  for (const strand of strands) {
    const col = THREE.MathUtils.clamp(Math.floor((strand.u - minU) * invU * cols), 0, cols - 1)
    const row = THREE.MathUtils.clamp(Math.floor((strand.v - minV) * invV * rows), 0, rows - 1)
    cells[row * cols + col].push(strand)
  }

  const merged: RuntimeStrand[][] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = cells[row * cols + col]
      if (!cell.length) continue
      if (cell.length >= 4) { merged.push(cell); continue }
      const augmented = [...cell]
      for (let y = Math.max(0, row - 1); y <= Math.min(rows - 1, row + 1); y += 1) {
        for (let x = Math.max(0, col - 1); x <= Math.min(cols - 1, col + 1); x += 1) {
          if (x === col && y === row) continue
          augmented.push(...cells[y * cols + x].slice(0, 24))
        }
      }
      merged.push(augmented)
    }
  }
  return merged
}

function cellCenter(strands: readonly RuntimeStrand[]) {
  const center = new THREE.Vector3()
  let total = 0
  for (const strand of strands) {
    center.addScaledVector(strand.root, strand.weight)
    total += strand.weight
  }
  return center.multiplyScalar(1 / Math.max(1e-6, total))
}

function localRight(strands: readonly RuntimeStrand[], center: THREE.Vector3, flow: THREE.Vector3, fallback: THREE.Vector3) {
  const offset = new THREE.Vector3()
  let right = new THREE.Vector3()
  let bestDist = 0
  for (const strand of strands) {
    offset.copy(strand.root).sub(center)
    offset.addScaledVector(flow, -offset.dot(flow))
    const dist = offset.lengthSq()
    if (dist > bestDist) { bestDist = dist; right.copy(offset) }
  }
  if (right.lengthSq() <= 1e-10) right = fallback.clone().addScaledVector(flow, -fallback.dot(flow))
  if (right.lengthSq() <= 1e-10) right.copy(stableRight(flow))
  return right.normalize()
}

function fitCard(cell: readonly RuntimeStrand[], frame: RootFrame, layer: (typeof LOCAL_LAYERS)[number]): HairCard {
  const flow = averageFlow(cell)
  const rootCenter = cellCenter(cell)
  const right = localRight(cell, rootCenter, flow, frame.uAxis)
  const normal = new THREE.Vector3().crossVectors(right, flow)
  if (normal.lengthSq() <= 1e-10) normal.copy(frame.nAxis)
  normal.normalize()
  if (normal.dot(frame.nAxis) < 0) normal.multiplyScalar(-1)

  const rings: CardRing[] = []
  const sample = new THREE.Vector3()
  const values: number[] = []
  const avgWidth = cell.reduce((s, st) => s + st.source.widthRoot, 0) / Math.max(1, cell.length)

  // Average strand length drives root extension: push the first ring down by
  // ~18% of the strand length so the card reaches into the scalp/hairline gap.
  const avgLen = cell.reduce((s, st) => s + st.length, 0) / Math.max(1, cell.length)
  const rootPush = avgLen * 0.18

  for (let ri = 0; ri <= LENGTH_SEGMENTS; ri += 1) {
    const t = ri / LENGTH_SEGMENTS
    const rootLock = smoothstep(0.04, 0.22, t)
    const center = new THREE.Vector3()
    let total = 0
    for (const strand of cell) {
      center.addScaledVector(samplePolyline(strand.points, t, sample), strand.weight)
      total += strand.weight
    }
    center.multiplyScalar(1 / Math.max(1e-6, total))
    center.lerpVectors(rootCenter, center, THREE.MathUtils.lerp(1, layer.length, rootLock))

    // Push root end toward scalp (anti-flow direction) to close hairline gap.
    const rootExtend = rootPush * (1 - rootLock)
    center.addScaledVector(flow, -rootExtend)

    values.length = 0
    for (const strand of cell) {
      values.push(samplePolyline(strand.points, t, sample).clone().sub(center).dot(right))
    }
    const lo = quantile(values, 0.03)
    const hi = quantile(values, 0.97)
    const spread = Math.max(0.004, (hi - lo) * 0.5)
    const rootWidthLock = THREE.MathUtils.lerp(0.42, 1, rootLock)
    const width = THREE.MathUtils.clamp(
      Math.max(spread, avgWidth * 9, 0.010) * layer.width * rootWidthLock * (1.22 - smoothstep(0.78, 1, t) * 0.2),
      0.0045, 0.07,
    )
    center.addScaledVector(right, (lo + hi) * 0.5)
    center.addScaledVector(normal, layer.lift * rootLock)

    const prev = ri > 0 ? rings[ri - 1].center : rootCenter
    const tangent = center.clone().sub(prev)
    if (tangent.lengthSq() <= 1e-10) tangent.copy(flow)
    tangent.normalize()

    rings.push({ center, tangent, right, normal, halfWidth: width, crown: width * 0.14 * layer.crown * rootLock })
  }

  for (let i = 0; i < rings.length - 1; i += 1) {
    rings[i].tangent.copy(rings[i + 1].center).sub(rings[i].center).normalize()
  }

  return { rings, tileIndex: layer.tile }
}

function buildCards(strands: RuntimeStrand[], complexity: number): HairCard[] {
  const frame = buildRootFrame(strands)
  const cells = buildCells(strands, frame, complexity)
  const cards: HairCard[] = []
  for (const cell of cells) {
    for (const layer of LOCAL_LAYERS) cards.push(fitCard(cell, frame, layer))
  }
  return cards
}

// ---------------------------------------------------------------------------
// Atlas — color baked from melanin model, fiber shape from canvas strokes.
//
// We use the canvas only to rasterise bezier fiber shapes into an alpha mask.
// Color is computed in JS (same melanin formula as the BSDF shader) and written
// directly into the ImageData typed array — bypassing the canvas 2D compositing
// pipeline entirely. This means:
//   • No premultiplied-alpha darkening (we never let the 2D context touch RGB).
//   • GLB export gets a fully-colored texture (no shader needed at export time).
//   • Strand variance (melaninRandomize) shows up per fiber.
// ---------------------------------------------------------------------------

const EUMELANIN_ABS   = [0.419, 0.697, 1.37]  as const
const PHEOMELANIN_ABS = [0.187, 0.4,   1.05]  as const

function melaninToLinear255(melanin: number, redness: number, tintR: number, tintG: number, tintB: number) {
  const eu = 1 - redness
  const ph = redness
  // Exponent tuned for meshStandardMaterial (PBR linear pipeline).
  const r = Math.exp(-(EUMELANIN_ABS[0] * eu + PHEOMELANIN_ABS[0] * ph) * melanin * 4.2)
  const g = Math.exp(-(EUMELANIN_ABS[1] * eu + PHEOMELANIN_ABS[1] * ph) * melanin * 4.2)
  const b = Math.exp(-(EUMELANIN_ABS[2] * eu + PHEOMELANIN_ABS[2] * ph) * melanin * 4.2)
  // Store as sRGB (gamma-encoded) so Three.js linearises on upload via SRGBColorSpace.
  const toSrgb = (v: number) => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return [
    Math.round(Math.min(1, toSrgb(r * tintR)) * 255),
    Math.round(Math.min(1, toSrgb(g * tintG)) * 255),
    Math.round(Math.min(1, toSrgb(b * tintB)) * 255),
  ] as const
}

function drawAtlasTile(atlas: ImageData, tileIndex: number, mat: HairMaterialSettings) {
  const rng = mulberry32(hashU32(tileIndex + 101))

  // --- Step 1: rasterise fiber alpha mask via canvas strokes ---------------
  const tileCanvas = document.createElement('canvas')
  tileCanvas.width  = ATLAS_TILE_PX
  tileCanvas.height = ATLAS_TILE_PX
  const ctx = tileCanvas.getContext('2d', { willReadFrequently: true })!

  const isVariantB  = (tileIndex % 2) === 1
  const layerGroup  = Math.floor(tileIndex / 2)
  // More strands = denser coverage so individual card silhouettes dissolve.
  const strandCount = layerGroup === 0 ? 720 : layerGroup === 1 ? 580 : 440

  // Parse tint once
  const tintC = new THREE.Color(mat.tintColor ?? '#ffffff')

  ctx.lineCap = 'round'
  for (let i = 0; i < strandCount; i += 1) {
    // Allow strands to start slightly outside tile bounds so edge coverage
    // is uniform right to the card border (no bare-edge artifact).
    const rootX = (rng() * 1.1 - 0.05) * ATLAS_TILE_PX
    const bend  = (rng() - 0.5) * (isVariantB ? 64 : 36)
    const sway  = (rng() - 0.5) * 18
    const tipX  = rootX + bend
    // consume jitter rng slot (used in step 2)
    rng()

    // White strokes — we only want the alpha channel from this canvas pass.
    // Softer falloff at root (0→0.03) and tip (0.82→1) so overlapping cards
    // dissolve into each other rather than showing hard silhouette edges.
    const grad = ctx.createLinearGradient(rootX, ATLAS_TILE_PX, tipX, 0)
    grad.addColorStop(0.00, 'rgba(255,255,255,0)')
    grad.addColorStop(0.03, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.82, 'rgba(255,255,255,0.9)')
    grad.addColorStop(1.00, 'rgba(255,255,255,0)')
    ctx.strokeStyle = grad
    // Wider strokes = better coverage between fibers
    ctx.lineWidth   = 1.0 + rng() * 2.2
    ctx.beginPath()
    ctx.moveTo(rootX, ATLAS_TILE_PX + 6)
    ctx.bezierCurveTo(
      rootX + sway,               ATLAS_TILE_PX * 0.68,
      tipX + (rng() - 0.5) * 32, ATLAS_TILE_PX * 0.28,
      tipX,                       -8,
    )
    ctx.stroke()
  }

  // --- Step 2: read alpha back, write color + alpha directly to ImageData --
  // The canvas stored premul values internally, but since we drew white (R=G=B=255),
  // the premul alpha is exactly what we wrote. We only use data[i+3] (alpha).
  const tile    = ctx.getImageData(0, 0, ATLAS_TILE_PX, ATLAS_TILE_PX)
  const tileAlpha = tile.data  // only [i+3] is meaningful

  const col     = tileIndex % ATLAS_COLS
  const row     = Math.floor(tileIndex / ATLAS_COLS)
  const offX    = col * ATLAS_TILE_PX
  const offY    = row * ATLAS_TILE_PX
  const aStride = ATLAS_W * 4

  // Re-seed rng to replay the same per-strand melanin jitter sequence.
  const rng2 = mulberry32(hashU32(tileIndex + 101))

  // Build a per-fiber color lookup indexed by X column so we can composite
  // fiber colors over an opaque background per pixel, respecting coverage.
  // Strategy: for each pixel, we use the background color = average fiber color
  // weighted by which fiber is topmost. Since we can't easily replay bezier
  // rasterisation per pixel, we instead build a flat color from the tile-average
  // melanin (with per-row variation for root-to-tip darkening) and use the
  // alpha channel from the canvas as the mask.
  //
  // For strand variance: tile columns map loosely to fiber X position, so we
  // vary melanin by column using the per-fiber jitter seeded consistently.
  // This gives visible color variation without needing per-pixel fiber tracing.

  // Build column color table: 256 entries, one per X pixel column.
  const colR = new Uint8Array(ATLAS_TILE_PX)
  const colG = new Uint8Array(ATLAS_TILE_PX)
  const colB = new Uint8Array(ATLAS_TILE_PX)
  for (let px = 0; px < ATLAS_TILE_PX; px += 1) {
    // Jitter melanin per column to encode strand variance spatially.
    const jitter = (rng2() - 0.5) * 2 * (mat.melaninRandomize ?? 0.12)
    const melaninCol = Math.max(0, Math.min(1, mat.melanin + jitter))
    const [cr, cg, cb] = melaninToLinear255(melaninCol, mat.melaninRedness, tintC.r, tintC.g, tintC.b)
    colR[px] = cr; colG[px] = cg; colB[px] = cb
  }

  const rootDarken = Math.max(0, Math.min(1, mat.rootDarken ?? 0.5))
  const rootDarkenLen = Math.max(0.01, mat.rootDarkenLength ?? 0.14)

  for (let py = 0; py < ATLAS_TILE_PX; py += 1) {
    // v=0 at bottom (root), v=1 at top (tip) — canvas Y is flipped vs UV.
    const v = 1 - py / (ATLAS_TILE_PX - 1)
    const rootRamp = Math.min(1, v / rootDarkenLen)
    const rootRampSmooth = rootRamp * rootRamp * (3 - 2 * rootRamp)
    const darken = 1 - rootDarken * (1 - rootRampSmooth) * 0.6

    for (let px = 0; px < ATLAS_TILE_PX; px += 1) {
      const src = (py * ATLAS_TILE_PX + px) * 4
      const dst = ((offY + py) * aStride) + (offX + px) * 4
      const rawA = tileAlpha[src + 3]

      // Hard-threshold: below 28 is background fog from gradient brush edges,
      // not real fiber. Zero it out so card interiors are truly transparent.
      // Above threshold, remap to full 0..255 range so fibers are opaque and
      // the alphaTest cutout is clean.
      const a = rawA < 28 ? 0 : Math.min(255, Math.round((rawA - 28) * (255 / 227)))

      atlas.data[dst]     = Math.round(colR[px] * darken)
      atlas.data[dst + 1] = Math.round(colG[px] * darken)
      atlas.data[dst + 2] = Math.round(colB[px] * darken)
      atlas.data[dst + 3] = a
    }
  }
}

function buildAtlas(mat: HairMaterialSettings) {
  const canvas = document.createElement('canvas')
  canvas.width  = ATLAS_W
  canvas.height = ATLAS_H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  const atlasImage = ctx.createImageData(ATLAS_W, ATLAS_H)
  for (let i = 0; i < ATLAS_COLS * ATLAS_ROWS; i += 1) drawAtlasTile(atlasImage, i, mat)
  bleedAtlasBorders(atlasImage)
  ctx.putImageData(atlasImage, 0, 0)

  // SRGBColorSpace: the atlas contains display-gamma RGB values (as painted).
  // Three.js will linearise on upload for correct PBR, but MeshBasicMaterial
  // bypasses tone-mapping so the values display as intended.
  const atlas = new THREE.CanvasTexture(canvas)
  atlas.colorSpace      = THREE.SRGBColorSpace
  atlas.premultiplyAlpha = false
  atlas.needsUpdate     = true
  return { atlas, canvas }
}

function bleedAtlasBorders(image: ImageData) {
  const { data, width, height } = image
  const stride = width * 4
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * stride + x * 4
      if (data[i + 3] > 32) continue
      for (let r = 1; r <= 3; r += 1) {
        let found = false
        for (let dy = -r; dy <= r && !found; dy += 1) {
          for (let dx = -r; dx <= r && !found; dx += 1) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
            const nx = x + dx, ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const ni = ny * stride + nx * 4
            if (data[ni + 3] > 32) {
              data[i] = data[ni]; data[i + 1] = data[ni + 1]; data[i + 2] = data[ni + 2]
              found = true
            }
          }
        }
        if (found) break
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Geometry — standard position/normal/uv, no strand attributes needed.
// UV: u=0..1 across width, v=0..1 root→tip (matches card material shader).
// ---------------------------------------------------------------------------

function tileUv(tileIndex: number, u: number, v: number) {
  const col  = tileIndex % ATLAS_COLS
  const row  = Math.floor(tileIndex / ATLAS_COLS)
  const safeU = THREE.MathUtils.lerp(TILE_UV_PAD, 1 - TILE_UV_PAD, u)
  const safeV = THREE.MathUtils.lerp(TILE_UV_PAD, 1 - TILE_UV_PAD, v)
  return [(col + safeU) / ATLAS_COLS, 1 - (row + 1 - safeV) / ATLAS_ROWS] as const
}

function buildGeometry(cards: readonly HairCard[]) {
  const vertsAcross  = WIDTH_SEGMENTS + 1
  const vertsAlong   = LENGTH_SEGMENTS + 1
  const vertsPerCard = vertsAcross * vertsAlong
  // Each card is emitted twice: front side + back side (flipped winding, same
  // outward normal). This lets us use FrontSide material so both sides always
  // light with the correct outward sphere normal — DoubleSide would negate the
  // normal on back-faces and produce dark rectangular patches.
  const n = cards.length * 2

  const positions = new Float32Array(n * vertsPerCard * 3)
  const normals   = new Float32Array(n * vertsPerCard * 3)
  const uvs       = new Float32Array(n * vertsPerCard * 2)
  const indices   = new Uint32Array(n * LENGTH_SEGMENTS * WIDTH_SEGMENTS * 6)

  // Head center for smooth sphere-outward normals — consistent lighting across
  // all cards regardless of local face orientation.
  const headCenter = new THREE.Vector3()
  for (const card of cards) headCenter.add(card.rings[0].center)
  headCenter.multiplyScalar(1 / Math.max(1, cards.length))

  let pWrite = 0, uvWrite = 0, iWrite = 0, vertBase = 0

  for (const card of cards) {
    // Emit vertices for one side (shared between front and back passes).
    const sideVertBase = vertBase

    for (let y = 0; y <= LENGTH_SEGMENTS; y += 1) {
      const ring = card.rings[y]
      const v = y / LENGTH_SEGMENTS

      for (let x = 0; x <= WIDTH_SEGMENTS; x += 1) {
        const u    = x / WIDTH_SEGMENTS
        const side = u * 2 - 1
        const crown = (1 - side * side) * ring.crown
        const point = ring.center.clone()
          .addScaledVector(ring.right, side * ring.halfWidth)
          .addScaledVector(ring.normal, crown)

        // Sphere normal blended with face normal — same for both passes so
        // both sides of the card light identically.
        const sphereNormal = point.clone().sub(headCenter).normalize()
        const faceNormal = ring.normal.clone().addScaledVector(ring.right, side * 0.14).normalize()
        const normal = sphereNormal.lerp(faceNormal, 0.35).normalize()

        const atlasUv = tileUv(card.tileIndex, u, v)

        positions[pWrite]     = point.x
        positions[pWrite + 1] = point.y
        positions[pWrite + 2] = point.z
        normals[pWrite]       = normal.x
        normals[pWrite + 1]   = normal.y
        normals[pWrite + 2]   = normal.z
        pWrite += 3
        uvs[uvWrite]     = atlasUv[0]
        uvs[uvWrite + 1] = atlasUv[1]
        uvWrite += 2
      }
    }

    // Front-face indices (CCW winding).
    for (let y = 0; y < LENGTH_SEGMENTS; y += 1) {
      for (let x = 0; x < WIDTH_SEGMENTS; x += 1) {
        const a = sideVertBase + y * vertsAcross + x
        const b = a + 1, c = a + vertsAcross, d = c + 1
        indices[iWrite]     = a; indices[iWrite + 1] = b; indices[iWrite + 2] = c
        indices[iWrite + 3] = b; indices[iWrite + 4] = d; indices[iWrite + 5] = c
        iWrite += 6
      }
    }
    vertBase += vertsPerCard

    // Back-face pass: same vertices, flipped winding (CW → appears CCW from back).
    const backVertBase = vertBase
    // Copy positions, normals, uvs from front pass.
    const frontStart = (sideVertBase) * 3
    const backStart  = backVertBase * 3
    positions.copyWithin(backStart, frontStart, frontStart + vertsPerCard * 3)
    normals.copyWithin(backStart,   frontStart, frontStart + vertsPerCard * 3)
    const frontUvStart = sideVertBase * 2
    const backUvStart  = backVertBase * 2
    uvs.copyWithin(backUvStart, frontUvStart, frontUvStart + vertsPerCard * 2)
    pWrite   += vertsPerCard * 3
    uvWrite  += vertsPerCard * 2

    // Back-face indices: swap b and c to flip winding.
    for (let y = 0; y < LENGTH_SEGMENTS; y += 1) {
      for (let x = 0; x < WIDTH_SEGMENTS; x += 1) {
        const a = backVertBase + y * vertsAcross + x
        const b = a + 1, c = a + vertsAcross, d = c + 1
        indices[iWrite]     = a; indices[iWrite + 1] = c; indices[iWrite + 2] = b
        indices[iWrite + 3] = b; indices[iWrite + 4] = c; indices[iWrite + 5] = d
        iWrite += 6
      }
    }
    vertBase += vertsPerCard
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('normal',   new THREE.BufferAttribute(normals,   3))
  geo.setAttribute('uv',       new THREE.BufferAttribute(uvs,       2))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.computeBoundingSphere()
  return geo
}

function emptyHairCardMesh(): HairCardMesh {
  const canvas = document.createElement('canvas')
  canvas.width = 1; canvas.height = 1
  return {
    geometry: new THREE.BufferGeometry(),
    atlas: new THREE.CanvasTexture(canvas),
    atlasCanvas: canvas,
    cardCount: 0,
  }
}

export function buildHairCardMesh(
  strands: readonly GeneratedStrand[],
  complexity: number,
  material: HairMaterialSettings,
): HairCardMesh {
  const runtime = makeRuntimeStrands(strands)
  if (runtime.length < 8) return emptyHairCardMesh()

  const cards = buildCards(runtime, complexity)
  if (!cards.length) return emptyHairCardMesh()

  const { atlas, canvas } = buildAtlas(material)
  return {
    geometry: buildGeometry(cards),
    atlas,
    atlasCanvas: canvas,
    cardCount: cards.length,
  }
}
