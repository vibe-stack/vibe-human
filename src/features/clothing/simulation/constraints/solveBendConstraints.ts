import type { ClothSimMesh } from '../types'

export function solveBendConstraints(mesh: ClothSimMesh, dt: number) {
  const dtSq = dt * dt
  const { positions, invMass, bendConstraints } = mesh
  for (const constraint of bendConstraints) {
    const ia = constraint.a * 3
    const ib = constraint.b * 3
    const ic = constraint.c * 3
    const mx = (positions[ia] + positions[ic]) * 0.5
    const my = (positions[ia + 1] + positions[ic + 1]) * 0.5
    const mz = (positions[ia + 2] + positions[ic + 2]) * 0.5
    const dx = positions[ib] - mx
    const dy = positions[ib + 1] - my
    const dz = positions[ib + 2] - mz
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (length < 1e-7) continue

    const wa = invMass[constraint.a]
    const wb = invMass[constraint.b]
    const wc = invMass[constraint.c]
    const wsum = wb + 0.25 * (wa + wc)
    if (wsum < 1e-9) continue

    const C = length - constraint.rest
    const alpha = constraint.compliance / dtSq
    const lambda = -C / (wsum + alpha)
    const invLength = 1 / length
    const gx = dx * invLength
    const gy = dy * invLength
    const gz = dz * invLength

    if (wb > 0) {
      positions[ib] += wb * lambda * gx
      positions[ib + 1] += wb * lambda * gy
      positions[ib + 2] += wb * lambda * gz
    }
    if (wa > 0) {
      positions[ia] -= 0.5 * wa * lambda * gx
      positions[ia + 1] -= 0.5 * wa * lambda * gy
      positions[ia + 2] -= 0.5 * wa * lambda * gz
    }
    if (wc > 0) {
      positions[ic] -= 0.5 * wc * lambda * gx
      positions[ic + 1] -= 0.5 * wc * lambda * gy
      positions[ic + 2] -= 0.5 * wc * lambda * gz
    }
  }
}