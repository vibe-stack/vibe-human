import * as THREE from 'three/webgpu'
import type { ColliderSnapshot, EllipsoidProxy } from '../types'

type Listener = () => void

const state = {
  version: 0,
  snapshot: { version: 0, proxies: [] } as ColliderSnapshot,
  listeners: new Set<Listener>(),
}

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

export function buildBodyProxySnapshotFromBones(bones: Record<string, THREE.Bone>): Omit<ColliderSnapshot, 'version'> {
  const proxies = [] as ColliderSnapshot['proxies']
  const head = getBone(bones, ['head', 'spine006', 'neck'])
  const neck = getBone(bones, ['neck', 'spine006', 'spine005'])
  const chest = getBone(bones, ['spine005', 'spine004', 'chest'])
  const pelvis = getBone(bones, ['hips', 'pelvis', 'spine'])
  const leftUpperArm = getBone(bones, ['upperarml', 'leftupperarm'])
  const leftForearm = getBone(bones, ['forearml', 'leftforearm'])
  const rightUpperArm = getBone(bones, ['upperarmr', 'rightupperarm'])
  const rightForearm = getBone(bones, ['forearmr', 'rightforearm'])
  const leftThigh = getBone(bones, ['thighl', 'leftupleg'])
  const leftCalf = getBone(bones, ['thighl001', 'shinl', 'leftleg'])
  const rightThigh = getBone(bones, ['thighr', 'rightupleg'])
  const rightCalf = getBone(bones, ['thighr001', 'shinr', 'rightleg'])

  if (head) {
    const p = head.getWorldPosition(new THREE.Vector3())
    proxies.push({ kind: 'sphere', cx: p.x, cy: p.y + 0.02, cz: p.z, r: 0.12, friction: 0.55, skin: 0.01 })
  }

  if (chest && pelvis) {
    proxies.push(buildTorsoEllipsoid(chest, pelvis, 0.18, 0.26, 0.14))
  }
  if (pelvis) {
    const p = pelvis.getWorldPosition(new THREE.Vector3())
    proxies.push({ kind: 'ellipsoid', cx: p.x, cy: p.y + 0.03, cz: p.z, rx: 0.16, ry: 0.12, rz: 0.12, qx: 0, qy: 0, qz: 0, qw: 1, friction: 0.6, skin: 0.01 })
  }

  pushCapsule(proxies, leftUpperArm, leftForearm, 0.06)
  pushCapsule(proxies, rightUpperArm, rightForearm, 0.06)
  pushCapsule(proxies, leftThigh, leftCalf, 0.09)
  pushCapsule(proxies, rightThigh, rightCalf, 0.09)
  if (neck && head) pushCapsule(proxies, neck, head, 0.06)

  return { proxies }
}

function getBone(bones: Record<string, THREE.Bone>, aliases: string[]) {
  const wanted = aliases.map(normalizeBoneName)
  return Object.values(bones).find((bone) => wanted.includes(normalizeBoneName(bone.name))) ?? null
}

function normalizeBoneName(name: string) {
  return name.replace(/^DEF-/, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function pushCapsule(proxies: ColliderSnapshot['proxies'], a: THREE.Bone | null, b: THREE.Bone | null, radius: number) {
  if (!a || !b) return
  const start = a.getWorldPosition(new THREE.Vector3())
  const end = b.getWorldPosition(new THREE.Vector3())
  proxies.push({
    kind: 'capsule',
    ax: start.x,
    ay: start.y,
    az: start.z,
    bx: end.x,
    by: end.y,
    bz: end.z,
    r: radius,
    friction: 0.5,
    skin: 0.008,
  })
}

function buildTorsoEllipsoid(
  chest: THREE.Bone,
  pelvis: THREE.Bone,
  rx: number,
  ry: number,
  rz: number,
): EllipsoidProxy {
  const top = chest.getWorldPosition(new THREE.Vector3())
  const bottom = pelvis.getWorldPosition(new THREE.Vector3())
  const center = top.clone().lerp(bottom, 0.5)
  return {
    kind: 'ellipsoid',
    cx: center.x,
    cy: center.y,
    cz: center.z,
    rx,
    ry: Math.max(ry, top.distanceTo(bottom) * 0.6),
    rz,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    friction: 0.65,
    skin: 0.01,
  }
}