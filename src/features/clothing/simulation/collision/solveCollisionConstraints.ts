import type { CapsuleProxy, ClothSimMesh, ColliderProxy, ColliderSnapshot, EllipsoidProxy, SphereProxy } from '../types'

export function solveCollisionConstraints(mesh: ClothSimMesh, snapshot: ColliderSnapshot | null) {
  if (!snapshot || snapshot.proxies.length === 0) return
  const { positions, prevPositions, invMass, particleCount } = mesh

  for (let particle = 0; particle < particleCount; particle += 1) {
    if (invMass[particle] === 0) continue
    const offset = particle * 3
    let px = positions[offset]
    let py = positions[offset + 1]
    let pz = positions[offset + 2]
    let hit = false

    for (const proxy of snapshot.proxies) {
      const pushed = pushOut(proxy, px, py, pz)
      if (!pushed) continue
      px = pushed.x
      py = pushed.y
      pz = pushed.z
      const dx = px - prevPositions[offset]
      const dy = py - prevPositions[offset + 1]
      const dz = pz - prevPositions[offset + 2]
      const normalDot = dx * pushed.nx + dy * pushed.ny + dz * pushed.nz
      const tx = dx - pushed.nx * normalDot
      const ty = dy - pushed.ny * normalDot
      const tz = dz - pushed.nz * normalDot
      prevPositions[offset] += tx * Math.min(1, proxy.friction)
      prevPositions[offset + 1] += ty * Math.min(1, proxy.friction)
      prevPositions[offset + 2] += tz * Math.min(1, proxy.friction)
      hit = true
    }

    if (hit) {
      positions[offset] = px
      positions[offset + 1] = py
      positions[offset + 2] = pz
    }
  }
}

function pushOut(proxy: ColliderProxy, px: number, py: number, pz: number) {
  switch (proxy.kind) {
    case 'sphere':
      return pushOutOfSphere(proxy, px, py, pz)
    case 'capsule':
      return pushOutOfCapsule(proxy, px, py, pz)
    case 'ellipsoid':
      return pushOutOfEllipsoid(proxy, px, py, pz)
  }
}

function pushOutOfSphere(proxy: SphereProxy, px: number, py: number, pz: number) {
  const dx = px - proxy.cx
  const dy = py - proxy.cy
  const dz = pz - proxy.cz
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6
  const target = proxy.r + proxy.skin
  if (distance >= target) return null
  const inv = 1 / distance
  return {
    x: proxy.cx + dx * inv * target,
    y: proxy.cy + dy * inv * target,
    z: proxy.cz + dz * inv * target,
    nx: dx * inv,
    ny: dy * inv,
    nz: dz * inv,
  }
}

function pushOutOfCapsule(proxy: CapsuleProxy, px: number, py: number, pz: number) {
  const abx = proxy.bx - proxy.ax
  const aby = proxy.by - proxy.ay
  const abz = proxy.bz - proxy.az
  const apx = px - proxy.ax
  const apy = py - proxy.ay
  const apz = pz - proxy.az
  const segLenSq = abx * abx + aby * aby + abz * abz
  const t = segLenSq < 1e-9 ? 0 : clamp01((apx * abx + apy * aby + apz * abz) / segLenSq)
  const qx = proxy.ax + abx * t
  const qy = proxy.ay + aby * t
  const qz = proxy.az + abz * t
  const dx = px - qx
  const dy = py - qy
  const dz = pz - qz
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6
  const target = proxy.r + proxy.skin
  if (distance >= target) return null
  const inv = 1 / distance
  return {
    x: qx + dx * inv * target,
    y: qy + dy * inv * target,
    z: qz + dz * inv * target,
    nx: dx * inv,
    ny: dy * inv,
    nz: dz * inv,
  }
}

function pushOutOfEllipsoid(proxy: EllipsoidProxy, px: number, py: number, pz: number) {
  const local = rotateVec(px - proxy.cx, py - proxy.cy, pz - proxy.cz, -proxy.qx, -proxy.qy, -proxy.qz, proxy.qw)
  const sx = local.x / proxy.rx
  const sy = local.y / proxy.ry
  const sz = local.z / proxy.rz
  const scaledLength = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1e-6
  if (scaledLength >= 1 + proxy.skin / Math.min(proxy.rx, proxy.ry, proxy.rz)) return null

  const surfScale = 1 / scaledLength
  const surfaceLocal = {
    x: local.x * surfScale,
    y: local.y * surfScale,
    z: local.z * surfScale,
  }
  const normalLocal = normalize({
    x: surfaceLocal.x / (proxy.rx * proxy.rx),
    y: surfaceLocal.y / (proxy.ry * proxy.ry),
    z: surfaceLocal.z / (proxy.rz * proxy.rz),
  })
  const surfaceWorld = rotateVec(surfaceLocal.x, surfaceLocal.y, surfaceLocal.z, proxy.qx, proxy.qy, proxy.qz, proxy.qw)
  const normalWorld = normalize(rotateVec(normalLocal.x, normalLocal.y, normalLocal.z, proxy.qx, proxy.qy, proxy.qz, proxy.qw))
  return {
    x: proxy.cx + surfaceWorld.x + normalWorld.x * proxy.skin,
    y: proxy.cy + surfaceWorld.y + normalWorld.y * proxy.skin,
    z: proxy.cz + surfaceWorld.z + normalWorld.z * proxy.skin,
    nx: normalWorld.x,
    ny: normalWorld.y,
    nz: normalWorld.z,
  }
}

function rotateVec(x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number) {
  const tx = 2 * (qy * z - qz * y)
  const ty = 2 * (qz * x - qx * z)
  const tz = 2 * (qx * y - qy * x)
  return {
    x: x + qw * tx + (qy * tz - qz * ty),
    y: y + qw * ty + (qz * tx - qx * tz),
    z: z + qw * tz + (qx * ty - qy * tx),
  }
}

function normalize(v: { x: number; y: number; z: number }) {
  const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1e-6
  return { x: v.x / length, y: v.y / length, z: v.z / length }
}

function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value
}