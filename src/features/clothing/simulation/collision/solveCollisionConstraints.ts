import type {
  CapsuleProxy,
  ClothSimMesh,
  ColliderProxy,
  ColliderSnapshot,
  CollisionBounds,
  CollisionMeshPatchSnapshot,
  EllipsoidProxy,
  MeshSurfaceColliderSnapshot,
  SphereProxy,
} from '../types'

const CONTACT_RESULT = new Float32Array(6)
const TRIANGLE_RESULT = new Float32Array(6)
const ROTATED_LOCAL = new Float32Array(3)
const ROTATED_SURFACE = new Float32Array(3)
const ROTATED_NORMAL = new Float32Array(3)
const MAX_COLLIDER_SEARCH_RADIUS = 4

type TriangleColliderSurface = CollisionMeshPatchSnapshot | MeshSurfaceColliderSnapshot

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
      if (!pushOutOfMeshCollider(meshCollider, px, py, pz, CONTACT_RESULT)) continue
      px = CONTACT_RESULT[0]
      py = CONTACT_RESULT[1]
      pz = CONTACT_RESULT[2]
      applyContactFriction(prevPositions, offset, px, py, pz, CONTACT_RESULT[3], CONTACT_RESULT[4], CONTACT_RESULT[5], meshCollider.friction)
      hit = true
    }

    for (const patch of snapshot.lowResMeshPatches ?? []) {
      if (!pushOutOfLowResPatch(patch, px, py, pz, CONTACT_RESULT)) continue
      px = CONTACT_RESULT[0]
      py = CONTACT_RESULT[1]
      pz = CONTACT_RESULT[2]
      applyContactFriction(prevPositions, offset, px, py, pz, CONTACT_RESULT[3], CONTACT_RESULT[4], CONTACT_RESULT[5], patch.friction)
      hit = true
    }

    for (const proxy of snapshot.proxies) {
      if (!pushOut(proxy, px, py, pz, CONTACT_RESULT)) continue
      px = CONTACT_RESULT[0]
      py = CONTACT_RESULT[1]
      pz = CONTACT_RESULT[2]
      applyContactFriction(prevPositions, offset, px, py, pz, CONTACT_RESULT[3], CONTACT_RESULT[4], CONTACT_RESULT[5], proxy.friction)
      hit = true
    }

    if (hit) {
      positions[offset] = px
      positions[offset + 1] = py
      positions[offset + 2] = pz
    }
  }
}

function applyContactFriction(
  prevPositions: Float32Array,
  offset: number,
  px: number,
  py: number,
  pz: number,
  nx: number,
  ny: number,
  nz: number,
  friction: number,
) {
  const dx = px - prevPositions[offset]
  const dy = py - prevPositions[offset + 1]
  const dz = pz - prevPositions[offset + 2]
  const normalDot = dx * nx + dy * ny + dz * nz
  const tx = dx - nx * normalDot
  const ty = dy - ny * normalDot
  const tz = dz - nz * normalDot
  const limitedFriction = Math.min(1, friction)
  prevPositions[offset] += tx * limitedFriction
  prevPositions[offset + 1] += ty * limitedFriction
  prevPositions[offset + 2] += tz * limitedFriction
}

function pushOutOfLowResPatch(
  patch: CollisionMeshPatchSnapshot,
  px: number,
  py: number,
  pz: number,
  out: Float32Array,
) {
  const target = patch.skin + patch.thickness
  if (target <= 0 || patch.indices.length < 3 || isOutsideBounds(patch.bounds, target, px, py, pz)) return false

  const searchRadius = colliderSearchRadius(target, patch.cellSize)
  const cx = Math.floor(px / patch.cellSize)
  const cy = Math.floor(py / patch.cellSize)
  const cz = Math.floor(pz / patch.cellSize)
  const visitStamp = nextVisitStamp(patch)
  let bestDistSq = Infinity
  let bestX = 0
  let bestY = 0
  let bestZ = 0
  let bestNx = 0
  let bestNy = 1
  let bestNz = 0

  for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
    for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
      for (let dz = -searchRadius; dz <= searchRadius; dz += 1) {
        const cellIndex = patch.cellIndexLookup.get(hashCell(cx + dx, cy + dy, cz + dz))
        if (cellIndex === undefined) continue
        const start = patch.cellStarts[cellIndex]
        const count = patch.cellCounts[cellIndex]
        for (let item = 0; item < count; item += 1) {
          const triangle = patch.cellTriangleIndices[start + item]
          if (patch.triangleVisitMarks[triangle] === visitStamp) continue
          patch.triangleVisitMarks[triangle] = visitStamp
          if (!closestPointOnTriangle(patch, triangle, px, py, pz, TRIANGLE_RESULT)) continue
          const deltaX = px - TRIANGLE_RESULT[0]
          const deltaY = py - TRIANGLE_RESULT[1]
          const deltaZ = pz - TRIANGLE_RESULT[2]
          const distSq = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ
          if (distSq < bestDistSq) {
            bestDistSq = distSq
            bestX = TRIANGLE_RESULT[0]
            bestY = TRIANGLE_RESULT[1]
            bestZ = TRIANGLE_RESULT[2]
            bestNx = TRIANGLE_RESULT[3]
            bestNy = TRIANGLE_RESULT[4]
            bestNz = TRIANGLE_RESULT[5]
          }
        }
      }
    }
  }

  if (bestDistSq >= target * target) return false
  const dist = Math.sqrt(bestDistSq)
  let nx = px - bestX
  let ny = py - bestY
  let nz = pz - bestZ
  if (dist > 1e-6) {
    const inv = 1 / dist
    nx *= inv
    ny *= inv
    nz *= inv
  } else {
    nx = bestNx
    ny = bestNy
    nz = bestNz
  }
  const correction = target - dist
  out[0] = px + nx * correction
  out[1] = py + ny * correction
  out[2] = pz + nz * correction
  out[3] = nx
  out[4] = ny
  out[5] = nz
  return true
}

function pushOutOfMeshCollider(
  collider: MeshSurfaceColliderSnapshot,
  px: number,
  py: number,
  pz: number,
  out: Float32Array,
) {
  const target = collider.skin + collider.thickness
  if (target <= 0 || isOutsideBounds(collider.bounds, target, px, py, pz)) return false
  const cellSize = collider.cellSize
  const searchRadius = colliderSearchRadius(target, cellSize)
  const cx = Math.floor(px / cellSize)
  const cy = Math.floor(py / cellSize)
  const cz = Math.floor(pz / cellSize)
  const visitStamp = nextVisitStamp(collider)
  let bestSigned = Infinity
  let bestAbs = Infinity
  let bestNx = 0
  let bestNy = 1
  let bestNz = 0

  for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
    for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
      for (let dz = -searchRadius; dz <= searchRadius; dz += 1) {
        const cellIndex = collider.cellIndexLookup.get(hashCell(cx + dx, cy + dy, cz + dz))
        if (cellIndex === undefined) continue
        const start = collider.cellStarts[cellIndex]
        const count = collider.cellCounts[cellIndex]
        for (let item = 0; item < count; item += 1) {
          const triangle = collider.cellTriangleIndices[start + item]
          if (collider.triangleVisitMarks[triangle] === visitStamp) continue
          collider.triangleVisitMarks[triangle] = visitStamp
          if (!closestPointOnTriangle(collider, triangle, px, py, pz, TRIANGLE_RESULT)) continue
          const signed =
            (px - TRIANGLE_RESULT[0]) * TRIANGLE_RESULT[3]
            + (py - TRIANGLE_RESULT[1]) * TRIANGLE_RESULT[4]
            + (pz - TRIANGLE_RESULT[2]) * TRIANGLE_RESULT[5]
          const abs = Math.abs(signed)
          if (abs < bestAbs) {
            bestSigned = signed
            bestAbs = abs
            bestNx = TRIANGLE_RESULT[3]
            bestNy = TRIANGLE_RESULT[4]
            bestNz = TRIANGLE_RESULT[5]
          }
        }
      }
    }
  }

  if (bestAbs === Infinity || bestSigned >= target || bestAbs > cellSize * (searchRadius + 1.5)) return false
  const correction = target - bestSigned
  out[0] = px + bestNx * correction
  out[1] = py + bestNy * correction
  out[2] = pz + bestNz * correction
  out[3] = bestNx
  out[4] = bestNy
  out[5] = bestNz
  return true
}

function closestPointOnTriangle(
  collider: TriangleColliderSurface,
  triangle: number,
  px: number,
  py: number,
  pz: number,
  out: Float32Array,
) {
  const normalOffset = triangle * 3
  const nx = collider.triangleNormals[normalOffset]
  const ny = collider.triangleNormals[normalOffset + 1]
  const nz = collider.triangleNormals[normalOffset + 2]
  if (nx === 0 && ny === 0 && nz === 0) return false
  const ia = collider.indices[triangle * 3] * 3
  const ib = collider.indices[triangle * 3 + 1] * 3
  const ic = collider.indices[triangle * 3 + 2] * 3
  closestPointTriangleRaw(
    px,
    py,
    pz,
    collider.vertices[ia],
    collider.vertices[ia + 1],
    collider.vertices[ia + 2],
    collider.vertices[ib],
    collider.vertices[ib + 1],
    collider.vertices[ib + 2],
    collider.vertices[ic],
    collider.vertices[ic + 1],
    collider.vertices[ic + 2],
    out,
  )
  out[3] = nx
  out[4] = ny
  out[5] = nz
  return true
}

function closestPointTriangleRaw(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  out: Float32Array,
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
  if (d1 <= 0 && d2 <= 0) {
    out[0] = ax
    out[1] = ay
    out[2] = az
    return
  }

  const bpx = px - bx
  const bpy = py - by
  const bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) {
    out[0] = bx
    out[1] = by
    out[2] = bz
    return
  }

  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    out[0] = ax + abx * v
    out[1] = ay + aby * v
    out[2] = az + abz * v
    return
  }

  const cpx = px - cx
  const cpy = py - cy
  const cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) {
    out[0] = cx
    out[1] = cy
    out[2] = cz
    return
  }

  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    out[0] = ax + acx * w
    out[1] = ay + acy * w
    out[2] = az + acz * w
    return
  }

  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
    out[0] = bx + (cx - bx) * w
    out[1] = by + (cy - by) * w
    out[2] = bz + (cz - bz) * w
    return
  }

  const denom = 1 / (va + vb + vc)
  const v = vb * denom
  const w = vc * denom
  out[0] = ax + abx * v + acx * w
  out[1] = ay + aby * v + acy * w
  out[2] = az + abz * v + acz * w
}

function pushOut(proxy: ColliderProxy, px: number, py: number, pz: number, out: Float32Array) {
  switch (proxy.kind) {
    case 'sphere':
      return pushOutOfSphere(proxy, px, py, pz, out)
    case 'capsule':
      return pushOutOfCapsule(proxy, px, py, pz, out)
    case 'ellipsoid':
      return pushOutOfEllipsoid(proxy, px, py, pz, out)
  }
}

function pushOutOfSphere(proxy: SphereProxy, px: number, py: number, pz: number, out: Float32Array) {
  const target = proxy.r + proxy.skin
  const dx = px - proxy.cx
  if (dx <= -target || dx >= target) return false
  const dy = py - proxy.cy
  if (dy <= -target || dy >= target) return false
  const dz = pz - proxy.cz
  if (dz <= -target || dz >= target) return false
  const distanceSq = dx * dx + dy * dy + dz * dz
  if (distanceSq >= target * target) return false
  const distance = Math.sqrt(distanceSq) || 1e-6
  const inv = 1 / distance
  out[0] = proxy.cx + dx * inv * target
  out[1] = proxy.cy + dy * inv * target
  out[2] = proxy.cz + dz * inv * target
  out[3] = dx * inv
  out[4] = dy * inv
  out[5] = dz * inv
  return true
}

function pushOutOfCapsule(proxy: CapsuleProxy, px: number, py: number, pz: number, out: Float32Array) {
  const abx = proxy.bx - proxy.ax
  const aby = proxy.by - proxy.ay
  const abz = proxy.bz - proxy.az
  const target = proxy.r + proxy.skin
  const minX = Math.min(proxy.ax, proxy.bx) - target
  const maxX = Math.max(proxy.ax, proxy.bx) + target
  const minY = Math.min(proxy.ay, proxy.by) - target
  const maxY = Math.max(proxy.ay, proxy.by) + target
  const minZ = Math.min(proxy.az, proxy.bz) - target
  const maxZ = Math.max(proxy.az, proxy.bz) + target
  if (px < minX || px > maxX || py < minY || py > maxY || pz < minZ || pz > maxZ) return false
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
  const distanceSq = dx * dx + dy * dy + dz * dz
  if (distanceSq >= target * target) return false
  const distance = Math.sqrt(distanceSq) || 1e-6
  const inv = 1 / distance
  out[0] = qx + dx * inv * target
  out[1] = qy + dy * inv * target
  out[2] = qz + dz * inv * target
  out[3] = dx * inv
  out[4] = dy * inv
  out[5] = dz * inv
  return true
}

function pushOutOfEllipsoid(proxy: EllipsoidProxy, px: number, py: number, pz: number, out: Float32Array) {
  const dx = px - proxy.cx
  const dy = py - proxy.cy
  const dz = pz - proxy.cz
  const outerRadius = Math.max(proxy.rx, proxy.ry, proxy.rz) + proxy.skin
  if (dx < -outerRadius || dx > outerRadius || dy < -outerRadius || dy > outerRadius || dz < -outerRadius || dz > outerRadius) return false
  rotateVecInto(dx, dy, dz, -proxy.qx, -proxy.qy, -proxy.qz, proxy.qw, ROTATED_LOCAL)
  const sx = ROTATED_LOCAL[0] / proxy.rx
  const sy = ROTATED_LOCAL[1] / proxy.ry
  const sz = ROTATED_LOCAL[2] / proxy.rz
  const scaledLength = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1e-6
  if (scaledLength >= 1 + proxy.skin / Math.min(proxy.rx, proxy.ry, proxy.rz)) return null

  const surfScale = 1 / scaledLength
  const surfaceLocalX = ROTATED_LOCAL[0] * surfScale
  const surfaceLocalY = ROTATED_LOCAL[1] * surfScale
  const surfaceLocalZ = ROTATED_LOCAL[2] * surfScale
  normalizeInto(
    surfaceLocalX / (proxy.rx * proxy.rx),
    surfaceLocalY / (proxy.ry * proxy.ry),
    surfaceLocalZ / (proxy.rz * proxy.rz),
    ROTATED_NORMAL,
  )
  rotateVecInto(surfaceLocalX, surfaceLocalY, surfaceLocalZ, proxy.qx, proxy.qy, proxy.qz, proxy.qw, ROTATED_SURFACE)
  rotateVecInto(ROTATED_NORMAL[0], ROTATED_NORMAL[1], ROTATED_NORMAL[2], proxy.qx, proxy.qy, proxy.qz, proxy.qw, ROTATED_NORMAL)
  normalizeInto(ROTATED_NORMAL[0], ROTATED_NORMAL[1], ROTATED_NORMAL[2], ROTATED_NORMAL)
  out[0] = proxy.cx + ROTATED_SURFACE[0] + ROTATED_NORMAL[0] * proxy.skin
  out[1] = proxy.cy + ROTATED_SURFACE[1] + ROTATED_NORMAL[1] * proxy.skin
  out[2] = proxy.cz + ROTATED_SURFACE[2] + ROTATED_NORMAL[2] * proxy.skin
  out[3] = ROTATED_NORMAL[0]
  out[4] = ROTATED_NORMAL[1]
  out[5] = ROTATED_NORMAL[2]
  return true
}

function rotateVecInto(x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number, out: Float32Array) {
  const tx = 2 * (qy * z - qz * y)
  const ty = 2 * (qz * x - qx * z)
  const tz = 2 * (qx * y - qy * x)
  out[0] = x + qw * tx + (qy * tz - qz * ty)
  out[1] = y + qw * ty + (qz * tx - qx * tz)
  out[2] = z + qw * tz + (qx * ty - qy * tx)
}

function normalizeInto(x: number, y: number, z: number, out: Float32Array) {
  const length = Math.sqrt(x * x + y * y + z * z) || 1e-6
  out[0] = x / length
  out[1] = y / length
  out[2] = z / length
}

function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function colliderSearchRadius(target: number, cellSize: number) {
  return Math.min(MAX_COLLIDER_SEARCH_RADIUS, Math.max(1, Math.ceil(target / cellSize) + 1))
}

function nextVisitStamp(collider: TriangleColliderSurface) {
  let stamp = collider.triangleVisitStamp + 1
  if (stamp >= 0xffffffff) {
    collider.triangleVisitMarks.fill(0)
    stamp = 1
  }
  collider.triangleVisitStamp = stamp
  return stamp
}

function isOutsideBounds(bounds: CollisionBounds, margin: number, x: number, y: number, z: number) {
  return (
    x < bounds.minX - margin
    || x > bounds.maxX + margin
    || y < bounds.minY - margin
    || y > bounds.maxY + margin
    || z < bounds.minZ - margin
    || z > bounds.maxZ + margin
  )
}

function hashCell(x: number, y: number, z: number) {
  return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0
}
