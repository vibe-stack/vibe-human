import * as THREE from 'three/webgpu'
import type { MeshBVH } from 'three-mesh-bvh'
import type { CapsuleCollider, ClothSolverState, Collider, MeshCollider, SphereCollider } from './types'

// Pre-allocated scratch — reused across every particle / every frame.
const _localPoint = new THREE.Vector3()
const _worldHit = new THREE.Vector3()
const _hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 }
const _faceNormal = new THREE.Vector3()
const _worldNormal = new THREE.Vector3()
const _tri = new THREE.Triangle()
const _vA = new THREE.Vector3()
const _vB = new THREE.Vector3()
const _vC = new THREE.Vector3()

type MeshQueryCache = {
  localMat: THREE.Matrix4
  worldMat: THREE.Matrix4
  normalMat: THREE.Matrix3
}

type MeshColliderWithCache = MeshCollider & {
  __queryCache?: MeshQueryCache
}

/** Project every particle out of every collider. Pure SDF push — much
 *  cheaper and more reliable than rapier ball-vs-ball at this scale. */
export function projectColliders(state: ClothSolverState) {
  const { positions, prevPositions, invMass, colliders, particleCount } = state
  if (colliders.length === 0) return

  for (let k = 0; k < colliders.length; k += 1) {
    const c = colliders[k]
    if (c.kind === 'mesh') prepareMeshQuery(c)
  }

  for (let i = 0; i < particleCount; i += 1) {
    if (invMass[i] === 0) continue
    const o = i * 3
    let px = positions[o], py = positions[o + 1], pz = positions[o + 2]
    let touched = false

    for (let k = 0; k < colliders.length; k += 1) {
      const c = colliders[k]
      let r: PushResult = null
      if (c.kind === 'sphere') r = pushOutOfSphere(c, px, py, pz)
      else if (c.kind === 'capsule') r = pushOutOfCapsule(c, px, py, pz)
      else if (c.kind === 'mesh') r = pushOutOfMesh(c, px, py, pz)
      if (r) {
        // Save predicted position before pushout so we can compute penetration depth.
        const predX = px, predY = py, predZ = pz
        px = r.x; py = r.y; pz = r.z
        // Friction: Coulomb model — static friction fully stops tangential slip when
        // it falls within μ × penDepth; kinetic friction clamps it otherwise.
        const fr = c.friction
        if (fr > 0) {
          const opx = prevPositions[o], opy = prevPositions[o + 1], opz = prevPositions[o + 2]
          const nx = r.nx, ny = r.ny, nz = r.nz
          // Tangential displacement (same whether measured from pushed or predicted pos
          // because the pushout correction is purely normal).
          const dx = px - opx, dy = py - opy, dz = pz - opz
          const dn = dx * nx + dy * ny + dz * nz
          const tx = dx - nx * dn, ty = dy - ny * dn, tz = dz - nz * dn
          // Penetration depth = pushout correction projected onto the contact normal.
          const penDepth = (px - predX) * nx + (py - predY) * ny + (pz - predZ) * nz
          if (penDepth > 1e-6) {
            const tangMagSq = tx * tx + ty * ty + tz * tz
            const coulombLimit = fr * penDepth
            if (tangMagSq <= coulombLimit * coulombLimit) {
              // Static friction: zero tangential velocity entirely.
              prevPositions[o]     = opx + tx
              prevPositions[o + 1] = opy + ty
              prevPositions[o + 2] = opz + tz
            } else {
              // Kinetic friction: clamp tangential displacement to μ × penDepth.
              const scale = coulombLimit / Math.sqrt(tangMagSq)
              prevPositions[o]     = opx + tx * scale
              prevPositions[o + 1] = opy + ty * scale
              prevPositions[o + 2] = opz + tz * scale
            }
          }
        }
        touched = true
      }
    }

    if (touched) {
      positions[o] = px; positions[o + 1] = py; positions[o + 2] = pz
    }
  }
}

type PushResult = { x: number; y: number; z: number; nx: number; ny: number; nz: number } | null

function pushOutOfSphere(c: SphereCollider, px: number, py: number, pz: number): PushResult {
  const dx = px - c.cx, dy = py - c.cy, dz = pz - c.cz
  const distSq = dx * dx + dy * dy + dz * dz
  const rSq = c.r * c.r
  if (distSq >= rSq) return null
  const dist = Math.sqrt(distSq) || 1e-6
  const inv = 1 / dist
  const nx = dx * inv, ny = dy * inv, nz = dz * inv
  return {
    x: c.cx + nx * c.r,
    y: c.cy + ny * c.r,
    z: c.cz + nz * c.r,
    nx, ny, nz,
  }
}

function pushOutOfCapsule(c: CapsuleCollider, px: number, py: number, pz: number): PushResult {
  // Find closest point on segment a..b
  const abx = c.bx - c.ax, aby = c.by - c.ay, abz = c.bz - c.az
  const apx = px - c.ax, apy = py - c.ay, apz = pz - c.az
  const segLenSq = abx * abx + aby * aby + abz * abz
  const t = segLenSq < 1e-9 ? 0 : clamp01((apx * abx + apy * aby + apz * abz) / segLenSq)
  const qx = c.ax + abx * t, qy = c.ay + aby * t, qz = c.az + abz * t
  const dx = px - qx, dy = py - qy, dz = pz - qz
  const distSq = dx * dx + dy * dy + dz * dz
  const rSq = c.r * c.r
  if (distSq >= rSq) return null
  const dist = Math.sqrt(distSq) || 1e-6
  const inv = 1 / dist
  const nx = dx * inv, ny = dy * inv, nz = dz * inv
  return {
    x: qx + nx * c.r,
    y: qy + ny * c.r,
    z: qz + nz * c.r,
    nx, ny, nz,
  }
}

function clamp01(v: number) { return v < 0 ? 0 : v > 1 ? 1 : v }

function prepareMeshQuery(collider: MeshCollider) {
  const c = collider as MeshColliderWithCache
  const cache = c.__queryCache ??= {
    localMat: new THREE.Matrix4(),
    worldMat: new THREE.Matrix4(),
    normalMat: new THREE.Matrix3(),
  }
  cache.worldMat.fromArray(c.mesh.matrixWorld.elements as ArrayLike<number>)
  cache.localMat.copy(cache.worldMat).invert()
  cache.normalMat.getNormalMatrix(cache.worldMat)
  return cache
}

/**
 * Push a point out of a triangle mesh using a MeshBVH. We query for the
 * closest point on the mesh surface in mesh-local space, then decide which
 * side of the surface we're on by checking the dot product with the face
 * normal. If we're inside (or within `skin`), snap to the surface + skin
 * along the outward normal.
 *
 * Performance: O(log N) per query thanks to BVH. We reuse scratch vectors
 * across calls so the hot loop allocates nothing.
 */
function pushOutOfMesh(c: MeshCollider, px: number, py: number, pz: number): PushResult {
  const geom = c.mesh.geometry as unknown as THREE.BufferGeometry & { boundsTree?: MeshBVH }
  const bvh = geom.boundsTree
  if (!bvh) return null
  const cache = prepareMeshQuery(c)

  _localPoint.set(px, py, pz).applyMatrix4(cache.localMat)

  const hit = bvh.closestPointToPoint(_localPoint, _hit)
  if (!hit) return null

  if (!getTriangleNormal(geom, hit.faceIndex ?? 0, _faceNormal)) return null

  // Transform hit point + face normal to world.
  _worldHit.copy(hit.point).applyMatrix4(cache.worldMat)
  _worldNormal.copy(_faceNormal).applyMatrix3(cache.normalMat).normalize()

  const dx = px - _worldHit.x
  const dy = py - _worldHit.y
  const dz = pz - _worldHit.z
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const sgn = dx * _worldNormal.x + dy * _worldNormal.y + dz * _worldNormal.z

  // If the particle is clearly far from the surface AND on the outward
  // side of the face normal, it's free — skip.
  if (sgn > c.skin && dist > c.skin) return null

  // When the closest point is on the back side of a consistently wound body
  // mesh, the particle is inside the collider and still needs to be pushed
  // along the outward face normal. Using the surface→particle vector there
  // moves the particle deeper into the body and causes the visible jumping.
  const nx = _worldNormal.x
  const ny = _worldNormal.y
  const nz = _worldNormal.z

  return {
    x: _worldHit.x + nx * c.skin,
    y: _worldHit.y + ny * c.skin,
    z: _worldHit.z + nz * c.skin,
    nx, ny, nz,
  }
}

function getTriangleNormal(
  geom: THREE.BufferGeometry,
  faceIndex: number,
  out: THREE.Vector3,
): boolean {
  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!posAttr) return false
  const index = geom.getIndex()
  const a = index ? index.getX(faceIndex * 3 + 0) : faceIndex * 3 + 0
  const b = index ? index.getX(faceIndex * 3 + 1) : faceIndex * 3 + 1
  const c = index ? index.getX(faceIndex * 3 + 2) : faceIndex * 3 + 2
  _vA.fromBufferAttribute(posAttr, a)
  _vB.fromBufferAttribute(posAttr, b)
  _vC.fromBufferAttribute(posAttr, c)
  _tri.set(_vA, _vB, _vC)
  _tri.getNormal(out)
  return true
}

// ---------------------------------------------------------------------------
// Helpers for placing pre-canned colliders in world space.
// ---------------------------------------------------------------------------

export const sphere = (cx: number, cy: number, cz: number, r: number, friction = 0.6): Collider =>
  ({ kind: 'sphere', cx, cy, cz, r, friction })

export const capsule = (
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r: number, friction = 0.6,
): Collider => ({ kind: 'capsule', ax, ay, az, bx, by, bz, r, friction })
