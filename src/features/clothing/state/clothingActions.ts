import { nanoid } from '../../../utils/nanoid'
import { clothingStore } from './clothingStore'
import { pushHistory } from './historyActions'
import { setSelectedPatterns } from './transformActions'
import type {
  ClothSimQuality,
  ClothingTool,
  ClothingTransformMode,
  GarmentDocument,
  PatternPiece,
  PatternPlacement,
  Seam,
} from './clothingTypes'

const uid = () => nanoid(8)

// ---------------------------------------------------------------------------
// Re-export submodules so existing imports keep working
// ---------------------------------------------------------------------------

export * from './historyActions'
export * from './shapeActions'
export * from './pointActions'
export * from './transformActions'

// ---------------------------------------------------------------------------
// Tool selection
// ---------------------------------------------------------------------------

export function setActiveClothingTool(tool: ClothingTool) {
  if (clothingStore.activeClothingTool === tool) return
  clothingStore.activeClothingTool = tool
  // Switching tools cancels any in-progress draft
  clothingStore.draft = null
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function selectPattern(id: string | undefined) {
  clothingStore.garment.selectedPatternId = id
  clothingStore.garment.selectedPointId = undefined
  clothingStore.garment.selectedEdgeId = undefined
  clothingStore.selectedPatternIds = id ? [id] : []
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
  clothingStore.selectedPatternIds = []
}

export { setSelectedPatterns }

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

export function createSeam(
  patternIdA: string,
  edgeIdA: string,
  patternIdB: string,
  edgeIdB: string,
): string {
  pushHistory()
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

export function deleteSeam(seamId: string) {
  if (!clothingStore.garment.seams[seamId]) return
  pushHistory()
  delete clothingStore.garment.seams[seamId]
}

// ---------------------------------------------------------------------------
// Boolean: punch a hole in target using cutter outline.
// History is pushed so this is properly undoable / revertible.
// ---------------------------------------------------------------------------

/**
 * Subtract the topmost selected piece from the others. The last item in
 * `clothingStore.selectedPatternIds` is treated as the cutter; all earlier
 * ids become targets. This is the only "blessed" entry point for boolean
 * subtract — explicit, predictable, and undoable.
 */
export function subtractTopFromSelection(): boolean {
  const ids = [...clothingStore.selectedPatternIds]
  if (ids.length < 2) return false
  const cutterId = ids[ids.length - 1]
  const targetIds = ids.slice(0, -1)
  const cutter = clothingStore.garment.patterns[cutterId]
  if (!cutter || !cutter.closed || cutter.edges.length < 3) return false

  pushHistory()
  for (const targetId of targetIds) {
    const target = clothingStore.garment.patterns[targetId]
    if (!target) continue
    for (const point of Object.values(cutter.points)) {
      target.points[point.id] = { ...point }
    }
    target.holes = target.holes ?? []
    target.holes.push(cutter.edges.map((edge) => ({ ...edge })))
  }
  delete clothingStore.garment.patterns[cutterId]
  clothingStore.selectedPatternIds = targetIds
  clothingStore.garment.selectedPatternId = targetIds[0]
  clothingStore.dirty.previewDirty = true
  clothingStore.dirty.triangulationDirty = true
  return true
}

export function makeHoleFromPattern(targetPatternId: string, cutterPatternId: string) {
  if (targetPatternId === cutterPatternId) return
  const target = clothingStore.garment.patterns[targetPatternId]
  const cutter = clothingStore.garment.patterns[cutterPatternId]
  if (!target || !cutter || !cutter.closed || cutter.edges.length < 3) return

  pushHistory()
  for (const point of Object.values(cutter.points)) {
    target.points[point.id] = { ...point }
  }
  target.holes = target.holes ?? []
  target.holes.push(cutter.edges.map((edge) => ({ ...edge })))

  delete clothingStore.garment.patterns[cutterPatternId]
  clothingStore.garment.selectedPatternId = targetPatternId
  clothingStore.garment.selectedPointId = undefined
  clothingStore.garment.selectedEdgeId = undefined
  clothingStore.selectedPatternIds = [targetPatternId]
  clothingStore.dirty.previewDirty = true
  clothingStore.dirty.triangulationDirty = true
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

export function setHoveredEntity(
  id: string | null,
  type: 'point' | 'edge' | 'pattern' | 'seam' | null,
) {
  clothingStore.viewport2D.hoveredEntityId = id
  clothingStore.viewport2D.hoveredEntityType = type
}

// ---------------------------------------------------------------------------
// Pattern piece blank create
// ---------------------------------------------------------------------------

export function createPatternPiece(): string {
  pushHistory()
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
// Preview dirty flags
// ---------------------------------------------------------------------------

export function markPreviewDirty() {
  clothingStore.dirty.previewDirty = true
  clothingStore.dirty.triangulationDirty = true
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

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

export function setTransformMode(mode: ClothingTransformMode) {
  clothingStore.transformMode = mode
}

export function setPatternPlacement(patternId: string, placement: PatternPlacement) {
  clothingStore.placements[patternId] = placement
}

/** Wipe placements for the given pieces (or all selected if none passed)
 *  so they fall back to defaultPlacement. Bumps the sim reset key so the
 *  solver re-spawns at the new (default) frame. */
export function resetPatternTransforms(patternIds?: string[]) {
  const ids = patternIds ?? [...clothingStore.selectedPatternIds]
  if (ids.length === 0) {
    for (const k of Object.keys(clothingStore.placements)) delete clothingStore.placements[k]
  } else {
    for (const id of ids) delete clothingStore.placements[id]
  }
  clothingStore.simResetKey += 1
  clothingStore.simRunning = false
}

// ---------------------------------------------------------------------------
// Document loading
// ---------------------------------------------------------------------------

export function loadDemoGarment(doc: GarmentDocument) {
  clothingStore.garment = doc
  clothingStore.placements = {}
  const patternIds = Object.keys(doc.patterns)
  if (patternIds.length === 1) {
    clothingStore.placements[patternIds[0]] = {
      position: { x: 0, y: -0.74, z: 0.3 },
      rotation: { x: 0, y: 0, z: 0 },
    }
  } else if (patternIds.length >= 2) {
    const [frontId, backId] = patternIds
    clothingStore.placements[frontId] = {
      position: { x: 0, y: -0.74, z: 0.3 },
      rotation: { x: 0, y: 0, z: 0 },
    }
    clothingStore.placements[backId] = {
      position: { x: 0, y: -0.74, z: -0.3 },
      rotation: { x: 0, y: Math.PI, z: 0 },
    }
  }
  clothingStore.viewport2D.zoom = 1.35
  clothingStore.viewport2D.panX = 0
  clothingStore.viewport2D.panY = 0
  clothingStore.viewport2D.hoveredEntityId = null
  clothingStore.viewport2D.hoveredEntityType = null
  clothingStore.history.past.length = 0
  clothingStore.history.future.length = 0
  clothingStore.selectedPatternIds = doc.selectedPatternId ? [doc.selectedPatternId] : []
  clothingStore.dirty.previewDirty = true
  clothingStore.dirty.triangulationDirty = true
}

// ---------------------------------------------------------------------------
// Legacy compatibility — previous code paths still use these names.
// They forward to the raw (no-history) helpers in pointActions.
// Callers wanting history must push it themselves before dragging.
// ---------------------------------------------------------------------------

export { movePointRaw as movePoint, moveHandleRaw as moveHandle } from './pointActions'

export function setRectanglePatternBounds(_patternId: string, _a: { x: number; y: number }, _b: { x: number; y: number }) {
  // Retained for any external caller — no-op since rectangle drafting is now
  // handled by the draft system. The original use-case (live rubber-band
  // rectangle while drawing) is now drawn as a preview, not a committed piece.
}
