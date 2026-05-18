import type { ClothFrame, ClothSimMesh, ColliderSnapshot, SolverParams } from './types'
import { solveBendConstraints } from './constraints/solveBendConstraints'
import { solveDistanceConstraints } from './constraints/solveDistanceConstraints'
import { solvePinConstraints } from './constraints/solvePinConstraints'
import { solveCollisionConstraints } from './collision/solveCollisionConstraints'

export class XPBDClothSolver {
  readonly mesh: ClothSimMesh
  readonly params: SolverParams
  private colliders: ColliderSnapshot | null = null
  private elapsed = 0

  constructor(
    mesh: ClothSimMesh,
    params: SolverParams,
  ) {
    this.mesh = mesh
    this.params = params
  }

  step(snapshot?: ColliderSnapshot | null): ClothFrame {
    if (snapshot !== undefined) this.colliders = snapshot
    const dt = this.params.dt / this.params.substeps

    for (let substep = 0; substep < this.params.substeps; substep += 1) {
      const sewingProgress = this.sewingProgress()
      const gravityScale = this.gravityProgress()
      const damping = this.dampingForAssembly(sewingProgress)
      this.integrate(dt, damping, this.params.gravity * gravityScale)
      this.clampSubstepDisplacement(sewingProgress)
      for (let iteration = 0; iteration < this.params.iterations; iteration += 1) {
        solveDistanceConstraints(this.mesh, this.mesh.stretchConstraints, dt)
        solveDistanceConstraints(this.mesh, this.mesh.shearConstraints, dt)
        solveDistanceConstraints(this.mesh, this.mesh.seamConstraints, dt, { seamRestScale: 1 - sewingProgress })
        solveBendConstraints(this.mesh, dt)
        solvePinConstraints(this.mesh)
      }
      solveCollisionConstraints(this.mesh, this.colliders)
      if (sewingProgress >= 1) this.weldSeamPairs()
      this.deriveVelocities(dt, this.velocityRetentionForAssembly(sewingProgress))
      this.applyGround()
      this.elapsed += dt
    }

    return { positions: this.mesh.positions }
  }

  private integrate(dt: number, damping: number, gravity: number) {
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
      const vy = velocities[offset + 1] * dampPerStep + gravity * dt
      const vz = velocities[offset + 2] * dampPerStep
      prevPositions[offset] = positions[offset]
      prevPositions[offset + 1] = positions[offset + 1]
      prevPositions[offset + 2] = positions[offset + 2]
      positions[offset] += vx * dt
      positions[offset + 1] += vy * dt
      positions[offset + 2] += vz * dt
    }
  }

  private deriveVelocities(dt: number, velocityRetention: number) {
    const maxVelocity = this.params.maxVelocity ?? 8
    const invDt = 1 / dt
    const { positions, prevPositions, velocities, particleCount } = this.mesh
    for (let particle = 0; particle < particleCount; particle += 1) {
      const offset = particle * 3
      let vx = (positions[offset] - prevPositions[offset]) * invDt * velocityRetention
      let vy = (positions[offset + 1] - prevPositions[offset + 1]) * invDt * velocityRetention
      let vz = (positions[offset + 2] - prevPositions[offset + 2]) * invDt * velocityRetention
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

  private weldSeamPairs() {
    const { positions, prevPositions, invMass } = this.mesh
    for (const seam of this.mesh.seamConstraints) {
      const ia = seam.a * 3
      const ib = seam.b * 3
      const wa = invMass[seam.a]
      const wb = invMass[seam.b]
      const wsum = wa + wb
      if (wsum < 1e-9) continue
      const tA = wa / wsum
      const tB = wb / wsum
      const mx = positions[ia] * tB + positions[ib] * tA
      const my = positions[ia + 1] * tB + positions[ib + 1] * tA
      const mz = positions[ia + 2] * tB + positions[ib + 2] * tA
      const px = prevPositions[ia] * tB + prevPositions[ib] * tA
      const py = prevPositions[ia + 1] * tB + prevPositions[ib + 1] * tA
      const pz = prevPositions[ia + 2] * tB + prevPositions[ib + 2] * tA
      if (wa > 0) {
        positions[ia] = mx
        positions[ia + 1] = my
        positions[ia + 2] = mz
        prevPositions[ia] = px
        prevPositions[ia + 1] = py
        prevPositions[ia + 2] = pz
      }
      if (wb > 0) {
        positions[ib] = mx
        positions[ib + 1] = my
        positions[ib + 2] = mz
        prevPositions[ib] = px
        prevPositions[ib + 1] = py
        prevPositions[ib + 2] = pz
      }
    }
  }

  private clampSubstepDisplacement(sewingProgress: number) {
    const skin = this.colliders?.meshColliders?.[0]?.skin ?? 0.022
    const thickness = this.colliders?.meshColliders?.[0]?.thickness ?? 0.008
    const baseLimit = Math.max(0.005, (skin + thickness) * 0.5)
    const sewingTighten = 0.6 + 0.4 * sewingProgress
    const limit = baseLimit * sewingTighten
    const limitSq = limit * limit
    const { positions, prevPositions, particleCount } = this.mesh
    for (let particle = 0; particle < particleCount; particle += 1) {
      const offset = particle * 3
      const dx = positions[offset] - prevPositions[offset]
      const dy = positions[offset + 1] - prevPositions[offset + 1]
      const dz = positions[offset + 2] - prevPositions[offset + 2]
      const distSq = dx * dx + dy * dy + dz * dz
      if (distSq <= limitSq) continue
      const scale = limit / Math.sqrt(distSq)
      positions[offset] = prevPositions[offset] + dx * scale
      positions[offset + 1] = prevPositions[offset + 1] + dy * scale
      positions[offset + 2] = prevPositions[offset + 2] + dz * scale
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

  private sewingProgress() {
    const duration = this.params.sewingTime ?? 1.2
    if (duration <= 0) return 1
    return smooth01(this.elapsed / duration)
  }

  private gravityProgress() {
    const sewingDuration = this.params.sewingTime ?? 1.2
    const delay = this.params.gravityDelayTime ?? sewingDuration * 0.85
    const duration = this.params.gravityRampTime ?? 0.45
    if (duration <= 0) return 1
    return smooth01((this.elapsed - delay) / duration)
  }

  private dampingForAssembly(sewingProgress: number) {
    const base = clamp01(this.params.damping)
    const assemblyDamping = 0.22
    return base + (assemblyDamping - base) * (1 - sewingProgress)
  }

  private velocityRetentionForAssembly(sewingProgress: number) {
    return 0.05 + 0.95 * sewingProgress * sewingProgress
  }
}

function smooth01(value: number) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value
}
