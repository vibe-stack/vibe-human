import { evaluateEdgeAt, sampleEdgeLoop, samplePatternOutline } from '../geometry/patternSampling'
import type { PatternPanel, Vec2 } from '../document/types'
import type { CompilerOptions } from './types'
import type {
  BendConstraint,
  DistanceConstraint,
  PanelRuntimeInfo,
  PinConstraint,
} from '../simulation/types'

const PATTERN_UNIT_SCALE = 0.004

const QUALITY_PRESETS: Record<CompilerOptions['quality'], {
  spacing: number
  bendCompliance: number
  stretchCompliance: number
  shearCompliance: number
  minDim: number
  maxDim: number
}> = {
  low: { spacing: 0.060, bendCompliance: 0.020, stretchCompliance: 0.0002, shearCompliance: 0.00028, minDim: 8, maxDim: 16 },
  medium: { spacing: 0.040, bendCompliance: 0.012, stretchCompliance: 0.0002, shearCompliance: 0.00028, minDim: 12, maxDim: 24 },
  high: { spacing: 0.028, bendCompliance: 0.006, stretchCompliance: 0.00014, shearCompliance: 0.0002, minDim: 16, maxDim: 32 },
  ultra: { spacing: 0.020, bendCompliance: 0.002, stretchCompliance: 0.00008, shearCompliance: 0.00014, minDim: 20, maxDim: 40 },
}

export type CompiledPanelSimMesh = {
  panelInfo: PanelRuntimeInfo
  positions: number[]
  invMass: number[]
  panelIds: string[]
  panelUvs: number[]
  panelLocalPositions: number[]
  stretchConstraints: DistanceConstraint[]
  shearConstraints: DistanceConstraint[]
  bendConstraints: BendConstraint[]
  pinConstraints: PinConstraint[]
  seamSamplePoints: Array<{ particle: number; x: number; y: number }>
}

export function buildPanelSimMesh(
  panel: PatternPanel,
  options: CompilerOptions,
  particleOffset: number,
): CompiledPanelSimMesh {
  const preset = QUALITY_PRESETS[options.quality]
  const bounds = boundsOf(panel)
  const worldWidth = bounds.width * PATTERN_UNIT_SCALE
  const worldHeight = bounds.height * PATTERN_UNIT_SCALE
  const cols = clampInt(
    Math.round(Math.max(worldWidth, 0.08) / preset.spacing) + 1,
    preset.minDim,
    preset.maxDim,
  )
  const rows = clampInt(
    Math.round(Math.max(worldHeight, 0.08) / preset.spacing) + 1,
    preset.minDim,
    preset.maxDim,
  )

  const active = buildActiveMask(cols, rows, panel, bounds)
  const gridToParticle = new Int32Array(cols * rows).fill(-1)
  const positions: number[] = []
  const invMass: number[] = []
  const panelIds: string[] = []
  const panelUvs: number[] = []
  const panelLocalPositions: number[] = []
  const seamSamplePoints: Array<{ particle: number; x: number; y: number }> = []
  const particleIndices: number[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const gridIndex = row * cols + col
      if (!active[gridIndex]) continue
      const u = col / (cols - 1)
      const v = row / (rows - 1)
      const localX = (u - 0.5) * worldWidth
      const localZ = (v - 0.5) * worldHeight
      const world = applyPlacement(localX, 0, localZ, panel.placement)
      const particle = particleOffset + particleIndices.length
      gridToParticle[gridIndex] = particle
      particleIndices.push(particle)
      positions.push(world.x, world.y, world.z)
      invMass.push(1 / 0.018)
      panelIds.push(panel.id)
      panelUvs.push(u, v)
      panelLocalPositions.push(bounds.minX + u * bounds.width, bounds.minY + v * bounds.height)
      seamSamplePoints.push({ particle, x: bounds.minX + u * bounds.width, y: bounds.minY + v * bounds.height })
    }
  }

  const stretchConstraints: DistanceConstraint[] = []
  const shearConstraints: DistanceConstraint[] = []
  const bendConstraints: BendConstraint[] = []
  const triangles: number[] = []
  const spacingX = worldWidth / Math.max(1, cols - 1)
  const spacingY = worldHeight / Math.max(1, rows - 1)
  const diag = Math.hypot(spacingX, spacingY)
  const idx = (col: number, row: number) => row * cols + col
  const map = (col: number, row: number) => gridToParticle[idx(col, row)]
  const has = (col: number, row: number) =>
    col >= 0 && col < cols && row >= 0 && row < rows && gridToParticle[idx(col, row)] >= 0

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const a = map(col, row)
      if (a < 0) continue

      if (has(col + 1, row)) {
        stretchConstraints.push({ a, b: map(col + 1, row), rest: spacingX, compliance: preset.stretchCompliance, kind: 'stretch' })
      }
      if (has(col, row + 1)) {
        stretchConstraints.push({ a, b: map(col, row + 1), rest: spacingY, compliance: preset.stretchCompliance, kind: 'stretch' })
      }
      if (has(col + 1, row + 1)) {
        shearConstraints.push({ a, b: map(col + 1, row + 1), rest: diag, compliance: preset.shearCompliance, kind: 'shear' })
      }
      if (has(col + 1, row - 1)) {
        shearConstraints.push({ a, b: map(col + 1, row - 1), rest: diag, compliance: preset.shearCompliance, kind: 'shear' })
      }
      if (has(col - 1, row) && has(col + 1, row)) {
        bendConstraints.push({ a: map(col - 1, row), b: a, c: map(col + 1, row), rest: spacingX * 2, compliance: preset.bendCompliance, kind: 'bend' })
      }
      if (has(col, row - 1) && has(col, row + 1)) {
        bendConstraints.push({ a: map(col, row - 1), b: a, c: map(col, row + 1), rest: spacingY * 2, compliance: preset.bendCompliance, kind: 'bend' })
      }

      if (has(col + 1, row) && has(col, row + 1) && has(col + 1, row + 1)) {
        const b = map(col + 1, row)
        const c = map(col, row + 1)
        const d = map(col + 1, row + 1)
        triangles.push(a, b, c, b, d, c)
      }
    }
  }

  const pinConstraints = buildPinConstraints(panel, seamSamplePoints)

  return {
    panelInfo: {
      panelId: panel.id,
      placement: panel.placement,
      particleIndices,
      triangleIndices: new Uint32Array(triangles),
    },
    positions,
    invMass,
    panelIds,
    panelUvs,
    panelLocalPositions,
    stretchConstraints,
    shearConstraints,
    bendConstraints,
    pinConstraints,
    seamSamplePoints,
  }
}

function buildPinConstraints(
  panel: PatternPanel,
  particles: Array<{ particle: number; x: number; y: number }>,
) {
  const pins: PinConstraint[] = []
  for (const pin of panel.pins ?? []) {
    let best = particles[0]
    let bestDist = Infinity
    for (const particle of particles) {
      const dx = particle.x - uvToPattern(pin.u, boundsOf(panel).minX, boundsOf(panel).width)
      const dy = particle.y - uvToPattern(pin.v, boundsOf(panel).minY, boundsOf(panel).height)
      const dist = dx * dx + dy * dy
      if (dist < bestDist) {
        bestDist = dist
        best = particle
      }
    }
    const world = applyPlacementFromPattern(best.x, best.y, panel)
    pins.push({ particle: best.particle, x: world.x, y: world.y, z: world.z, stiffness: pin.weight ?? 1, kind: 'pin' })
  }
  return pins
}

function buildActiveMask(
  cols: number,
  rows: number,
  panel: PatternPanel,
  bounds: { minX: number; minY: number; width: number; height: number },
) {
  const outer = samplePatternOutline(panel, 12)
  const holes = (panel.holes ?? []).map((hole) => sampleEdgeLoop(panel, hole, 12)).filter((hole) => hole.length >= 3)
  const active = new Array<boolean>(cols * rows).fill(true)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const px = bounds.minX + (col / Math.max(1, cols - 1)) * bounds.width
      const py = bounds.minY + (row / Math.max(1, rows - 1)) * bounds.height
      active[row * cols + col] = pointInPanel({ x: px, y: py }, outer, holes)
    }
  }
  return active
}

function pointInPanel(pt: Vec2, outer: Vec2[], holes: Vec2[][]) {
  const outerClass = classifyPointInPolygon(pt, outer)
  if (outerClass === 'outside') return false
  for (const hole of holes) {
    if (classifyPointInPolygon(pt, hole) === 'inside') return false
  }
  return true
}

function classifyPointInPolygon(point: Vec2, polygon: Vec2[]): 'inside' | 'boundary' | 'outside' {
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (pointOnSegment(point, polygon[j], polygon[i])) return 'boundary'
  }
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    const intersect = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (intersect) inside = !inside
  }
  return inside ? 'inside' : 'outside'
}

function pointOnSegment(point: Vec2, a: Vec2, b: Vec2) {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const apx = point.x - a.x
  const apy = point.y - a.y
  const cross = abx * apy - aby * apx
  if (Math.abs(cross) > 1e-6) return false
  const dot = apx * abx + apy * aby
  if (dot < -1e-6) return false
  const lenSq = abx * abx + aby * aby
  return dot - lenSq <= 1e-6
}

function boundsOf(panel: PatternPanel) {
  const points = Object.values(panel.points)
  if (!points.length) return { minX: -140, minY: -140, width: 280, height: 280 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return { minX, minY, width: maxX - minX || 1, height: maxY - minY || 1 }
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function applyPlacement(x: number, y: number, z: number, placement: PatternPanel['placement']) {
  const q = quatFromEuler(placement.rotation.x, placement.rotation.y, placement.rotation.z)
  const rotated = rotateVec(x, y, z, q.x, q.y, q.z, q.w)
  return {
    x: rotated.x + placement.position.x,
    y: rotated.y + placement.position.y,
    z: rotated.z + placement.position.z,
  }
}

function applyPlacementFromPattern(x: number, y: number, panel: PatternPanel) {
  const bounds = boundsOf(panel)
  const worldX = ((x - bounds.minX) / bounds.width - 0.5) * bounds.width * PATTERN_UNIT_SCALE
  const worldZ = ((y - bounds.minY) / bounds.height - 0.5) * bounds.height * PATTERN_UNIT_SCALE
  return applyPlacement(worldX, 0, worldZ, panel.placement)
}

function uvToPattern(value: number, min: number, span: number) {
  return min + value * span
}

function quatFromEuler(x: number, y: number, z: number) {
  const c1 = Math.cos(x / 2)
  const s1 = Math.sin(x / 2)
  const c2 = Math.cos(y / 2)
  const s2 = Math.sin(y / 2)
  const c3 = Math.cos(z / 2)
  const s3 = Math.sin(z / 2)
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  }
}

function rotateVec(x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number) {
  const tx = 2 * (qy * z - qz * y)
  const ty = 2 * (qz * x - qx * z)
  const tz = 2 * (qx * y - qy * x)
  return {
    x: x + qw * tx + (qy * tz - qz * ty),
    y: y + qw * ty + (qz * tx - qx * tz),
    z: z + qw * tz + (qx * ty - qy * tx),
  }
}

export function samplePanelEdge(panel: PatternPanel, edgeId: string, samples: number, reversed = false) {
  const edge = panel.edges.find((item) => item.id === edgeId)
  if (!edge) return []
  const points: Vec2[] = []
  for (let index = 0; index <= samples; index += 1) {
    points.push(evaluateEdgeAt(panel, edge, index / samples))
  }
  return reversed ? points.reverse() : points
}