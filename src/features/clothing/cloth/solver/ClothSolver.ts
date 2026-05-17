import { solveBendingConstraints, solveDistanceConstraints } from './constraints'
import { projectColliders } from './colliders'
import type {
  BendConstraint,
  ClothSolverParams,
  ClothSolverState,
  Collider,
  DistanceConstraint,
} from './types'

/**
 * Position-Based Dynamics cloth solver. Substepped XPBD: integrate, solve
 * constraints per substep, project colliders, recompute velocity from
 * (positions - prevPositions) / dt. No per-frame allocations.
 *
 * Public API is deliberately small: build → step → setPin/getters.
 */

export type ClothSolverInit = {
  positions: Float32Array
  invMass: Float32Array
  distances: DistanceConstraint[]
  bends: BendConstraint[]
  colliders: Collider[]
  params: ClothSolverParams
}

export class ClothSolver {
  readonly state: ClothSolverState

  constructor(init: ClothSolverInit) {
    const n = init.positions.length / 3
    this.state = {
      particleCount: n,
      positions: init.positions,
      prevPositions: new Float32Array(init.positions),
      invMass: init.invMass,
      velocities: new Float32Array(n * 3),
      externalAccel: new Float32Array(n * 3),
      distances: init.distances,
      bends: init.bends,
      colliders: init.colliders,
      params: init.params,
    }
  }

  /** Advance one fixed step. Caller does its own accumulator/clamping. */
  step() {
    const s = this.state
    const { substeps, dt: dtFull, gravity } = s.params
    const dt = dtFull / substeps
    const damping = Math.max(0, Math.min(1, s.params.damping))

    for (let sub = 0; sub < substeps; sub += 1) {
      this.integrate(dt, gravity, damping)
      for (let it = 0; it < s.params.iterations; it += 1) {
        solveDistanceConstraints(s, dt)
        solveBendingConstraints(s, dt)
      }
      projectColliders(s)
      this.deriveVelocities(dt)
    }

    // Hard ground (cheap insurance against numerical drift)
    const floor = s.params.groundY
    for (let i = 0; i < s.particleCount; i += 1) {
      const o = i * 3 + 1
      if (s.positions[o] < floor) {
        s.positions[o] = floor
        s.prevPositions[o] = floor
      }
    }

    // Reset external accelerations (drag forces are per-frame).
    s.externalAccel.fill(0)
  }

  // -------------------------------------------------------------------------
  // Particle pinning / mass control
  // -------------------------------------------------------------------------

  setPinned(i: number, pinned: boolean, mass = 0.018) {
    this.state.invMass[i] = pinned ? 0 : 1 / mass
  }

  isPinned(i: number) {
    return this.state.invMass[i] === 0
  }

  /** Add a per-particle acceleration this frame (drag pull). */
  addExternalAccel(i: number, ax: number, ay: number, az: number) {
    const o = i * 3
    this.state.externalAccel[o]     += ax
    this.state.externalAccel[o + 1] += ay
    this.state.externalAccel[o + 2] += az
  }

  /** Force a particle to a position (used by hard-pull during drag). */
  forcePosition(i: number, x: number, y: number, z: number) {
    const o = i * 3
    this.state.positions[o]     = x
    this.state.positions[o + 1] = y
    this.state.positions[o + 2] = z
    // Preserve velocity continuity using prevPositions delta on release.
  }

  /** Add velocity (used by release-flick). */
  addVelocity(i: number, vx: number, vy: number, vz: number) {
    const o = i * 3
    const s = this.state
    s.prevPositions[o]     = s.positions[o]     - (s.velocities[o]     + vx) * s.params.dt
    s.prevPositions[o + 1] = s.positions[o + 1] - (s.velocities[o + 1] + vy) * s.params.dt
    s.prevPositions[o + 2] = s.positions[o + 2] - (s.velocities[o + 2] + vz) * s.params.dt
    s.velocities[o]     += vx
    s.velocities[o + 1] += vy
    s.velocities[o + 2] += vz
  }

  /** Translate every particle (used by gizmo move during edit mode). */
  translateAll(dx: number, dy: number, dz: number) {
    const s = this.state
    for (let i = 0; i < s.particleCount; i += 1) {
      const o = i * 3
      s.positions[o]     += dx; s.positions[o + 1] += dy; s.positions[o + 2] += dz
      s.prevPositions[o] += dx; s.prevPositions[o + 1] += dy; s.prevPositions[o + 2] += dz
    }
  }

  /** Rotate every particle around a world-space pivot. */
  rotateAll(pivotX: number, pivotY: number, pivotZ: number, qx: number, qy: number, qz: number, qw: number) {
    const s = this.state
    for (let i = 0; i < s.particleCount; i += 1) {
      const o = i * 3
      rotatePointInPlace(s.positions, o, pivotX, pivotY, pivotZ, qx, qy, qz, qw)
      rotatePointInPlace(s.prevPositions, o, pivotX, pivotY, pivotZ, qx, qy, qz, qw)
    }
  }

  setColliders(colliders: Collider[]) { this.state.colliders = colliders }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private integrate(dt: number, gravity: number, damping: number) {
    const s = this.state
    const dampPerStep = Math.pow(1 - damping, dt)
    for (let i = 0; i < s.particleCount; i += 1) {
      const o = i * 3
      if (s.invMass[i] === 0) {
        // Pinned: prev = current so derived velocity stays 0.
        s.prevPositions[o]     = s.positions[o]
        s.prevPositions[o + 1] = s.positions[o + 1]
        s.prevPositions[o + 2] = s.positions[o + 2]
        s.velocities[o] = 0; s.velocities[o + 1] = 0; s.velocities[o + 2] = 0
        continue
      }
      // Verlet integrate with external accel + gravity
      const vx = s.velocities[o]     * dampPerStep + s.externalAccel[o]     * dt
      const vy = s.velocities[o + 1] * dampPerStep + (gravity + s.externalAccel[o + 1]) * dt
      const vz = s.velocities[o + 2] * dampPerStep + s.externalAccel[o + 2] * dt

      const px = s.positions[o], py = s.positions[o + 1], pz = s.positions[o + 2]
      s.prevPositions[o]     = px
      s.prevPositions[o + 1] = py
      s.prevPositions[o + 2] = pz
      s.positions[o]     = px + vx * dt
      s.positions[o + 1] = py + vy * dt
      s.positions[o + 2] = pz + vz * dt
    }
  }

  private deriveVelocities(dt: number) {
    const s = this.state
    const invDt = 1 / dt
    for (let i = 0; i < s.particleCount; i += 1) {
      const o = i * 3
      s.velocities[o]     = (s.positions[o]     - s.prevPositions[o])     * invDt
      s.velocities[o + 1] = (s.positions[o + 1] - s.prevPositions[o + 1]) * invDt
      s.velocities[o + 2] = (s.positions[o + 2] - s.prevPositions[o + 2]) * invDt
    }
  }
}

function rotatePointInPlace(
  buf: Float32Array, o: number,
  px: number, py: number, pz: number,
  qx: number, qy: number, qz: number, qw: number,
) {
  // p' = pivot + q * (p - pivot) * q⁻¹  (quaternion rotation)
  const dx = buf[o] - px, dy = buf[o + 1] - py, dz = buf[o + 2] - pz
  // t = 2 * cross(q.xyz, d)
  const tx = 2 * (qy * dz - qz * dy)
  const ty = 2 * (qz * dx - qx * dz)
  const tz = 2 * (qx * dy - qy * dx)
  // d' = d + qw*t + cross(q.xyz, t)
  buf[o]     = px + dx + qw * tx + (qy * tz - qz * ty)
  buf[o + 1] = py + dy + qw * ty + (qz * tx - qx * tz)
  buf[o + 2] = pz + dz + qw * tz + (qx * ty - qy * tx)
}
