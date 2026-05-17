/**
 * Pure data model for the cloth solver. No THREE.js, no React — easy to
 * test and trivially fast (everything lives in typed arrays).
 *
 * Vec3 streams are laid out as [x0,y0,z0, x1,y1,z1, ...] so all hot loops
 * are linear scans through Float32Array, which the JIT can vectorize.
 */

export type Vec3Stream = Float32Array

/** A distance constraint: keep particles a and b at `rest` apart, with
 *  compliance (XPBD) controlling stiffness (0 = infinitely stiff). */
export type DistanceConstraint = {
  a: number
  b: number
  rest: number
  compliance: number
}

/** Bending constraint along a particle "path" of 3 nodes — keeps the
 *  middle close to the midpoint of the endpoints to resist folding. */
export type BendConstraint = {
  a: number
  b: number // middle
  c: number
  rest: number // initial length of a..b..c segment, used as target
  compliance: number
}

/** What the solver needs to know about the world to keep cloth out of
 *  the body. Each collider is a pure SDF — no rigid-body engine. */
export type SphereCollider = { kind: 'sphere'; cx: number; cy: number; cz: number; r: number; friction: number }
export type CapsuleCollider = {
  kind: 'capsule'
  ax: number; ay: number; az: number
  bx: number; by: number; bz: number
  r: number
  friction: number
}
/**
 * Mesh collider — defers to MeshBVH at solve time. The owner is responsible
 * for keeping `mesh`'s geometry+BVH and `mesh.matrixWorld` fresh (typically
 * by calling MeshBVH.refit() once per frame after skinning updates).
 *
 * `skin` is a small offset added to every contact normal — gives the cloth
 * some breathing room so it doesn't z-fight the body surface.
 */
export type MeshCollider = {
  kind: 'mesh'
  // Carrying a THREE.Mesh inside the solver state is OK — we never touch it
  // from the hot loops, only via projectColliders which IS allowed to do
  // heavyweight ops. Typed loosely to avoid a hard three import here.
  mesh: {
    geometry: { boundsTree?: unknown }
    matrixWorld: { elements: ArrayLike<number> }
  }
  friction: number
  skin: number
}
export type Collider = SphereCollider | CapsuleCollider | MeshCollider

export type ClothSolverParams = {
  gravity: number             // m/s², negative is down
  damping: number             // global velocity damping per second (0..1)
  substeps: number            // XPBD substeps per fixed step
  iterations: number          // constraint passes per substep
  dt: number                  // fixed timestep
  groundY: number             // hard floor
}

export type ClothSolverState = {
  particleCount: number
  /** Particle positions, world space. */
  positions: Vec3Stream
  /** Previous positions for verlet velocity derivation. */
  prevPositions: Vec3Stream
  /** Per-particle inverse mass. 0 = pinned. */
  invMass: Float32Array
  /** Linear velocity (m/s). */
  velocities: Vec3Stream
  /** External per-particle acceleration (drag forces etc.), reset each frame. */
  externalAccel: Vec3Stream
  distances: DistanceConstraint[]
  bends: BendConstraint[]
  colliders: Collider[]
  params: ClothSolverParams
}

// ---------------------------------------------------------------------------
// Tiny inline math helpers — kept here so call sites can stay tight.
// ---------------------------------------------------------------------------

export const v3get = (s: Vec3Stream, i: number, out: { x: number; y: number; z: number }) => {
  const o = i * 3
  out.x = s[o]; out.y = s[o + 1]; out.z = s[o + 2]
}

export const v3set = (s: Vec3Stream, i: number, x: number, y: number, z: number) => {
  const o = i * 3
  s[o] = x; s[o + 1] = y; s[o + 2] = z
}

export const v3add = (s: Vec3Stream, i: number, x: number, y: number, z: number) => {
  const o = i * 3
  s[o] += x; s[o + 1] += y; s[o + 2] += z
}
