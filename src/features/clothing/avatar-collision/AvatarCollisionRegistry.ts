import * as THREE from 'three/webgpu'
import type {
  ColliderSnapshot,
  CollisionAvatar,
  CollisionAvatarProxy,
  CollisionMeshPatch,
  CollisionRegion,
  MeshSurfaceColliderSnapshot,
} from '../simulation/types'

type Listener = () => void
type RegionSamples = Record<CollisionRegion, THREE.Vector3[]>
type RegionCounts = Partial<Record<CollisionRegion, number>>

type CollisionAvatarBuildOptions = {
  bodyMeshes?: THREE.SkinnedMesh[]
  headMeshes?: THREE.SkinnedMesh[]
  includeLowResMesh?: boolean
  settings?: Partial<CollisionAvatar['settings']>
}

type SnapshotOptions = {
  globalInflate?: number
  normalOffset?: number
  perRegionInflate?: Partial<Record<CollisionRegion, number>>
  includeLowResMesh?: boolean
  showCapsules?: boolean
  showEllipsoids?: boolean
}

type AvatarMeshColliderOptions = {
  id?: string
  skinOffset?: number
  garmentThickness?: number
  cellSize?: number
  triangleStride?: number
  includeRegions?: Set<CollisionRegion>
  debugPerf?: boolean
}

const DEFAULT_SKIN = 0.012
const TORSO_FRICTION = 0.68
const LIMB_FRICTION = 0.56
const HEAD_FRICTION = 0.52
const BUILD_SAMPLE_STRIDE = 3
const LOW_RES_VERTEX_STRIDE = 12
const MAX_HASH_CELLS_PER_TRIANGLE = 128

export const COLLISION_REGIONS: CollisionRegion[] = [
  'head',
  'neck',
  'chest',
  'abdomen',
  'pelvis',
  'shoulder.L',
  'shoulder.R',
  'upperArm.L',
  'upperArm.R',
  'forearm.L',
  'forearm.R',
  'hand.L',
  'hand.R',
  'hip.L',
  'hip.R',
  'thigh.L',
  'thigh.R',
  'calf.L',
  'calf.R',
  'foot.L',
  'foot.R',
]

const state = {
  version: 0,
  avatar: null as CollisionAvatar | null,
  snapshot: { version: 0, proxies: [] } as ColliderSnapshot,
  listeners: new Set<Listener>(),
}

const _samplePoint = new THREE.Vector3()
const _scratchA = new THREE.Vector3()
const _scratchB = new THREE.Vector3()
const _scratchQ = new THREE.Quaternion()
const _scratchScale = new THREE.Vector3()
const _scratchMatrix = new THREE.Matrix4()

export function getBodyProxySnapshot() {
  return state.snapshot
}

export function getCollisionAvatar() {
  return state.avatar
}

export function getCollisionAvatarStats() {
  return {
    hasAvatar: Boolean(state.avatar),
    proxyCount: state.avatar?.proxies.length ?? 0,
    meshPatchCount: state.avatar?.lowResMeshPatches?.length ?? 0,
    sourceVertexCount: state.avatar?.source.vertexCount ?? 0,
  }
}

export function setCollisionAvatar(avatar: CollisionAvatar | null) {
  state.avatar = avatar
  if (!avatar) {
    setBodyProxySnapshot({ proxies: [] })
    return
  }
  notify()
}

export function setBodyProxySnapshot(snapshot: Omit<ColliderSnapshot, 'version'>) {
  state.version += 1
  state.snapshot = {
    version: state.version,
    proxies: snapshot.proxies,
    meshColliders: snapshot.meshColliders,
    lowResMeshPatches: snapshot.lowResMeshPatches,
  }
  notify()
}

export function clearBodyProxySnapshot() {
  state.avatar = null
  setBodyProxySnapshot({ proxies: [] })
}

export function subscribeBodyProxy(fn: Listener) {
  state.listeners.add(fn)
  return () => state.listeners.delete(fn)
}

export function buildCollisionAvatarFromSkinnedMeshes(
  bones: Record<string, THREE.Bone>,
  options: CollisionAvatarBuildOptions = {},
): CollisionAvatar {
  const bodyMeshes = options.bodyMeshes ?? []
  const headMeshes = options.headMeshes ?? []
  const meshes = [...bodyMeshes, ...headMeshes]
  const samples = emptyRegionSamples()
  const counts: RegionCounts = {}
  let vertexCount = 0

  for (const mesh of bodyMeshes) {
    vertexCount += collectRegionSamples(mesh, samples, counts, null)
  }
  for (const mesh of headMeshes) {
    vertexCount += collectRegionSamples(mesh, samples, counts, 'head')
  }

  const proxies: CollisionAvatarProxy[] = []
  addEllipsoidProxy(proxies, 'head', bones, samples.head, ['head', 'rt_head', 'spine006'], { min: [0.105, 0.16, 0.105], fallback: [0, 0.11, 0, 0.16, 0.205, 0.16], friction: HEAD_FRICTION })
  addEllipsoidProxy(proxies, 'neck', bones, samples.neck, ['neck', 'spine006', 'head'], { min: [0.08, 0.08, 0.07], fallback: [0, 0, 0, 0.095, 0.115, 0.08], friction: TORSO_FRICTION })
  addEllipsoidProxy(proxies, 'chest', bones, samples.chest, ['spine004', 'spine005', 'chest'], { min: [0.19, 0.16, 0.12], max: [0.34, 0.34, 0.23], fallback: [0, 0.03, 0, 0.24, 0.22, 0.16], friction: TORSO_FRICTION })
  addEllipsoidProxy(proxies, 'abdomen', bones, samples.abdomen, ['spine002', 'spine003', 'abdomen'], { min: [0.17, 0.15, 0.12], max: [0.31, 0.3, 0.21], fallback: [0, 0, 0, 0.21, 0.2, 0.15], friction: TORSO_FRICTION })
  addEllipsoidProxy(proxies, 'pelvis', bones, samples.pelvis, ['pelvis', 'hips', 'spine'], { min: [0.19, 0.13, 0.12], max: [0.34, 0.24, 0.22], fallback: [0, -0.02, 0, 0.26, 0.17, 0.17], friction: TORSO_FRICTION })

  addBridgeCapsule(proxies, 'shoulder.L', bones, samples['shoulder.L'], ['shoulderl', 'leftshoulder', 'claviclel'], ['upperarml', 'leftupperarm'], 0.075, TORSO_FRICTION)
  addBridgeCapsule(proxies, 'shoulder.R', bones, samples['shoulder.R'], ['shoulderr', 'rightshoulder', 'clavicler'], ['upperarmr', 'rightupperarm'], 0.075, TORSO_FRICTION)
  addBridgeCapsule(proxies, 'hip.L', bones, samples['hip.L'], ['pelvis', 'hips', 'spine'], ['thighl', 'leftupleg'], 0.105, TORSO_FRICTION)
  addBridgeCapsule(proxies, 'hip.R', bones, samples['hip.R'], ['pelvis', 'hips', 'spine'], ['thighr', 'rightupleg'], 0.105, TORSO_FRICTION)

  addBoneCapsule(proxies, 'upperArm.L', bones, samples['upperArm.L'], ['upperarml', 'leftupperarm'], ['forearml001', 'forearml', 'leftforearm'], 0.078, LIMB_FRICTION)
  addBoneCapsule(proxies, 'upperArm.R', bones, samples['upperArm.R'], ['upperarmr', 'rightupperarm'], ['forearmr001', 'forearmr', 'rightforearm'], 0.078, LIMB_FRICTION)
  addBoneCapsule(proxies, 'forearm.L', bones, samples['forearm.L'], ['forearml001', 'forearml', 'leftforearm'], ['handl', 'lefthand'], 0.055, LIMB_FRICTION)
  addBoneCapsule(proxies, 'forearm.R', bones, samples['forearm.R'], ['forearmr001', 'forearmr', 'rightforearm'], ['handr', 'righthand'], 0.055, LIMB_FRICTION)
  addEllipsoidProxy(proxies, 'hand.L', bones, samples['hand.L'], ['handl', 'lefthand'], { min: [0.045, 0.065, 0.028], fallback: [0, -0.025, 0, 0.07, 0.095, 0.035], friction: LIMB_FRICTION })
  addEllipsoidProxy(proxies, 'hand.R', bones, samples['hand.R'], ['handr', 'righthand'], { min: [0.045, 0.065, 0.028], fallback: [0, -0.025, 0, 0.07, 0.095, 0.035], friction: LIMB_FRICTION })

  addBoneCapsule(proxies, 'thigh.L', bones, samples['thigh.L'], ['thighl', 'leftupleg'], ['thighl001', 'shinl', 'calfl', 'leftleg'], 0.105, LIMB_FRICTION)
  addBoneCapsule(proxies, 'thigh.R', bones, samples['thigh.R'], ['thighr', 'rightupleg'], ['thighr001', 'shinr', 'calfr', 'rightleg'], 0.105, LIMB_FRICTION)
  addBoneCapsule(proxies, 'calf.L', bones, samples['calf.L'], ['thighl001', 'shinl', 'calfl', 'leftleg'], ['footl', 'leftfoot'], 0.078, LIMB_FRICTION)
  addBoneCapsule(proxies, 'calf.R', bones, samples['calf.R'], ['thighr001', 'shinr', 'calfr', 'rightleg'], ['footr', 'rightfoot'], 0.078, LIMB_FRICTION)
  addBoneCapsule(proxies, 'foot.L', bones, samples['foot.L'], ['footl', 'leftfoot'], ['toel', 'lefttoe'], 0.065, LIMB_FRICTION)
  addBoneCapsule(proxies, 'foot.R', bones, samples['foot.R'], ['footr', 'rightfoot'], ['toer', 'righttoe'], 0.065, LIMB_FRICTION)

  const settings = {
    globalInflate: options.settings?.globalInflate ?? 0.018,
    normalOffset: options.settings?.normalOffset ?? 0,
    perRegionInflate: options.settings?.perRegionInflate ?? {},
  }

  return {
    version: 1,
    createdAt: Date.now(),
    source: {
      meshCount: meshes.length,
      vertexCount,
      boneCount: Object.keys(bones).length,
    },
    settings,
    proxies,
    lowResMeshPatches: options.includeLowResMesh ? buildLowResMeshPatches(meshes, bones) : undefined,
  }
}

export function buildColliderSnapshotFromCollisionAvatar(
  avatar: CollisionAvatar | null,
  bones: Record<string, THREE.Bone>,
  options: SnapshotOptions = {},
): Omit<ColliderSnapshot, 'version'> {
  if (!avatar) return { proxies: [] }
  const globalInflate = options.globalInflate ?? avatar.settings.globalInflate
  const normalOffset = options.normalOffset ?? avatar.settings.normalOffset
  const perRegionInflate = options.perRegionInflate ?? avatar.settings.perRegionInflate
  const showCapsules = options.showCapsules ?? true
  const showEllipsoids = options.showEllipsoids ?? true
  const proxies: ColliderSnapshot['proxies'] = []

  for (const proxy of avatar.proxies) {
    const bone = getBoneByName(bones, proxy.anchorBone)
    if (!bone) continue
    const skin = proxy.skin + Math.max(0, globalInflate) + Math.max(0, perRegionInflate[proxy.region] ?? 0) + normalOffset
    if (proxy.kind === 'capsule') {
      if (!showCapsules) continue
      const a = localPointToWorld(bone, proxy.ax, proxy.ay, proxy.az, _scratchA)
      const b = localPointToWorld(bone, proxy.bx, proxy.by, proxy.bz, _scratchB)
      const scale = bone.getWorldScale(_scratchScale)
      proxies.push({
        kind: 'capsule',
        ax: a.x,
        ay: a.y,
        az: a.z,
        bx: b.x,
        by: b.y,
        bz: b.z,
        r: proxy.r * Math.max(scale.x, scale.y, scale.z),
        friction: proxy.friction,
        skin,
      })
      continue
    }
    if (!showEllipsoids) continue
    const center = localPointToWorld(bone, proxy.cx, proxy.cy, proxy.cz, _scratchA)
    const boneQ = bone.getWorldQuaternion(_scratchQ)
    const localQ = new THREE.Quaternion(proxy.qx, proxy.qy, proxy.qz, proxy.qw)
    const worldQ = boneQ.multiply(localQ)
    const scale = bone.getWorldScale(_scratchScale)
    proxies.push({
      kind: 'ellipsoid',
      cx: center.x,
      cy: center.y,
      cz: center.z,
      rx: proxy.rx * Math.abs(scale.x),
      ry: proxy.ry * Math.abs(scale.y),
      rz: proxy.rz * Math.abs(scale.z),
      qx: worldQ.x,
      qy: worldQ.y,
      qz: worldQ.z,
      qw: worldQ.w,
      friction: proxy.friction,
      skin,
    })
  }

  return {
    proxies,
    lowResMeshPatches: options.includeLowResMesh ? snapshotLowResMeshPatches(avatar, bones) : undefined,
  }
}

export function buildAvatarMeshColliderSnapshotFromSkinnedMeshes(
  meshes: THREE.SkinnedMesh[],
  options: AvatarMeshColliderOptions = {},
): MeshSurfaceColliderSnapshot | null {
  const triangleStride = Math.max(1, Math.floor(options.triangleStride ?? 1))
  const includeRegions = options.includeRegions
  const vertices: number[] = []
  const indices: number[] = []
  const vertexMap = new Map<string, number>()
  let triangleOrdinal = 0
  const extractionStart = options.debugPerf ? performance.now() : 0

  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    const mesh = meshes[meshIndex]
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position) continue
    const index = mesh.geometry.index
    const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3)
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const ia = index ? index.getX(triangle * 3) : triangle * 3
      const ib = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1
      const ic = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2
      if (includeRegions && !triangleMatchesRegions(mesh, ia, ib, ic, includeRegions)) continue
      if (triangleOrdinal % triangleStride !== 0) {
        triangleOrdinal += 1
        continue
      }
      triangleOrdinal += 1
      const a = pushUniqueSkinnedWorldVertex(vertices, vertexMap, meshIndex, mesh, ia)
      const b = pushUniqueSkinnedWorldVertex(vertices, vertexMap, meshIndex, mesh, ib)
      const c = pushUniqueSkinnedWorldVertex(vertices, vertexMap, meshIndex, mesh, ic)
      indices.push(a, b, c)
    }
  }

  if (indices.length === 0) return null
  if (options.debugPerf) {
    console.debug(`[clothing] posed mesh extraction ${(performance.now() - extractionStart).toFixed(2)}ms`)
  }
  const vertexArray = new Float32Array(vertices)
  const indexArray = new Uint32Array(indices)
  const hashStart = options.debugPerf ? performance.now() : 0
  const hash = buildTriangleSpatialHash(vertexArray, indexArray, options.cellSize ?? 0.09)
  if (options.debugPerf) {
    console.debug(`[clothing] spatial hash build ${(performance.now() - hashStart).toFixed(2)}ms`)
  }
  return {
    kind: 'mesh',
    id: options.id ?? 'avatar.mesh',
    vertices: vertexArray,
    indices: indexArray,
    cellSize: hash.cellSize,
    cellKeys: hash.cellKeys,
    cellStarts: hash.cellStarts,
    cellCounts: hash.cellCounts,
    cellTriangleIndices: hash.cellTriangleIndices,
    skin: options.skinOffset ?? 0.022,
    thickness: options.garmentThickness ?? 0.008,
    friction: 0.74,
  }
}

export function buildBodyProxySnapshotFromBones(
  bones: Record<string, THREE.Bone>,
  options: CollisionAvatarBuildOptions = {},
): Omit<ColliderSnapshot, 'version'> {
  const avatar = buildCollisionAvatarFromSkinnedMeshes(bones, options)
  return buildColliderSnapshotFromCollisionAvatar(avatar, bones)
}

function notify() {
  state.listeners.forEach((listener) => listener())
}

function emptyRegionSamples(): RegionSamples {
  return Object.fromEntries(COLLISION_REGIONS.map((region) => [region, []])) as unknown as RegionSamples
}

function collectRegionSamples(
  mesh: THREE.SkinnedMesh,
  out: RegionSamples,
  counts: RegionCounts,
  fallbackRegion: CollisionRegion | null,
) {
  const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) return 0
  for (let index = 0; index < position.count; index += 1) {
    const region = classifySkinnedVertex(mesh, index) ?? fallbackRegion
    if (!region) continue
    counts[region] = (counts[region] ?? 0) + 1
    if (index % BUILD_SAMPLE_STRIDE !== 0) continue
    copySkinnedWorldVertex(mesh, position, index, _samplePoint)
    _samplePoint.applyMatrix4(mesh.matrixWorld)
    out[region].push(_samplePoint.clone())
  }
  return position.count
}

function pushUniqueSkinnedWorldVertex(
  vertices: number[],
  vertexMap: Map<string, number>,
  meshIndex: number,
  mesh: THREE.SkinnedMesh,
  vertexIndex: number,
) {
  const key = `${meshIndex}:${vertexIndex}`
  const existing = vertexMap.get(key)
  if (existing !== undefined) return existing
  const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) return 0
  const nextIndex = vertices.length / 3
  copySkinnedWorldVertex(mesh, position, vertexIndex, _samplePoint)
  _samplePoint.applyMatrix4(mesh.matrixWorld)
  vertices.push(_samplePoint.x, _samplePoint.y, _samplePoint.z)
  vertexMap.set(key, nextIndex)
  return nextIndex
}

function copySkinnedWorldVertex(
  mesh: THREE.SkinnedMesh,
  position: THREE.BufferAttribute,
  vertexIndex: number,
  target: THREE.Vector3,
) {
  target.fromBufferAttribute(position, vertexIndex)
  mesh.applyBoneTransform(vertexIndex, target)
  return target
}

function triangleMatchesRegions(
  mesh: THREE.SkinnedMesh,
  a: number,
  b: number,
  c: number,
  includeRegions: Set<CollisionRegion>,
) {
  const ra = classifySkinnedVertex(mesh, a)
  const rb = classifySkinnedVertex(mesh, b)
  const rc = classifySkinnedVertex(mesh, c)
  return Boolean((ra && includeRegions.has(ra)) || (rb && includeRegions.has(rb)) || (rc && includeRegions.has(rc)))
}

function classifySkinnedVertex(mesh: THREE.SkinnedMesh, vertexIndex: number): CollisionRegion | null {
  const skinIndex = mesh.geometry.getAttribute('skinIndex') as THREE.BufferAttribute | undefined
  const skinWeight = mesh.geometry.getAttribute('skinWeight') as THREE.BufferAttribute | undefined
  if (!skinIndex || !skinWeight) return null
  const scores = new Map<CollisionRegion, number>()
  const itemSize = Math.min(skinIndex.itemSize, skinWeight.itemSize, 4)
  for (let item = 0; item < itemSize; item += 1) {
    const boneIndex = getAttrComponent(skinIndex, vertexIndex, item)
    const weight = getAttrComponent(skinWeight, vertexIndex, item)
    if (weight <= 1e-5) continue
    const bone = mesh.skeleton.bones[boneIndex]
    if (!bone) continue
    const region = classifyBoneRegion(bone.name)
    if (!region) continue
    scores.set(region, (scores.get(region) ?? 0) + weight)
  }
  let best: CollisionRegion | null = null
  let bestWeight = 0
  scores.forEach((weight, region) => {
    if (weight > bestWeight) {
      best = region
      bestWeight = weight
    }
  })
  return best
}

function addBoneCapsule(
  proxies: CollisionAvatarProxy[],
  region: CollisionRegion,
  bones: Record<string, THREE.Bone>,
  samples: THREE.Vector3[],
  anchorAliases: string[],
  endAliases: string[],
  fallbackRadius: number,
  friction: number,
) {
  const anchor = getBone(bones, anchorAliases)
  const end = getBone(bones, endAliases)
  if (!anchor || !end) return
  addCapsuleFromWorldSegment(proxies, region, anchor, end, samples, fallbackRadius, friction)
}

function addBridgeCapsule(
  proxies: CollisionAvatarProxy[],
  region: CollisionRegion,
  bones: Record<string, THREE.Bone>,
  samples: THREE.Vector3[],
  anchorAliases: string[],
  endAliases: string[],
  fallbackRadius: number,
  friction: number,
) {
  addBoneCapsule(proxies, region, bones, samples, anchorAliases, endAliases, fallbackRadius, friction)
}

function addCapsuleFromWorldSegment(
  proxies: CollisionAvatarProxy[],
  region: CollisionRegion,
  anchor: THREE.Bone,
  end: THREE.Bone,
  samples: THREE.Vector3[],
  fallbackRadius: number,
  friction: number,
) {
  const startWorld = anchor.getWorldPosition(_scratchA).clone()
  const endWorld = end.getWorldPosition(_scratchB).clone()
  if (startWorld.distanceToSquared(endWorld) < 1e-8) return
  const radius = fitCapsuleRadius(samples, startWorld, endWorld, fallbackRadius)
  const startLocal = anchor.worldToLocal(startWorld.clone())
  const endLocal = anchor.worldToLocal(endWorld.clone())
  proxies.push({
    kind: 'capsule',
    id: `${region}.capsule`,
    region,
    anchorBone: anchor.name,
    ax: startLocal.x,
    ay: startLocal.y,
    az: startLocal.z,
    bx: endLocal.x,
    by: endLocal.y,
    bz: endLocal.z,
    r: radius,
    friction,
    skin: DEFAULT_SKIN,
  })
}

function fitCapsuleRadius(samples: THREE.Vector3[], start: THREE.Vector3, end: THREE.Vector3, fallbackRadius: number) {
  if (samples.length < 8) return fallbackRadius
  const axis = end.clone().sub(start)
  const lengthSq = axis.lengthSq()
  if (lengthSq < 1e-8) return fallbackRadius
  const distances = samples.map((point) => {
    const t = Math.max(0, Math.min(1, point.clone().sub(start).dot(axis) / lengthSq))
    const closest = start.clone().addScaledVector(axis, t)
    return point.distanceTo(closest)
  })
  return Math.max(fallbackRadius * 0.75, Math.min(fallbackRadius * 1.5, quantile(distances, 0.84) + 0.012))
}

function addEllipsoidProxy(
  proxies: CollisionAvatarProxy[],
  region: CollisionRegion,
  bones: Record<string, THREE.Bone>,
  samples: THREE.Vector3[],
  aliases: string[],
  options: {
    min: [number, number, number]
    max?: [number, number, number]
    fallback: [number, number, number, number, number, number]
    friction: number
  },
) {
  const anchor = getBone(bones, aliases)
  if (!anchor) return
  const inv = _scratchMatrix.copy(anchor.matrixWorld).invert()
  const localPoints = samples.map((point) => point.clone().applyMatrix4(inv))
  const fitted = fitEllipsoid(localPoints, options.min, options.max)
  const [fcx, fcy, fcz, frx, fry, frz] = options.fallback
  proxies.push({
    kind: 'ellipsoid',
    id: `${region}.ellipsoid`,
    region,
    anchorBone: anchor.name,
    cx: fitted?.cx ?? fcx,
    cy: fitted?.cy ?? fcy,
    cz: fitted?.cz ?? fcz,
    rx: fitted?.rx ?? frx,
    ry: fitted?.ry ?? fry,
    rz: fitted?.rz ?? frz,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    friction: options.friction,
    skin: DEFAULT_SKIN,
  })
}

function fitEllipsoid(points: THREE.Vector3[], min: [number, number, number], max?: [number, number, number]) {
  if (points.length < 12) return null
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const zs = points.map((point) => point.z)
  const minX = quantile(xs, 0.08)
  const maxX = quantile(xs, 0.92)
  const minY = quantile(ys, 0.06)
  const maxY = quantile(ys, 0.94)
  const minZ = quantile(zs, 0.08)
  const maxZ = quantile(zs, 0.92)
  return {
    cx: (minX + maxX) * 0.5,
    cy: (minY + maxY) * 0.5,
    cz: (minZ + maxZ) * 0.5,
    rx: clampRadius((maxX - minX) * 0.5 + 0.012, min[0], max?.[0]),
    ry: clampRadius((maxY - minY) * 0.5 + 0.012, min[1], max?.[1]),
    rz: clampRadius((maxZ - minZ) * 0.5 + 0.012, min[2], max?.[2]),
  }
}

function buildLowResMeshPatches(meshes: THREE.SkinnedMesh[], bones: Record<string, THREE.Bone>) {
  const patches = new Map<CollisionRegion, CollisionMeshPatch>()
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position) continue
    for (let index = 0; index < position.count; index += LOW_RES_VERTEX_STRIDE) {
      const region = classifySkinnedVertex(mesh, index)
      if (!region) continue
      const anchor = getBoneByName(bones, anchorBoneNameForRegion(region, bones))
      if (!anchor) continue
      const patch = getOrCreatePatch(patches, region, anchor.name)
      copySkinnedWorldVertex(mesh, position, index, _samplePoint)
      _samplePoint.applyMatrix4(mesh.matrixWorld)
      const local = anchor.worldToLocal(_samplePoint.clone())
      patch.vertices.push(local.x, local.y, local.z)
    }
  }
  for (const patch of patches.values()) {
    const vertexCount = Math.floor(patch.vertices.length / 3)
    for (let index = 2; index < vertexCount; index += 3) {
      patch.indices.push(index - 2, index - 1, index)
    }
  }
  return [...patches.values()].filter((patch) => patch.indices.length > 0)
}

function getOrCreatePatch(patches: Map<CollisionRegion, CollisionMeshPatch>, region: CollisionRegion, anchorBone: string) {
  let patch = patches.get(region)
  if (!patch) {
    patch = { id: `${region}.lowRes`, region, anchorBone, vertices: [], indices: [] }
    patches.set(region, patch)
  }
  return patch
}

function snapshotLowResMeshPatches(avatar: CollisionAvatar, bones: Record<string, THREE.Bone>) {
  return (avatar.lowResMeshPatches ?? []).map((patch) => {
    const bone = getBoneByName(bones, patch.anchorBone)
    const vertices = new Float32Array(patch.vertices.length)
    if (bone) {
      for (let index = 0; index < patch.vertices.length; index += 3) {
        const world = localPointToWorld(bone, patch.vertices[index], patch.vertices[index + 1], patch.vertices[index + 2], _scratchA)
        vertices[index] = world.x
        vertices[index + 1] = world.y
        vertices[index + 2] = world.z
      }
    }
    return {
      id: patch.id,
      region: patch.region,
      vertices,
      indices: new Uint32Array(patch.indices),
    }
  })
}

function anchorBoneNameForRegion(region: CollisionRegion, bones: Record<string, THREE.Bone>) {
  const proxyAnchor = {
    head: ['head', 'rt_head', 'spine006'],
    neck: ['neck', 'spine006'],
    chest: ['spine004', 'spine005', 'chest'],
    abdomen: ['spine002', 'spine003', 'abdomen'],
    pelvis: ['pelvis', 'hips', 'spine'],
    'shoulder.L': ['shoulderl', 'leftshoulder', 'claviclel'],
    'shoulder.R': ['shoulderr', 'rightshoulder', 'clavicler'],
    'upperArm.L': ['upperarml', 'leftupperarm'],
    'upperArm.R': ['upperarmr', 'rightupperarm'],
    'forearm.L': ['forearml001', 'forearml', 'leftforearm'],
    'forearm.R': ['forearmr001', 'forearmr', 'rightforearm'],
    'hand.L': ['handl', 'lefthand'],
    'hand.R': ['handr', 'righthand'],
    'hip.L': ['pelvis', 'hips', 'spine'],
    'hip.R': ['pelvis', 'hips', 'spine'],
    'thigh.L': ['thighl', 'leftupleg'],
    'thigh.R': ['thighr', 'rightupleg'],
    'calf.L': ['thighl001', 'shinl', 'calfl', 'leftleg'],
    'calf.R': ['thighr001', 'shinr', 'calfr', 'rightleg'],
    'foot.L': ['footl', 'leftfoot'],
    'foot.R': ['footr', 'rightfoot'],
  } satisfies Record<CollisionRegion, string[]>
  return getBone(bones, proxyAnchor[region])?.name ?? ''
}

function localPointToWorld(bone: THREE.Bone, x: number, y: number, z: number, target: THREE.Vector3) {
  return target.set(x, y, z).applyMatrix4(bone.matrixWorld).clone()
}

function getAttrComponent(attribute: THREE.BufferAttribute, index: number, component: number) {
  switch (component) {
    case 0:
      return attribute.getX(index)
    case 1:
      return attribute.getY(index)
    case 2:
      return attribute.getZ(index)
    default:
      return attribute.getW(index)
  }
}

function classifyBoneRegion(name: string): CollisionRegion | null {
  const normalized = normalizeBoneName(name)
  const side = boneSide(normalized)

  if (matchesAny(normalized, ['head', 'brow', 'forehead', 'temple', 'ear', 'cheek', 'jaw', 'chin', 'nose', 'lip', 'teeth', 'eye'])) return 'head'
  if (matchesAny(normalized, ['neck']) || normalized.includes('spine006')) return 'neck'
  if (matchesAny(normalized, ['shoulder', 'clavicle']) && side) return `shoulder.${side}`
  if (matchesAny(normalized, ['upperarm', 'uparm']) && side) return `upperArm.${side}`
  if (matchesAny(normalized, ['forearm', 'lowerarm']) && side) return `forearm.${side}`
  if (matchesAny(normalized, ['hand', 'thumb', 'finger', 'findex', 'fmiddle', 'fring', 'fpinky']) && side) return `hand.${side}`
  if (matchesAny(normalized, ['thigh', 'upleg']) && side) return `thigh.${side}`
  if (matchesAny(normalized, ['shin', 'calf', 'leg']) && side) return `calf.${side}`
  if (matchesAny(normalized, ['foot', 'toe']) && side) return `foot.${side}`
  if (matchesAny(normalized, ['hip']) && side) return `hip.${side}`
  if (matchesAny(normalized, ['breast', 'chest']) || normalized.includes('spine004') || normalized.includes('spine005')) return 'chest'
  if (matchesAny(normalized, ['abdomen', 'belly']) || normalized.includes('spine002') || normalized.includes('spine003')) return 'abdomen'
  if (matchesAny(normalized, ['pelvis', 'hips']) || normalized === 'spine' || normalized.includes('spine001')) return 'pelvis'
  return null
}

function boneSide(normalized: string): 'L' | 'R' | null {
  if (normalized.includes('left') || /l\d*$/.test(normalized)) return 'L'
  if (normalized.includes('right') || /r\d*$/.test(normalized)) return 'R'
  return null
}

function getBone(bones: Record<string, THREE.Bone>, aliases: string[]) {
  const wanted = aliases.map(normalizeBoneName)
  return Object.values(bones).find((bone) => wanted.includes(normalizeBoneName(bone.name))) ?? null
}

function getBoneByName(bones: Record<string, THREE.Bone>, name: string) {
  const normalized = normalizeBoneName(name)
  return bones[name] ?? Object.values(bones).find((bone) => normalizeBoneName(bone.name) === normalized) ?? null
}

function normalizeBoneName(name: string) {
  return name.replace(/^DEF-/, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function matchesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle))
}

function quantile(values: number[], q: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q)))
  return sorted[index]
}

function clampRadius(value: number, min: number, max?: number) {
  return Math.min(max ?? Infinity, Math.max(min, value))
}

function buildTriangleSpatialHash(vertices: Float32Array, indices: Uint32Array, cellSize: number) {
  const safeCellSize = Math.max(0.025, cellSize)
  const cells = new Map<number, number[]>()
  const triangleCount = indices.length / 3
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ia = indices[triangle * 3] * 3
    const ib = indices[triangle * 3 + 1] * 3
    const ic = indices[triangle * 3 + 2] * 3
    const minX = Math.min(vertices[ia], vertices[ib], vertices[ic])
    const minY = Math.min(vertices[ia + 1], vertices[ib + 1], vertices[ic + 1])
    const minZ = Math.min(vertices[ia + 2], vertices[ib + 2], vertices[ic + 2])
    const maxX = Math.max(vertices[ia], vertices[ib], vertices[ic])
    const maxY = Math.max(vertices[ia + 1], vertices[ib + 1], vertices[ic + 1])
    const maxZ = Math.max(vertices[ia + 2], vertices[ib + 2], vertices[ic + 2])
    const minCx = Math.floor(minX / safeCellSize)
    const minCy = Math.floor(minY / safeCellSize)
    const minCz = Math.floor(minZ / safeCellSize)
    const maxCx = Math.floor(maxX / safeCellSize)
    const maxCy = Math.floor(maxY / safeCellSize)
    const maxCz = Math.floor(maxZ / safeCellSize)
    const cellSpan =
      (maxCx - minCx + 1) *
      (maxCy - minCy + 1) *
      (maxCz - minCz + 1)
    if (!Number.isFinite(cellSpan) || cellSpan > MAX_HASH_CELLS_PER_TRIANGLE) continue
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      for (let cy = minCy; cy <= maxCy; cy += 1) {
        for (let cz = minCz; cz <= maxCz; cz += 1) {
          const key = hashCell(cx, cy, cz)
          const bucket = cells.get(key)
          if (bucket) bucket.push(triangle)
          else cells.set(key, [triangle])
        }
      }
    }
  }

  const sorted = [...cells.entries()].sort((a, b) => a[0] - b[0])
  const cellKeys = new Int32Array(sorted.length)
  const cellStarts = new Uint32Array(sorted.length)
  const cellCounts = new Uint32Array(sorted.length)
  const triangleRefs: number[] = []
  sorted.forEach(([key, triangles], index) => {
    cellKeys[index] = key
    cellStarts[index] = triangleRefs.length
    cellCounts[index] = triangles.length
    triangleRefs.push(...triangles)
  })
  return {
    cellSize: safeCellSize,
    cellKeys,
    cellStarts,
    cellCounts,
    cellTriangleIndices: new Uint32Array(triangleRefs),
  }
}

function hashCell(x: number, y: number, z: number) {
  return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0
}
