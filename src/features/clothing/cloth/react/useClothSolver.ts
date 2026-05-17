import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { ClothSolver } from '../solver/ClothSolver'
import { buildGrid } from '../topology/buildGrid'
import { buildVisualMesh } from '../topology/buildVisualMesh'
import { sampleSimAtUv } from '../topology/sampleSimAtUv'
import { getBodyCollisionMeshes, subscribeBodyMesh } from '../body/bodyMeshRegistry'
import type { Collider } from '../solver/types'
import type { ClothSimQuality, PatternPiece, PatternPlacement } from '../../state/clothingTypes'

const FIXED_DT = 1 / 60
const MAX_SUBSTEPS = 4
const QUALITY: Record<ClothSimQuality, { spacing: number; subs: number; iter: number; bend: number; minDim: number; maxDim: number }> = {
  low:    { spacing: 0.060, subs: 1, iter: 2, bend: 0.020, minDim: 8,  maxDim: 16 },
  medium: { spacing: 0.040, subs: 2, iter: 3, bend: 0.012, minDim: 12, maxDim: 24 },
  high:   { spacing: 0.028, subs: 3, iter: 4, bend: 0.006, minDim: 16, maxDim: 32 },
  ultra:  { spacing: 0.020, subs: 4, iter: 5, bend: 0.002, minDim: 20, maxDim: 40 },
}

export type ClothInstance = {
  solver: ClothSolver
  grid: ReturnType<typeof buildGrid>
  visual: ReturnType<typeof buildVisualMesh>
  sampleScratch: Float32Array
}

/**
 * Owns the solver lifecycle for one pattern piece. The hook rebuilds the
 * solver whenever the inputs that affect topology change (piece geometry,
 * quality, resetKey) and steps it every frame when `running` is true.
 *
 * Placement is applied as a *spawn transform*: each rebuild positions
 * particles at (placement * localRest). No bake, no snap.
 */
export function useClothSolver(args: {
  piece: PatternPiece
  quality: ClothSimQuality
  resetKey: number
  running: boolean
  placement: PatternPlacement
}) {
  const { piece, quality, resetKey, running, placement } = args

  // Topology key: anything that changes grid topology forces a full rebuild.
  // Placement is intentionally NOT in here — moving the cloth shouldn't
  // re-allocate the solver, just translate particles.
  const topologyKey = useMemo(() => buildTopologyKey(piece, quality, resetKey), [piece, quality, resetKey])

  const instanceRef = useRef<ClothInstance | null>(null)
  const lastPlacementRef = useRef<PatternPlacement>(placement)

  // Build / rebuild the cloth instance.
  const instance = useMemo<ClothInstance>(() => {
    const q = QUALITY[quality]
    const grid = buildGrid(piece, {
      spacing: q.spacing,
      bendCompliance: q.bend,
      distanceCompliance: 0.0002,
      minDim: q.minDim,
      maxDim: q.maxDim,
    })

    const invMass = new Float32Array(grid.cols * grid.rows)
    for (let i = 0; i < invMass.length; i += 1) {
      invMass[i] = grid.active[i] ? 1 / 0.018 : 0
    }
    // Drop inactive particles entirely from any constraint pass by setting
    // them to infinite mass — but actually invMass=0 makes them PINNED.
    // We want them ignored: easiest is to leave them at rest (no constraints
    // reference them, so they stay put), but for safety give them invMass=1
    // and just rely on the absence of constraints to keep them out of the way.
    for (let i = 0; i < invMass.length; i += 1) if (!grid.active[i]) invMass[i] = 0

    // Apply the placement to spawn positions so the cloth starts where
    // the user placed it.
    const positions = new Float32Array(grid.positions)
    applyPlacement(positions, placement)

    const solver = new ClothSolver({
      positions,
      invMass,
      distances: grid.distances,
      bends: grid.bends,
      colliders: buildMeshColliders(),
      params: {
        gravity: -9.81,
        damping: 0.04,
        substeps: q.subs,
        iterations: q.iter,
        dt: FIXED_DT,
        groundY: -1.6,
      },
    })

    const visual = buildVisualMesh(piece)
    return { solver, grid, visual, sampleScratch: new Float32Array(3) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey])

  // Track instance ref + dispose on unmount.
  useEffect(() => {
    instanceRef.current = instance
    lastPlacementRef.current = placement
    // Initialise visual mesh positions from the (rest) sim so the first
    // frame doesn't show a flat plane.
    syncVisualFromSolver(instance)
    return () => { instance.visual.geometry.dispose() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance])

  // Placement deltas: always (running or not) translate/rotate every
  // particle to follow the gizmo. Particles live in world space; the
  // placement is just "where the cloth is right now". After applying,
  // refresh the visual mesh so the user sees it move immediately even
  // before pressing play.
  useEffect(() => {
    const inst = instanceRef.current
    if (!inst) return
    const prev = lastPlacementRef.current
    if (placementEquals(prev, placement)) return

    const dx = placement.position.x - prev.position.x
    const dy = placement.position.y - prev.position.y
    const dz = placement.position.z - prev.position.z

    const dq = eulerDeltaQuat(prev.rotation, placement.rotation)
    if (dq) {
      // Rotate around the *previous* placement position so the cloth pivots
      // about the gizmo's anchor, not its drifted centroid.
      inst.solver.rotateAll(prev.position.x, prev.position.y, prev.position.z, dq.x, dq.y, dq.z, dq.w)
    }
    if (dx || dy || dz) inst.solver.translateAll(dx, dy, dz)

    lastPlacementRef.current = placement
    syncVisualFromSolver(inst)
  }, [placement])

  // Keep the solver's collider list in sync as the registry changes
  // (character loaded / replaced).
  useEffect(() => {
    const update = () => {
      const inst = instanceRef.current
      if (!inst) return
      inst.solver.setColliders(buildMeshColliders())
    }
    return subscribeBodyMesh(update)
  }, [])

  // Frame loop.
  const accumRef = useRef(0)
  useFrame((_, delta) => {
    const inst = instanceRef.current
    if (!inst) return
    if (!running) return
    accumRef.current += Math.min(delta, 1 / 20)
    let steps = 0
    while (accumRef.current >= FIXED_DT && steps < MAX_SUBSTEPS) {
      inst.solver.step()
      accumRef.current -= FIXED_DT
      steps += 1
    }
    syncVisualFromSolver(inst)
  })

  return instance
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMeshColliders(): Collider[] {
  return getBodyCollisionMeshes().map((mesh) => ({
    kind: 'mesh',
    mesh,
    friction: 0.6,
    // Tiny offset so cloth sits a hair above the skin instead of z-fighting.
    skin: 0.004,
  }))
}

function buildTopologyKey(piece: PatternPiece, quality: ClothSimQuality, resetKey: number) {
  // Cheap hash: count + reset key + quality + edge count + hole count
  let pointStamp = 0
  for (const id of Object.keys(piece.points)) pointStamp = (pointStamp * 31 + id.charCodeAt(0)) | 0
  const holeCount = (piece.holes ?? []).reduce((s, h) => s + h.length, 0)
  return `${piece.id}|${quality}|${resetKey}|${Object.keys(piece.points).length}|${piece.edges.length}|${holeCount}|${pointStamp}`
}

function applyPlacement(positions: Float32Array, placement: PatternPlacement) {
  const { position, rotation } = placement
  const q = quatFromEuler(rotation.x, rotation.y, rotation.z)
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    const r = rotateVec(x, y, z, q.x, q.y, q.z, q.w)
    positions[i]     = r.x + position.x
    positions[i + 1] = r.y + position.y
    positions[i + 2] = r.z + position.z
  }
}

function syncVisualFromSolver(inst: ClothInstance) {
  const { solver, grid, visual } = inst
  const positionAttr = visual.geometry.getAttribute('position') as { array: Float32Array; needsUpdate: boolean; count: number } | undefined
  if (!positionAttr || positionAttr.count === 0) return
  const out = inst.sampleScratch
  const uvs = visual.uvs
  const positions = positionAttr.array
  for (let i = 0; i < positionAttr.count; i += 1) {
    sampleSimAtUv(solver.state.positions, grid, uvs[i * 2], uvs[i * 2 + 1], out)
    positions[i * 3]     = out[0]
    positions[i * 3 + 1] = out[1]
    positions[i * 3 + 2] = out[2]
  }
  positionAttr.needsUpdate = true
  visual.geometry.computeVertexNormals()
}

function placementEquals(a: PatternPlacement, b: PatternPlacement) {
  return a.position.x === b.position.x && a.position.y === b.position.y && a.position.z === b.position.z
    && a.rotation.x === b.rotation.x && a.rotation.y === b.rotation.y && a.rotation.z === b.rotation.z
}


function quatFromEuler(x: number, y: number, z: number) {
  // ZYX Euler -> quaternion (matches THREE default order 'XYZ' applied as RxRyRz)
  const c1 = Math.cos(x / 2), s1 = Math.sin(x / 2)
  const c2 = Math.cos(y / 2), s2 = Math.sin(y / 2)
  const c3 = Math.cos(z / 2), s3 = Math.sin(z / 2)
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  }
}

function rotateVec(x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number) {
  const tx = 2 * (qy * z - qz * y)
  const ty = 2 * (qz * x - qx * z)
  const tz = 2 * (qx * y - qy * x)
  return {
    x: x + qw * tx + (qy * tz - qz * ty),
    y: y + qw * ty + (qz * tx - qx * tz),
    z: z + qw * tz + (qx * ty - qy * tx),
  }
}

function eulerDeltaQuat(
  prev: { x: number; y: number; z: number },
  next: { x: number; y: number; z: number },
) {
  if (prev.x === next.x && prev.y === next.y && prev.z === next.z) return null
  const qP = quatFromEuler(prev.x, prev.y, prev.z)
  const qN = quatFromEuler(next.x, next.y, next.z)
  // qDelta = qN * qP⁻¹ (conjugate for unit quat)
  return quatMul(qN, { x: -qP.x, y: -qP.y, z: -qP.z, w: qP.w })
}

function quatMul(a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}
