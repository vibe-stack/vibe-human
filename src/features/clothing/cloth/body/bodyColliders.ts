import { capsule, sphere } from '../solver/colliders'
import type { Collider } from '../solver/types'

/** Approximate the head + torso with a small set of analytic SDFs. Pure
 *  numbers — no THREE / rapier. Shared by the solver and the debug viz. */

export const HEAD = { x: 0, y: 0.03, z: 0.02, r: 0.34 }
export const SHOULDER = { ax: -0.42, ay: -0.36, az: -0.01, bx: 0.42, by: -0.36, bz: -0.01, r: 0.18 }
export const TORSO = { ax: 0, ay: -0.18, az: -0.02, bx: 0, by: -1.2, bz: -0.02, r: 0.27 }

export function defaultBodyColliders(): Collider[] {
  return [
    sphere(HEAD.x, HEAD.y, HEAD.z, HEAD.r, 0.7),
    capsule(SHOULDER.ax, SHOULDER.ay, SHOULDER.az, SHOULDER.bx, SHOULDER.by, SHOULDER.bz, SHOULDER.r, 0.6),
    capsule(TORSO.ax, TORSO.ay, TORSO.az, TORSO.bx, TORSO.by, TORSO.bz, TORSO.r, 0.5),
  ]
}
