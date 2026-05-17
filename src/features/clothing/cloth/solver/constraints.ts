import type { BendConstraint, ClothSolverState, DistanceConstraint } from './types'

/**
 * XPBD distance constraint solve. We use the standard formulation:
 *   λ = -C / (w1 + w2 + α̃)
 *   Δx_i = ±w_i * λ * grad
 * with α̃ = compliance / dt².
 */
export function solveDistanceConstraints(state: ClothSolverState, dt: number) {
  const { positions, invMass, distances } = state
  const dtSq = dt * dt
  for (let k = 0; k < distances.length; k += 1) {
    const c = distances[k]
    solveDistance(positions, invMass, c, dtSq)
  }
}

function solveDistance(
  positions: Float32Array,
  invMass: Float32Array,
  c: DistanceConstraint,
  dtSq: number,
) {
  const ia = c.a * 3
  const ib = c.b * 3
  const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2]
  const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2]
  const dx = bx - ax, dy = by - ay, dz = bz - az
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (len < 1e-7) return

  const wA = invMass[c.a], wB = invMass[c.b]
  const wSum = wA + wB
  if (wSum < 1e-9) return

  const C = len - c.rest
  const alpha = c.compliance / dtSq
  const lambda = -C / (wSum + alpha)
  const invLen = 1 / len
  const gx = dx * invLen
  const gy = dy * invLen
  const gz = dz * invLen

  if (wA > 0) {
    positions[ia]     -= wA * lambda * gx
    positions[ia + 1] -= wA * lambda * gy
    positions[ia + 2] -= wA * lambda * gz
  }
  if (wB > 0) {
    positions[ib]     += wB * lambda * gx
    positions[ib + 1] += wB * lambda * gy
    positions[ib + 2] += wB * lambda * gz
  }
}

/**
 * Cheap bending constraint variant: keep the middle particle close to the
 * midpoint of its two endpoints (Müller-style triangle bending). This is
 * O(N) and behaves well at the resolutions cloth is normally run at.
 */
export function solveBendingConstraints(state: ClothSolverState, dt: number) {
  const { positions, invMass, bends } = state
  const dtSq = dt * dt
  for (let k = 0; k < bends.length; k += 1) {
    const c = bends[k]
    solveBend(positions, invMass, c, dtSq)
  }
}

function solveBend(
  positions: Float32Array,
  invMass: Float32Array,
  c: BendConstraint,
  dtSq: number,
) {
  const ia = c.a * 3, ib = c.b * 3, ic = c.c * 3
  const mx = (positions[ia] + positions[ic]) * 0.5
  const my = (positions[ia + 1] + positions[ic + 1]) * 0.5
  const mz = (positions[ia + 2] + positions[ic + 2]) * 0.5

  const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2]
  const dx = bx - mx, dy = by - my, dz = bz - mz
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (len < 1e-7) return

  const wA = invMass[c.a], wB = invMass[c.b], wC = invMass[c.c]
  // Effective inverse mass for the midpoint constraint: w_b is full,
  // endpoints share half each through the midpoint formulation.
  const wSum = wB + 0.25 * (wA + wC)
  if (wSum < 1e-9) return

  const alpha = c.compliance / dtSq
  const lambda = -len / (wSum + alpha)
  const invLen = 1 / len
  const gx = dx * invLen, gy = dy * invLen, gz = dz * invLen

  if (wB > 0) {
    positions[ib]     += wB * lambda * gx
    positions[ib + 1] += wB * lambda * gy
    positions[ib + 2] += wB * lambda * gz
  }
  if (wA > 0) {
    positions[ia]     -= 0.5 * wA * lambda * gx
    positions[ia + 1] -= 0.5 * wA * lambda * gy
    positions[ia + 2] -= 0.5 * wA * lambda * gz
  }
  if (wC > 0) {
    positions[ic]     -= 0.5 * wC * lambda * gx
    positions[ic + 1] -= 0.5 * wC * lambda * gy
    positions[ic + 2] -= 0.5 * wC * lambda * gz
  }
}
