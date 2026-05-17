import * as THREE from 'three/webgpu'
import type { ColliderSnapshot, EllipsoidProxy } from '../types'

type Listener = () => void
type ProxyBuildOptions = {
  bodyMeshes?: THREE.SkinnedMesh[]
  headMeshes?: THREE.SkinnedMesh[]
}
type SamplePoint = { x: number; y: number; z: number }

const state = {
  version: 0,
  snapshot: { version: 0, proxies: [] } as ColliderSnapshot,
  listeners: new Set<Listener>(),
}

const DEFAULT_SKIN = 0.012
const TORSO_FRICTION = 0.68
const LIMB_FRICTION = 0.56

const _up = new THREE.Vector3(0, 1, 0)
const _scratchA = new THREE.Vector3()
const _scratchB = new THREE.Vector3()
const _scratchC = new THREE.Vector3()
const _scratchQ = new THREE.Quaternion()
const _samplePoint = new THREE.Vector3()

export function getBodyProxySnapshot() {
  return state.snapshot
}

export function setBodyProxySnapshot(snapshot: Omit<ColliderSnapshot, 'version'>) {
  state.version += 1
  state.snapshot = { version: state.version, proxies: snapshot.proxies }
  state.listeners.forEach((listener) => listener())
}

export function clearBodyProxySnapshot() {
  setBodyProxySnapshot({ proxies: [] })
}

export function subscribeBodyProxy(fn: Listener) {
  state.listeners.add(fn)
  return () => state.listeners.delete(fn)
}

export function buildBodyProxySnapshotFromBones(
  bones: Record<string, THREE.Bone>,
  options: ProxyBuildOptions = {},
): Omit<ColliderSnapshot, 'version'> {
  const proxies = [] as ColliderSnapshot['proxies']

  const spine = getBone(bones, ['spine', 'hips', 'pelvis'])
  const spine001 = getBone(bones, ['spine001'])
  const spine002 = getBone(bones, ['spine002'])
  const spine003 = getBone(bones, ['spine003'])
  const spine004 = getBone(bones, ['spine004'])
  const spine005 = getBone(bones, ['spine005'])
  const spine006 = getBone(bones, ['spine006', 'neck', 'head'])

  const leftShoulder = getBone(bones, ['shoulderl', 'leftshoulder', 'claviclel'])
  const rightShoulder = getBone(bones, ['shoulderr', 'rightshoulder', 'clavicler'])
  const leftUpperArm = getBone(bones, ['upperarml', 'leftupperarm'])
  const leftForearm = getBone(bones, ['forearml001', 'forearml', 'leftforearm'])
  const leftHand = getBone(bones, ['handl', 'lefthand'])
  const rightUpperArm = getBone(bones, ['upperarmr', 'rightupperarm'])
  const rightForearm = getBone(bones, ['forearmr001', 'forearmr', 'rightforearm'])
  const rightHand = getBone(bones, ['handr', 'righthand'])

  const leftThigh = getBone(bones, ['thighl', 'leftupleg'])
  const leftCalf = getBone(bones, ['thighl001', 'shinl', 'calfl', 'leftleg'])
  const leftFoot = getBone(bones, ['footl', 'leftfoot'])
  const leftToe = getBone(bones, ['toel', 'lefttoe'])
  const rightThigh = getBone(bones, ['thighr', 'rightupleg'])
  const rightCalf = getBone(bones, ['thighr001', 'shinr', 'calfr', 'rightleg'])
  const rightFoot = getBone(bones, ['footr', 'rightfoot'])
  const rightToe = getBone(bones, ['toer', 'righttoe'])

  const bodySamples = sampleSkinnedMeshes(options.bodyMeshes ?? [], 8)
  const builtTorsoFromMesh = addMeshTorsoProxies(proxies, bodySamples, bones)
  if (!builtTorsoFromMesh) {
    addPelvisProxy(proxies, spine ?? spine001, leftThigh, rightThigh)
    addSegmentEllipsoid(proxies, spine ?? spine001, spine002 ?? spine003, 0.19, 0.13, TORSO_FRICTION)
    addSegmentEllipsoid(proxies, spine003 ?? spine002, spine005 ?? spine004, 0.245, 0.145, TORSO_FRICTION)
    addSegmentEllipsoid(proxies, spine004 ?? spine003, spine006 ?? spine005, 0.145, 0.095, TORSO_FRICTION)
    addBreastProxy(proxies, bones, 'l')
    addBreastProxy(proxies, bones, 'r')
  }
  addShoulderProxy(proxies, leftShoulder, rightShoulder, leftUpperArm, rightUpperArm)
  addHeadProxy(proxies, bones, spine006 ?? spine005, options.headMeshes)

  addArmProxy(proxies, leftShoulder, leftUpperArm, leftForearm, leftHand, 'l')
  addArmProxy(proxies, rightShoulder, rightUpperArm, rightForearm, rightHand, 'r')
  addLegProxy(proxies, leftThigh, leftCalf, leftFoot, leftToe)
  addLegProxy(proxies, rightThigh, rightCalf, rightFoot, rightToe)

  return { proxies }
}

function addArmProxy(
  proxies: ColliderSnapshot['proxies'],
  shoulder: THREE.Bone | null,
  upperArm: THREE.Bone | null,
  forearm: THREE.Bone | null,
  hand: THREE.Bone | null,
  side: 'l' | 'r',
) {
  addCapsule(proxies, shoulder, upperArm, 0.105, TORSO_FRICTION)
  addCapsule(proxies, upperArm, forearm, 0.078, LIMB_FRICTION)
  addCapsule(proxies, forearm, hand, 0.058, LIMB_FRICTION)
  addHandProxy(proxies, hand, side)
}

function addLegProxy(
  proxies: ColliderSnapshot['proxies'],
  thigh: THREE.Bone | null,
  calf: THREE.Bone | null,
  foot: THREE.Bone | null,
  toe: THREE.Bone | null,
) {
  addCapsule(proxies, thigh, calf, 0.135, LIMB_FRICTION)
  addCapsule(proxies, calf, foot, 0.102, LIMB_FRICTION)
  addCapsule(proxies, foot, toe, 0.075, LIMB_FRICTION)
  if (foot && toe) {
    addSegmentEllipsoid(proxies, foot, toe, 0.095, 0.06, LIMB_FRICTION, 0.62)
  }
}

function addPelvisProxy(
  proxies: ColliderSnapshot['proxies'],
  pelvis: THREE.Bone | null,
  leftThigh: THREE.Bone | null,
  rightThigh: THREE.Bone | null,
) {
  if (!pelvis) return
  const center = pelvis.getWorldPosition(_scratchA).clone()
  if (leftThigh && rightThigh) {
    const left = leftThigh.getWorldPosition(_scratchB)
    const right = rightThigh.getWorldPosition(_scratchC)
    center.lerp(left.add(right).multiplyScalar(0.5), 0.45)
  }
  proxies.push({
    kind: 'ellipsoid',
    cx: center.x,
    cy: center.y,
    cz: center.z,
    rx: 0.285,
    ry: 0.19,
    rz: 0.18,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    friction: TORSO_FRICTION,
    skin: DEFAULT_SKIN,
  })
}

function addShoulderProxy(
  proxies: ColliderSnapshot['proxies'],
  leftShoulder: THREE.Bone | null,
  rightShoulder: THREE.Bone | null,
  leftUpperArm: THREE.Bone | null,
  rightUpperArm: THREE.Bone | null,
) {
  const left = leftUpperArm ?? leftShoulder
  const right = rightUpperArm ?? rightShoulder
  addCapsule(proxies, left, right, 0.09, TORSO_FRICTION)
}

function addBreastProxy(proxies: ColliderSnapshot['proxies'], bones: Record<string, THREE.Bone>, side: 'l' | 'r') {
  const breast = getBone(bones, [`breast${side}`])
  if (!breast) return
  const center = breast.getWorldPosition(_scratchA)
  proxies.push({
    kind: 'ellipsoid',
    cx: center.x,
    cy: center.y,
    cz: center.z,
    rx: 0.105,
    ry: 0.115,
    rz: 0.095,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    friction: TORSO_FRICTION,
    skin: DEFAULT_SKIN,
  })
}

function addHeadProxy(
  proxies: ColliderSnapshot['proxies'],
  bones: Record<string, THREE.Bone>,
  neck: THREE.Bone | null,
  headMeshes: THREE.SkinnedMesh[] = [],
) {
  const headSamples = sampleSkinnedMeshes(headMeshes, 5)
  if (headSamples.length > 16) {
    const ellipsoid = ellipsoidFromPoints(headSamples, {
      xQuantile: [0.04, 0.96],
      yQuantile: [0.02, 0.98],
      zQuantile: [0.04, 0.96],
      minRadius: { x: 0.105, y: 0.16, z: 0.105 },
      padding: 0.014,
      friction: 0.52,
    })
    if (ellipsoid) proxies.push(ellipsoid)
    return
  }

  const points = Object.values(bones).filter((bone) => isHeadSurfaceBone(bone.name))
  if (points.length > 0) {
    const box = new THREE.Box3()
    for (const bone of points) {
      box.expandByPoint(bone.getWorldPosition(_scratchA))
    }
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(size.x * 0.5 + 0.03, size.y * 0.5 + 0.025, size.z * 0.5 + 0.045, 0.16)
    const forward = getHeadForward(points)
    if (forward) {
      center.addScaledVector(forward, -radius * 0.24)
    } else {
      center.z -= radius * 0.22
    }
    proxies.push({
      kind: 'ellipsoid',
      cx: center.x,
      cy: center.y,
      cz: center.z,
      rx: radius * 0.78,
      ry: radius * 1.04,
      rz: radius * 0.82,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      friction: 0.52,
      skin: DEFAULT_SKIN,
    })
    return
  }

  if (!neck) return
  const center = neck.getWorldPosition(_scratchA)
  proxies.push({
    kind: 'sphere',
    cx: center.x,
    cy: center.y + 0.105,
    cz: center.z,
    r: 0.205,
    friction: 0.52,
    skin: DEFAULT_SKIN,
  })
}

function addMeshTorsoProxies(
  proxies: ColliderSnapshot['proxies'],
  points: SamplePoint[],
  bones: Record<string, THREE.Bone>,
) {
  if (points.length < 64) return false
  const hip = getBone(bones, ['spine', 'hips', 'pelvis'])
  const abdomen = getBone(bones, ['spine002', 'spine003'])
  const chest = getBone(bones, ['spine004', 'spine005'])
  const neck = getBone(bones, ['spine006', 'neck'])
  const hipY = hip?.getWorldPosition(_scratchA).y ?? quantile(points.map((point) => point.y), 0.22)
  const abdomenY = abdomen?.getWorldPosition(_scratchA).y ?? quantile(points.map((point) => point.y), 0.45)
  const chestY = chest?.getWorldPosition(_scratchA).y ?? quantile(points.map((point) => point.y), 0.67)
  const neckY = neck?.getWorldPosition(_scratchA).y ?? quantile(points.map((point) => point.y), 0.82)

  const segments: Array<[number, number, number, number]> = [
    [hipY - 0.1, abdomenY, 0.16, 0.13],
    [abdomenY - 0.04, chestY, 0.2, 0.145],
    [chestY - 0.05, neckY + 0.02, 0.17, 0.12],
  ]
  let added = 0
  for (const [minY, maxY, minRx, minRz] of segments) {
    const slice = torsoSlice(points, minY, maxY)
    const ellipsoid = ellipsoidFromPoints(slice, {
      xQuantile: [0.12, 0.88],
      yQuantile: [0.03, 0.97],
      zQuantile: [0.08, 0.92],
      minRadius: { x: minRx, y: 0.08, z: minRz },
      maxRadius: { x: 0.31, z: 0.2 },
      padding: 0.018,
      friction: TORSO_FRICTION,
    })
    if (!ellipsoid) continue
    proxies.push(ellipsoid)
    added += 1
  }
  return added >= 2
}

function torsoSlice(points: SamplePoint[], minY: number, maxY: number) {
  return points.filter((point) => point.y >= minY && point.y <= maxY && Math.abs(point.x) < 0.42)
}

function sampleSkinnedMeshes(meshes: THREE.SkinnedMesh[], stride: number) {
  const points: SamplePoint[] = []
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position) continue
    const step = Math.max(1, stride)
    for (let index = 0; index < position.count; index += step) {
      mesh.applyBoneTransform(index, _samplePoint)
      _samplePoint.applyMatrix4(mesh.matrixWorld)
      points.push({ x: _samplePoint.x, y: _samplePoint.y, z: _samplePoint.z })
    }
  }
  return points
}

function ellipsoidFromPoints(
  points: SamplePoint[],
  options: {
    xQuantile: [number, number]
    yQuantile: [number, number]
    zQuantile: [number, number]
    minRadius: { x: number; y: number; z: number }
    maxRadius?: { x?: number; y?: number; z?: number }
    padding: number
    friction: number
  },
): EllipsoidProxy | null {
  if (points.length < 8) return null
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const zs = points.map((point) => point.z)
  const minX = quantile(xs, options.xQuantile[0])
  const maxX = quantile(xs, options.xQuantile[1])
  const minY = quantile(ys, options.yQuantile[0])
  const maxY = quantile(ys, options.yQuantile[1])
  const minZ = quantile(zs, options.zQuantile[0])
  const maxZ = quantile(zs, options.zQuantile[1])
  const clampRadius = (axis: 'x' | 'y' | 'z', radius: number) =>
    Math.min(options.maxRadius?.[axis] ?? Infinity, Math.max(options.minRadius[axis], radius + options.padding))
  return {
    kind: 'ellipsoid',
    cx: (minX + maxX) * 0.5,
    cy: (minY + maxY) * 0.5,
    cz: (minZ + maxZ) * 0.5,
    rx: clampRadius('x', (maxX - minX) * 0.5),
    ry: clampRadius('y', (maxY - minY) * 0.5),
    rz: clampRadius('z', (maxZ - minZ) * 0.5),
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    friction: options.friction,
    skin: DEFAULT_SKIN,
  }
}

function quantile(values: number[], q: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q)))
  return sorted[index]
}

function addHandProxy(proxies: ColliderSnapshot['proxies'], hand: THREE.Bone | null, side: 'l' | 'r') {
  if (!hand) return
  const center = hand.getWorldPosition(_scratchA)
  proxies.push({
    kind: 'ellipsoid',
    cx: center.x,
    cy: center.y,
    cz: center.z,
    rx: 0.07,
    ry: 0.095,
    rz: 0.035,
    ...worldQuaternionFields(hand),
    friction: LIMB_FRICTION,
    skin: DEFAULT_SKIN,
  })

  const thumb = findDescendant(hand, [`thumb01${side}`])
  const middle = findDescendant(hand, [`fmiddle01${side}`, `middle01${side}`])
  addCapsule(proxies, hand, thumb, 0.026, LIMB_FRICTION, 0.006)
  addCapsule(proxies, hand, middle, 0.032, LIMB_FRICTION, 0.006)
}

function addSegmentEllipsoid(
  proxies: ColliderSnapshot['proxies'],
  a: THREE.Bone | null,
  b: THREE.Bone | null,
  rx: number,
  rz: number,
  friction: number,
  lengthScale = 0.56,
) {
  if (!a || !b) return
  const start = a.getWorldPosition(_scratchA)
  const end = b.getWorldPosition(_scratchB)
  const center = start.clone().lerp(end, 0.5)
  const axis = end.clone().sub(start)
  const length = axis.length()
  if (length < 1e-4) return
  const quat = _scratchQ.setFromUnitVectors(_up, axis.normalize())
  proxies.push({
    kind: 'ellipsoid',
    cx: center.x,
    cy: center.y,
    cz: center.z,
    rx,
    ry: Math.max(length * lengthScale, rx * 0.8),
    rz,
    qx: quat.x,
    qy: quat.y,
    qz: quat.z,
    qw: quat.w,
    friction,
    skin: DEFAULT_SKIN,
  })
}

function addCapsule(
  proxies: ColliderSnapshot['proxies'],
  a: THREE.Bone | null,
  b: THREE.Bone | null,
  radius: number,
  friction: number,
  skin = DEFAULT_SKIN,
) {
  if (!a || !b) return
  const start = a.getWorldPosition(_scratchA)
  const end = b.getWorldPosition(_scratchB)
  if (start.distanceToSquared(end) < 1e-8) return
  proxies.push({
    kind: 'capsule',
    ax: start.x,
    ay: start.y,
    az: start.z,
    bx: end.x,
    by: end.y,
    bz: end.z,
    r: radius,
    friction,
    skin,
  })
}

function getBone(bones: Record<string, THREE.Bone>, aliases: string[]) {
  const wanted = aliases.map(normalizeBoneName)
  return Object.values(bones).find((bone) => wanted.includes(normalizeBoneName(bone.name))) ?? null
}

function findDescendant(root: THREE.Bone, aliases: string[]) {
  const wanted = aliases.map(normalizeBoneName)
  let found: THREE.Bone | null = null
  root.traverse((object) => {
    if (found) return
    const bone = object as THREE.Bone
    if (bone.isBone && wanted.includes(normalizeBoneName(bone.name))) {
      found = bone
    }
  })
  return found
}

function normalizeBoneName(name: string) {
  return name.replace(/^DEF-/, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function isHeadSurfaceBone(name: string) {
  const normalized = normalizeBoneName(name)
  return (
    normalized.startsWith('forehead') ||
    normalized.startsWith('temple') ||
    normalized.startsWith('ear') ||
    normalized.startsWith('brow') ||
    normalized.startsWith('cheek') ||
    normalized.startsWith('jaw') ||
    normalized.startsWith('chin') ||
    normalized.startsWith('nose')
  )
}

function getHeadForward(points: THREE.Bone[]) {
  const noseCenter = averageBonePositions(points.filter((bone) => normalizeBoneName(bone.name).startsWith('nose')))
  const sideCenter = averageBonePositions(points.filter((bone) => {
    const normalized = normalizeBoneName(bone.name)
    return normalized.startsWith('ear') || normalized.startsWith('temple')
  }))
  if (!noseCenter || !sideCenter) return null
  const forward = noseCenter.sub(sideCenter)
  return forward.lengthSq() > 1e-6 ? forward.normalize() : null
}

function averageBonePositions(bones: THREE.Bone[]) {
  if (bones.length === 0) return null
  const out = new THREE.Vector3()
  for (const bone of bones) {
    out.add(bone.getWorldPosition(_scratchA))
  }
  return out.multiplyScalar(1 / bones.length)
}

function worldQuaternionFields(object: THREE.Object3D): Pick<EllipsoidProxy, 'qx' | 'qy' | 'qz' | 'qw'> {
  const q = object.getWorldQuaternion(_scratchQ)
  return { qx: q.x, qy: q.y, qz: q.z, qw: q.w }
}
