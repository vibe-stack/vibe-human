import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import type { PatternDocument, PatternPanel } from '../document/types'
import { compileGarmentRuntime } from '../compiler/compileGarmentRuntime'
import { QUALITY_PRESETS as COMPLIANCE_PRESETS } from '../compiler/buildPanelSimMesh'
import type { CompileQuality } from '../compiler/types'
import { XPBDClothSolver } from '../simulation/solver'
import type {
  ClothFrame,
  CollisionAvatar,
  CollisionRegion,
  GarmentRuntime,
  MeshSurfaceColliderSnapshot,
  RenderPanelRuntime,
  SolverParams,
} from '../simulation/types'
import {
  buildCollisionAvatarFromSkinnedMeshes,
  clearBodyProxySnapshot,
  getBodyProxySnapshot,
  rebuildAvatarMeshCollider,
  setBodyProxySnapshot,
  setCollisionAvatar,
  type AvatarMeshColliderTopology,
} from '../avatar-collision/AvatarCollisionRegistry'
import { getAvatarCollisionSource } from '../avatar-collision/AvatarCollisionSource'
import type { AvatarCollisionMode } from '../state/clothingTypes'
import { setCollisionAvatarStats, setCollisionRuntimeStats } from '../state/clothingActions'

const FIXED_DT = 1 / 60
const MAX_SUBSTEPS = 4
const CLOTH_GROUND_Y = -3.15
const PATTERN_UNIT_SCALE = 0.004

const SOLVER_PRESETS: Record<CompileQuality, SolverParams> = {
  low: { gravity: -9.81, damping: 0.08, substeps: 1, iterations: 4, dt: FIXED_DT, groundY: CLOTH_GROUND_Y, maxVelocity: 6, selfCollisionRadius: 0.012, selfCollisionStiffness: 0.32, sewingTime: 0.65, gravityDelayTime: 0.05, gravityRampTime: 0.2 },
  medium: { gravity: -9.81, damping: 0.07, substeps: 2, iterations: 6, dt: FIXED_DT, groundY: CLOTH_GROUND_Y, maxVelocity: 6, selfCollisionRadius: 0.014, selfCollisionStiffness: 0.4, sewingTime: 0.65, gravityDelayTime: 0.05, gravityRampTime: 0.2 },
  high: { gravity: -9.81, damping: 0.06, substeps: 3, iterations: 8, dt: FIXED_DT, groundY: CLOTH_GROUND_Y, maxVelocity: 7, selfCollisionRadius: 0.016, selfCollisionStiffness: 0.5, sewingTime: 0.65, gravityDelayTime: 0.05, gravityRampTime: 0.2 },
  ultra: { gravity: -9.81, damping: 0.05, substeps: 4, iterations: 10, dt: FIXED_DT, groundY: CLOTH_GROUND_Y, maxVelocity: 8, selfCollisionRadius: 0.018, selfCollisionStiffness: 0.58, sewingTime: 0.65, gravityDelayTime: 0.05, gravityRampTime: 0.2 },
}

type RenderPanelEntry = {
  panelId: string
  panel: RenderPanelRuntime
  geometry: THREE.BufferGeometry
  positionArray: Float32Array
  normalArray: Float32Array
  smoothScratch: Float32Array
  vertexCount: number
  indices: Uint32Array
  neighborOffsets: Uint32Array
  neighbors: Uint32Array
}

const VISUAL_SMOOTHING_PASSES = 3
const VISUAL_SMOOTHING_ALPHA = 0.28
const VISUAL_SMOOTHING_SHRINK = -0.08

export function useGarmentSimulation(args: {
  document: PatternDocument
  quality: CompileQuality
  resetKey: number
  running: boolean
  enabled: boolean
  collision: {
    mode: AvatarCollisionMode
    buildRequestId: number
    globalInflate: number
    normalOffset: number
    perRegionInflate: Partial<Record<CollisionRegion, number>>
    skinOffset: number
    garmentThickness: number
    meshCellSize: number
    meshSampleStride: number
    enableVertexTriangle: boolean
    debugPerf: boolean
    includeLowResMesh: boolean
    showCapsules: boolean
    showEllipsoids: boolean
  }
}) {
  const { document, quality, resetKey, running, enabled, collision } = args

  // The simulation reacts to three *independent* kinds of change. The guiding
  // rule, MD-style: the drape is only ever thrown away on an explicit reset.
  // Everything else either reprojects the existing drape or is absorbed live.
  //
  //   geometryKey   — pattern points/edges/holes, seams, glue pins, resolution
  //                   (quality spacing + particleDistance). Recompiles the
  //                   mesh, then re-projects the current drape onto the new
  //                   grid so editing the 2D pattern reshapes the cloth in
  //                   place instead of resetting it.
  //   liveParamsKey — compliance / damping / solver iterations. Pushed into the
  //                   running solver in place; never rebuilds.
  //   placementKey  — panel placement. Handled live by the gizmo; never
  //                   rebuilds (see the paused-placement effect below).
  //
  // resetKey is separate: bumping it is the *only* thing that respawns flat.
  const geometryKey = useMemo(() => buildGeometryKey(document, quality), [document, quality])
  const liveParamsKey = useMemo(() => buildLiveParamsKey(document, quality), [document, quality])

  // Recompile when geometry/resolution changes or on an explicit reset. The
  // flat-vs-reproject decision is made in the consuming effect by comparing
  // resetKey against the last built one.
  const rebuildKey = `${resetKey}::${geometryKey}`
  const compileResult = useMemo(
    () => compileGarmentRuntime(document, { quality, seamSamples: 18 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuildKey captures exactly the recompilation-worthy inputs.
    [rebuildKey],
  )
  const renderPanels = useMemo(
    () => compileResult.value.renderPanels.map((panel) => createRenderPanelEntry(panel)),
    [compileResult],
  )
  const runtimeRef = useRef<GarmentRuntime | null>(null)
  const solverRef = useRef<XPBDClothSolver | null>(null)
  const renderPanelsRef = useRef<RenderPanelEntry[]>(renderPanels)
  const frameRef = useRef<ClothFrame | null>(null)
  const accumRef = useRef(0)
  const avatarRef = useRef<CollisionAvatar | null>(null)
  const avatarBuildRequestRef = useRef(-1)
  const meshColliderRef = useRef<MeshSurfaceColliderSnapshot | null>(null)
  const meshColliderTopologyRef = useRef<AvatarMeshColliderTopology | null>(null)
  const collisionRef = useRef(collision)
  const enabledRef = useRef(enabled)

  // Last seen reset key. A recompile reprojects the existing drape unless the
  // reset key changed (or this is the first build), in which case it respawns
  // flat. This is what keeps 2D pattern edits non-destructive.
  const lastResetKeyRef = useRef<number | null>(null)
  const liveParamsKeyRef = useRef<string | null>(null)
  // Previous placements, used to compute delta transforms when the gizmo is
  // dragged while the sim is paused. Initialised/reset by the compile effect.
  type Vec3 = { x: number; y: number; z: number }
  type PlacementRec = { position: Vec3; rotation: Vec3 }
  const prevPlacementsRef = useRef<Record<string, PlacementRec>>({})

  useEffect(() => {
    collisionRef.current = collision
  }, [collision])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!enabledRef.current || !runtime) return
    updateColliderSnapshotForStep(
      Boolean(runtime.simMesh.particleCount),
      avatarRef,
      avatarBuildRequestRef,
      meshColliderRef,
      meshColliderTopologyRef,
      collisionRef.current,
    )
  }, [collision.buildRequestId])

  useEffect(() => {
    enabledRef.current = enabled
    if (!enabled) clearBodyProxySnapshot()
  }, [enabled])

  useEffect(() => {
    return () => {
      clearBodyProxySnapshot()
      avatarRef.current = null
      avatarBuildRequestRef.current = -1
      meshColliderRef.current = null
      meshColliderTopologyRef.current = null
    }
  }, [])

  useEffect(() => {
    renderPanelsRef.current = renderPanels
  }, [renderPanels])

  useEffect(() => {
    return () => {
      renderPanels.forEach((entry) => entry.geometry.dispose())
    }
  }, [renderPanels])

  const documentRef = useRef(document)
  useEffect(() => {
    documentRef.current = document
  }, [document])

  useEffect(() => {
    const nextMesh = compileResult.value.simMesh

    // Reproject unless this rebuild was an explicit reset (or the first build).
    // Reset is the only path that throws the drape away.
    const previousMesh = runtimeRef.current?.simMesh ?? null
    const isReset = lastResetKeyRef.current === null || lastResetKeyRef.current !== resetKey
    const canReproject = !isReset && previousMesh !== null && previousMesh.particleCount > 0

    runtimeRef.current = compileResult.value
    frameRef.current = { positions: nextMesh.positions }

    if (canReproject && previousMesh) {
      // Keep the draped shape: sample the old world positions per panel in
      // pattern space and write them into the new grid. Seam rests are then
      // re-derived from the reprojected geometry so a paused garment doesn't
      // twitch. This covers resolution changes AND 2D pattern edits.
      reprojectDrape(previousMesh, nextMesh)
      refreshSeamPlacementRest(nextMesh)
    } else {
      // Explicit reset or first build: spawn flat at the document placement.
      applyDocumentPlacements(nextMesh, documentRef.current)
      refreshSeamPlacementRest(nextMesh)
    }

    const panelDamping = Object.values(documentRef.current.panels)
      .map((panel) => panel.damping)
      .filter((value): value is number => Number.isFinite(value))
    const damping = panelDamping.length
      ? panelDamping.reduce((sum, value) => sum + value, 0) / panelDamping.length
      : SOLVER_PRESETS[quality].damping
    solverRef.current = new XPBDClothSolver(nextMesh, { ...SOLVER_PRESETS[quality], damping })
    updateRenderPanels(compileResult.value, renderPanels, nextMesh.positions)
    accumRef.current = 0

    // Snapshot the current placements so the gizmo-delta effect can diff against them.
    const snapshotPlacements: Record<string, PlacementRec> = {}
    for (const [id, panel] of Object.entries(documentRef.current.panels)) {
      snapshotPlacements[id] = { position: { ...panel.placement.position }, rotation: { ...panel.placement.rotation } }
    }
    prevPlacementsRef.current = snapshotPlacements

    lastResetKeyRef.current = resetKey
    liveParamsKeyRef.current = liveParamsKey
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetKey/liveParamsKey are derived from compileResult inputs; depending on them directly would double-fire.
  }, [compileResult, quality, renderPanels])

  const runningRef = useRef(running)
  useEffect(() => {
    runningRef.current = running
  }, [running])

  // Live material / solver knobs: push straight into the running solver. No
  // rebuild, no respawn. When the sim is paused we run a single settle step so
  // the change is actually visible (MD-style tweak-during-pause); when it's
  // running the next frame already reflects it. Skips the render right after a
  // rebuild, which has already applied fresh presets.
  useEffect(() => {
    const solver = solverRef.current
    const runtime = runtimeRef.current
    if (!solver || !runtime) return
    if (liveParamsKeyRef.current === liveParamsKey) return
    liveParamsKeyRef.current = liveParamsKey

    applyLiveSolverParams(solver, documentRef.current, quality)

    if (!runningRef.current) {
      frameRef.current = solver.settle(getBodyProxySnapshot())
      updateRenderPanels(runtime, renderPanelsRef.current, frameRef.current.positions)
    }
  }, [liveParamsKey, quality])

  // Placement while paused: the gizmo writes panel placement into the document.
  // We apply a DELTA transform to the existing (draped) particle positions so
  // the sim shape is preserved — only translated/rotated — instead of being
  // snapped back to a flat spawn pose. Gated on a placement-only key so
  // unrelated document edits (color, compliance, …) never disturb the drape.
  const placementKey = useMemo(() => buildPlacementKey(document), [document])
  useEffect(() => {
    if (runningRef.current) return
    const runtime = runtimeRef.current
    if (!runtime) return
    const doc = documentRef.current
    for (const [panelId, panel] of Object.entries(doc.panels)) {
      const prev = prevPlacementsRef.current[panelId]
      if (!prev) {
        // First time we see this panel (e.g. added after compile) — initialise.
        prevPlacementsRef.current[panelId] = { position: { ...panel.placement.position }, rotation: { ...panel.placement.rotation } }
        continue
      }
      const curr = panel.placement
      const samePosX = prev.position.x === curr.position.x
      const samePosY = prev.position.y === curr.position.y
      const samePosZ = prev.position.z === curr.position.z
      const sameRotX = prev.rotation.x === curr.rotation.x
      const sameRotY = prev.rotation.y === curr.rotation.y
      const sameRotZ = prev.rotation.z === curr.rotation.z
      if (samePosX && samePosY && samePosZ && sameRotX && sameRotY && sameRotZ) continue
      applyPlacementDelta(runtime.simMesh, panelId, prev, curr)
      prevPlacementsRef.current[panelId] = { position: { ...curr.position }, rotation: { ...curr.rotation } }
    }
    refreshSeamPlacementRest(runtime.simMesh)
    updateRenderPanels(runtime, renderPanelsRef.current, runtime.simMesh.positions)
  }, [placementKey])

  useFrame((_, delta) => {
    if (!enabledRef.current) return
    const runtime = runtimeRef.current
    const solver = solverRef.current
    if (!runtime || !solver) return
    if (running) {
      accumRef.current += Math.min(delta, 1 / 20)
      let steps = 0
      while (accumRef.current >= FIXED_DT && steps < MAX_SUBSTEPS) {
        updateColliderSnapshotForStep(
          Boolean(runtime.simMesh.particleCount),
          avatarRef,
          avatarBuildRequestRef,
          meshColliderRef,
          meshColliderTopologyRef,
          collisionRef.current,
        )
        const start = collisionRef.current.debugPerf ? performance.now() : 0
        frameRef.current = solver.step(getBodyProxySnapshot())
        if (collisionRef.current.debugPerf) {
          console.debug(`[clothing] solver step ${(performance.now() - start).toFixed(2)}ms`)
        }
        accumRef.current -= FIXED_DT
        steps += 1
      }
    }
    updateRenderPanels(runtime, renderPanelsRef.current, frameRef.current?.positions ?? runtime.simMesh.positions)
  })

  const grab = useMemo(() => ({
    start(particle: number, x: number, y: number, z: number) {
      const solver = solverRef.current
      if (!solver) return
      solver.setGrab(particle, x, y, z, 0, 0, 0)
    },
    update(particle: number, x: number, y: number, z: number, vx: number, vy: number, vz: number) {
      const solver = solverRef.current
      if (!solver) return
      solver.setGrab(particle, x, y, z, vx, vy, vz)
    },
    release() {
      solverRef.current?.releaseGrab()
    },
    nearestParticleInPanel(panelId: string, worldX: number, worldY: number, worldZ: number) {
      const runtime = runtimeRef.current
      if (!runtime) return -1
      const positions = frameRef.current?.positions ?? runtime.simMesh.positions
      const panelIds = runtime.simMesh.panelIds
      const count = runtime.simMesh.particleCount
      let best = -1
      let bestDistSq = Infinity
      for (let i = 0; i < count; i += 1) {
        if (panelIds[i] !== panelId) continue
        const offset = i * 3
        const dx = positions[offset] - worldX
        const dy = positions[offset + 1] - worldY
        const dz = positions[offset + 2] - worldZ
        const distSq = dx * dx + dy * dy + dz * dz
        if (distSq < bestDistSq) {
          bestDistSq = distSq
          best = i
        }
      }
      return best
    },
  }), [])

  return {
    runtime: compileResult.value,
    issues: compileResult.issues,
    renderPanels,
    colliderSnapshot: getBodyProxySnapshot(),
    grab,
  }
}

function updateColliderSnapshotForStep(
  hasActiveGarment: boolean,
  avatarRef: MutableRefObject<CollisionAvatar | null>,
  buildRequestRef: MutableRefObject<number>,
  meshColliderRef: MutableRefObject<MeshSurfaceColliderSnapshot | null>,
  meshColliderTopologyRef: MutableRefObject<AvatarMeshColliderTopology | null>,
  collision: Parameters<typeof useGarmentSimulation>[0]['collision'],
) {
  if (!hasActiveGarment) return
  const source = getAvatarCollisionSource()
  source.getRootObject()?.updateMatrixWorld(true)
  const bones = source.getBones()
  const bodyMeshes = source.getBodyMeshes()
  const headMeshes = source.getHeadMeshes()
  const hasAvatar = Object.keys(bones).length > 0 && (bodyMeshes.length > 0 || headMeshes.length > 0)
  if (!hasAvatar) {
    setBodyProxySnapshot({ proxies: [] })
    return
  }

  if (!avatarRef.current || buildRequestRef.current !== collision.buildRequestId) {
    const avatar = buildCollisionAvatarFromSkinnedMeshes(bones, {
      bodyMeshes,
      headMeshes,
      settings: {
        globalInflate: collision.globalInflate,
        normalOffset: collision.normalOffset,
        perRegionInflate: collision.perRegionInflate,
      },
    })
    avatarRef.current = avatar
    buildRequestRef.current = collision.buildRequestId
    meshColliderTopologyRef.current = null
    setCollisionAvatar(avatar)
    setCollisionAvatarStats({
      generatedAt: avatar.createdAt,
      proxyCount: avatar.proxies.length,
      meshPatchCount: avatar.lowResMeshPatches?.length ?? 0,
      sourceVertexCount: avatar.source.vertexCount,
    })
  }

  const rebuild = timed(collision.debugPerf, 'rebuildAvatarMeshCollider', () => rebuildAvatarMeshCollider(
    source.getSkinnedMeshes(),
    meshColliderTopologyRef.current,
    {
      id: 'avatar.mesh',
      skinOffset: collision.skinOffset,
      garmentThickness: collision.garmentThickness,
      cellSize: collision.meshCellSize,
      triangleStride: collision.meshSampleStride,
      debugPerf: collision.debugPerf,
    },
  ))
  meshColliderRef.current = rebuild?.snapshot ?? null
  meshColliderTopologyRef.current = rebuild?.topology ?? null
  const meshCollider = meshColliderRef.current
  setCollisionRuntimeStats({
    meshColliderVertexCount: meshCollider ? meshCollider.vertices.length / 3 : 0,
    meshColliderTriangleCount: meshCollider ? meshCollider.indices.length / 3 : 0,
    spatialHashCellCount: meshCollider ? meshCollider.cellKeys.length : 0,
  })

  setBodyProxySnapshot({
    proxies: [],
    meshColliders: meshCollider ? [meshCollider] : undefined,
  })
}

function timed<T>(enabled: boolean, label: string, fn: () => T) {
  if (!enabled) return fn()
  const start = performance.now()
  const result = fn()
  console.debug(`[clothing] ${label} ${(performance.now() - start).toFixed(2)}ms`)
  return result
}

/**
 * Everything that changes the particle mesh: pattern geometry (points, edges,
 * holes), seams, glue pins, and resolution (solver quality spacing + per-panel
 * particleDistance). A change here rebuilds the mesh and then reprojects the
 * current drape onto it — so editing the 2D pattern, sewing, or changing
 * resolution reshapes the cloth in place instead of resetting it. Only an
 * explicit reset (resetKey) respawns flat; it is intentionally NOT part of this
 * key so the rebuild path can tell the two cases apart.
 */
export function buildGeometryKey(document: PatternDocument, quality: CompileQuality) {
  const panelKeys = Object.values(document.panels)
    .map((panel) => {
      const points = Object.values(panel.points)
        .map((point) => `${point.id}:${point.x},${point.y},${point.in?.x ?? ''},${point.in?.y ?? ''},${point.out?.x ?? ''},${point.out?.y ?? ''},${point.kind}`)
        .sort()
        .join('|')
      const edges = panel.edges.map((edge) => `${edge.id}:${edge.from}>${edge.to}:${edge.curve}`).join('|')
      const holes = (panel.holes ?? []).map((hole) => hole.map((edge) => edge.id).join(',')).join('|')
      const pins = (panel.pins ?? []).map((pin) => `${pin.id}:${pin.u},${pin.v}:${pin.weight ?? ''}`).sort().join('|')
      return `${panel.id}:${panel.closed}:${panel.fabricId ?? ''}:${panel.particleDistance}:${points}:${edges}:${holes}:${pins}`
    })
    .sort()
    .join('||')
  const seamKeys = Object.values(document.seams)
    .map((seam) => `${seam.id}:${seam.a.panelId}:${seam.a.edgeId}:${seam.a.reversed ? 1 : 0}:${seam.b.panelId}:${seam.b.edgeId}:${seam.b.reversed ? 1 : 0}:${seam.strength}`)
    .sort()
    .join('||')
  return `${quality}|${panelKeys}|${seamKeys}`
}

/**
 * Material / solver knobs that the solver can absorb in place: per-panel
 * compliance + damping, plus the quality preset (which also dictates solver
 * substeps/iterations). Never triggers a rebuild.
 */
export function buildLiveParamsKey(document: PatternDocument, quality: CompileQuality) {
  const panelKeys = Object.values(document.panels)
    .map((panel) => `${panel.id}:${panel.stretchCompliance ?? ''}:${panel.shearCompliance ?? ''}:${panel.bendCompliance ?? ''}:${panel.damping ?? ''}`)
    .sort()
    .join('||')
  return `${quality}|${panelKeys}`
}

/** Per-panel placement only — drives the live (paused) gizmo translate. */
export function buildPlacementKey(document: PatternDocument) {
  return Object.values(document.panels)
    .map((panel) => {
      const p = panel.placement
      return `${panel.id}:${p.position.x},${p.position.y},${p.position.z}:${p.rotation.x},${p.rotation.y},${p.rotation.z}`
    })
    .sort()
    .join('||')
}

/**
 * Push the document's material / solver knobs into a live solver. Compliance is
 * resolved against the same quality presets the compiler uses, so a panel that
 * leaves a knob unset still tracks quality changes. Mirrors the averaging the
 * rebuild path uses for damping.
 */
function applyLiveSolverParams(solver: XPBDClothSolver, document: PatternDocument, quality: CompileQuality) {
  const preset = COMPLIANCE_PRESETS[quality]
  const panels = Object.values(document.panels)

  const avg = (pick: (panel: PatternPanel) => number | undefined, fallback: number) => {
    const values = panels.map(pick).filter((value): value is number => Number.isFinite(value))
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback
  }

  solver.setStretchCompliance(avg((panel) => panel.stretchCompliance, preset.stretchCompliance))
  solver.setShearCompliance(avg((panel) => panel.shearCompliance, preset.shearCompliance))
  solver.setBendCompliance(avg((panel) => panel.bendCompliance, preset.bendCompliance))
  solver.setDamping(avg((panel) => panel.damping, SOLVER_PRESETS[quality].damping))
  solver.setSolverIterations(SOLVER_PRESETS[quality].substeps, SOLVER_PRESETS[quality].iterations)
}

/**
 * Re-project a draped garment from one particle grid onto a freshly-built one.
 * Used for resolution changes *and* 2D pattern edits (moving / adding / deleting
 * points, edges, holes) — anything short of a full reset.
 *
 * Matching is done in centroid-relative pattern space: for each panel we first
 * compute the centroid offset between the old and new grids and subtract it
 * before comparing distances.  This makes pure 2D translations transparent
 * (the same fabric point maps to itself regardless of how far the panel was
 * moved), while local shape edits still find the nearest old particle in the
 * fabric-local neighbourhood — exactly what MD does when you reshape a panel
 * with an existing drape.  Velocities are zeroed; the reprojected drape
 * becomes the new grid's rest state.
 */
function reprojectDrape(previous: GarmentRuntime['simMesh'], next: GarmentRuntime['simMesh']) {
  // Bucket previous particles by panel.
  const byPanel = new Map<string, number[]>()
  for (let i = 0; i < previous.particleCount; i += 1) {
    const panelId = previous.panelIds[i]
    let bucket = byPanel.get(panelId)
    if (!bucket) { bucket = []; byPanel.set(panelId, bucket) }
    bucket.push(i)
  }

  // Bucket next particles by panel (needed for centroid computation).
  const nextByPanel = new Map<string, number[]>()
  for (let i = 0; i < next.particleCount; i += 1) {
    const panelId = next.panelIds[i]
    let bucket = nextByPanel.get(panelId)
    if (!bucket) { bucket = []; nextByPanel.set(panelId, bucket) }
    bucket.push(i)
  }

  // Per-panel centroid offset: how much the grid has been translated in
  // 2D pattern space.  Subtracting this from the new particle coordinates
  // before comparing against old ones makes the comparison translation-invariant.
  const centroidOffset = new Map<string, { dx: number; dy: number }>()
  for (const [panelId, oldBucket] of byPanel) {
    const newBucket = nextByPanel.get(panelId)
    if (!newBucket || newBucket.length === 0) continue

    let oldCx = 0; let oldCy = 0
    for (const i of oldBucket) { oldCx += previous.panelLocalPositions[i * 2]; oldCy += previous.panelLocalPositions[i * 2 + 1] }
    oldCx /= oldBucket.length; oldCy /= oldBucket.length

    let newCx = 0; let newCy = 0
    for (const i of newBucket) { newCx += next.panelLocalPositions[i * 2]; newCy += next.panelLocalPositions[i * 2 + 1] }
    newCx /= newBucket.length; newCy /= newBucket.length

    centroidOffset.set(panelId, { dx: oldCx - newCx, dy: oldCy - newCy })
  }

  const { positions, prevPositions, velocities, panelIds, panelLocalPositions, particleCount } = next
  for (let particle = 0; particle < particleCount; particle += 1) {
    const panelId = panelIds[particle]
    const bucket = byPanel.get(panelId)
    const offset = particle * 3
    if (!bucket || bucket.length === 0) continue

    const co = centroidOffset.get(panelId) ?? { dx: 0, dy: 0 }
    // Shift new coords into old centroid frame so translation is cancelled out.
    const px = panelLocalPositions[particle * 2] + co.dx
    const py = panelLocalPositions[particle * 2 + 1] + co.dy
    let best = bucket[0]
    let bestDist = Infinity
    for (const candidate of bucket) {
      const dx = previous.panelLocalPositions[candidate * 2] - px
      const dy = previous.panelLocalPositions[candidate * 2 + 1] - py
      const dist = dx * dx + dy * dy
      if (dist < bestDist) { bestDist = dist; best = candidate }
    }

    const src = best * 3
    positions[offset] = previous.positions[src]
    positions[offset + 1] = previous.positions[src + 1]
    positions[offset + 2] = previous.positions[src + 2]
    prevPositions[offset] = previous.positions[src]
    prevPositions[offset + 1] = previous.positions[src + 1]
    prevPositions[offset + 2] = previous.positions[src + 2]
    velocities[offset] = 0
    velocities[offset + 1] = 0
    velocities[offset + 2] = 0
  }
}

function applyDocumentPlacements(runtimeMesh: GarmentRuntime['simMesh'], document: PatternDocument) {
  const { positions, prevPositions, velocities, panelIds, panelLocalPositions, particleCount } = runtimeMesh
  for (let particle = 0; particle < particleCount; particle += 1) {
    const panel = document.panels[panelIds[particle]]
    if (!panel) continue
    const localX = panelLocalPositions[particle * 2]
    const localY = panelLocalPositions[particle * 2 + 1]
    const world = applyPanelPlacement(localX, localY, panel)
    const offset = particle * 3
    positions[offset] = world.x
    positions[offset + 1] = world.y
    positions[offset + 2] = world.z
    prevPositions[offset] = world.x
    prevPositions[offset + 1] = world.y
    prevPositions[offset + 2] = world.z
    velocities[offset] = 0
    velocities[offset + 1] = 0
    velocities[offset + 2] = 0
  }
}

function refreshSeamPlacementRest(runtimeMesh: GarmentRuntime['simMesh']) {
  const positions = runtimeMesh.positions
  for (const seam of runtimeMesh.seamConstraints) {
    const ia = seam.a * 3
    const ib = seam.b * 3
    seam.rest = Math.hypot(
      positions[ib] - positions[ia],
      positions[ib + 1] - positions[ia + 1],
      positions[ib + 2] - positions[ia + 2],
    )
    seam.targetRest = seam.targetRest ?? 0
  }
}

function applyPanelPlacement(patternX: number, patternY: number, panel: PatternPanel) {
  const bounds = panelBounds(panel)
  const localX = ((patternX - bounds.minX) / bounds.width - 0.5) * bounds.width * PATTERN_UNIT_SCALE
  const localY = (0.5 - (patternY - bounds.minY) / bounds.height) * bounds.height * PATTERN_UNIT_SCALE
  const q = quatFromEuler(panel.placement.rotation.x, panel.placement.rotation.y, panel.placement.rotation.z)
  const rotated = rotateVec(localX, localY, 0, q.x, q.y, q.z, q.w)
  return {
    x: rotated.x + panel.placement.position.x,
    y: rotated.y + panel.placement.position.y,
    z: rotated.z + panel.placement.position.z,
  }
}

function panelBounds(panel: PatternPanel) {
  const points = Object.values(panel.points)
  if (!points.length) return { minX: -140, minY: -140, width: 280, height: 280 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return { minX, minY, width: maxX - minX || 1, height: maxY - minY || 1 }
}

function quatMul(
  a: { x: number; y: number; z: number; w: number },
  b: { x: number; y: number; z: number; w: number },
) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}

/**
 * Translate/rotate all particles of `panelId` by the delta between two
 * placements. Preserves the draped shape — only moves it in world space.
 */
function applyPlacementDelta(
  mesh: GarmentRuntime['simMesh'],
  panelId: string,
  prev: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } },
  next: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } },
) {
  const q0 = quatFromEuler(prev.rotation.x, prev.rotation.y, prev.rotation.z)
  const q1 = quatFromEuler(next.rotation.x, next.rotation.y, next.rotation.z)
  // Inverse of q0 (unit quaternion: conjugate == inverse)
  const q0inv = { x: -q0.x, y: -q0.y, z: -q0.z, w: q0.w }
  // Delta quaternion: rotate from old orientation to new
  const dq = quatMul(q1, q0inv)

  const { positions, prevPositions, velocities, panelIds, particleCount } = mesh
  for (let i = 0; i < particleCount; i += 1) {
    if (panelIds[i] !== panelId) continue
    const off = i * 3
    // Express particle relative to old placement pivot, apply delta rotation,
    // then translate to new placement pivot.
    const rx = positions[off] - prev.position.x
    const ry = positions[off + 1] - prev.position.y
    const rz = positions[off + 2] - prev.position.z
    const rotated = rotateVec(rx, ry, rz, dq.x, dq.y, dq.z, dq.w)
    positions[off] = rotated.x + next.position.x
    positions[off + 1] = rotated.y + next.position.y
    positions[off + 2] = rotated.z + next.position.z
    prevPositions[off] = positions[off]
    prevPositions[off + 1] = positions[off + 1]
    prevPositions[off + 2] = positions[off + 2]
    velocities[off] = 0
    velocities[off + 1] = 0
    velocities[off + 2] = 0
  }
}

function quatFromEuler(x: number, y: number, z: number) {
  const c1 = Math.cos(x / 2)
  const s1 = Math.sin(x / 2)
  const c2 = Math.cos(y / 2)
  const s2 = Math.sin(y / 2)
  const c3 = Math.cos(z / 2)
  const s3 = Math.sin(z / 2)
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

function createRenderPanelEntry(panel: GarmentRuntime['renderPanels'][number]): RenderPanelEntry {
  const vertexCount = panel.panelUvs.length / 2
  const positionArray = new Float32Array(vertexCount * 3)
  const normalArray = new Float32Array(vertexCount * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(panel.panelUvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(panel.indices, 1))
  const adjacency = buildAdjacency(vertexCount, panel.indices)
  return {
    panelId: panel.panelId,
    panel,
    geometry,
    positionArray,
    normalArray,
    smoothScratch: new Float32Array(vertexCount * 3),
    vertexCount,
    indices: panel.indices,
    neighborOffsets: adjacency.offsets,
    neighbors: adjacency.neighbors,
  }
}

function updateRenderPanels(_runtime: GarmentRuntime, entries: RenderPanelEntry[], positions: Float32Array) {
  for (const entry of entries) {
    const { panel, vertexCount } = entry
    const array = entry.positionArray
    const simTriangles = panel.embedding.simTriangles
    const barycentrics = panel.embedding.barycentrics
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const base = vertex * 3
      const ia = simTriangles[base] * 3
      const ib = simTriangles[base + 1] * 3
      const ic = simTriangles[base + 2] * 3
      const wa = barycentrics[base]
      const wb = barycentrics[base + 1]
      const wc = barycentrics[base + 2]
      array[base] = positions[ia] * wa + positions[ib] * wb + positions[ic] * wc
      array[base + 1] = positions[ia + 1] * wa + positions[ib + 1] * wb + positions[ic + 1] * wc
      array[base + 2] = positions[ia + 2] * wa + positions[ib + 2] * wb + positions[ic + 2] * wc
    }
    smoothVisualMeshPositions(array, entry.smoothScratch, entry.neighborOffsets, entry.neighbors, VISUAL_SMOOTHING_PASSES, VISUAL_SMOOTHING_ALPHA)
    smoothVisualMeshPositions(array, entry.smoothScratch, entry.neighborOffsets, entry.neighbors, 1, VISUAL_SMOOTHING_SHRINK)
    computeVertexNormalsFlat(array, entry.indices, entry.normalArray, vertexCount)
    ;(entry.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(entry.geometry.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true
    // Invalidate the cached bounding sphere so raycasting uses current positions.
    entry.geometry.boundingSphere = null
  }
}

// Specialized, allocation-free replacement for THREE's computeVertexNormals on a
// fixed indexed topology. Replicates THREE exactly: area-weighted face normal
// (C-B)x(A-B) accumulated per vertex, then per-vertex normalize (zero-length
// stays zero, matching Vector3.normalize()).
export function computeVertexNormalsFlat(
  positions: Float32Array,
  indices: Uint32Array,
  normals: Float32Array,
  vertexCount: number,
) {
  const normalLen = vertexCount * 3
  for (let i = 0; i < normalLen; i += 1) normals[i] = 0

  for (let i = 0; i < indices.length; i += 3) {
    const vA = indices[i]
    const vB = indices[i + 1]
    const vC = indices[i + 2]
    const iA = vA * 3
    const iB = vB * 3
    const iC = vC * 3

    const cbx = positions[iC] - positions[iB]
    const cby = positions[iC + 1] - positions[iB + 1]
    const cbz = positions[iC + 2] - positions[iB + 2]
    const abx = positions[iA] - positions[iB]
    const aby = positions[iA + 1] - positions[iB + 1]
    const abz = positions[iA + 2] - positions[iB + 2]

    const nx = cby * abz - cbz * aby
    const ny = cbz * abx - cbx * abz
    const nz = cbx * aby - cby * abx

    normals[iA] += nx; normals[iA + 1] += ny; normals[iA + 2] += nz
    normals[iB] += nx; normals[iB + 1] += ny; normals[iB + 2] += nz
    normals[iC] += nx; normals[iC + 1] += ny; normals[iC + 2] += nz
  }

  for (let i = 0; i < normalLen; i += 3) {
    const x = normals[i]
    const y = normals[i + 1]
    const z = normals[i + 2]
    const len = Math.sqrt(x * x + y * y + z * z) || 1
    const inv = 1 / len
    normals[i] = x * inv
    normals[i + 1] = y * inv
    normals[i + 2] = z * inv
  }
}

function buildAdjacency(vertexCount: number, indices: Uint32Array) {
  const neighborSets = Array.from({ length: vertexCount }, () => new Set<number>())
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]
    const b = indices[i + 1]
    const c = indices[i + 2]
    neighborSets[a].add(b); neighborSets[a].add(c)
    neighborSets[b].add(a); neighborSets[b].add(c)
    neighborSets[c].add(a); neighborSets[c].add(b)
  }
  const offsets = new Uint32Array(vertexCount + 1)
  let total = 0
  for (let i = 0; i < vertexCount; i += 1) {
    offsets[i] = total
    total += neighborSets[i].size
  }
  offsets[vertexCount] = total
  const neighbors = new Uint32Array(total)
  let cursor = 0
  for (let i = 0; i < vertexCount; i += 1) {
    for (const n of neighborSets[i]) neighbors[cursor++] = n
  }
  return { offsets, neighbors }
}

function smoothVisualMeshPositions(
  positions: Float32Array,
  scratch: Float32Array,
  neighborOffsets: Uint32Array,
  neighbors: Uint32Array,
  passes: number,
  alpha: number,
) {
  if (passes <= 0 || alpha <= 0) return
  const vertexCount = neighborOffsets.length - 1
  for (let pass = 0; pass < passes; pass += 1) {
    scratch.set(positions)
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const start = neighborOffsets[vertex]
      const end = neighborOffsets[vertex + 1]
      const neighborCount = end - start
      if (neighborCount === 0) continue
      let avgX = 0
      let avgY = 0
      let avgZ = 0
      for (let i = start; i < end; i += 1) {
        const n = neighbors[i] * 3
        avgX += scratch[n]
        avgY += scratch[n + 1]
        avgZ += scratch[n + 2]
      }
      const inv = 1 / neighborCount
      avgX *= inv
      avgY *= inv
      avgZ *= inv
      const base = vertex * 3
      positions[base] = scratch[base] + (avgX - scratch[base]) * alpha
      positions[base + 1] = scratch[base + 1] + (avgY - scratch[base + 1]) * alpha
      positions[base + 2] = scratch[base + 2] + (avgZ - scratch[base + 2]) * alpha
    }
  }
}
