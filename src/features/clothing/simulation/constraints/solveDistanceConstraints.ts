import type { ClothSimMesh, DistanceConstraint } from '../types'

type DistanceSolveOptions = {
  seamRestScale?: number
}

export function solveDistanceConstraints(
  mesh: ClothSimMesh,
  constraints: DistanceConstraint[],
  dt: number,
  options: DistanceSolveOptions = {},
) {
  const dtSq = dt * dt
  const { positions, invMass } = mesh
  for (const constraint of constraints) {
    solveDistance(positions, invMass, constraint, dtSq, options)
  }
}

function solveDistance(
  positions: Float32Array,
  invMass: Float32Array,
  constraint: DistanceConstraint,
  dtSq: number,
  options: DistanceSolveOptions,
) {
  const ia = constraint.a * 3
  const ib = constraint.b * 3
  const ax = positions[ia]
  const ay = positions[ia + 1]
  const az = positions[ia + 2]
  const bx = positions[ib]
  const by = positions[ib + 1]
  const bz = positions[ib + 2]
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (length < 1e-7) return

  const wa = invMass[constraint.a]
  const wb = invMass[constraint.b]
  const wsum = wa + wb
  if (wsum < 1e-9) return

  const rest = getConstraintRest(constraint, options)
  const C = length - rest
  const alpha = constraint.compliance / dtSq
  const lambda = -C / (wsum + alpha)
  const invLength = 1 / length
  const gx = dx * invLength
  const gy = dy * invLength
  const gz = dz * invLength

  if (wa > 0) {
    positions[ia] -= wa * lambda * gx
    positions[ia + 1] -= wa * lambda * gy
    positions[ia + 2] -= wa * lambda * gz
  }
  if (wb > 0) {
    positions[ib] += wb * lambda * gx
    positions[ib + 1] += wb * lambda * gy
    positions[ib + 2] += wb * lambda * gz
  }
}

function getConstraintRest(constraint: DistanceConstraint, options: DistanceSolveOptions) {
  if (constraint.targetRest === undefined) return constraint.rest
  const scale = clamp01(options.seamRestScale ?? 0)
  return constraint.targetRest + (constraint.rest - constraint.targetRest) * scale
}

function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value
}
