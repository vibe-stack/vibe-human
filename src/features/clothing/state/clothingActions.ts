import { nanoid } from '../../../utils/nanoid'
import { clothingStore } from './clothingStore'
import type { ClothingTool, GarmentDocument, PatternPiece, Seam } from './clothingTypes'

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
  clothingStore.simRunning = true
}

// ---------------------------------------------------------------------------
// Load garment document (replaces current)
// ---------------------------------------------------------------------------

export function loadDemoGarment(doc: GarmentDocument) {
  clothingStore.garment = doc
  clothingStore.dirty.previewDirty = true
  clothingStore.dirty.triangulationDirty = true
}
