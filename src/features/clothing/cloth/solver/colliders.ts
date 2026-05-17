import type { CapsuleCollider, ClothSolverState, Collider, SphereCollider } from './types'

/** Project every particle out of every collider. Pure SDF push — much
 *  cheaper and more reliable than rapier ball-vs-ball at this scale. */
export function projectColliders(state: ClothSolverState) {
  const { positions, prevPositions, colliders, particleCount } = state
  if (colliders.length === 0) return

  for (let i = 0; i < particleCount; i += 1) {
    const o = i * 3
    let px = positions[o], py = positions[o + 1], pz = positions[o + 2]
    let touched = false

    for (let k = 0; k < colliders.length; k += 1) {
      const c = colliders[k]
      const r = c.kind === 'sphere'
        ? pushOutOfSphere(c, px, py, pz)
        : pushOutOfCapsule(c, px, py, pz)
      if (r) {
        px = r.x; py = r.y; pz = r.z
        // Friction: damp the tangential motion since last frame.
        const fr = c.friction
        if (fr > 0) {
          const opx = prevPositions[o], opy = prevPositions[o + 1], opz = prevPositions[o + 2]
          // tangential displacement
          const dx = px - opx, dy = py - opy, dz = pz - opz
          const nx = r.nx, ny = r.ny, nz = r.nz
          const dn = dx * nx + dy * ny + dz * nz
          const tx = dx - nx * dn, ty = dy - ny * dn, tz = dz - nz * dn
          // Subtract some of the tangential motion (stick the cloth)
          const f = Math.min(1, fr)
          prevPositions[o]     = opx + tx * f
          prevPositions[o + 1] = opy + ty * f
          prevPositions[o + 2] = opz + tz * f
        }
        touched = true
      }
    }

    if (touched) {
      positions[o] = px; positions[o + 1] = py; positions[o + 2] = pz
    }
  }
}

type PushResult = { x: number; y: number; z: number; nx: number; ny: number; nz: number } | null

function pushOutOfSphere(c: SphereCollider, px: number, py: number, pz: number): PushResult {
  const dx = px - c.cx, dy = py - c.cy, dz = pz - c.cz
  const distSq = dx * dx + dy * dy + dz * dz
  const rSq = c.r * c.r
  if (distSq >= rSq) return null
  const dist = Math.sqrt(distSq) || 1e-6
  const inv = 1 / dist
  const nx = dx * inv, ny = dy * inv, nz = dz * inv
  return {
    x: c.cx + nx * c.r,
    y: c.cy + ny * c.r,
    z: c.cz + nz * c.r,
    nx, ny, nz,
  }
}

function pushOutOfCapsule(c: CapsuleCollider, px: number, py: number, pz: number): PushResult {
  // Find closest point on segment a..b
  const abx = c.bx - c.ax, aby = c.by - c.ay, abz = c.bz - c.az
  const apx = px - c.ax, apy = py - c.ay, apz = pz - c.az
  const segLenSq = abx * abx + aby * aby + abz * abz
  const t = segLenSq < 1e-9 ? 0 : clamp01((apx * abx + apy * aby + apz * abz) / segLenSq)
  const qx = c.ax + abx * t, qy = c.ay + aby * t, qz = c.az + abz * t
  const dx = px - qx, dy = py - qy, dz = pz - qz
  const distSq = dx * dx + dy * dy + dz * dz
  const rSq = c.r * c.r
  if (distSq >= rSq) return null
  const dist = Math.sqrt(distSq) || 1e-6
  const inv = 1 / dist
  const nx = dx * inv, ny = dy * inv, nz = dz * inv
  return {
    x: qx + nx * c.r,
    y: qy + ny * c.r,
    z: qz + nz * c.r,
    nx, ny, nz,
  }
}

function clamp01(v: number) { return v < 0 ? 0 : v > 1 ? 1 : v }

// ---------------------------------------------------------------------------
// Helpers for placing pre-canned colliders in world space.
// ---------------------------------------------------------------------------

export const sphere = (cx: number, cy: number, cz: number, r: number, friction = 0.6): Collider =>
  ({ kind: 'sphere', cx, cy, cz, r, friction })

export const capsule = (
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r: number, friction = 0.6,
): Collider => ({ kind: 'capsule', ax, ay, az, bx, by, bz, r, friction })
