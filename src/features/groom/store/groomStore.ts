import { proxy } from 'valtio'
import * as THREE from 'three'
import {
  clampGroomSettings,
  createEmptyGroomAsset,
} from '../core/groomAsset'
import {
  applyGuideSettingsToGuides,
  createGuideCurve,
  cutGuidesAtPoint,
  deleteGuidesAtPoint,
  generateGuidesFromScalpSelection,
  smoothGuidesAtPoint,
  combGuidesAtPoint,
} from '../core/guideCurves'
import { computeBarycentricForPoint, getTriangleCount, getTriangleSurfaceData } from '../core/scalpBinding'
import { setSkinFollicleTint, setSkinScalpMaskTexture } from '../../../skinMaterial'
import { createScalpMaskTexture, type ScalpMaskTexture } from '../core/scalpMaskTexture'
import { setHairRootFollicleColor, type HairMaterial } from '../shaders/hairStrandMaterial'
import { generateStrandsFromGuides } from '../core/strandGeneration'
import type {
  GeneratedStrand,
  GroomAsset,
  GroomModifierSettings,
  GroomTool,
  HairMaterialSettings,
  RegisteredGroomMesh,
} from '../core/types'

type GroomState = {
  activeGroomAsset: GroomAsset
  selectedGuideId: string | null
  activeGroomTool: GroomTool
  brushSize: number
  brushStrength: number
  showGuides: boolean
  showGeneratedStrands: boolean
  showScalpMask: boolean
  generatedStrands: GeneratedStrand[]
  availableMeshes: RegisteredGroomMesh[]
  sceneSelectionMeshId: string | null
}

const registeredMeshes = new Map<string, THREE.Mesh>()

// Optional skin material(s) that should receive the follicle tint / scalp
// mask vertex attribute updates.  Registered by the host scene (HumanModel
// imports `registerSkinMaterialForGroom` after creating the skin material).
const registeredSkinMaterials = new Set<THREE.Material>()

// Lazily created once we have a skin material to feed it into.  Lives for
// the lifetime of the app — only the pixel data is mutated when the user
// paints or erases scalp.
let scalpMaskTexture: ScalpMaskTexture | null = null
function ensureScalpMaskTexture(): ScalpMaskTexture {
  if (!scalpMaskTexture) scalpMaskTexture = createScalpMaskTexture()
  return scalpMaskTexture
}

export function registerSkinMaterialForGroom(mat: THREE.Material) {
  registeredSkinMaterials.add(mat)
  // Bind our scalp mask texture into the new material so it samples the
  // same data the groom system has been writing into.
  setSkinScalpMaskTexture(mat, ensureScalpMaskTexture().texture)
  applyFollicleTintToRegisteredSkins()
}
export function unregisterSkinMaterialForGroom(mat: THREE.Material) {
  registeredSkinMaterials.delete(mat)
}

// Derive the follicle color from the active hair material — mid-tone of the
// melanin model is what reads as "follicle" on skin.
function deriveFollicleColor(): { hex: string; strength: number } {
  const mat = groomStore.activeGroomAsset.material
  // Roughly: dark, slightly warm colour.  We compute exp(-σ_a * 5) on a
  // mid-eumelanin sample so the tint follows melanin/redness changes.
  const m = mat.melanin
  const r = mat.melaninRedness
  const eu = [0.419, 0.697, 1.37]
  const ph = [0.187, 0.4, 1.05]
  const sigma = [
    m * (eu[0] * (1 - r) + ph[0] * r),
    m * (eu[1] * (1 - r) + ph[1] * r),
    m * (eu[2] * (1 - r) + ph[2] * r),
  ].map((s) => Math.exp(-s * 5))
  const toHex = (c: number) => Math.max(0, Math.min(255, Math.round(c * 255)))
  const hex = `#${toHex(sigma[0]).toString(16).padStart(2, '0')}${toHex(sigma[1]).toString(16).padStart(2, '0')}${toHex(sigma[2]).toString(16).padStart(2, '0')}`
  // Strength scales with whether there's any scalp painted at all.
  const hasMask = groomStore.activeGroomAsset.scalpMask.selectedTriangleIndices.length > 0
  return { hex, strength: hasMask ? 0.85 : 0 }
}

// The active hair material — the GroomRenderer registers it once at mount
// so the store can push the follicle colour into it whenever the hair
// colour or scalp paint changes.  Without this, the strand root would be
// coloured by the absorption model while the skin is tinted independently,
// and the boundary would never match.
let registeredHairMaterial: HairMaterial | null = null
export function registerHairMaterialForGroom(mat: HairMaterial) {
  registeredHairMaterial = mat
  applyFollicleTintToRegisteredSkins()
}
export function unregisterHairMaterialForGroom(mat: HairMaterial) {
  if (registeredHairMaterial === mat) registeredHairMaterial = null
}

function applyFollicleTintToRegisteredSkins() {
  const { hex, strength } = deriveFollicleColor()
  for (const mat of registeredSkinMaterials) setSkinFollicleTint(mat, hex, strength)
  // Push the same follicle colour into the strand root so they visually meet.
  if (registeredHairMaterial) setHairRootFollicleColor(registeredHairMaterial, hex)
}

// Update the follicle tint + UV-space scalp mask texture whenever the asset
// changes.  Throttled via rAF so paint drags don't rasterize per tick.
let scalpAttrDirty = 0
function scheduleScalpAttrSync() {
  if (scalpAttrDirty) return
  scalpAttrDirty = requestAnimationFrame(() => {
    scalpAttrDirty = 0
    const mesh = getRegisteredGroomMesh(groomStore.activeGroomAsset.targetMeshId)
    if (mesh && mesh.geometry instanceof THREE.BufferGeometry) {
      ensureScalpMaskTexture().rebuild(
        mesh.geometry,
        groomStore.activeGroomAsset.scalpMask.selectedTriangleIndices,
      )
    }
    applyFollicleTintToRegisteredSkins()
  })
}

function buildObjectPath(object: THREE.Object3D) {
  const parts: string[] = []
  let current: THREE.Object3D | null = object

  while (current) {
    const currentName = current.name
    const siblings = current.parent?.children.filter((child) => child.name === currentName) ?? [current]
    const siblingIndex = siblings.indexOf(current)
    parts.push(`${currentName || current.type}[${Math.max(0, siblingIndex)}]`)
    current = current.parent
  }

  return parts.reverse().join('/')
}

function regenerateGeneratedStrandsInternal() {
  const mesh = getRegisteredGroomMesh(groomStore.activeGroomAsset.targetMeshId)
  groomStore.generatedStrands = generateStrandsFromGuides(groomStore.activeGroomAsset, mesh ?? undefined)
}

// Strand regeneration is expensive (10k+ strands → ~50ms).  During an
// interactive drag we *skip strand regeneration entirely* and only rebuild
// once at pointer up — guide overlay edits remain visible in real time.
let dragInProgress = false
export function beginGroomDrag() { dragInProgress = true }
export function endGroomDrag() {
  dragInProgress = false
  regenerateGeneratedStrandsInternal()
}

function setGuides(nextGuides: GroomAsset['guides']) {
  groomStore.activeGroomAsset.guides = nextGuides
  // Defer strand regen during drags; guide overlay still updates live.
  if (!dragInProgress) regenerateGeneratedStrandsInternal()
}

export const groomStore = proxy<GroomState>({
  activeGroomAsset: createEmptyGroomAsset(),
  selectedGuideId: null,
  activeGroomTool: 'none',
  brushSize: 0.045,
  brushStrength: 0.7,
  showGuides: true,
  showGeneratedStrands: true,
  showScalpMask: true,
  generatedStrands: [],
  availableMeshes: [],
  sceneSelectionMeshId: null,
})

export function getRegisteredGroomMesh(meshId: string | null) {
  return meshId ? registeredMeshes.get(meshId) ?? null : null
}

export function getRegisteredGroomMeshes() {
  return groomStore.availableMeshes
}

export function registerGroomMeshes(meshes: THREE.Mesh[]) {
  registeredMeshes.clear()

  const descriptors = meshes.map((mesh) => {
    const meshId = buildObjectPath(mesh)
    mesh.userData.groomMeshId = meshId
    registeredMeshes.set(meshId, mesh)

    return {
      id: meshId,
      name: mesh.name || mesh.type,
      triangleCount: getTriangleCount(mesh.geometry as THREE.BufferGeometry),
    }
  })

  groomStore.availableMeshes = descriptors

  if (!groomStore.sceneSelectionMeshId && descriptors.length > 0) {
    groomStore.sceneSelectionMeshId = descriptors[0].id
  }

  if (groomStore.activeGroomAsset.targetMeshId && !registeredMeshes.has(groomStore.activeGroomAsset.targetMeshId)) {
    groomStore.activeGroomAsset.targetMeshId = null
    groomStore.activeGroomAsset.scalpMask.selectedTriangleIndices = []
    setGuides([])
  }
}

export function setActiveGroomTool(tool: GroomTool) {
  groomStore.activeGroomTool = tool
}

export function setBrushSize(value: number) {
  groomStore.brushSize = Math.min(0.2, Math.max(0.005, value))
}

export function setBrushStrength(value: number) {
  groomStore.brushStrength = Math.min(1, Math.max(0.05, value))
}

export function setSceneSelectionMeshId(meshId: string | null) {
  groomStore.sceneSelectionMeshId = meshId
}

export function useSelectedMeshAsGroomTarget() {
  if (!groomStore.sceneSelectionMeshId) return

  groomStore.activeGroomAsset.targetMeshId = groomStore.sceneSelectionMeshId
  groomStore.activeGroomAsset.scalpMask.selectedTriangleIndices = []
  groomStore.selectedGuideId = null
  setGuides([])
  scheduleScalpAttrSync()
}

export function clearScalpMask() {
  groomStore.activeGroomAsset.scalpMask.selectedTriangleIndices = []
  groomStore.generatedStrands = []
  scheduleScalpAttrSync()
}

// Working set kept in sync with the proxy so we don't pay O(N log N) on
// every drag tick.  Reset whenever the array reference changes externally.
let scalpMaskSet: Set<number> | null = null
let scalpMaskSetVersion: number[] | null = null

function ensureScalpMaskSet(): Set<number> {
  const arr = groomStore.activeGroomAsset.scalpMask.selectedTriangleIndices
  if (scalpMaskSet && scalpMaskSetVersion === arr) return scalpMaskSet
  scalpMaskSet = new Set(arr)
  scalpMaskSetVersion = arr as number[]
  return scalpMaskSet
}

export function updateScalpMaskTriangles(triangleIndices: number[], mode: 'add' | 'remove') {
  const set = ensureScalpMaskSet()
  let changed = false
  for (const triangleIndex of triangleIndices) {
    if (mode === 'add') {
      if (!set.has(triangleIndex)) { set.add(triangleIndex); changed = true }
    } else if (set.delete(triangleIndex)) {
      changed = true
    }
  }
  if (!changed) return
  // Maintain insertion-order array; skip the sort during drags.
  const next = Array.from(set)
  if (!dragInProgress) next.sort((a, b) => a - b)
  scalpMaskSetVersion = next
  groomStore.activeGroomAsset.scalpMask.selectedTriangleIndices = next
  scheduleScalpAttrSync()
}

export function addGuideAtSurfacePoint(mesh: THREE.Mesh, triangleIndex: number, pointLocal: THREE.Vector3) {
  const geometry = mesh.geometry
  if (!(geometry instanceof THREE.BufferGeometry)) return

  const surface = getTriangleSurfaceData(geometry, triangleIndex)
  if (!surface) return

  const root = {
    meshId: groomStore.activeGroomAsset.targetMeshId ?? '',
    triangleIndex,
    barycentric: computeBarycentricForPoint(pointLocal, surface.a, surface.b, surface.c),
    localNormalOffset: 0.0015,
  }
  const guide = createGuideCurve(root, pointLocal, surface.normal, groomStore.activeGroomAsset.settings)
  setGuides([...groomStore.activeGroomAsset.guides, guide].slice(0, 200))
  groomStore.selectedGuideId = guide.id
}

export function generateGuidesFromActiveScalp() {
  const mesh = getRegisteredGroomMesh(groomStore.activeGroomAsset.targetMeshId)
  if (!mesh) return

  const guides = generateGuidesFromScalpSelection(
    mesh,
    groomStore.activeGroomAsset.targetMeshId ?? '',
    groomStore.activeGroomAsset.scalpMask.selectedTriangleIndices,
    groomStore.activeGroomAsset.settings,
  )
  setGuides(guides)
  groomStore.selectedGuideId = guides[0]?.id ?? null
}

export function updateGuideTools(
  operation: 'comb' | 'smooth' | 'cut' | 'delete',
  pointLocal: THREE.Vector3,
  deltaLocal?: THREE.Vector3,
) {
  const radius = groomStore.brushSize
  const strength = groomStore.brushStrength

  if (operation === 'comb' && deltaLocal) {
    setGuides(
      combGuidesAtPoint(
        groomStore.activeGroomAsset.guides,
        pointLocal,
        deltaLocal,
        radius,
        strength * 0.8,
      ),
    )
    return
  }

  if (operation === 'smooth') {
    setGuides(smoothGuidesAtPoint(groomStore.activeGroomAsset.guides, pointLocal, radius))
    return
  }

  if (operation === 'cut') {
    setGuides(cutGuidesAtPoint(groomStore.activeGroomAsset.guides, pointLocal, radius, strength))
    return
  }

  setGuides(deleteGuidesAtPoint(groomStore.activeGroomAsset.guides, pointLocal, radius))
}

export function setModifierSetting<K extends keyof GroomModifierSettings>(key: K, value: GroomModifierSettings[K]) {
  groomStore.activeGroomAsset.settings = clampGroomSettings({
    ...groomStore.activeGroomAsset.settings,
    [key]: value,
  })

  if (key === 'guideLength' || key === 'guideRadius' || key === 'guideSegments') {
    setGuides(
      applyGuideSettingsToGuides(
        groomStore.activeGroomAsset.guides,
        groomStore.activeGroomAsset.settings,
        groomStore.selectedGuideId,
      ),
    )
    return
  }

  regenerateGeneratedStrandsInternal()
}

export function setHairMaterialSetting<K extends keyof HairMaterialSettings>(key: K, value: HairMaterialSettings[K]) {
  groomStore.activeGroomAsset.material = {
    ...groomStore.activeGroomAsset.material,
    [key]: value,
  }
  // Hair colour changes — push to skin so the follicle tint follows along.
  if (key === 'melanin' || key === 'melaninRedness' || key === 'tintColor') {
    scheduleScalpAttrSync()
  }
}

export function setShowGuides(value: boolean) {
  groomStore.showGuides = value
}

export function setShowGeneratedStrands(value: boolean) {
  groomStore.showGeneratedStrands = value
}

export function setShowScalpMask(value: boolean) {
  groomStore.showScalpMask = value
}

export function regenerateGeneratedStrands() {
  regenerateGeneratedStrandsInternal()
}

export function replaceActiveGroomAsset(asset: GroomAsset) {
  groomStore.activeGroomAsset = {
    ...asset,
    settings: clampGroomSettings(asset.settings),
  }
  groomStore.selectedGuideId = asset.guides[0]?.id ?? null
  regenerateGeneratedStrandsInternal()
}
