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
  buildAvatarMeshColliderSnapshotFromSkinnedMeshes,
  buildCollisionAvatarFromSkinnedMeshes,
  clearBodyProxySnapshot,
  getBodyProxySnapshot,
  setBodyProxySnapshot,
  setCollisionAvatar,
} from '../avatar-collision/AvatarCollisionRegistry'
import { getAvatarCollisionSource } from '../avatar-collision/AvatarCollisionSource'
import type { AvatarCollisionMode } from '../state/clothingTypes'
import { setCollisionAvatarStats, setCollisionRuntimeStats } from '../state/clothingActions'

const FIXED_DT = 1 / 60
const MAX_SUBSTEPS = 4
const CLOTH_GROUND_Y = -3.15
const PATTERN_UNIT_SCALE = 0.004

const SOLVER_PRESETS: Record<CompileQuality, SolverParams> = {
  low: { gravity: -9.81, damping: 0.08, substeps: 1, iterations: 4, dt: FIXED_DT, groundY: CLOTH_GROUND_Y, maxVelocity: 6, sewingTime: 0.85, gravityDelayTime: 0.7, gravityRampTime: 0.45 },
  medium: { gravity: -9.81, damping: 0.07, substeps: 2, iterations: 6, dt: FIXED_DT, groundY: CLOTH_GROUND_Y, maxVelocity: 6, sewingTime: 0.85, gravityDelayTime: 0.7, gravityRampTime: 0.45 },
  high: { gravity: -9.81, damping: 0.06, substeps: 3, iterations: 8, dt: FIXED_DT, groundY: CLOTH_GROUND_Y, maxVelocity: 7, sewingTime: 0.85, gravityDelayTime: 0.7, gravityRampTime: 0.45 },
  ultra: { gravity: -9.81, damping: 0.05, substeps: 4, iterations: 10, dt: FIXED_DT, groundY: CLOTH_GROUND_Y, maxVelocity: 8, sewingTime: 0.85, gravityDelayTime: 0.7, gravityRampTime: 0.45 },
}

type RenderPanelEntry = {
  panelId: string
  geometry: THREE.BufferGeometry
}

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
  const meshColliderKeyRef = useRef('')
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
      meshColliderKeyRef.current = ''
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

  useEffect(() => {
    runtimeRef.current = compileResult.value
    frameRef.current = { positions: compileResult.value.simMesh.positions }
    applyDocumentPlacements(compileResult.value.simMesh, document)
    refreshSeamPlacementRest(compileResult.value.simMesh)
    solverRef.current = new XPBDClothSolver(compileResult.value.simMesh, SOLVER_PRESETS[quality])
    updateRenderPanels(compileResult.value, renderPanels, compileResult.value.simMesh.positions)
    accumRef.current = 0
  }, [compileResult, document, quality, renderPanels])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || running) return
    applyDocumentPlacements(runtime.simMesh, document)
    refreshSeamPlacementRest(runtime.simMesh)
    solverRef.current = new XPBDClothSolver(runtime.simMesh, SOLVER_PRESETS[quality])
    frameRef.current = { positions: runtime.simMesh.positions }
    updateRenderPanels(runtime, renderPanelsRef.current, runtime.simMesh.positions)
  }, [document, quality, running])

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
          meshColliderKeyRef,
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

  return {
    runtime: compileResult.value,
    issues: compileResult.issues,
    renderPanels,
    colliderSnapshot: getBodyProxySnapshot(),
  }
}

function updateColliderSnapshotForStep(
  hasActiveGarment: boolean,
  avatarRef: MutableRefObject<CollisionAvatar | null>,
  buildRequestRef: MutableRefObject<number>,
  meshColliderRef: MutableRefObject<MeshSurfaceColliderSnapshot | null>,
  meshColliderKeyRef: MutableRefObject<string>,
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
    setCollisionAvatar(avatar)
    setCollisionAvatarStats({
      generatedAt: avatar.createdAt,
      proxyCount: avatar.proxies.length,
      meshPatchCount: avatar.lowResMeshPatches?.length ?? 0,
      sourceVertexCount: avatar.source.vertexCount,
    })
  }

  meshColliderRef.current = timed(collision.debugPerf, 'buildAvatarMeshCollider', () => buildAvatarMeshColliderSnapshotFromSkinnedMeshes(
    source.getSkinnedMeshes(),
    {
      id: 'avatar.mesh',
      skinOffset: collision.skinOffset,
      garmentThickness: collision.garmentThickness,
      cellSize: collision.meshCellSize,
      triangleStride: collision.meshSampleStride,
      debugPerf: collision.debugPerf,
    },
  ))
  meshColliderKeyRef.current = ''
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
  return { panelId: panel.panelId, geometry }
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
    attr.needsUpdate = true
    entry.geometry.computeVertexNormals()
  }
}
