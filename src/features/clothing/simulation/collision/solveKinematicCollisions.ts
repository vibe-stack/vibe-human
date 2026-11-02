import type { ClothSimMesh } from '../types'
import { closestPointBarycentric, type KinematicBodyCollider } from './kinematicBodyCollider'

// Cloth vs animated-body contacts, solved as XPBD constraints.
//
// Each substep: detectKinematicContacts() finds particle–skin contacts once at
// the predicted positions (as contact planes); projectKinematicContacts() is
// called inside every constraint iteration so stretch, bend, seams and contacts
// converge together; applyKinematicFriction() then applies body-relative
// Coulomb friction from the normal correction actually used, and
// applyContactVelocities() makes the response inelastic. Skin features poking
// between particles are resolved once per step by resolveSkinVertexContacts(). Projecting contacts once after all constraint iterations
// (the previous design) let the last hard projection win: cloth under motion
// could not transmit tension around the body and was peeled off it.

const CONTACT = new Float32Array(14)
const CLOSEST = new Float32Array(5)
const NEAR_TRIANGLES = new Uint32Array(256)

/**
 * Deepest penetration the persistent-contact fallback will resolve. Kept well
 * below the radius of a forearm: anything deeper is more likely cloth on the
 * far side of a thin limb than cloth that tunnelled in.
 */
const MAX_RECOVERY_DEPTH = 0.035
/** Contacts farther than this from their cached triangle are forgotten. */
const CONTACT_FORGET_DISTANCE = 0.25
/**
 * Substeps a particle stays friction-free after touching two opposing skin
 * surfaces. Fabric squeezed in an armpit or between the thighs is touched by
 * both sides; with friction the limb that moves drags it along (shirts ride up
 * and walk off the body). Real fabric slips there, so we let it.
 */
const PINCH_SUBSTEPS = 24
/** Contacts are kept for particles this close above the rest distance, so constraints cannot pull them in unseen. */
const CONTACT_MARGIN = 0.004
/** Candidate skin triangles kept per particle per fixed step. */
const CANDIDATE_CAP = 96
/** Skin-vertex/cloth-face pairs kept per cloth particle. */
const FACE_PAIRS_PER_PARTICLE = 4
/** A skin vertex never pushes cloth from further inside than this (thinner than any limb). */
const FACE_DEPTH_LIMIT = 0.025

export type BodyCollisionStats = {
  /** Particles touching the skin this step (last substep). */
  contacts: number
  /** Particles found below the skin surface at detection (last substep). */
  penetrations: number
  /** Deepest penetration below the skin surface at detection (metres, last substep). */
  maxPenetration: number
  /** Particles recovered through the persistent-contact fallback (whole step). */
  recovered: number
  /** Skin-vertex/cloth-face contact pairs resolved this step. */
  skinPushes: number
  /** Milliseconds in the skin-vertex/cloth-face pass (once per step). */
  skinPassMs: number
  /** Broad-phase re-gathers (whole step). */
  gathers: number
}

export function createBodyCollisionStats(): BodyCollisionStats {
  return { contacts: 0, penetrations: 0, maxPenetration: 0, recovered: 0, skinPushes: 0, skinPassMs: 0, gathers: 0 }
}

/**
 * Contact state for one cloth mesh against one animated body: broad-phase
 * candidates (gathered once per fixed step), persistent contacts (last skin
 * triangle, pinch detection), and this substep's contact constraints.
 */
export class KinematicContactCache {
  /**
   * Skin vertices push cloth faces (see resolveSkinVertexContacts). Off by
   * default: it removes residual poke-through on coarse cloth over bony skin,
   * but in the lab's stability matrix it made travelling locomotion (jog, run)
   * shed garments, while particle contacts alone keep every clip stable.
   */
  skinVertexContacts = false
  readonly grid: ClothTriangleGrid
  // Persistent across substeps.
  readonly triangle: Int32Array
  readonly normal: Float32Array
  readonly pinch: Uint8Array
  // Broad phase.
  readonly candidates: Uint32Array
  readonly candidateCount: Uint16Array
  readonly gatherPoint: Float32Array
  readonly gatherRadius: Float32Array
  readonly gatherGeneration: Int32Array
  readonly localTravel: Float32Array
  // Particle contacts of the current substep (contact plane through point, along normal).
  readonly contactFlag: Uint8Array
  readonly contactPoint: Float32Array
  readonly contactNormal: Float32Array
  readonly contactSkinMotion: Float32Array
  readonly contactFriction: Float32Array
  readonly normalCorrection: Float32Array
  // Skin-vertex / cloth-face pairs of the current substep.
  faceCount = 0
  readonly faceTriangle: Int32Array
  readonly faceWeights: Float32Array
  readonly faceNormal: Float32Array
  readonly facePoint: Float32Array
  readonly faceSkinMotion: Float32Array
  thickness = 0

  constructor(mesh: ClothSimMesh) {
    const n = mesh.particleCount
    this.grid = new ClothTriangleGrid(mesh)
    this.triangle = new Int32Array(n).fill(-1)
    this.normal = new Float32Array(n * 3)
    this.pinch = new Uint8Array(n)
    this.candidates = new Uint32Array(n * CANDIDATE_CAP)
    this.candidateCount = new Uint16Array(n)
    this.gatherPoint = new Float32Array(n * 3)
    this.gatherRadius = new Float32Array(n)
    this.gatherGeneration = new Int32Array(n).fill(-1)
    this.localTravel = new Float32Array(n)
    this.contactFlag = new Uint8Array(n)
    this.contactPoint = new Float32Array(n * 3)
    this.contactNormal = new Float32Array(n * 3)
    this.contactSkinMotion = new Float32Array(n * 3)
    this.contactFriction = new Float32Array(n)
    this.normalCorrection = new Float32Array(n)
    const pairs = Math.max(64, n * FACE_PAIRS_PER_PARTICLE)
    this.faceTriangle = new Int32Array(pairs)
    this.faceWeights = new Float32Array(pairs * 3)
    this.faceNormal = new Float32Array(pairs * 3)
    this.facePoint = new Float32Array(pairs * 3)
    this.faceSkinMotion = new Float32Array(pairs * 3)
  }

  clear() {
    this.triangle.fill(-1)
    this.normal.fill(0)
    this.pinch.fill(0)
    this.gatherGeneration.fill(-1)
    this.contactFlag.fill(0)
    this.faceCount = 0
  }
}

/**
 * Uniform hash grid over cloth triangles. The cloth lattice is coarser than
 * most skins, so body features (collar bones, shoulder caps, knuckles) can poke
 * through a cloth triangle while all three of its particles are outside the
 * skin. Skin vertices look up the triangles above them here.
 */
export class ClothTriangleGrid {
  readonly cellSize: number
  private readonly heads: Int32Array
  private readonly next: Int32Array
  private readonly entries: Uint32Array
  private readonly mask: number
  /** Bounding sphere per cloth triangle (cx, cy, cz, r), refreshed by rebuild(). */
  readonly spheres: Float32Array
  private count = 0
  minX = 0; minY = 0; minZ = 0; maxX = 0; maxY = 0; maxZ = 0

  constructor(mesh: ClothSimMesh) {
    let longest = 0.02
    for (const c of mesh.stretchConstraints) longest = Math.max(longest, c.rest)
    this.cellSize = Math.min(0.12, longest * 1.1)
    const triangleCount = mesh.triangles.length / 3
    const buckets = nextPowerOfTwo(Math.max(256, triangleCount * 4))
    this.heads = new Int32Array(buckets)
    this.mask = buckets - 1
    this.spheres = new Float32Array(triangleCount * 4)
    const capacity = Math.max(64, triangleCount * 32)
    this.next = new Int32Array(capacity)
    this.entries = new Uint32Array(capacity * 2)
  }

  rebuild(mesh: ClothSimMesh, margin: number) {
    const { positions, triangles } = mesh
    const inv = 1 / this.cellSize
    this.heads.fill(-1)
    this.count = 0
    this.minX = this.minY = this.minZ = Infinity
    this.maxX = this.maxY = this.maxZ = -Infinity
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3
      const x0 = Math.min(positions[a], positions[b], positions[c]) - margin
      const y0 = Math.min(positions[a + 1], positions[b + 1], positions[c + 1]) - margin
      const z0 = Math.min(positions[a + 2], positions[b + 2], positions[c + 2]) - margin
      const scx = (positions[a] + positions[b] + positions[c]) / 3
      const scy = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3
      const scz = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3
      const s4 = (t / 3) * 4
      this.spheres[s4] = scx
      this.spheres[s4 + 1] = scy
      this.spheres[s4 + 2] = scz
      this.spheres[s4 + 3] = Math.sqrt(Math.max(
        (positions[a] - scx) ** 2 + (positions[a + 1] - scy) ** 2 + (positions[a + 2] - scz) ** 2,
        (positions[b] - scx) ** 2 + (positions[b + 1] - scy) ** 2 + (positions[b + 2] - scz) ** 2,
        (positions[c] - scx) ** 2 + (positions[c + 1] - scy) ** 2 + (positions[c + 2] - scz) ** 2,
      ))
      const x1 = Math.max(positions[a], positions[b], positions[c]) + margin
      const y1 = Math.max(positions[a + 1], positions[b + 1], positions[c + 1]) + margin
      const z1 = Math.max(positions[a + 2], positions[b + 2], positions[c + 2]) + margin
      if (x0 < this.minX) this.minX = x0; if (y0 < this.minY) this.minY = y0; if (z0 < this.minZ) this.minZ = z0
      if (x1 > this.maxX) this.maxX = x1; if (y1 > this.maxY) this.maxY = y1; if (z1 > this.maxZ) this.maxZ = z1
      const cx0 = Math.floor(x0 * inv), cy0 = Math.floor(y0 * inv), cz0 = Math.floor(z0 * inv)
      const cx1 = Math.floor(x1 * inv), cy1 = Math.floor(y1 * inv), cz1 = Math.floor(z1 * inv)
      for (let cx = cx0; cx <= cx1; cx += 1) {
        for (let cy = cy0; cy <= cy1; cy += 1) {
          for (let cz = cz0; cz <= cz1; cz += 1) {
            if (this.count >= this.next.length) return
            const bucket = hashCell(cx, cy, cz) & this.mask
            const slot = this.count++
            this.entries[slot * 2] = t / 3
            this.entries[slot * 2 + 1] = packCell(cx, cy, cz)
            this.next[slot] = this.heads[bucket]
            this.heads[bucket] = slot
          }
        }
      }
    }
  }

  /** Triangles registered in the cell containing (x, y, z), written to `out`; returns the count. */
  query(x: number, y: number, z: number, out: Uint32Array) {
    const inv = 1 / this.cellSize
    const cx = Math.floor(x * inv), cy = Math.floor(y * inv), cz = Math.floor(z * inv)
    const key = packCell(cx, cy, cz)
    let count = 0
    for (let slot = this.heads[hashCell(cx, cy, cz) & this.mask]; slot >= 0 && count < out.length; slot = this.next[slot]) {
      if (this.entries[slot * 2 + 1] === key) out[count++] = this.entries[slot * 2]
    }
    return count
  }
}

/**
 * Find this substep's contacts against animated colliders. Call after the
 * colliders' setSubstep() and after integration (`prevPositions` holds the
 * particle positions at the start of the substep).
 */
export function detectKinematicContacts(
  mesh: ClothSimMesh,
  colliders: readonly KinematicBodyCollider[],
  cache: KinematicContactCache,
  substepFraction: number,
  stats: BodyCollisionStats | null,
) {
  cache.contactFlag.fill(0)
  cache.normalCorrection.fill(0)
  cache.faceCount = 0
  const collider = colliders[0]
  if (!collider?.ready) return
  const { positions, prevPositions, invMass, particleCount, particleFrictions } = mesh
  const { triangle: lastTriangle, normal: lastNormal, pinch, candidates, candidateCount, gatherPoint, gatherRadius, gatherGeneration, localTravel } = cache
  const thickness = collider.thickness
  cache.thickness = thickness
  if (stats) {
    stats.contacts = 0
    stats.penetrations = 0
    stats.maxPenetration = 0
  }

  // The skin can move this far relative to the character root during one
  // substep; a particle that was clear at the start can be at most this deep.
  const bodyTravel = collider.maxRelativeDisplacement * substepFraction
  const baseRadius = thickness + CONTACT_MARGIN + bodyTravel * 1.25
  // Shared root motion during this substep: cloth riding the body moves with it.
  const rootX = collider.rootStep[0] * substepFraction
  const rootY = collider.rootStep[1] * substepFraction
  const rootZ = collider.rootStep[2] * substepFraction
  const rootStepLength = Math.hypot(collider.rootStep[0], collider.rootStep[1], collider.rootStep[2])
  // Swept BVH bounds and triangle spheres already cover the skin's motion over
  // the whole step, so the gather radius only adds the per-substep depth
  // allowance and room for the particle's own motion; particles that outrun
  // it re-gather. Cloth riding the body will travel with the root for the rest
  // of the step, so the gather is centred halfway along that path.
  const remaining = 1 - collider.substepRange[0]
  const aheadX = collider.rootStep[0] * remaining * 0.5
  const aheadY = collider.rootStep[1] * remaining * 0.5
  const aheadZ = collider.rootStep[2] * remaining * 0.5
  const stepRadius = baseRadius + 0.02 + rootStepLength * remaining * 0.5
  const generation = collider.generation
  const triangleTravel = collider.triangleTravel

  for (let particle = 0; particle < particleCount; particle += 1) {
    if (invMass[particle] === 0) continue
    const o = particle * 3
    const px = positions[o]
    const py = positions[o + 1]
    const pz = positions[o + 2]
    const sx = prevPositions[o]
    const sy = prevPositions[o + 1]
    const sz = prevPositions[o + 2]
    const particleTravel = Math.hypot(px - sx - rootX, py - sy - rootY, pz - sz - rootZ)

    if (gatherGeneration[particle] !== generation || Math.hypot(px - gatherPoint[o], py - gatherPoint[o + 1], pz - gatherPoint[o + 2]) + baseRadius + particleTravel > gatherRadius[particle]) {
      const r = Math.max(stepRadius, baseRadius + particleTravel + 0.01)
      const offset = particle * CANDIDATE_CAP
      const count = collider.gather(px + aheadX, py + aheadY, pz + aheadZ, r, candidates, offset, CANDIDATE_CAP)
      candidateCount[particle] = count
      let travel = 0
      for (let k = 0; k < count; k += 1) travel = Math.max(travel, triangleTravel[candidates[offset + k]])
      localTravel[particle] = travel
      gatherPoint[o] = px + aheadX; gatherPoint[o + 1] = py + aheadY; gatherPoint[o + 2] = pz + aheadZ
      gatherRadius[particle] = r
      gatherGeneration[particle] = generation
      if (stats) stats.gathers += 1
    }
    // Depth allowance from the skin moving *here*, not the fastest hand.
    const radius = thickness + CONTACT_MARGIN + localTravel[particle] * substepFraction * 1.25 + particleTravel
    let found = collider.closestAmong(px, py, pz, radius, candidates, particle * CANDIDATE_CAP, candidateCount[particle], CONTACT)
    let recovered = false
    if (!found) {
      const tri = lastTriangle[particle]
      if (tri >= 0) {
        collider.closestOnTriangle(tri, px, py, pz, CONTACT)
        const signed = CONTACT[6]
        // Only a genuine crossing: outside the remembered skin triangle at the
        // start of the substep, behind it at the end.
        if (signed < 0 && signed > -MAX_RECOVERY_DEPTH && collider.signedDistanceAtSubstepStart(tri, sx, sy, sz) > -0.002) {
          found = true
          recovered = true
        } else if (Math.hypot(px - CONTACT[0], py - CONTACT[1], pz - CONTACT[2]) > CONTACT_FORGET_DISTANCE) {
          lastTriangle[particle] = -1
        }
      }
    }
    if (!found) continue

    const signed = CONTACT[6]
    lastTriangle[particle] = CONTACT[10]
    if (signed >= thickness + CONTACT_MARGIN) continue
    const nx = CONTACT[3], ny = CONTACT[4], nz = CONTACT[5]
    // Opposing contact normals on consecutive contacts: pinched between two surfaces.
    if (lastNormal[o] * nx + lastNormal[o + 1] * ny + lastNormal[o + 2] * nz < -0.35) pinch[particle] = PINCH_SUBSTEPS
    else if (pinch[particle] > 0) pinch[particle] -= 1
    lastNormal[o] = nx; lastNormal[o + 1] = ny; lastNormal[o + 2] = nz

    cache.contactFlag[particle] = 1
    cache.contactPoint[o] = CONTACT[0]; cache.contactPoint[o + 1] = CONTACT[1]; cache.contactPoint[o + 2] = CONTACT[2]
    cache.contactNormal[o] = nx; cache.contactNormal[o + 1] = ny; cache.contactNormal[o + 2] = nz
    cache.contactSkinMotion[o] = CONTACT[7]; cache.contactSkinMotion[o + 1] = CONTACT[8]; cache.contactSkinMotion[o + 2] = CONTACT[9]
    cache.contactFriction[particle] = pinch[particle] > 0 ? 0 : collider.friction * (particleFrictions?.[particle] ?? 1)
    if (stats) {
      if (signed < thickness) stats.contacts += 1
      if (signed < 0) {
        stats.penetrations += 1
        if (-signed > stats.maxPenetration) stats.maxPenetration = -signed
      }
      if (recovered) stats.recovered += 1
    }
  }

}

/**
 * Skin vertices poking through cloth faces between particles (a resolution
 * artefact: the cloth lattice is coarser than the skin). Resolved once per
 * fixed step, after the constraint loop of the final substep. Re-applying these
 * pairs inside every constraint iteration over-constrained faces shared by
 * several skin vertices and destabilised fast motion, so they are deliberately
 * kept out of the loop.
 */
export function resolveSkinVertexContacts(mesh: ClothSimMesh, colliders: readonly KinematicBodyCollider[], cache: KinematicContactCache, stats: BodyCollisionStats | null) {
  const collider = colliders[0]
  if (!collider?.ready || !cache.skinVertexContacts) return
  const start = performance.now()
  cache.faceCount = 0
  detectSkinVertexContacts(mesh, collider, cache)
  projectFaceContacts(mesh, cache)
  if (stats) {
    stats.skinPassMs = performance.now() - start
    stats.skinPushes = cache.faceCount
  }
}

/** Project this substep's contacts; call inside every constraint iteration. */
export function projectKinematicContacts(mesh: ClothSimMesh, cache: KinematicContactCache) {
  const { positions, particleCount } = mesh
  const { contactFlag, contactPoint, contactNormal, normalCorrection } = cache
  const thickness = cache.thickness
  for (let particle = 0; particle < particleCount; particle += 1) {
    if (contactFlag[particle] === 0) continue
    const o = particle * 3
    const nx = contactNormal[o], ny = contactNormal[o + 1], nz = contactNormal[o + 2]
    const c = (positions[o] - contactPoint[o]) * nx + (positions[o + 1] - contactPoint[o + 1]) * ny + (positions[o + 2] - contactPoint[o + 2]) * nz - thickness
    if (c >= 0) continue
    positions[o] -= nx * c
    positions[o + 1] -= ny * c
    positions[o + 2] -= nz * c
    normalCorrection[particle] -= c
  }

}

function projectFaceContacts(mesh: ClothSimMesh, cache: KinematicContactCache) {
  const { positions, invMass } = mesh
  const thickness = cache.thickness
  const { faceCount, faceTriangle, faceWeights, faceNormal, facePoint } = cache
  const triangles = mesh.triangles
  for (let k = 0; k < faceCount; k += 1) {
    const t = faceTriangle[k]
    const ia = triangles[t * 3], ib = triangles[t * 3 + 1], ic = triangles[t * 3 + 2]
    const a = ia * 3, b = ib * 3, c = ic * 3
    const u = faceWeights[k * 3], v = faceWeights[k * 3 + 1], w = faceWeights[k * 3 + 2]
    const k3 = k * 3
    const nx = faceNormal[k3], ny = faceNormal[k3 + 1], nz = faceNormal[k3 + 2]
    const qx = positions[a] * u + positions[b] * v + positions[c] * w
    const qy = positions[a + 1] * u + positions[b + 1] * v + positions[c + 1] * w
    const qz = positions[a + 2] * u + positions[b + 2] * v + positions[c + 2] * w
    const height = (qx - facePoint[k3]) * nx + (qy - facePoint[k3 + 1]) * ny + (qz - facePoint[k3 + 2]) * nz
    if (height >= thickness) continue
    const wa = invMass[ia] * u, wb = invMass[ib] * v, wc = invMass[ic] * w
    const denominator = wa * u + wb * v + wc * w
    if (denominator < 1e-12) continue
    const scale = (thickness - height) / denominator
    positions[a] += nx * wa * scale; positions[a + 1] += ny * wa * scale; positions[a + 2] += nz * wa * scale
    positions[b] += nx * wb * scale; positions[b + 1] += ny * wb * scale; positions[b + 2] += nz * wb * scale
    positions[c] += nx * wc * scale; positions[c + 1] += ny * wc * scale; positions[c + 2] += nz * wc * scale
  }
}

/**
 * Coulomb friction against the moving skin, after the constraint loop: the
 * tangential part of (particle motion − skin motion) is cancelled (stick) or
 * limited by μ·(normal correction) (slip). Cloth resting on a walking body is
 * carried along with it.
 */
export function applyKinematicFriction(mesh: ClothSimMesh, cache: KinematicContactCache) {
  const { positions, prevPositions, particleCount } = mesh
  const { contactFlag, contactNormal, contactSkinMotion, contactFriction, normalCorrection } = cache
  for (let particle = 0; particle < particleCount; particle += 1) {
    if (contactFlag[particle] === 0) continue
    const friction = contactFriction[particle]
    const depth = normalCorrection[particle]
    if (friction <= 0 || depth <= 0) continue
    const o = particle * 3
    const nx = contactNormal[o], ny = contactNormal[o + 1], nz = contactNormal[o + 2]
    const rx = positions[o] - prevPositions[o] - contactSkinMotion[o]
    const ry = positions[o + 1] - prevPositions[o + 1] - contactSkinMotion[o + 1]
    const rz = positions[o + 2] - prevPositions[o + 2] - contactSkinMotion[o + 2]
    const rn = rx * nx + ry * ny + rz * nz
    const tx = rx - nx * rn, ty = ry - ny * rn, tz = rz - nz * rn
    const tangentSq = tx * tx + ty * ty + tz * tz
    if (tangentSq < 1e-16) continue
    const limit = friction * depth
    const scale = tangentSq <= limit * limit ? 1 : limit / Math.sqrt(tangentSq)
    positions[o] -= tx * scale
    positions[o + 1] -= ty * scale
    positions[o + 2] -= tz * scale
  }
}

/**
 * Record skin-vertex / cloth-face pairs: a skin vertex projecting into a cloth
 * face from below (along its own normal) closer than the rest distance.
 */
function detectSkinVertexContacts(mesh: ClothSimMesh, collider: KinematicBodyCollider, cache: KinematicContactCache) {
  if (mesh.triangles.length === 0) return
  const grid = cache.grid
  const thickness = cache.thickness
  grid.rebuild(mesh, thickness + 0.01)
  const { positions, triangles } = mesh
  const { prev, curr, prevNormals, currNormals, vertexCount } = collider
  const [t0, t] = collider.substepRange
  const span = t - t0
  const spheres = grid.spheres
  const capacity = cache.faceTriangle.length
  for (let v = 0; v < vertexCount; v += 1) {
    const o = v * 3
    const mx = curr[o] - prev[o], my = curr[o + 1] - prev[o + 1], mz = curr[o + 2] - prev[o + 2]
    const vx = prev[o] + mx * t
    const vy = prev[o + 1] + my * t
    const vz = prev[o + 2] + mz * t
    if (vx < grid.minX || vx > grid.maxX || vy < grid.minY || vy > grid.maxY || vz < grid.minZ || vz > grid.maxZ) continue
    const near = grid.query(vx, vy, vz, NEAR_TRIANGLES)
    if (near === 0) continue
    let nx = prevNormals[o] + (currNormals[o] - prevNormals[o]) * t
    let ny = prevNormals[o + 1] + (currNormals[o + 1] - prevNormals[o + 1]) * t
    let nz = prevNormals[o + 2] + (currNormals[o + 2] - prevNormals[o + 2]) * t
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (nLen < 1e-9) continue
    nx /= nLen; ny /= nLen; nz /= nLen
    for (let k = 0; k < near; k += 1) {
      const tri = NEAR_TRIANGLES[k]
      const s4 = tri * 4
      const reach = spheres[s4 + 3] + thickness
      const ex = vx - spheres[s4], ey = vy - spheres[s4 + 1], ez = vz - spheres[s4 + 2]
      if (ex * ex + ey * ey + ez * ez > reach * reach) continue
      const ia = triangles[tri * 3], ib = triangles[tri * 3 + 1], ic = triangles[tri * 3 + 2]
      // Pinch guard: in an armpit or between the thighs a skin vertex on one
      // surface "sees" cloth resting on the opposite surface just above it and
      // would shove it into that surface. Only act where the face's own
      // particle contacts agree with this vertex's normal.
      if (!agreesWithContacts(cache, ia, nx, ny, nz) || !agreesWithContacts(cache, ib, nx, ny, nz) || !agreesWithContacts(cache, ic, nx, ny, nz)) continue
      const a = ia * 3, b = ib * 3, c = ic * 3
      // Faces roughly parallel to the skin only; a face crossing it edge-on is
      // handled by the particle contacts.
      const e1x = positions[b] - positions[a], e1y = positions[b + 1] - positions[a + 1], e1z = positions[b + 2] - positions[a + 2]
      const e2x = positions[c] - positions[a], e2y = positions[c + 1] - positions[a + 1], e2z = positions[c + 2] - positions[a + 2]
      const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x
      const fLen = Math.sqrt(fx * fx + fy * fy + fz * fz)
      if (fLen < 1e-12 || Math.abs(fx * nx + fy * ny + fz * nz) < 0.6 * fLen) continue
      closestPointBarycentric(
        vx, vy, vz,
        positions[a], positions[a + 1], positions[a + 2],
        positions[b], positions[b + 1], positions[b + 2],
        positions[c], positions[c + 1], positions[c + 2],
        CLOSEST,
      )
      const u = CLOSEST[3]
      const w1 = CLOSEST[4]
      const w2 = 1 - u - w1
      // Only faces the vertex projects onto; edges and corners belong to the
      // particle–skin contacts.
      if (u < 0.02 || w1 < 0.02 || w2 < 0.02) continue
      const dx = CLOSEST[0] - vx, dy = CLOSEST[1] - vy, dz = CLOSEST[2] - vz
      const height = dx * nx + dy * ny + dz * nz
      if (height >= thickness + CONTACT_MARGIN || height < -FACE_DEPTH_LIMIT) continue
      const lateralSq = dx * dx + dy * dy + dz * dz - height * height
      if (lateralSq > thickness * thickness * 4) continue
      if (cache.faceCount >= capacity) return
      const pair = cache.faceCount++
      const p3 = pair * 3
      cache.faceTriangle[pair] = tri
      cache.faceWeights[p3] = u; cache.faceWeights[p3 + 1] = w1; cache.faceWeights[p3 + 2] = w2
      cache.faceNormal[p3] = nx; cache.faceNormal[p3 + 1] = ny; cache.faceNormal[p3 + 2] = nz
      cache.facePoint[p3] = vx; cache.facePoint[p3 + 1] = vy; cache.facePoint[p3 + 2] = vz
      cache.faceSkinMotion[p3] = mx * span; cache.faceSkinMotion[p3 + 1] = my * span; cache.faceSkinMotion[p3 + 2] = mz * span
    }
  }
}

function agreesWithContacts(cache: KinematicContactCache, particle: number, nx: number, ny: number, nz: number) {
  if (cache.pinch[particle] > 0) return false
  if (cache.contactFlag[particle] === 0) return true
  const o = particle * 3
  return cache.contactNormal[o] * nx + cache.contactNormal[o + 1] * ny + cache.contactNormal[o + 2] * nz > 0.3
}

function hashCell(x: number, y: number, z: number) {
  return Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)
}

/** Cell identity, 10 bits per axis: unique across 1024 cells per axis, far more than any garment spans. */
function packCell(x: number, y: number, z: number) {
  return (((x & 1023) << 20) | ((y & 1023) << 10) | (z & 1023)) >>> 0
}

function nextPowerOfTwo(value: number) {
  let result = 1
  while (result < value) result <<= 1
  return result
}

/**
 * Inelastic contact response. Position projection pushes a particle out of the
 * skin within one substep, and deriving velocity from that displacement turns
 * every push into an outward kick (a 5 mm correction at 1/360 s is 1.8 m/s),
 * so cloth bounced off the body on every contact and ratcheted along it. Remove
 * any separating normal velocity relative to the skin for particles that were
 * in contact this substep (restitution 0).
 */
export function applyContactVelocities(mesh: ClothSimMesh, cache: KinematicContactCache, dt: number) {
  const { velocities, particleCount, triangles } = mesh
  const { contactFlag, contactNormal, contactSkinMotion } = cache
  const invDt = 1 / dt
  const removeSeparation = (particle: number, nx: number, ny: number, nz: number, mx: number, my: number, mz: number) => {
    const o = particle * 3
    const rvn = (velocities[o] - mx * invDt) * nx + (velocities[o + 1] - my * invDt) * ny + (velocities[o + 2] - mz * invDt) * nz
    if (rvn <= 0) return
    velocities[o] -= nx * rvn
    velocities[o + 1] -= ny * rvn
    velocities[o + 2] -= nz * rvn
  }
  for (let particle = 0; particle < particleCount; particle += 1) {
    if (contactFlag[particle] === 0) continue
    const o = particle * 3
    removeSeparation(particle, contactNormal[o], contactNormal[o + 1], contactNormal[o + 2], contactSkinMotion[o], contactSkinMotion[o + 1], contactSkinMotion[o + 2])
  }
  const { faceCount, faceTriangle, faceNormal, faceSkinMotion } = cache
  for (let k = 0; k < faceCount; k += 1) {
    const t = faceTriangle[k]
    const k3 = k * 3
    for (let corner = 0; corner < 3; corner += 1) {
      removeSeparation(triangles[t * 3 + corner], faceNormal[k3], faceNormal[k3 + 1], faceNormal[k3 + 2], faceSkinMotion[k3], faceSkinMotion[k3 + 1], faceSkinMotion[k3 + 2])
    }
  }
}
