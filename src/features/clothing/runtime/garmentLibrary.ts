import type { PatternDocument, PatternEdge, PatternPanel, PatternPoint, PatternSeam } from '../document/types'
import { PATTERN_UNIT_SCALE } from '../simulation/placement'
import type { BodyMeasurements } from './bodyMeasurements'
import { FABRICS, type FabricId, type FabricPreset } from './fabrics'

// Parametric garment patterns cut from body measurements.
//
// Every garment is a set of flat panels in the frontal plane (character space:
// x = character left, y = up), front and back with identical outlines so their
// seams pair edge-for-edge, exactly like a real sewing pattern. Panels are laid
// out in front of / behind the body by garmentArrangement and sewn by the
// solver's assembly phase, so attachment works for any body the measurements
// came from.

export type GarmentKind = 'tshirt' | 'shirt' | 'trousers' | 'jacket' | 'skirt' | 'dress'

export type GarmentInfo = {
  kind: GarmentKind
  name: string
  defaultFabric: FabricId
  /** Layer order: higher layers are laid out (and stay) further from the skin. */
  layer: number
  region: 'upper' | 'lower' | 'full'
}

export const GARMENTS: Record<GarmentKind, GarmentInfo> = {
  tshirt: { kind: 'tshirt', name: 'T-shirt', defaultFabric: 'jersey', layer: 1, region: 'upper' },
  shirt: { kind: 'shirt', name: 'Long-sleeve shirt', defaultFabric: 'cotton', layer: 1, region: 'upper' },
  trousers: { kind: 'trousers', name: 'Trousers', defaultFabric: 'denim', layer: 0, region: 'lower' },
  jacket: { kind: 'jacket', name: 'Open jacket (loose)', defaultFabric: 'wool', layer: 2, region: 'upper' },
  skirt: { kind: 'skirt', name: 'Flared skirt', defaultFabric: 'silk', layer: 0, region: 'lower' },
  dress: { kind: 'dress', name: 'Sleeveless dress', defaultFabric: 'silk', layer: 1, region: 'full' },
}

export const GARMENT_KINDS = Object.keys(GARMENTS) as GarmentKind[]

export type PanelMetadata = {
  garment: GarmentKind
  side: 'front' | 'back'
  layer: number
  /** Edge ids bound to the skin once sewn (waistbands). */
  anchorEdges: string[]
}

export type OutfitItem = { kind: GarmentKind; fabric?: FabricId }

type Pt = { x: number; y: number }
/** One half (character left, x >= 0) of a panel outline: points from one midline point to the other. */
type HalfOutline = { points: Pt[]; edges: string[] }

export function buildOutfitDocument(items: OutfitItem[], m: BodyMeasurements): PatternDocument {
  const panels: Record<string, PatternPanel> = {}
  const seams: Record<string, PatternSeam> = {}
  const usedFabrics: Record<string, FabricPreset> = {}
  for (const item of items) {
    const fabric = FABRICS[item.fabric ?? GARMENTS[item.kind].defaultFabric]
    usedFabrics[fabric.id] = fabric
    const built = buildGarment(item.kind, m, fabric)
    for (const panel of built.panels) panels[panel.id] = panel
    for (const seam of built.seams) seams[seam.id] = seam
  }
  return {
    id: `outfit-${items.map((item) => item.kind).join('-')}`,
    name: items.map((item) => GARMENTS[item.kind].name).join(' + '),
    panels,
    seams,
    fabrics: Object.fromEntries(Object.values(usedFabrics).map((fabric) => [fabric.id, {
      id: fabric.id,
      name: fabric.name,
      stretchCompliance: fabric.stretchCompliance,
      shearCompliance: fabric.shearCompliance,
      bendCompliance: fabric.bendCompliance,
      damping: fabric.damping,
      friction: fabric.friction,
      density: fabric.density,
    }])),
  }
}

export function buildGarment(kind: GarmentKind, m: BodyMeasurements, fabric: FabricPreset) {
  switch (kind) {
    case 'tshirt': return upperGarment(kind, m, fabric, { sleeve: 'short', ease: 0.12, hemDrop: 0.04, frontNeck: 0.07, split: false })
    case 'shirt': return upperGarment(kind, m, fabric, { sleeve: 'long', ease: 0.1, hemDrop: 0.11, frontNeck: 0.05, split: false })
    case 'jacket': return upperGarment(kind, m, fabric, { sleeve: 'long', ease: 0.2, hemDrop: 0.2, frontNeck: 0.13, split: true })
    case 'dress': return dress(m, fabric)
    case 'trousers': return trousers(m, fabric)
    case 'skirt': return skirt(m, fabric)
  }
}

// ---------------------------------------------------------------------------
// Upper body: T-shirt, shirt, jacket
// ---------------------------------------------------------------------------

function upperGarment(
  kind: GarmentKind,
  m: BodyMeasurements,
  fabric: FabricPreset,
  options: { sleeve: 'short' | 'long'; ease: number; hemDrop: number; frontNeck: number; split: boolean },
) {
  const e = options.ease
  const clearance = 0.008 + fabric.thickness
  const neck = necklineGeometry(m)
  const shoulderPoint: Pt = { x: (m.shoulder.L.x - m.shoulder.R.x) / 2 + 0.01, y: m.shoulderTopY + clearance }

  // Arm direction in the frontal plane (average of left and mirrored right).
  const dx = ((m.wrist.L.x - m.shoulder.L.x) + (m.shoulder.R.x - m.wrist.R.x)) / 2
  const dy = ((m.wrist.L.y - m.shoulder.L.y) + (m.wrist.R.y - m.shoulder.R.y)) / 2
  const armLength = Math.hypot(dx, dy) || 0.55
  const d = { x: dx / armLength, y: dy / armLength }
  const n = { x: d.y, y: -d.x } // perpendicular, pointing to the underside of the arm
  const upperArmLength = (m.shoulder.L.distanceTo(m.elbow.L) + m.shoulder.R.distanceTo(m.elbow.R)) / 2
  const sleeveLength = options.sleeve === 'short' ? upperArmLength * 0.5 + 0.03 : armLength + 0.015
  // The sleeve root must pass around the arm where it meets the shoulder cap,
  // which is thicker than the upper arm; too narrow and the armpit over-stretches.
  const rootRadius = Math.max(m.armRadius.root, m.armRadius.upper * 1.08)
  const rootWidth = Math.PI * (rootRadius + clearance) * (1 + e) + 0.02
  const endRadius = options.sleeve === 'short' ? m.armRadius.upper * 0.95 : m.armRadius.wrist
  const endWidth = Math.PI * (endRadius + clearance) * (1 + e) + (options.sleeve === 'long' ? 0.03 : 0.015)

  const sleeveTop = add(shoulderPoint, scale(d, sleeveLength))
  const sleeveBottom = add(sleeveTop, scale(n, endWidth))
  const rootBottom = add(shoulderPoint, scale(n, rootWidth))

  const sideX = Math.max(m.chest.circumference, m.waist.circumference) / 4 * (1 + e) + 0.01
  const hipX = m.hips.circumference / 4 * (1 + e) + 0.012
  // Underarm: where the sleeve's underside line reaches the side seam.
  let underarm = rootBottom
  if (rootBottom.x < sideX && sleeveBottom.x > sideX) {
    const t = (sideX - sleeveBottom.x) / (rootBottom.x - sleeveBottom.x)
    underarm = { x: sideX, y: sleeveBottom.y + (rootBottom.y - sleeveBottom.y) * t }
  }
  const hemY = m.hips.y - options.hemDrop
  const hemX = Math.max(hipX, sideX) + (options.split ? 0.02 : 0)

  const half = (frontNeckDepth: number): HalfOutline => {
    const neckPoints = neckArc(neck, frontNeckDepth)
    const points: Pt[] = [...neckPoints, shoulderPoint, sleeveTop, sleeveBottom, underarm]
    const edges: string[] = neckPoints.slice(0, -1).map((_, i) => `neck-L-${i}`)
    edges.push('shoulder-L', 'sleevetop-L', 'cuff-L', 'sleeveunder-L')
    if (hemY < m.hips.y - 0.02) {
      points.push({ x: hipX, y: m.hips.y })
      edges.push('side-L-0', 'side-L-1')
    } else {
      edges.push('side-L-0')
    }
    points.push({ x: hemX, y: hemY }, { x: 0, y: hemY })
    edges.push('hem-L')
    return { points, edges }
  }

  const prefix = kind
  const meta = (side: 'front' | 'back'): PanelMetadata => ({ garment: kind, side, layer: GARMENTS[kind].layer, anchorEdges: [] })
  const back = fullPanel(`${prefix}-back`, `${GARMENTS[kind].name} back`, half(0.018), fabric, m, meta('back'))
  const sewn = ['shoulder', 'sleevetop', 'sleeveunder', 'side-0', 'side-1']
  if (!options.split) {
    const front = fullPanel(`${prefix}-front`, `${GARMENTS[kind].name} front`, half(options.frontNeck), fabric, m, meta('front'))
    return { panels: [front, back], seams: pairSeams(prefix, front, back, sewn) }
  }
  const frontL = halfPanel(`${prefix}-front-L`, `${GARMENTS[kind].name} left front`, half(options.frontNeck), 'L', fabric, m, meta('front'))
  const frontR = halfPanel(`${prefix}-front-R`, `${GARMENTS[kind].name} right front`, half(options.frontNeck), 'R', fabric, m, meta('front'))
  return {
    panels: [frontL, frontR, back],
    seams: [...pairSeams(prefix, frontL, back, sewn), ...pairSeams(prefix, frontR, back, sewn)],
  }
}

type NeckGeometry = { halfWidth: number; sideY: number }

function necklineGeometry(m: BodyMeasurements): NeckGeometry {
  return {
    halfWidth: m.neckRadius * 1.2 + 0.012,
    sideY: Math.max(m.neckBase.y + 0.02, m.shoulderTopY + 0.03),
  }
}

/** Neckline from the centre (x=0, dipped by `depth`) to the side, as a short polyline. */
function neckArc(neck: NeckGeometry, depth: number): Pt[] {
  const points: Pt[] = []
  const steps = 4
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * (Math.PI / 2)
    points.push({ x: Math.sin(a) * neck.halfWidth, y: neck.sideY - Math.cos(a) * depth })
  }
  return points
}

// ---------------------------------------------------------------------------
// Dress
// ---------------------------------------------------------------------------

function dress(m: BodyMeasurements, fabric: FabricPreset) {
  const e = 0.1
  const clearance = 0.008 + fabric.thickness
  const neck = necklineGeometry(m)
  const strap: Pt = { x: neck.halfWidth + 0.05, y: m.shoulderTopY + clearance * 0.5 }
  const sideX = m.chest.circumference / 4 * (1 + e) + 0.01
  const underarmY = Math.min(m.shoulder.L.y, m.shoulder.R.y) - 2.2 * m.armRadius.upper - 0.03
  const waistX = m.waist.circumference / 4 * (1 + e) + 0.012
  const hipX = m.hips.circumference / 4 * (1 + 0.12) + 0.015
  const hemY = (m.knee.L.y + m.knee.R.y) / 2 - 0.04
  const hemX = hipX + 0.55 * (m.hips.y - hemY)

  const half = (depth: number): HalfOutline => {
    const neckPoints = neckArc(neck, depth)
    const armhole: Pt[] = [
      { x: strap.x + 0.015, y: strap.y - 0.06 },
      { x: sideX - 0.03, y: underarmY + 0.025 },
    ]
    const points: Pt[] = [...neckPoints, strap, ...armhole, { x: sideX, y: underarmY }, { x: waistX, y: m.waist.y }, { x: hipX, y: m.hips.y }, { x: hemX, y: hemY }, { x: 0, y: hemY }]
    const edges = [...neckPoints.slice(0, -1).map((_, i) => `neck-L-${i}`), 'shoulder-L', 'armhole-L-0', 'armhole-L-1', 'armhole-L-2', 'side-L-0', 'side-L-1', 'side-L-2', 'hem-L']
    return { points, edges }
  }
  const meta = (side: 'front' | 'back'): PanelMetadata => ({ garment: 'dress', side, layer: GARMENTS.dress.layer, anchorEdges: [] })
  const front = fullPanel('dress-front', 'Dress front', half(0.1), fabric, m, meta('front'))
  const back = fullPanel('dress-back', 'Dress back', half(0.04), fabric, m, meta('back'))
  return { panels: [front, back], seams: pairSeams('dress', front, back, ['shoulder', 'side-0', 'side-1', 'side-2']) }
}

// ---------------------------------------------------------------------------
// Lower body: trousers, skirt
// ---------------------------------------------------------------------------

function trousers(m: BodyMeasurements, fabric: FabricPreset) {
  const e = 0.07
  const clearance = 0.008 + fabric.thickness
  const waistY = m.waist.y - 0.01
  const waistX = m.waist.circumference / 4 * (1 + 0.03) + 0.006
  const hipX = m.hips.circumference / 4 * (1 + e) + 0.012
  const kneeY = (m.knee.L.y + m.knee.R.y) / 2
  const kneeCenter = (m.knee.L.x - m.knee.R.x) / 2
  const ankleCenter = (m.ankle.L.x - m.ankle.R.x) / 2
  const hemY = Math.max((m.ankle.L.y + m.ankle.R.y) / 2 + 0.015, 0.03)
  const kneeHalf = Math.PI * (m.legRadius.knee + clearance) * (1 + e) / 2 + 0.012
  const hemHalf = Math.PI * (m.legRadius.ankle + clearance) * (1 + e) / 2 + 0.03
  const crotchY = m.crotchY - 0.035

  const half: HalfOutline = {
    points: [
      { x: 0, y: waistY },
      { x: waistX, y: waistY },
      { x: hipX, y: m.hips.y },
      { x: kneeCenter + kneeHalf, y: kneeY },
      { x: ankleCenter + hemHalf, y: hemY },
      { x: Math.max(0.01, ankleCenter - hemHalf), y: hemY },
      { x: Math.max(0.012, kneeCenter - kneeHalf), y: kneeY },
      { x: 0, y: crotchY },
    ],
    edges: ['waist-L', 'outer-L-0', 'outer-L-1', 'outer-L-2', 'hem-L', 'inner-L-0', 'inner-L-1'],
  }
  const meta = (side: 'front' | 'back'): PanelMetadata => ({ garment: 'trousers', side, layer: GARMENTS.trousers.layer, anchorEdges: ['waist-L', 'waist-R'] })
  const front = fullPanel('trousers-front', 'Trousers front', half, fabric, m, meta('front'))
  const back = fullPanel('trousers-back', 'Trousers back', half, fabric, m, meta('back'))
  return { panels: [front, back], seams: pairSeams('trousers', front, back, ['outer-0', 'outer-1', 'outer-2', 'inner-0', 'inner-1']) }
}

function skirt(m: BodyMeasurements, fabric: FabricPreset) {
  const waistY = m.waist.y - 0.01
  const waistX = m.waist.circumference / 4 * 1.03 + 0.006
  const hipX = m.hips.circumference / 4 * 1.1 + 0.015
  const hemY = (m.knee.L.y + m.knee.R.y) / 2 - 0.08
  const hemX = hipX + 0.6 * (m.hips.y - hemY)
  const half: HalfOutline = {
    points: [{ x: 0, y: waistY }, { x: waistX, y: waistY }, { x: hipX, y: m.hips.y }, { x: hemX, y: hemY }, { x: 0, y: hemY }],
    edges: ['waist-L', 'side-L-0', 'side-L-1', 'hem-L'],
  }
  const meta = (side: 'front' | 'back'): PanelMetadata => ({ garment: 'skirt', side, layer: GARMENTS.skirt.layer, anchorEdges: ['waist-L', 'waist-R'] })
  const front = fullPanel('skirt-front', 'Skirt front', half, fabric, m, meta('front'))
  const back = fullPanel('skirt-back', 'Skirt back', half, fabric, m, meta('back'))
  return { panels: [front, back], seams: pairSeams('skirt', front, back, ['side-0', 'side-1']) }
}

// ---------------------------------------------------------------------------
// Panel assembly
// ---------------------------------------------------------------------------

/** Mirror a left half across x=0 into a closed outline (character left then right). */
function fullPanel(id: string, name: string, half: HalfOutline, fabric: FabricPreset, m: BodyMeasurements, metadata: PanelMetadata): PatternPanel {
  const { points, edges } = half
  const loop: Pt[] = [...points]
  const loopEdges: string[] = [...edges]
  for (let i = points.length - 2; i >= 1; i -= 1) {
    loop.push({ x: -points[i].x, y: points[i].y })
    loopEdges.push(mirrorEdge(edges[i]))
  }
  loopEdges.push(mirrorEdge(edges[0]))
  return makePanel(id, name, loop, loopEdges, fabric, m, metadata)
}

/** One side of a split front: the half outline closed by an open centre-front edge. */
function halfPanel(id: string, name: string, half: HalfOutline, side: 'L' | 'R', fabric: FabricPreset, m: BodyMeasurements, metadata: PanelMetadata): PatternPanel {
  const sign = side === 'L' ? 1 : -1
  const inset = 0.006
  const loop = half.points.map((p) => ({ x: sign * Math.max(p.x, inset), y: p.y }))
  const loopEdges = [...half.edges.map((edge) => (side === 'L' ? edge : mirrorEdge(edge))), `center-${side}`]
  return makePanel(id, name, loop, loopEdges, fabric, m, metadata)
}

function mirrorEdge(edge: string) {
  return edge.replace('-L', '-R')
}

function makePanel(id: string, name: string, loop: Pt[], edgeIds: string[], fabric: FabricPreset, m: BodyMeasurements, metadata: PanelMetadata): PatternPanel {
  const s = PATTERN_UNIT_SCALE
  const points: Record<string, PatternPoint> = {}
  const pointIds = loop.map((_, i) => `${id}-p${i}`)
  loop.forEach((p, i) => {
    points[pointIds[i]] = { id: pointIds[i], x: p.x / s, y: -p.y / s, kind: 'corner' }
  })
  const edges: PatternEdge[] = loop.map((_, i) => ({ id: edgeIds[i], from: pointIds[i], to: pointIds[(i + 1) % loop.length], curve: 'line' }))
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of loop) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  const z = metadata.side === 'front' ? m.chest.centerZ + m.chest.halfDepth + 0.05 : m.chest.centerZ - m.chest.halfDepth - 0.05
  return {
    id,
    name,
    points,
    edges,
    closed: true,
    fabricId: fabric.id,
    color: fabric.color,
    particleDistance: 16,
    stretchCompliance: fabric.stretchCompliance,
    shearCompliance: fabric.shearCompliance,
    bendCompliance: fabric.bendCompliance,
    damping: fabric.damping,
    friction: fabric.friction,
    density: fabric.density,
    placement: { position: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z }, rotation: { x: 0, y: 0, z: 0 } },
    metadata,
  }
}

/** Seams between same-named edges of two panels; `names` without side suffix ('side-0' → side-L-0 & side-R-0). */
function pairSeams(prefix: string, a: PatternPanel, b: PatternPanel, names: string[]): PatternSeam[] {
  const seams: PatternSeam[] = []
  const aEdges = new Set(a.edges.map((edge) => edge.id))
  const bEdges = new Set(b.edges.map((edge) => edge.id))
  for (const name of names) {
    for (const side of ['L', 'R']) {
      const [base, ...rest] = name.split('-')
      const edgeId = [`${base}-${side}`, ...rest].join('-')
      if (!aEdges.has(edgeId) || !bEdges.has(edgeId)) continue
      const id = `${prefix}-${a.id}-${b.id}-${edgeId}`
      seams.push({ id, name: `${prefix} ${edgeId}`, a: { panelId: a.id, edgeId }, b: { panelId: b.id, edgeId }, strength: 1 })
    }
  }
  return seams
}

function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y }
}

function scale(a: Pt, s: number): Pt {
  return { x: a.x * s, y: a.y * s }
}
