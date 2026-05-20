import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import type { PatternDocument, PatternPanel } from '../document/types'
import { compileGarmentRuntime } from '../compiler/compileGarmentRuntime'
import type { CompileQuality } from '../compiler/types'
import { XPBDClothSolver } from '../simulation/solver'
import type {
  ClothFrame,
  CollisionAvatar,
  CollisionRegion,
  GarmentRuntime,
  MeshSurfaceColliderSnapshot,
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
  low: { gravity: -9.81, damping: 0.08, substeps: 1, iterations: 4, dt: FIXED_DT, groundY: CLOTH_GROUND_Y, maxVelocity: 6, sewingTime: 0.65, gravityDelayTime: 0.05, gravityRampTime: 0.2 },
  medium: { gravity: -9.81, damping: 0.07, substeps: 2, iterations: 6, dt: FIXED_DT, groundY: CLOTH_GROUND_Y, maxVelocity: 6, sewingTime: 0.65, gravityDelayTime: 0.05, gravityRampTime: 0.2 },
  high: { gravity: -9.81, damping: 0.06, substeps: 3, iterations: 8, dt: FIXED_DT, groundY: CLOTH_GROUND_Y, maxVelocity: 7, sewingTime: 0.65, gravityDelayTime: 0.05, gravityRampTime: 0.2 },
  ultra: { gravity: -9.81, damping: 0.05, substeps: 4, iterations: 10, dt: FIXED_DT, groundY: CLOTH_GROUND_Y, maxVelocity: 8, sewingTime: 0.65, gravityDelayTime: 0.05, gravityRampTime: 0.2 },
}

type RenderPanelEntry = {
  panelId: string
  geometry: THREE.BufferGeometry
  neighborOffsets: Uint32Array
  neighbors: Uint32Array
}

const VISUAL_SMOOTHING_PASSES = 5
const VISUAL_SMOOTHING_ALPHA = 0.5
const VISUAL_SMOOTHING_SHRINK = -0.53

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
  const topologyKey = useMemo(() => buildTopologyKey(document, quality, resetKey), [document, quality, resetKey])
  const compileResult = useMemo(
    () => compileGarmentRuntime(document, { quality, seamSamples: 12 }),
    [topologyKey],
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

  useEffect(() => {
    collisionRef.current = collision
  }, [collision])

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
    runtimeRef.current = compileResult.value
    frameRef.current = { positions: compileResult.value.simMesh.positions }
    applyDocumentPlacements(compileResult.value.simMesh, documentRef.current)
    refreshSeamPlacementRest(compileResult.value.simMesh)
    solverRef.current = new XPBDClothSolver(compileResult.value.simMesh, SOLVER_PRESETS[quality])
    updateRenderPanels(compileResult.value, renderPanels, compileResult.value.simMesh.positions)
    accumRef.current = 0
  }, [compileResult, quality, renderPanels])

  const runningRef = useRef(running)
  useEffect(() => {
    runningRef.current = running
  }, [running])

  useEffect(() => {
    if (runningRef.current) return
    const runtime = runtimeRef.current
    if (!runtime) return
    applyDocumentPlacements(runtime.simMesh, document)
    updateRenderPanels(runtime, renderPanelsRef.current, runtime.simMesh.positions)
  }, [document])

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

function buildTopologyKey(document: PatternDocument, quality: CompileQuality, resetKey: number) {
  const panelKeys = Object.values(document.panels)
    .map((panel) => {
      const points = Object.values(panel.points)
        .map((point) => `${point.id}:${point.x},${point.y},${point.in?.x ?? ''},${point.in?.y ?? ''},${point.out?.x ?? ''},${point.out?.y ?? ''},${point.kind}`)
        .sort()
        .join('|')
      const edges = panel.edges.map((edge) => `${edge.id}:${edge.from}>${edge.to}:${edge.curve}`).join('|')
      const holes = (panel.holes ?? []).map((hole) => hole.map((edge) => edge.id).join(',')).join('|')
      return `${panel.id}:${panel.closed}:${panel.particleDistance}:${panel.fabricId ?? ''}:${points}:${edges}:${holes}`
    })
    .sort()
    .join('||')
  const seamKeys = Object.values(document.seams)
    .map((seam) => `${seam.id}:${seam.a.panelId}:${seam.a.edgeId}:${seam.a.reversed ? 1 : 0}:${seam.b.panelId}:${seam.b.edgeId}:${seam.b.reversed ? 1 : 0}:${seam.strength}`)
    .sort()
    .join('||')
  return `${quality}|${resetKey}|${panelKeys}|${seamKeys}`
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
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((panel.panelUvs.length / 2) * 3), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(panel.panelUvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(panel.indices, 1))
  const adjacency = buildAdjacency(panel.panelUvs.length / 2, panel.indices)
  return {
    panelId: panel.panelId,
    geometry,
    neighborOffsets: adjacency.offsets,
    neighbors: adjacency.neighbors,
  }
}

function updateRenderPanels(runtime: GarmentRuntime, entries: RenderPanelEntry[], positions: Float32Array) {
  for (const entry of entries) {
    const panel = runtime.renderPanels.find((item) => item.panelId === entry.panelId)
    if (!panel) continue
    const attr = entry.geometry.getAttribute('position') as THREE.BufferAttribute
    const array = attr.array as Float32Array
    for (let vertex = 0; vertex < panel.panelUvs.length / 2; vertex += 1) {
      const ia = panel.embedding.simTriangles[vertex * 3] * 3
      const ib = panel.embedding.simTriangles[vertex * 3 + 1] * 3
      const ic = panel.embedding.simTriangles[vertex * 3 + 2] * 3
      const wa = panel.embedding.barycentrics[vertex * 3]
      const wb = panel.embedding.barycentrics[vertex * 3 + 1]
      const wc = panel.embedding.barycentrics[vertex * 3 + 2]
      array[vertex * 3] = positions[ia] * wa + positions[ib] * wb + positions[ic] * wc
      array[vertex * 3 + 1] = positions[ia + 1] * wa + positions[ib + 1] * wb + positions[ic + 1] * wc
      array[vertex * 3 + 2] = positions[ia + 2] * wa + positions[ib + 2] * wb + positions[ic + 2] * wc
    }
    smoothVisualMeshPositions(array, entry.neighborOffsets, entry.neighbors, VISUAL_SMOOTHING_PASSES, VISUAL_SMOOTHING_ALPHA)
    smoothVisualMeshPositions(array, entry.neighborOffsets, entry.neighbors, 1, VISUAL_SMOOTHING_SHRINK)
    attr.needsUpdate = true
    entry.geometry.computeVertexNormals()
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
  neighborOffsets: Uint32Array,
  neighbors: Uint32Array,
  passes: number,
  alpha: number,
) {
  if (passes <= 0 || alpha <= 0) return
  const scratch = new Float32Array(positions.length)
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
