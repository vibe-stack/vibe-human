import { nanoid } from '../../../utils/nanoid'
import { clothingStore } from './clothingStore'
import type { ClothSimQuality, ClothingTool, GarmentDocument, PatternEdge, PatternPiece, PatternPoint, Seam, Vec2 } from './clothingTypes'

// ---------------------------------------------------------------------------
// Helper: generate a short id without external dep
// ---------------------------------------------------------------------------
function uid() {
  return nanoid(8)
}

// ---------------------------------------------------------------------------
// Tool selection
// ---------------------------------------------------------------------------

export function setActiveClothingTool(tool: ClothingTool) {
  clothingStore.activeClothingTool = tool
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function selectPattern(id: string | undefined) {
  clothingStore.garment.selectedPatternId = id
  clothingStore.garment.selectedPointId = undefined
  clothingStore.garment.selectedEdgeId = undefined
}

export function selectPoint(id: string | undefined) {
  clothingStore.garment.selectedPointId = id
}

export function selectEdge(id: string | undefined) {
  clothingStore.garment.selectedEdgeId = id
}

export function clearSelection() {
  clothingStore.garment.selectedPatternId = undefined
  clothingStore.garment.selectedPointId = undefined
  clothingStore.garment.selectedEdgeId = undefined
  clothingStore.garment.selectedSeamId = undefined
}

// ---------------------------------------------------------------------------
// Point mutation
// ---------------------------------------------------------------------------

export function movePoint(patternId: string, pointId: string, x: number, y: number) {
  const pattern = clothingStore.garment.patterns[patternId]
  if (!pattern) return
  const pt = pattern.points[pointId]
  if (!pt) return
  pt.x = x
  pt.y = y
  clothingStore.dirty.previewDirty = true
  clothingStore.dirty.triangulationDirty = true
}

export function addPoint(patternId: string, x: number, y: number) {
  const pattern = clothingStore.garment.patterns[patternId]
  if (!pattern) return
  const id = uid()
  pattern.points[id] = { id, x, y, kind: 'corner' }
  clothingStore.dirty.previewDirty = true
}

export function moveHandle(patternId: string, pointId: string, handleKind: 'in' | 'out', x: number, y: number) {
  const pattern = clothingStore.garment.patterns[patternId]
  const point = pattern?.points[pointId]
  if (!pattern || !point) return

  point[handleKind] = { x: x - point.x, y: y - point.y }
  point.kind = 'smooth'
  clothingStore.dirty.previewDirty = true
  clothingStore.dirty.triangulationDirty = true
}

export function convertEdgeToCurve(patternId: string, edgeId: string) {
  const pattern = clothingStore.garment.patterns[patternId]
  const edge = pattern?.edges.find((item) => item.id === edgeId)
  if (!pattern || !edge) return

  const from = pattern.points[edge.from]
  const to = pattern.points[edge.to]
  if (!from || !to) return

  edge.curve = 'cubic'
  from.out = from.out ?? { x: (to.x - from.x) / 3, y: (to.y - from.y) / 3 }
  to.in = to.in ?? { x: (from.x - to.x) / 3, y: (from.y - to.y) / 3 }
  from.kind = 'smooth'
  to.kind = 'smooth'
  clothingStore.dirty.previewDirty = true
  clothingStore.dirty.triangulationDirty = true
}

function makePoint(id: string, x: number, y: number): PatternPoint {
  return { id, x, y, kind: 'corner' }
}

function makeEdge(from: string, to: string, curve: 'line' | 'cubic' = 'line'): PatternEdge {
  return { id: uid(), from, to, curve }
}

export function createRectanglePattern(center: Vec2, width = 180, height = 140): string {
  const id = uid()
  const topLeft = makePoint(uid(), center.x - width / 2, center.y - height / 2)
  const topRight = makePoint(uid(), center.x + width / 2, center.y - height / 2)
  const bottomRight = makePoint(uid(), center.x + width / 2, center.y + height / 2)
  const bottomLeft = makePoint(uid(), center.x - width / 2, center.y + height / 2)
  const piece: PatternPiece = {
    id,
    name: `Pattern ${Object.keys(clothingStore.garment.patterns).length + 1}`,
    points: {
      [topLeft.id]: topLeft,
      [topRight.id]: topRight,
      [bottomRight.id]: bottomRight,
      [bottomLeft.id]: bottomLeft,
    },
    edges: [
      makeEdge(topLeft.id, topRight.id),
      makeEdge(topRight.id, bottomRight.id),
      makeEdge(bottomRight.id, bottomLeft.id),
      makeEdge(bottomLeft.id, topLeft.id),
    ],
    closed: true,
    particleDistance: 22,
  }

  clothingStore.garment.patterns[id] = piece
  clothingStore.garment.selectedPatternId = id
  clothingStore.garment.selectedPointId = undefined
  clothingStore.garment.selectedEdgeId = undefined
  markPreviewDirty()
  return id
}

export function deletePoint(patternId: string, pointId: string) {
  const pattern = clothingStore.garment.patterns[patternId]
  if (!pattern) return
  delete pattern.points[pointId]
  pattern.edges = pattern.edges.filter((e) => e.from !== pointId && e.to !== pointId)
  clothingStore.dirty.previewDirty = true
  clothingStore.dirty.triangulationDirty = true
}

// ---------------------------------------------------------------------------
// Pattern piece CRUD
// ---------------------------------------------------------------------------

export function createPatternPiece(): string {
  const id = uid()
  const piece: PatternPiece = {
    id,
    name: `Pattern ${Object.keys(clothingStore.garment.patterns).length + 1}`,
    points: {},
    edges: [],
    closed: false,
    particleDistance: 20,
  }
  clothingStore.garment.patterns[id] = piece
  return id
}

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

export function createSeam(
  patternIdA: string,
  edgeIdA: string,
  patternIdB: string,
  edgeIdB: string,
): string {
  const id = uid()
  const seam: Seam = {
    id,
    name: `Seam ${Object.keys(clothingStore.garment.seams).length + 1}`,
    a: { patternId: patternIdA, edgeId: edgeIdA },
    b: { patternId: patternIdB, edgeId: edgeIdB },
    strength: 1,
  }
  clothingStore.garment.seams[id] = seam
  return id
}

export function makeHoleFromPattern(targetPatternId: string, cutterPatternId: string) {
  if (targetPatternId === cutterPatternId) return
  const target = clothingStore.garment.patterns[targetPatternId]
  const cutter = clothingStore.garment.patterns[cutterPatternId]
  if (!target || !cutter || !cutter.closed || cutter.edges.length < 3) return

  for (const point of Object.values(cutter.points)) {
    target.points[point.id] = { ...point }
  }
  target.holes = target.holes ?? []
  target.holes.push(cutter.edges.map((edge) => ({ ...edge })))

  delete clothingStore.garment.patterns[cutterPatternId]
  clothingStore.garment.selectedPatternId = targetPatternId
  clothingStore.garment.selectedPointId = undefined
  clothingStore.garment.selectedEdgeId = undefined
  markPreviewDirty()
}

// ---------------------------------------------------------------------------
// Hover (called by PatternPicker)
// ---------------------------------------------------------------------------

export function setHoveredEntity(
  id: string | null,
  type: 'point' | 'edge' | 'pattern' | 'seam' | null,
) {
  clothingStore.viewport2D.hoveredEntityId = id
  clothingStore.viewport2D.hoveredEntityType = type
}

// ---------------------------------------------------------------------------
// Preview dirty flags
// ---------------------------------------------------------------------------

export function markPreviewDirty() {
  clothingStore.dirty.previewDirty = true
  clothingStore.dirty.triangulationDirty = true
}

export function toggleSimRunning() {
  clothingStore.simRunning = !clothingStore.simRunning
}

export function stopSim() {
  clothingStore.simRunning = false
}

export function resetSim() {
  clothingStore.simResetKey += 1
  clothingStore.simRunning = false
}

export function setSimQuality(quality: ClothSimQuality) {
  if (clothingStore.simQuality === quality) return
  clothingStore.simQuality = quality
  clothingStore.simResetKey += 1
  clothingStore.simRunning = false
}

// ---------------------------------------------------------------------------
// Load garment document (replaces current)
// ---------------------------------------------------------------------------

export function loadDemoGarment(doc: GarmentDocument) {
  clothingStore.garment = doc
  clothingStore.viewport2D.zoom = 1.35
  clothingStore.viewport2D.panX = 0
  clothingStore.viewport2D.panY = 0
  clothingStore.viewport2D.hoveredEntityId = null
  clothingStore.viewport2D.hoveredEntityType = null
  clothingStore.dirty.previewDirty = true
  clothingStore.dirty.triangulationDirty = true
}
