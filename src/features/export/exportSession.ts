import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { appState } from '../../appState'
import {
  BODY_SKIN_TEXTURE_DEFAULTS,
  EYE_TEXTURE_DEFAULT,
  SKIN_TEXTURE_DEFAULTS,
} from '../../skinMaterial'
import { buildHairCardMesh } from '../groom/core/hairCardBuilder'
import { groomStore, getRegisteredGroomMesh } from '../groom/store/groomStore'
import type { GeneratedStrand } from '../groom/core/types'

let currentExportScene: THREE.Scene | null = null

const HEAD_SKIN_MATERIAL_ALIASES = ['mhead', 'tslheadskin', 'tslskin']
const BODY_SKIN_MATERIAL_ALIASES = ['mbody', 'tslbodyskin']
const EYE_MESH_NAMES = new Set(['Eye_L', 'Eye_R'])
const HEAD_GEOMETRY_MIN_Y = 2.65
const BODY_GEOMETRY_MAX_Y = 3.0
const BODY_GEOMETRY_MIN_HEIGHT = 1.5

const _v = new THREE.Vector3()
const _base = new THREE.Vector3()
const _morph = new THREE.Vector3()
const _skinned = new THREE.Vector3()
const _boneMatrix = new THREE.Matrix4()

export function setCurrentExportScene(scene: THREE.Scene | null) {
  currentExportScene = scene
}

export function hasCurrentExportScene() {
  return currentExportScene !== null
}

function resolveTextureUrl(url: string) {
  if (/^(blob:|data:|https?:|\/)/.test(url)) return url
  return `${import.meta.env.BASE_URL}${url}`
}

async function loadTexture(url: string | null | undefined, colorSpace: THREE.ColorSpace) {
  if (!url) return null
  const texture = await new THREE.TextureLoader().loadAsync(resolveTextureUrl(url))
  texture.colorSpace = colorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

function normalizeMaterialName(name: string) {
  return name.replace(/\.\d+$/, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function materialNameMatches(name: string, aliases: string[]) {
  const normalized = normalizeMaterialName(name)
  return aliases.some((alias) => normalized === alias || normalized.includes(alias))
}

function materialNames(mesh: THREE.Mesh) {
  const material = mesh.material
  const materials = Array.isArray(material) ? material : material ? [material] : []
  return materials.map((mat) => mat.name).filter(Boolean)
}

function hasNamedMaterial(mesh: THREE.Mesh, aliases: string[]) {
  return materialNames(mesh).some((name) => materialNameMatches(name, aliases))
}

function geometryYBounds(mesh: THREE.Mesh) {
  const geometry = mesh.geometry
  if (!geometry) return null
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const box = geometry.boundingBox
  return box ? { min: box.min.y, max: box.max.y, height: box.max.y - box.min.y } : null
}

function isHeadGeometry(mesh: THREE.Mesh) {
  const bounds = geometryYBounds(mesh)
  return Boolean(bounds && bounds.min >= HEAD_GEOMETRY_MIN_Y)
}

function isBodyGeometry(mesh: THREE.Mesh) {
  const bounds = geometryYBounds(mesh)
  return Boolean(
    bounds &&
    bounds.min < HEAD_GEOMETRY_MIN_Y &&
    bounds.max <= BODY_GEOMETRY_MAX_Y &&
    bounds.height >= BODY_GEOMETRY_MIN_HEIGHT,
  )
}

function isHeadSkinMesh(mesh: THREE.Mesh) {
  if (isBodyGeometry(mesh)) return false
  return isHeadGeometry(mesh) || mesh.name === 'Head' || hasNamedMaterial(mesh, HEAD_SKIN_MATERIAL_ALIASES)
}

function isBodySkinMesh(mesh: THREE.Mesh) {
  return isBodyGeometry(mesh) || hasNamedMaterial(mesh, BODY_SKIN_MATERIAL_ALIASES) || /body/i.test(mesh.name)
}

function isEyeMesh(mesh: THREE.Mesh) {
  return EYE_MESH_NAMES.has(mesh.name) || sourceMaterials(mesh).some((mat) => materialNameMatches(mat.name, ['tsleye']))
}

function isExportableMesh(object: THREE.Object3D): object is THREE.Mesh {
  const mesh = object as THREE.Mesh
  if (!mesh.isMesh || !mesh.geometry || !mesh.visible) return false
  if (/^Hair(?:CardsPreview|VolumeCards|Strands|Flyaways)$/.test(mesh.name)) return false
  if (/TransformControls|BoneHandle|Gizmo/i.test(mesh.name) || /Line/.test(mesh.type)) return false
  return true
}

function sourceMaterials(mesh: THREE.Mesh) {
  const material = mesh.material
  return Array.isArray(material) ? material : material ? [material] : []
}

function toExportMaterial(material: THREE.Material | undefined) {
  const mat = material as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial | undefined
  const out = new THREE.MeshStandardMaterial({
    name: material?.name ? `${material.name}_Export` : 'ExportMaterial',
    color: mat?.color ? mat.color.clone() : new THREE.Color(0xffffff),
    map: mat?.map ?? null,
    normalMap: mat?.normalMap ?? null,
    roughnessMap: mat?.roughnessMap ?? null,
    metalnessMap: mat?.metalnessMap ?? null,
    roughness: typeof mat?.roughness === 'number' ? mat.roughness : 0.75,
    metalness: typeof mat?.metalness === 'number' ? mat.metalness : 0,
    transparent: Boolean(mat?.transparent),
    opacity: typeof mat?.opacity === 'number' ? mat.opacity : 1,
    side: mat?.side ?? THREE.FrontSide,
  })
  return out
}

async function createSkinExportMaterials() {
  const headColorUrl = appState.skinTextures.colorFinal ?? SKIN_TEXTURE_DEFAULTS.colorFinal
  const headRoughnessUrl = appState.skinTextures.roughness ?? SKIN_TEXTURE_DEFAULTS.roughness
  const headNormalUrl = appState.skinTextures.wrinkleNormal ?? SKIN_TEXTURE_DEFAULTS.wrinkleNormal

  const bodyColorUrl = BODY_SKIN_TEXTURE_DEFAULTS.colorFinal
  const bodyNormalUrl = BODY_SKIN_TEXTURE_DEFAULTS.wrinkleNormal

  const [headMap, headRoughnessMap, headNormalMap, bodyMap, bodyNormalMap, eyeMap] = await Promise.all([
    loadTexture(headColorUrl, THREE.SRGBColorSpace),
    loadTexture(headRoughnessUrl, THREE.NoColorSpace),
    loadTexture(headNormalUrl, THREE.NoColorSpace),
    loadTexture(bodyColorUrl, THREE.SRGBColorSpace),
    loadTexture(bodyNormalUrl, THREE.NoColorSpace),
    loadTexture(EYE_TEXTURE_DEFAULT, THREE.SRGBColorSpace),
  ])

  const head = new THREE.MeshStandardMaterial({
    name: 'ExportHeadSkin',
    map: headMap,
    roughnessMap: headRoughnessMap,
    normalMap: headNormalMap,
    roughness: appState.surfaceRoughness,
    metalness: 0,
    side: THREE.DoubleSide,
  })

  const body = new THREE.MeshStandardMaterial({
    name: 'ExportBodySkin',
    map: bodyMap,
    normalMap: bodyNormalMap,
    roughness: appState.surfaceRoughness,
    metalness: 0,
    side: THREE.DoubleSide,
  })

  const eye = new THREE.MeshPhysicalMaterial({
    name: 'ExportEye',
    map: eyeMap,
    color: new THREE.Color(0xffffff),
    roughness: 0.018,
    metalness: 0,
    ior: 1.376,
    specularIntensity: 1,
    specularColor: new THREE.Color(1, 1, 1),
    clearcoat: 1,
    clearcoatRoughness: 0.015,
    transmission: 0.08,
    thickness: 0.06,
  })

  return { head, body, eye }
}

function getMorphedLocalPosition(mesh: THREE.Mesh, index: number, target: THREE.Vector3) {
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) return target.set(0, 0, 0)

  target.fromBufferAttribute(position, index)
  const morphPositions = geometry.morphAttributes.position ?? []
  const influences = mesh.morphTargetInfluences ?? []
  if (!morphPositions.length || !influences.length) return target

  _base.copy(target)
  for (let i = 0; i < morphPositions.length; i += 1) {
    const influence = influences[i] ?? 0
    if (Math.abs(influence) <= 1e-6) continue
    _morph.fromBufferAttribute(morphPositions[i] as THREE.BufferAttribute, index)
    if (geometry.morphTargetsRelative) target.addScaledVector(_morph, influence)
    else target.addScaledVector(_morph.sub(_base), influence)
  }
  return target
}

function applySkinning(mesh: THREE.SkinnedMesh, index: number, target: THREE.Vector3) {
  const skinIndex = mesh.geometry.getAttribute('skinIndex') as THREE.BufferAttribute | undefined
  const skinWeight = mesh.geometry.getAttribute('skinWeight') as THREE.BufferAttribute | undefined
  if (!skinIndex || !skinWeight || !mesh.skeleton) return target

  mesh.skeleton.update()
  const boneMatrices = mesh.skeleton.boneMatrices
  if (!boneMatrices) return target
  _base.copy(target).applyMatrix4(mesh.bindMatrix)
  _skinned.set(0, 0, 0)

  for (let i = 0; i < 4; i += 1) {
    const weight = skinWeight.getComponent(index, i)
    if (weight <= 0) continue
    const boneIndex = skinIndex.getComponent(index, i)
    _boneMatrix.fromArray(boneMatrices, boneIndex * 16)
    _skinned.addScaledVector(_v.copy(_base).applyMatrix4(_boneMatrix), weight)
  }

  return target.copy(_skinned.applyMatrix4(mesh.bindMatrixInverse))
}

function bakeMeshGeometry(mesh: THREE.Mesh) {
  const source = mesh.geometry
  const position = source.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) return null

  const positions = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i += 1) {
    getMorphedLocalPosition(mesh, i, _v)
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      applySkinning(mesh as THREE.SkinnedMesh, i, _v)
    }
    _v.applyMatrix4(mesh.matrixWorld)
    positions[i * 3] = _v.x
    positions[i * 3 + 1] = _v.y
    positions[i * 3 + 2] = _v.z
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const uv = source.getAttribute('uv')
  if (uv) geometry.setAttribute('uv', uv.clone())

  const color = source.getAttribute('color')
  if (color) geometry.setAttribute('color', color.clone())

  const index = source.getIndex()
  if (index) geometry.setIndex(index.clone())
  geometry.groups = source.groups.map((group) => ({ ...group }))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function addBakedHairCards(exportScene: THREE.Scene) {
  const strands = groomStore.generatedStrands as GeneratedStrand[]
  if (!strands.length) return 0
  const hairCards = buildHairCardMesh(strands, groomStore.cardComplexity, groomStore.activeGroomAsset.material)
  if (!hairCards.cardCount) return 0

  const geometry = hairCards.geometry.clone()
  const targetMesh = getRegisteredGroomMesh(groomStore.activeGroomAsset.targetMeshId)
  if (targetMesh) geometry.applyMatrix4(targetMesh.matrixWorld)
  geometry.computeVertexNormals()

  const atlas = new THREE.CanvasTexture(hairCards.atlasCanvas)
  atlas.colorSpace = THREE.SRGBColorSpace
  atlas.flipY = false
  atlas.needsUpdate = true

  const material = new THREE.MeshStandardMaterial({
    name: 'ExportHairCards',
    map: atlas,
    alphaTest: 0.45,
    transparent: false,
    roughness: 0.88,
    metalness: 0,
    side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'HairCards'
  exportScene.add(mesh)
  return hairCards.cardCount
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function exportCurrentSessionGLB(filename = 'human-session.glb') {
  if (!currentExportScene) {
    throw new Error('No active 3D scene is available to export.')
  }

  currentExportScene.updateMatrixWorld(true)
  const exportScene = new THREE.Scene()
  exportScene.name = 'HumanExport'
  const skinMaterials = await createSkinExportMaterials()
  let meshCount = 0

  currentExportScene.traverse((object) => {
    if (!isExportableMesh(object)) return
    const geometry = bakeMeshGeometry(object)
    if (!geometry) return

    const materials = sourceMaterials(object)
    const material = isEyeMesh(object)
      ? skinMaterials.eye
      : isHeadSkinMesh(object)
        ? skinMaterials.head
        : isBodySkinMesh(object)
          ? skinMaterials.body
          : materials.length > 1
            ? materials.map((mat) => toExportMaterial(mat))
            : toExportMaterial(materials[0])

    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = object.name || `Mesh_${meshCount + 1}`
    exportScene.add(mesh)
    meshCount += 1
  })

  const hairCardCount = addBakedHairCards(exportScene)
  const exporter = new GLTFExporter()
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      exportScene,
      (result) => resolve(result as ArrayBuffer),
      (error) => reject(error),
      { binary: true, onlyVisible: true, trs: false },
    )
  })

  downloadBlob(new Blob([buffer], { type: 'model/gltf-binary' }), filename)
  return { meshCount, hairCardCount }
}
