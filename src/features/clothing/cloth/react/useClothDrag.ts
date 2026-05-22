import { useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import type { ClothInstance } from './useClothSolver'

/**
 * Cursor-driven drag interaction. While the pointer is down on the cloth:
 *   - find the nearest cluster of particles
 *   - hard-pull them to follow the cursor on the view plane each frame
 *   - track velocity of the cursor (EMA) so release injects a flick
 *
 * Returns three pointer handlers wired to the mesh.
 */

const PULL_RADIUS_PX = 64
const MAX_PARTICLES = 64
const FLICK_SCALE = 0.7

type DragState = {
  pointerId: number
  particles: number[]                      // indices in the solver
  offsets: Float32Array                    // per-particle local offset from cursor (3 each)
  plane: THREE.Plane
  cursor: THREE.Vector3
  velocity: THREE.Vector3
  lastTime: number
}

export function useClothDrag(instance: ClothInstance | null, ensureRunning: () => void) {
  const { camera } = useThree()
  const drag = useRef<DragState | null>(null)

  function onPointerDown(event: ThreeEvent<PointerEvent>) {
    if (!instance) return
    event.stopPropagation()
    const hit = event.point
    const particles = pickNearest(instance, hit, PULL_RADIUS_PX, MAX_PARTICLES)
    if (particles.length === 0) return

    const offsets = new Float32Array(particles.length * 3)
    const pos = instance.solver.state.positions
    for (let k = 0; k < particles.length; k += 1) {
      const i = particles[k] * 3
      offsets[k * 3 + 0] = pos[i + 0] - hit.x
      offsets[k * 3 + 1] = pos[i + 1] - hit.y
      offsets[k * 3 + 2] = pos[i + 2] - hit.z
    }

    const normal = new THREE.Vector3()
    camera.getWorldDirection(normal)
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit)

    drag.current = {
      pointerId: event.pointerId,
      particles,
      offsets,
      plane,
      cursor: hit.clone(),
      velocity: new THREE.Vector3(),
      lastTime: performance.now(),
    }
    ensureRunning()
    ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
  }

  function onPointerMove(event: ThreeEvent<PointerEvent>) {
    const d = drag.current
    if (!d || !instance) return
    event.stopPropagation()
    const next = event.ray.intersectPlane(d.plane, new THREE.Vector3())
    if (!next) return

    const now = performance.now()
    const dt = Math.max((now - d.lastTime) / 1000, 1 / 240)
    const instV = next.clone().sub(d.cursor).divideScalar(dt)
    d.velocity.lerp(instV, 0.35)
    d.cursor.copy(next)
    d.lastTime = now

    // Hard-pull particles to follow the cursor.
    for (let k = 0; k < d.particles.length; k += 1) {
      const i = d.particles[k]
      instance.solver.forcePosition(
        i,
        next.x + d.offsets[k * 3 + 0],
        next.y + d.offsets[k * 3 + 1],
        next.z + d.offsets[k * 3 + 2],
      )
    }
  }

  function onPointerUp(event: ThreeEvent<PointerEvent>) {
    const d = drag.current
    if (!d || !instance) return
    event.stopPropagation()
    const v = d.velocity
    const speed = v.length()
    if (speed > 0.05) {
      const flick = v.clone().multiplyScalar(FLICK_SCALE)
      for (let k = 0; k < d.particles.length; k += 1) {
        const w = 1 - (k / d.particles.length) * 0.7 // outer particles get less flick
        instance.solver.addVelocity(d.particles[k], flick.x * w, flick.y * w, flick.z * w)
      }
    }
    drag.current = null
    ;(event.target as HTMLElement).releasePointerCapture?.(event.pointerId)
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp }
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

function pickNearest(instance: ClothInstance, hit: THREE.Vector3, _radiusPx: number, maxCount: number): number[] {
  // Approximation: convert "screen pixels" to a world radius by using the
  // mean particle spacing × a factor. Marvelous-style soft pick.
  const radius = Math.max(instance.grid.spacingX, instance.grid.spacingZ) * 4
  const radiusSq = radius * radius
  const pos = instance.solver.state.positions
  const out: Array<{ i: number; dSq: number }> = []

  let nearestI = -1
  let nearestSq = Infinity
  for (let i = 0; i < instance.solver.state.particleCount; i += 1) {
    if (instance.solver.state.invMass[i] === 0) continue
    const o = i * 3
    const dx = pos[o] - hit.x
    const dy = pos[o + 1] - hit.y
    const dz = pos[o + 2] - hit.z
    const dSq = dx * dx + dy * dy + dz * dz
    if (dSq < nearestSq) { nearestSq = dSq; nearestI = i }
    if (dSq <= radiusSq) out.push({ i, dSq })
  }
  if (out.length === 0 && nearestI >= 0) out.push({ i: nearestI, dSq: nearestSq })

  out.sort((a, b) => a.dSq - b.dSq)
  return out.slice(0, maxCount).map((x) => x.i)
}

// Silence ts unused
void PULL_RADIUS_PX
