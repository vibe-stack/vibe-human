import type {
  CapsuleProxy,
  ClothSimMesh,
  ColliderProxy,
  ColliderSnapshot,
  CollisionMeshPatchSnapshot,
  EllipsoidProxy,
  MeshSurfaceColliderSnapshot,
  SphereProxy,
} from '../types'

export function solveCollisionConstraints(mesh: ClothSimMesh, snapshot: ColliderSnapshot | null) {
  if (
    !snapshot
    || (
      snapshot.proxies.length === 0
      && (snapshot.meshColliders?.length ?? 0) === 0
      && (snapshot.lowResMeshPatches?.length ?? 0) === 0
    )
  ) return
  const { positions, prevPositions, invMass, particleCount } = mesh

  for (let particle = 0; particle < particleCount; particle += 1) {
    if (invMass[particle] === 0) continue
    const offset = particle * 3
    let px = positions[offset]
    let py = positions[offset + 1]
    let pz = positions[offset + 2]
    let hit = false

    for (const meshCollider of snapshot.meshColliders ?? []) {
      const pushed = pushOutOfMeshCollider(meshCollider, px, py, pz)
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
      prevPositions[offset] += tx * Math.min(1, meshCollider.friction)
      prevPositions[offset + 1] += ty * Math.min(1, meshCollider.friction)
      prevPositions[offset + 2] += tz * Math.min(1, meshCollider.friction)
      hit = true
    }

    for (const patch of snapshot.lowResMeshPatches ?? []) {
      const pushed = pushOutOfLowResPatch(patch, px, py, pz)
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
      prevPositions[offset] += tx * Math.min(1, patch.friction)
      prevPositions[offset + 1] += ty * Math.min(1, patch.friction)
      prevPositions[offset + 2] += tz * Math.min(1, patch.friction)
      hit = true
    }

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

function pushOutOfLowResPatch(patch: CollisionMeshPatchSnapshot, px: number, py: number, pz: number) {
  const target = patch.skin + patch.thickness
  if (target <= 0 || patch.indices.length < 3) return null

  let best: ReturnType<typeof closestPointOnPatchTriangle> | null = null
  let bestDistSq = Infinity

  for (let triangle = 0; triangle < Math.floor(patch.indices.length / 3); triangle += 1) {
    const closest = closestPointOnPatchTriangle(patch, triangle, px, py, pz)
    if (!closest) continue
    const dx = px - closest.x
    const dy = py - closest.y
    const dz = pz - closest.z
    const distSq = dx * dx + dy * dy + dz * dz
    if (distSq < bestDistSq) {
      best = closest
      bestDistSq = distSq
    }
  }

  if (!best || bestDistSq >= target * target) return null
  const dist = Math.sqrt(bestDistSq)
  let nx = px - best.x
  let ny = py - best.y
  let nz = pz - best.z
  if (dist > 1e-6) {
    const inv = 1 / dist
    nx *= inv
    ny *= inv
    nz *= inv
  } else {
    nx = best.nx
    ny = best.ny
    nz = best.nz
  }
  const correction = target - dist
  return {
    x: px + nx * correction,
    y: py + ny * correction,
    z: pz + nz * correction,
    nx,
    ny,
    nz,
  }
}

function pushOutOfMeshCollider(collider: MeshSurfaceColliderSnapshot, px: number, py: number, pz: number) {
  const target = collider.skin + collider.thickness
  if (target <= 0) return null
  const cellSize = collider.cellSize
  const searchRadius = Math.max(1, Math.ceil(target / cellSize) + 1)
  const cx = Math.floor(px / cellSize)
  const cy = Math.floor(py / cellSize)
  const cz = Math.floor(pz / cellSize)
  let best: ReturnType<typeof closestPointOnTriangle> | null = null
  let bestSigned = Infinity
  let bestAbs = Infinity
  const visited = new Set<number>()

  for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
    for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
      for (let dz = -searchRadius; dz <= searchRadius; dz += 1) {
        const cellIndex = findCell(collider.cellKeys, hashCell(cx + dx, cy + dy, cz + dz))
        if (cellIndex < 0) continue
        const start = collider.cellStarts[cellIndex]
        const count = collider.cellCounts[cellIndex]
        for (let item = 0; item < count; item += 1) {
          const triangle = collider.cellTriangleIndices[start + item]
          if (visited.has(triangle)) continue
          visited.add(triangle)
          const closest = closestPointOnTriangle(collider, triangle, px, py, pz)
          if (!closest) continue
          const signed = (px - closest.x) * closest.nx + (py - closest.y) * closest.ny + (pz - closest.z) * closest.nz
          const abs = Math.abs(signed)
          if (abs < bestAbs) {
            best = closest
            bestSigned = signed
            bestAbs = abs
          }
        }
      }
    }
  }

  if (!best || bestSigned >= target || bestAbs > cellSize * (searchRadius + 1.5)) return null
  const correction = target - bestSigned
  return {
    x: px + best.nx * correction,
    y: py + best.ny * correction,
    z: pz + best.nz * correction,
    nx: best.nx,
    ny: best.ny,
    nz: best.nz,
  }
}

function closestPointOnTriangle(collider: MeshSurfaceColliderSnapshot, triangle: number, px: number, py: number, pz: number) {
  const ia = collider.indices[triangle * 3] * 3
  const ib = collider.indices[triangle * 3 + 1] * 3
  const ic = collider.indices[triangle * 3 + 2] * 3
  const ax = collider.vertices[ia]
  const ay = collider.vertices[ia + 1]
  const az = collider.vertices[ia + 2]
  const bx = collider.vertices[ib]
  const by = collider.vertices[ib + 1]
  const bz = collider.vertices[ib + 2]
  const cx = collider.vertices[ic]
  const cy = collider.vertices[ic + 1]
  const cz = collider.vertices[ic + 2]
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const acx = cx - ax
  const acy = cy - ay
  const acz = cz - az
  const nxRaw = aby * acz - abz * acy
  const nyRaw = abz * acx - abx * acz
  const nzRaw = abx * acy - aby * acx
  const nLen = Math.sqrt(nxRaw * nxRaw + nyRaw * nyRaw + nzRaw * nzRaw)
  if (nLen < 1e-9) return null
  const closest = closestPointTriangleRaw(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz)
  return {
    x: closest.x,
    y: closest.y,
    z: closest.z,
    nx: nxRaw / nLen,
    ny: nyRaw / nLen,
    nz: nzRaw / nLen,
  }
}

function closestPointOnPatchTriangle(patch: CollisionMeshPatchSnapshot, triangle: number, px: number, py: number, pz: number) {
  const ia = patch.indices[triangle * 3] * 3
  const ib = patch.indices[triangle * 3 + 1] * 3
  const ic = patch.indices[triangle * 3 + 2] * 3
  const ax = patch.vertices[ia]
  const ay = patch.vertices[ia + 1]
  const az = patch.vertices[ia + 2]
  const bx = patch.vertices[ib]
  const by = patch.vertices[ib + 1]
  const bz = patch.vertices[ib + 2]
  const cx = patch.vertices[ic]
  const cy = patch.vertices[ic + 1]
  const cz = patch.vertices[ic + 2]
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const acx = cx - ax
  const acy = cy - ay
  const acz = cz - az
  const nxRaw = aby * acz - abz * acy
  const nyRaw = abz * acx - abx * acz
  const nzRaw = abx * acy - aby * acx
  const nLen = Math.sqrt(nxRaw * nxRaw + nyRaw * nyRaw + nzRaw * nzRaw)
  if (nLen < 1e-9) return null
  const closest = closestPointTriangleRaw(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz)
  return {
    x: closest.x,
    y: closest.y,
    z: closest.z,
    nx: nxRaw / nLen,
    ny: nyRaw / nLen,
    nz: nzRaw / nLen,
  }
}

function closestPointTriangleRaw(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
) {
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const acx = cx - ax
  const acy = cy - ay
  const acz = cz - az
  const apx = px - ax
  const apy = py - ay
  const apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  if (d1 <= 0 && d2 <= 0) return { x: ax, y: ay, z: az }

  const bpx = px - bx
  const bpy = py - by
  const bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return { x: bx, y: by, z: bz }

  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return { x: ax + abx * v, y: ay + aby * v, z: az + abz * v }
  }

  const cpx = px - cx
  const cpy = py - cy
  const cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return { x: cx, y: cy, z: cz }

  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return { x: ax + acx * w, y: ay + acy * w, z: az + acz * w }
  }

  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
    return { x: bx + (cx - bx) * w, y: by + (cy - by) * w, z: bz + (cz - bz) * w }
  }

  const denom = 1 / (va + vb + vc)
  const v = vb * denom
  const w = vc * denom
  return {
    x: ax + abx * v + acx * w,
    y: ay + aby * v + acy * w,
    z: az + abz * v + acz * w,
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

function findCell(keys: Int32Array, key: number) {
  let low = 0
  let high = keys.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const value = keys[mid]
    if (value === key) return mid
    if (value < key) low = mid + 1
    else high = mid - 1
  }
  return -1
}

function hashCell(x: number, y: number, z: number) {
  return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0
}
