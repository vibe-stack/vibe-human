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
  groomStore.generatedStrands = generateStrandsFromGuides(groomStore.activeGroomAsset)
}

function setGuides(nextGuides: GroomAsset['guides']) {
  groomStore.activeGroomAsset.guides = nextGuides
  regenerateGeneratedStrandsInternal()
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
}

export function clearScalpMask() {
  groomStore.activeGroomAsset.scalpMask.selectedTriangleIndices = []
}

export function updateScalpMaskTriangles(triangleIndices: number[], mode: 'add' | 'remove') {
  const current = new Set(groomStore.activeGroomAsset.scalpMask.selectedTriangleIndices)

  for (const triangleIndex of triangleIndices) {
    if (mode === 'add') current.add(triangleIndex)
    else current.delete(triangleIndex)
  }

  groomStore.activeGroomAsset.scalpMask.selectedTriangleIndices = Array.from(current).sort((a, b) => a - b)
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
