import { buildTriangleBVH, bvhQueryPointRadius, refitTriangleBVH, type TriangleBVH } from './triangleBVH'

// Animated (kinematic) body collider for cloth.
//
// The legacy mesh collider only knew the body's *current* pose. That breaks on
// an animated character in three ways, all of which show up as cloth sinking
// into limbs or being dragged off them:
//
//   1. Every substep collided against the end-of-frame pose, so a fast limb
//      jumped its full per-frame distance at substep 0 and left particles deep
//      inside it — deeper than the contact query radius, so they were never
//      found again.
//   2. Friction was measured against the particle's own previous position, i.e.
//      relative to the world, not to the moving skin. Static friction therefore
//      *held cloth still while the body slid underneath it*.
//   3. The inside/outside test used flat face normals at the closest point, which
//      flips sign around edges and vertices (armpits, elbows, crotch) and makes
//      contacts jitter.
//
// This collider keeps the body pose at the start and end of each fixed step,
// interpolates it per substep, reports the surface displacement at the contact
// (so friction is body-relative), and signs distances with interpolated smooth
// vertex normals. The BVH is refit once per step over the union of both poses,
// which keeps it conservative for every substep in between.

const CLOSEST = new Float32Array(5)
let GATHER_KEYS = new Float32Array(1024)
let SORT_SCRATCH = new Float32Array(1024)
let LOWER_BOUNDS = new Float32Array(256)
/** Barycentric margin inside which a closest point counts as a face (not edge/vertex) contact. */
const FACE_INTERIOR = 1e-3

export type KinematicColliderOptions = {
  /** Distance the cloth mid-surface rests above the skin (garment half-thickness + skin offset). */
  thickness: number
  /** Coulomb friction coefficient of the skin. */
  friction: number
}

export class KinematicBodyCollider {
  readonly indices: Uint32Array
  readonly vertexCount: number
  readonly triangleCount: number
  /** Pose at the start of the current fixed step. */
  readonly prev: Float32Array
  /** Pose at the end of the current fixed step. */
  readonly curr: Float32Array
  readonly prevNormals: Float32Array
  readonly currNormals: Float32Array
  /** Per-triangle bounding sphere over both step poses (cx, cy, cz, r). */
  private readonly spheres: Float32Array
  /** Per-triangle root-relative skin travel over the current step (max vertex displacement). */
  readonly triangleTravel: Float32Array
  thickness: number
  friction: number
  /** Largest vertex displacement over the current fixed step (metres). */
  maxStepDisplacement = 0
  /**
   * Displacement of the character root over the current step. Skin travel
   * relative to it (limbs swinging) is what threatens cloth riding on the body;
   * the shared root translation moves cloth and skin together.
   */
  readonly rootStep = new Float32Array(3)
  /** Largest root-relative vertex displacement over the current step. */
  maxRelativeDisplacement = 0
  /** Pose generation, bumped every pushPose; lets callers detect fresh poses. */
  generation = 0
  private bvh: TriangleBVH | null = null
  private substepFrom = 0
  private substepTo = 1
  private hasPose = false

  constructor(indices: Uint32Array, vertexCount: number, options: KinematicColliderOptions) {
    this.indices = indices
    this.vertexCount = vertexCount
    this.triangleCount = indices.length / 3
    this.prev = new Float32Array(vertexCount * 3)
    this.curr = new Float32Array(vertexCount * 3)
    this.prevNormals = new Float32Array(vertexCount * 3)
    this.currNormals = new Float32Array(vertexCount * 3)
    this.spheres = new Float32Array(this.triangleCount * 4)
    this.triangleTravel = new Float32Array(this.triangleCount)
    this.thickness = options.thickness
    this.friction = options.friction
  }

  /**
   * Advance to a new body pose. Call exactly once per fixed simulation step,
   * after the skeleton has been updated and before the cloth steps. `teleport`
   * (or the very first pose) snaps both ends so no velocity is implied.
   */
  pushPose(vertices: Float32Array, teleport = false, rootStep?: ArrayLike<number>) {
    const first = !this.hasPose || teleport
    if (first) {
      this.prev.set(vertices)
      this.curr.set(vertices)
      computeVertexNormals(this.curr, this.indices, this.currNormals)
      this.prevNormals.set(this.currNormals)
    } else {
      this.prev.set(this.curr)
      this.prevNormals.set(this.currNormals)
      this.curr.set(vertices)
      computeVertexNormals(this.curr, this.indices, this.currNormals)
    }
    this.hasPose = true
    this.generation += 1

    const rx = first || !rootStep ? 0 : rootStep[0]
    const ry = first || !rootStep ? 0 : rootStep[1]
    const rz = first || !rootStep ? 0 : rootStep[2]
    this.rootStep[0] = rx; this.rootStep[1] = ry; this.rootStep[2] = rz
    let maxSq = 0
    let maxRelativeSq = 0
    const { prev, curr } = this
    for (let i = 0; i < curr.length; i += 3) {
      const dx = curr[i] - prev[i]
      const dy = curr[i + 1] - prev[i + 1]
      const dz = curr[i + 2] - prev[i + 2]
      const sq = dx * dx + dy * dy + dz * dz
      if (sq > maxSq) maxSq = sq
      const relativeSq = (dx - rx) ** 2 + (dy - ry) ** 2 + (dz - rz) ** 2
      if (relativeSq > maxRelativeSq) maxRelativeSq = relativeSq
    }
    this.maxStepDisplacement = Math.sqrt(maxSq)
    this.maxRelativeDisplacement = Math.sqrt(maxRelativeSq)

    if (!this.bvh) this.bvh = buildTriangleBVH(this.curr, this.indices)
    refitTriangleBVH(this.bvh, this.curr, this.prev)
    this.updateBoundingSpheres()
  }

  /** Spheres bounding each triangle at both ends of the step: cheap narrow-phase rejection. */
  private updateBoundingSpheres() {
    const { prev, curr, indices, spheres } = this
    for (let t = 0; t < this.triangleCount; t += 1) {
      const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3
      const cx = (prev[a] + prev[b] + prev[c] + curr[a] + curr[b] + curr[c]) / 6
      const cy = (prev[a + 1] + prev[b + 1] + prev[c + 1] + curr[a + 1] + curr[b + 1] + curr[c + 1]) / 6
      const cz = (prev[a + 2] + prev[b + 2] + prev[c + 2] + curr[a + 2] + curr[b + 2] + curr[c + 2]) / 6
      let r = 0
      for (const v of [a, b, c]) {
        r = Math.max(r, Math.hypot(prev[v] - cx, prev[v + 1] - cy, prev[v + 2] - cz), Math.hypot(curr[v] - cx, curr[v + 1] - cy, curr[v + 2] - cz))
      }
      spheres[t * 4] = cx
      spheres[t * 4 + 1] = cy
      spheres[t * 4 + 2] = cz
      spheres[t * 4 + 3] = r
      const [rx, ry, rz] = this.rootStep
      let travel = 0
      for (const v of [a, b, c]) travel = Math.max(travel, Math.hypot(curr[v] - prev[v] - rx, curr[v + 1] - prev[v + 1] - ry, curr[v + 2] - prev[v + 2] - rz))
      this.triangleTravel[t] = travel
    }
  }

  /** Restrict queries to the substep interval [from, to] of the current step (0..1). */
  setSubstep(from: number, to: number) {
    this.substepFrom = from
    this.substepTo = to
  }

  get ready() {
    return this.hasPose
  }

  /** Interpolation parameters of the current substep (0..1 within the step). */
  get substepRange(): readonly [number, number] {
    return [this.substepFrom, this.substepTo]
  }

  /**
   * Closest skin point to (px,py,pz) within `radius`, at the end of the current
   * substep. Writes into `out`:
   *   [0..2] closest point, [3..5] smooth outward normal, [6] signed distance,
   *   [7..9] skin displacement over the substep at that point,
   *   [10] triangle index, [11..13] barycentrics (u,v,w).
   * Returns false when nothing is in range.
   */
  closest(px: number, py: number, pz: number, radius: number, out: Float32Array): boolean {
    if (!this.bvh) return false
    const count = bvhQueryPointRadius(this.bvh, px, py, pz, radius)
    if (count === 0) return false
    const candidates = this.bvh.candidates
    const spheres = this.spheres
    const t = this.substepTo
    let bestDistSq = radius * radius
    let bestDist = radius
    let bestTri = -1
    let bestU = 0
    let bestV = 0
    let bestW = 0
    for (let c = 0; c < count; c += 1) {
      const tri = candidates[c]
      const s4 = tri * 4
      const sx = px - spheres[s4], sy = py - spheres[s4 + 1], sz = pz - spheres[s4 + 2]
      const reach = bestDist + spheres[s4 + 3]
      if (sx * sx + sy * sy + sz * sz > reach * reach) continue
      this.closestOnTriangleAt(tri, t, px, py, pz)
      const dx = px - CLOSEST[0]
      const dy = py - CLOSEST[1]
      const dz = pz - CLOSEST[2]
      const distSq = dx * dx + dy * dy + dz * dz
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        bestDist = Math.sqrt(distSq)
        bestTri = tri
        bestU = CLOSEST[3]
        bestV = CLOSEST[4]
        bestW = 1 - CLOSEST[3] - CLOSEST[4]
      }
    }
    if (bestTri < 0) return false
    this.evaluate(bestTri, bestU, bestV, bestW, px, py, pz, out)
    return true
  }

  /**
   * Broad phase only: write the triangles whose swept bounds lie within
   * `radius` of the point into out[offset..], nearest bounding sphere first, up
   * to `cap`. Valid for every substep of the current fixed step, so callers can
   * gather once per step and run closestAmong() per substep.
   */
  gather(px: number, py: number, pz: number, radius: number, out: Uint32Array, offset: number, cap: number) {
    if (!this.bvh) return 0
    const count = bvhQueryPointRadius(this.bvh, px, py, pz, radius)
    const candidates = this.bvh.candidates
    if (count <= cap) {
      for (let c = 0; c < count; c += 1) out[offset + c] = candidates[c]
      return count
    }
    // Too many: keep the `cap` nearest by bounding-sphere distance.
    const spheres = this.spheres
    if (GATHER_KEYS.length < count) GATHER_KEYS = new Float32Array(count * 2)
    const keys = GATHER_KEYS.subarray(0, count)
    for (let c = 0; c < count; c += 1) {
      const s4 = candidates[c] * 4
      const dx = px - spheres[s4], dy = py - spheres[s4 + 1], dz = pz - spheres[s4 + 2]
      keys[c] = Math.sqrt(dx * dx + dy * dy + dz * dz) - spheres[s4 + 3]
    }
    const sorted = SORT_SCRATCH.length >= count ? SORT_SCRATCH.subarray(0, count) : (SORT_SCRATCH = new Float32Array(count * 2)).subarray(0, count)
    sorted.set(keys)
    sorted.sort()
    const threshold = sorted[cap - 1]
    let n = 0
    for (let c = 0; c < count && n < cap; c += 1) if (keys[c] <= threshold) out[offset + n++] = candidates[c]
    return n
  }

  /** Narrow phase over a gathered list; same contract and output as closest(). */
  closestAmong(px: number, py: number, pz: number, radius: number, list: Uint32Array, offset: number, count: number, out: Float32Array): boolean {
    const spheres = this.spheres
    const t = this.substepTo
    // Pass 1: sphere bounds. No point of a triangle is farther than its sphere's
    // far side, so the smallest far side bounds the answer; only triangles whose
    // near side beats it need the exact test.
    if (LOWER_BOUNDS.length < count) LOWER_BOUNDS = new Float32Array(count * 2)
    const lower = LOWER_BOUNDS
    let bound = radius
    for (let c = 0; c < count; c += 1) {
      const s4 = list[offset + c] * 4
      const sx = px - spheres[s4], sy = py - spheres[s4 + 1], sz = pz - spheres[s4 + 2]
      const centre = Math.sqrt(sx * sx + sy * sy + sz * sz)
      const r = spheres[s4 + 3]
      lower[c] = centre - r
      if (centre + r < bound) bound = centre + r
    }
    // Pass 2: exact tests where they can still win.
    let bestDistSq = bound * bound * (1 + 1e-6) + 1e-12
    let bestDist = Math.sqrt(bestDistSq)
    let bestTri = -1
    let bestU = 0
    let bestV = 0
    for (let c = 0; c < count; c += 1) {
      if (lower[c] > bestDist) continue
      const tri = list[offset + c]
      this.closestOnTriangleAt(tri, t, px, py, pz)
      const dx = px - CLOSEST[0], dy = py - CLOSEST[1], dz = pz - CLOSEST[2]
      const distSq = dx * dx + dy * dy + dz * dz
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        bestDist = Math.sqrt(distSq)
        bestTri = tri
        bestU = CLOSEST[3]
        bestV = CLOSEST[4]
      }
    }
    if (bestTri < 0 || bestDistSq > radius * radius) return false
    this.evaluate(bestTri, bestU, bestV, 1 - bestU - bestV, px, py, pz, out)
    return true
  }

  /**
   * Evaluate a fixed surface location (triangle + barycentrics) at the end of the
   * current substep, filling `out` exactly like closest(). Used by persistent
   * contacts and skin attachments.
   */
  evaluate(tri: number, u: number, v: number, w: number, px: number, py: number, pz: number, out: Float32Array) {
    const { prev, curr, prevNormals, currNormals, indices } = this
    const t1 = this.substepTo
    const t0 = this.substepFrom
    const ia = indices[tri * 3] * 3
    const ib = indices[tri * 3 + 1] * 3
    const ic = indices[tri * 3 + 2] * 3
    let qx = 0, qy = 0, qz = 0, q0x = 0, q0y = 0, q0z = 0, nx = 0, ny = 0, nz = 0
    for (let k = 0; k < 3; k += 1) {
      const pa = prev[ia + k], pb = prev[ib + k], pc = prev[ic + k]
      const ca = curr[ia + k], cb = curr[ib + k], cc = curr[ic + k]
      const p = pa * u + pb * v + pc * w
      const cpos = ca * u + cb * v + cc * w
      const end = p + (cpos - p) * t1
      const start = p + (cpos - p) * t0
      const na = prevNormals[ia + k] + (currNormals[ia + k] - prevNormals[ia + k]) * t1
      const nb = prevNormals[ib + k] + (currNormals[ib + k] - prevNormals[ib + k]) * t1
      const nc = prevNormals[ic + k] + (currNormals[ic + k] - prevNormals[ic + k]) * t1
      const n = na * u + nb * v + nc * w
      if (k === 0) { qx = end; q0x = start; nx = n } else if (k === 1) { qy = end; q0y = start; ny = n } else { qz = end; q0z = start; nz = n }
    }
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (nLen > 1e-9) {
      nx /= nLen; ny /= nLen; nz /= nLen
    } else {
      nx = 0; ny = 1; nz = 0
    }
    // Inside a face the geometric normal is exact; interpolated vertex normals
    // tilt toward the corners and would push contacts sideways (cloth sliding
    // off flat skin). Edges and vertices keep the smooth normal, which is what
    // makes the inside/outside sign robust there. Oriented by the smooth normal
    // so it does not depend on source winding.
    if (u > FACE_INTERIOR && v > FACE_INTERIOR && w > FACE_INTERIOR) {
      const t = t1
      const ax = prev[ia] + (curr[ia] - prev[ia]) * t, ay = prev[ia + 1] + (curr[ia + 1] - prev[ia + 1]) * t, az = prev[ia + 2] + (curr[ia + 2] - prev[ia + 2]) * t
      const e1x = prev[ib] + (curr[ib] - prev[ib]) * t - ax, e1y = prev[ib + 1] + (curr[ib + 1] - prev[ib + 1]) * t - ay, e1z = prev[ib + 2] + (curr[ib + 2] - prev[ib + 2]) * t - az
      const e2x = prev[ic] + (curr[ic] - prev[ic]) * t - ax, e2y = prev[ic + 1] + (curr[ic + 1] - prev[ic + 1]) * t - ay, e2z = prev[ic + 2] + (curr[ic + 2] - prev[ic + 2]) * t - az
      let fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x
      const fLen = Math.sqrt(fx * fx + fy * fy + fz * fz)
      if (fLen > 1e-12) {
        fx /= fLen; fy /= fLen; fz /= fLen
        if (fx * nx + fy * ny + fz * nz < 0) { fx = -fx; fy = -fy; fz = -fz }
        nx = fx; ny = fy; nz = fz
      }
    }
    out[0] = qx; out[1] = qy; out[2] = qz
    out[3] = nx; out[4] = ny; out[5] = nz
    out[6] = (px - qx) * nx + (py - qy) * ny + (pz - qz) * nz
    out[7] = qx - q0x; out[8] = qy - q0y; out[9] = qz - q0z
    out[10] = tri
    out[11] = u; out[12] = v; out[13] = w
  }

  /** Like closest(), but restricted to one known triangle (persistent contacts). */
  closestOnTriangle(tri: number, px: number, py: number, pz: number, out: Float32Array) {
    this.closestOnTriangleAt(tri, this.substepTo, px, py, pz)
    const u = CLOSEST[3]
    const v = CLOSEST[4]
    this.evaluate(tri, u, v, 1 - u - v, px, py, pz, out)
  }

  /**
   * Signed distance of (px,py,pz) from triangle `tri` posed at the *start* of
   * the current substep (smooth-normal sign). Used to tell a genuine crossing
   * (outside → inside during this substep) from cloth that is simply on the far
   * side of a thin limb.
   */
  signedDistanceAtSubstepStart(tri: number, px: number, py: number, pz: number) {
    this.closestOnTriangleAt(tri, this.substepFrom, px, py, pz)
    const u = CLOSEST[3]
    const v = CLOSEST[4]
    const w = 1 - u - v
    const qx = CLOSEST[0], qy = CLOSEST[1], qz = CLOSEST[2]
    const { prevNormals, currNormals, indices } = this
    const t = this.substepFrom
    const ia = indices[tri * 3] * 3, ib = indices[tri * 3 + 1] * 3, ic = indices[tri * 3 + 2] * 3
    let nx = 0, ny = 0, nz = 0
    for (let k = 0; k < 3; k += 1) {
      const na = prevNormals[ia + k] + (currNormals[ia + k] - prevNormals[ia + k]) * t
      const nb = prevNormals[ib + k] + (currNormals[ib + k] - prevNormals[ib + k]) * t
      const nc = prevNormals[ic + k] + (currNormals[ic + k] - prevNormals[ic + k]) * t
      const n = na * u + nb * v + nc * w
      if (k === 0) nx = n; else if (k === 1) ny = n; else nz = n
    }
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    return ((px - qx) * nx + (py - qy) * ny + (pz - qz) * nz) / len
  }

  /** Closest point on triangle `tri` at interpolation `t`; writes CLOSEST = [x,y,z,u,v]. */
  private closestOnTriangleAt(tri: number, t: number, px: number, py: number, pz: number) {
    const { prev, curr, indices } = this
    const ia = indices[tri * 3] * 3
    const ib = indices[tri * 3 + 1] * 3
    const ic = indices[tri * 3 + 2] * 3
    const ax = prev[ia] + (curr[ia] - prev[ia]) * t
    const ay = prev[ia + 1] + (curr[ia + 1] - prev[ia + 1]) * t
    const az = prev[ia + 2] + (curr[ia + 2] - prev[ia + 2]) * t
    const bx = prev[ib] + (curr[ib] - prev[ib]) * t
    const by = prev[ib + 1] + (curr[ib + 1] - prev[ib + 1]) * t
    const bz = prev[ib + 2] + (curr[ib + 2] - prev[ib + 2]) * t
    const cx = prev[ic] + (curr[ic] - prev[ic]) * t
    const cy = prev[ic + 1] + (curr[ic + 1] - prev[ic + 1]) * t
    const cz = prev[ic + 2] + (curr[ic + 2] - prev[ic + 2]) * t
    closestPointBarycentric(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, CLOSEST)
  }
}

/**
 * Ericson's closest point on triangle, returning the point and the barycentric
 * weights of vertices a and b (c = 1 - u - v). out = [x, y, z, u, v].
 */
export function closestPointBarycentric(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  out: Float32Array,
) {
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  if (d1 <= 0 && d2 <= 0) return write(out, ax, ay, az, 1, 0)
  const bpx = px - bx, bpy = py - by, bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return write(out, bx, by, bz, 0, 1)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return write(out, ax + abx * v, ay + aby * v, az + abz * v, 1 - v, v)
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return write(out, cx, cy, cz, 0, 0)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return write(out, ax + acx * w, ay + acy * w, az + acz * w, 1 - w, 0)
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
    return write(out, bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w, 0, 1 - w)
  }
  const denom = 1 / (va + vb + vc)
  const v = vb * denom
  const w = vc * denom
  return write(out, ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w, 1 - v - w, v)
}

function write(out: Float32Array, x: number, y: number, z: number, u: number, v: number) {
  out[0] = x; out[1] = y; out[2] = z; out[3] = u; out[4] = v
}

/** Area-weighted smooth vertex normals. */
export function computeVertexNormals(vertices: Float32Array, indices: Uint32Array, normals: Float32Array) {
  normals.fill(0)
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3
    const b = indices[i + 1] * 3
    const c = indices[i + 2] * 3
    const e1x = vertices[b] - vertices[a], e1y = vertices[b + 1] - vertices[a + 1], e1z = vertices[b + 2] - vertices[a + 2]
    const e2x = vertices[c] - vertices[a], e2y = vertices[c + 1] - vertices[a + 1], e2z = vertices[c + 2] - vertices[a + 2]
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x
    normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz
    normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz
    normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.sqrt(normals[i] * normals[i] + normals[i + 1] * normals[i + 1] + normals[i + 2] * normals[i + 2])
    if (len > 1e-12) {
      normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len
    }
  }
}
