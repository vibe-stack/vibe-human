import type { ClothFrame, ClothSimMesh, ColliderSnapshot, SolverParams } from './types'
import { solveBendConstraints } from './constraints/solveBendConstraints'
import { solveDistanceConstraints } from './constraints/solveDistanceConstraints'
import { solvePinConstraints } from './constraints/solvePinConstraints'
import { solveCollisionConstraints } from './collision/solveCollisionConstraints'

export class XPBDClothSolver {
  private colliders: ColliderSnapshot | null = null

  constructor(
    readonly mesh: ClothSimMesh,
    readonly params: SolverParams,
  ) {}

  step(snapshot?: ColliderSnapshot | null): ClothFrame {
    if (snapshot !== undefined) this.colliders = snapshot
    const dt = this.params.dt / this.params.substeps
    const damping = Math.max(0, Math.min(1, this.params.damping))

    for (let substep = 0; substep < this.params.substeps; substep += 1) {
      this.integrate(dt, damping)
      for (let iteration = 0; iteration < this.params.iterations; iteration += 1) {
        solveDistanceConstraints(this.mesh, this.mesh.stretchConstraints, dt)
        solveDistanceConstraints(this.mesh, this.mesh.shearConstraints, dt)
        solveDistanceConstraints(this.mesh, this.mesh.seamConstraints, dt)
        solveBendConstraints(this.mesh, dt)
        solvePinConstraints(this.mesh)
        solveCollisionConstraints(this.mesh, this.colliders)
      }
      this.deriveVelocities(dt)
      this.applyGround()
    }

    return { positions: this.mesh.positions }
  }

  private integrate(dt: number, damping: number) {
    const dampPerStep = Math.pow(1 - damping, dt)
    const { positions, prevPositions, velocities, invMass, particleCount } = this.mesh
    for (let particle = 0; particle < particleCount; particle += 1) {
      const offset = particle * 3
      if (invMass[particle] === 0) {
        prevPositions[offset] = positions[offset]
        prevPositions[offset + 1] = positions[offset + 1]
        prevPositions[offset + 2] = positions[offset + 2]
        velocities[offset] = 0
        velocities[offset + 1] = 0
        velocities[offset + 2] = 0
        continue
      }
      const vx = velocities[offset] * dampPerStep
      const vy = velocities[offset + 1] * dampPerStep + this.params.gravity * dt
      const vz = velocities[offset + 2] * dampPerStep
      prevPositions[offset] = positions[offset]
      prevPositions[offset + 1] = positions[offset + 1]
      prevPositions[offset + 2] = positions[offset + 2]
      positions[offset] += vx * dt
      positions[offset + 1] += vy * dt
      positions[offset + 2] += vz * dt
    }
  }

  private deriveVelocities(dt: number) {
    const maxVelocity = this.params.maxVelocity ?? 8
    const invDt = 1 / dt
    const { positions, prevPositions, velocities, particleCount } = this.mesh
    for (let particle = 0; particle < particleCount; particle += 1) {
      const offset = particle * 3
      let vx = (positions[offset] - prevPositions[offset]) * invDt
      let vy = (positions[offset + 1] - prevPositions[offset + 1]) * invDt
      let vz = (positions[offset + 2] - prevPositions[offset + 2]) * invDt
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz)
      if (speed > maxVelocity) {
        const scale = maxVelocity / speed
        vx *= scale
        vy *= scale
        vz *= scale
        prevPositions[offset] = positions[offset] - vx * dt
        prevPositions[offset + 1] = positions[offset + 1] - vy * dt
        prevPositions[offset + 2] = positions[offset + 2] - vz * dt
      }
      velocities[offset] = vx
      velocities[offset + 1] = vy
      velocities[offset + 2] = vz
    }
  }

  private applyGround() {
    const { positions, prevPositions, particleCount } = this.mesh
    for (let particle = 0; particle < particleCount; particle += 1) {
      const offset = particle * 3 + 1
      if (positions[offset] >= this.params.groundY) continue
      positions[offset] = this.params.groundY
      prevPositions[offset] = this.params.groundY
    }
  }
}