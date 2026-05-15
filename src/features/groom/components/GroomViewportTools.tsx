import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { subscribe, useSnapshot } from 'valtio'
import * as THREE from 'three/webgpu'
import { setIsTransforming } from '../../../appState'
import {
  collectTrianglesInBrush,
  findClosestTriangle,
  getTriangleSurfaceData,
} from '../core/scalpBinding'
import {
  addGuideAtSurfacePoint,
  beginGroomDrag,
  endGroomDrag,
  getRegisteredGroomMesh,
  groomStore,
  setSceneSelectionMeshId,
  updateScalpFlowTriangles,
  updateScalpMapTriangles,
  updateGuideTools,
  updateScalpMaskTriangles,
} from '../store/groomStore'
import type { GroomAsset, GroomTool, ScalpMapChannel, ScalpPaintChannel } from '../core/types'

type BrushHit = {
  worldPos: THREE.Vector3
  worldNormal: THREE.Vector3
} | null

type ResolvedHit = {
  worldPos: THREE.Vector3
  worldNormal: THREE.Vector3
  effectWorldPos: THREE.Vector3
  triangleIndex: number | null
  onGuide: boolean
  onMesh: boolean
  sourceMesh: THREE.Mesh
}

type DragState = {
  pointerId: number
  lastPointLocal: THREE.Vector3
  lastClientX: number
  lastClientY: number
  sourceMesh: THREE.Mesh
  tool: GroomTool
  scalpPaintChannel: ScalpPaintChannel
}

const BRUSH_TOOLS = new Set<GroomTool>(['paint-scalp', 'erase-scalp', 'add-guide', 'comb', 'smooth', 'cut', 'delete-guide'])
const MASK_TOOLS = new Set<GroomTool>(['paint-scalp', 'erase-scalp'])
const GUIDE_EDIT_TOOLS = new Set<GroomTool>(['comb', 'smooth', 'cut', 'delete-guide'])

// -----------------------------------------------------------------------------
// Scalp paint visualization geometry
// -----------------------------------------------------------------------------

function scalarMapChannel(channel: ScalpPaintChannel): ScalpMapChannel | null {
  return channel === 'mask' || channel === 'flow' ? null : channel
}

function overlayColorForValue(value: number, out: THREE.Color) {
  const strength = THREE.MathUtils.clamp(Math.abs(value), 0.18, 1)
  const positive = new THREE.Color('#f472b6')
  const negative = new THREE.Color('#38bdf8')
  const base = value >= 0 ? positive : negative
  out.set('#111827').lerp(base, strength)
  return out
}

function buildScalpOverlayGeometry(mesh: THREE.Mesh, asset: GroomAsset, channel: ScalpPaintChannel) {
  const geometry = mesh.geometry
  if (!(geometry instanceof THREE.BufferGeometry)) return null

  const scalarChannel = scalarMapChannel(channel)
  const triangleEntries = scalarChannel
    ? Object.entries(asset.scalpMask.maps?.[scalarChannel] ?? {})
        .map(([key, value]) => [Number(key), value] as const)
        .filter(([triangleIndex, value]) => Number.isInteger(triangleIndex) && Math.abs(value) > 0.015)
    : asset.scalpMask.selectedTriangleIndices.map((triangleIndex) => [triangleIndex, 1] as const)

  if (!triangleEntries.length) return null

  const positions = new Float32Array(triangleEntries.length * 18)
  const normals = new Float32Array(triangleEntries.length * 18)
  const colors = new Float32Array(triangleEntries.length * 18)
  const color = new THREE.Color()
  let cursor = 0
  for (const [triangleIndex, value] of triangleEntries) {
    const surface = getTriangleSurfaceData(geometry, triangleIndex)
    if (!surface) continue
    const { a, b, c, normal } = surface
    if (scalarChannel) overlayColorForValue(value, color)
    else color.set('#22c55e')
    // Write CCW + CW windings so it's visible from either side without DoubleSide.
    const verts = [a, b, c, a, c, b]
    for (const v of verts) {
      positions[cursor]     = v.x + normal.x * 0.0008
      positions[cursor + 1] = v.y + normal.y * 0.0008
      positions[cursor + 2] = v.z + normal.z * 0.0008
      normals[cursor]       = normal.x
      normals[cursor + 1]   = normal.y
      normals[cursor + 2]   = normal.z
      colors[cursor]        = color.r
      colors[cursor + 1]    = color.g
      colors[cursor + 2]    = color.b
      cursor += 3
    }
  }

  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions.subarray(0, cursor), 3))
  result.setAttribute('normal', new THREE.Float32BufferAttribute(normals.subarray(0, cursor), 3))
  result.setAttribute('color', new THREE.Float32BufferAttribute(colors.subarray(0, cursor), 3))
  return result
}

function buildScalpFlowGeometry(mesh: THREE.Mesh, asset: GroomAsset) {
  const geometry = mesh.geometry
  if (!(geometry instanceof THREE.BufferGeometry)) return null
  const entries = Object.entries(asset.scalpMask.flowMap ?? {})
    .map(([key, flow]) => [Number(key), flow] as const)
    .filter(([triangleIndex, flow]) => Number.isInteger(triangleIndex) && Array.isArray(flow))
  if (!entries.length) return null

  const maxVectors = 1800
  const step = Math.max(1, Math.ceil(entries.length / maxVectors))
  const positions: number[] = []
  const colors: number[] = []
  const start = new THREE.Vector3()
  const end = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const side = new THREE.Vector3()

  for (let i = 0; i < entries.length; i += step) {
    const [triangleIndex, flow] = entries[i]
    const surface = getTriangleSurfaceData(geometry, triangleIndex)
    if (!surface) continue

    dir.set(flow[0], flow[1], flow[2])
    dir.addScaledVector(surface.normal, -dir.dot(surface.normal))
    if (dir.lengthSq() <= 1e-10) continue
    dir.normalize()

    const span = Math.sqrt(new THREE.Triangle(surface.a, surface.b, surface.c).getArea()) * 1.45
    const length = THREE.MathUtils.clamp(span, 0.006, 0.03)
    start.copy(surface.centroid).addScaledVector(surface.normal, 0.002)
    end.copy(start).addScaledVector(dir, length)
    side.crossVectors(surface.normal, dir).normalize()

    const headA = end.clone().addScaledVector(dir, -length * 0.28).addScaledVector(side, length * 0.13)
    const headB = end.clone().addScaledVector(dir, -length * 0.28).addScaledVector(side, -length * 0.13)
    positions.push(
      start.x, start.y, start.z, end.x, end.y, end.z,
      headA.x, headA.y, headA.z, end.x, end.y, end.z,
      headB.x, headB.y, headB.z, end.x, end.y, end.z,
    )
    for (let c = 0; c < 6; c += 1) colors.push(0.56, 0.82, 1)
  }

  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  result.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return result
}

// -----------------------------------------------------------------------------
// Brush cursor — a simple world-space ring placed at the hit point.
// -----------------------------------------------------------------------------

function buildBrushCircleGeometry(segments = 64) {
  const positions: number[] = []
  for (let i = 0; i <= segments; i += 1) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    positions.push(Math.cos(a0), Math.sin(a0), 0, Math.cos(a1), Math.sin(a1), 0)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geo
}

function BrushCursor({
  brushSize,
  hitRef,
}: {
  brushSize: number
  hitRef: React.MutableRefObject<BrushHit>
}) {
  const groupRef = useRef<THREE.Group>(null)
  const circleGeo = useMemo(() => buildBrushCircleGeometry(), [])
  const circleMat = useMemo(
    () => new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthTest: false, toneMapped: false }),
    [],
  )

  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    const hit = hitRef.current
    if (!hit) {
      group.visible = false
      return
    }
    group.visible = true
    const n = hit.worldNormal
    const up = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    const right = new THREE.Vector3().crossVectors(up, n).normalize().multiplyScalar(brushSize)
    const realUp = new THREE.Vector3().crossVectors(n, right.clone().normalize()).multiplyScalar(brushSize)
    const scaledN = n.clone().multiplyScalar(brushSize)
    group.matrix.makeBasis(right, realUp, scaledN)
    group.matrix.setPosition(hit.worldPos)
    group.matrixAutoUpdate = false
  })

  useEffect(() => () => { circleGeo.dispose(); circleMat.dispose() }, [circleGeo, circleMat])

  return (
    <group ref={groupRef} renderOrder={100}>
      <lineSegments geometry={circleGeo} renderOrder={100}>
        <primitive object={circleMat} attach="material" />
      </lineSegments>
    </group>
  )
}

// -----------------------------------------------------------------------------
// FollowerGroup — mirrors a source mesh's world transform.
// -----------------------------------------------------------------------------

function FollowerGroup({ source, children }: { source: THREE.Mesh; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    if (!ref.current) return
    source.updateWorldMatrix(true, false)
    ref.current.matrix.copy(source.matrixWorld)
  }, [source])
  useFrame(() => {
    if (!ref.current) return
    ref.current.matrix.copy(source.matrixWorld)
  })
  return <group ref={ref} matrixAutoUpdate={false}>{children}</group>
}

// -----------------------------------------------------------------------------
// Raycasting helpers (shared scratch — DOM event handlers run on the main
// thread one at a time, so reusing buffers is safe here).
// -----------------------------------------------------------------------------

const _ndc = new THREE.Vector2()
const _raycaster = new THREE.Raycaster()
const _sphere = new THREE.Sphere()
const _sphereHit = new THREE.Vector3()
const _guideA = new THREE.Vector3()
const _guideB = new THREE.Vector3()
const _guideBestPoint = new THREE.Vector3()
const _guideProjectedA = new THREE.Vector3()
const _guideProjectedB = new THREE.Vector3()
const _guideWorldPoint = new THREE.Vector3()
const _cameraRight = new THREE.Vector3()
const _cameraUp = new THREE.Vector3()
const _deltaLocalStart = new THREE.Vector3()
const _deltaLocalEnd = new THREE.Vector3()
const _screenDeltaWorld = new THREE.Vector3()

function clientToNDC(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect()
  _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  return _ndc
}

function raycastMesh(mesh: THREE.Mesh, camera: THREE.Camera, canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  _raycaster.setFromCamera(clientToNDC(canvas, clientX, clientY), camera)
  const hits = _raycaster.intersectObject(mesh, false)
  return hits.length > 0 ? hits[0] : null
}

function fallbackHitOnBoundingSphere(mesh: THREE.Mesh, camera: THREE.Camera, canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const geom = mesh.geometry as THREE.BufferGeometry
  if (!geom.boundingSphere) geom.computeBoundingSphere()
  if (!geom.boundingSphere) return null

  _raycaster.setFromCamera(clientToNDC(canvas, clientX, clientY), camera)
  _sphere.copy(geom.boundingSphere).applyMatrix4(mesh.matrixWorld)
  _sphere.radius *= 1.5
  const intersection = _raycaster.ray.intersectSphere(_sphere, _sphereHit)
  if (intersection) return _sphereHit.clone()

  // Closest approach to sphere center along the ray.
  const t = Math.max(0, _sphere.center.clone().sub(_raycaster.ray.origin).dot(_raycaster.ray.direction))
  return _raycaster.ray.origin.clone().addScaledVector(_raycaster.ray.direction, t)
}

function worldRadiusToScreenPixels(
  worldPoint: THREE.Vector3,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  radius: number,
) {
  const rect = canvas.getBoundingClientRect()
  _cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
  _cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize()

  const cx = (worldPoint.clone().project(camera).x * 0.5 + 0.5) * rect.width
  const cy = (-worldPoint.clone().project(camera).y * 0.5 + 0.5) * rect.height
  const rx = worldPoint.clone().addScaledVector(_cameraRight, radius).project(camera)
  const ry = worldPoint.clone().addScaledVector(_cameraUp, radius).project(camera)
  const dx = (rx.x * 0.5 + 0.5) * rect.width - cx
  const dy = (-rx.y * 0.5 + 0.5) * rect.height - cy
  const ux = (ry.x * 0.5 + 0.5) * rect.width - cx
  const uy = (-ry.y * 0.5 + 0.5) * rect.height - cy
  return Math.max(Math.hypot(dx, dy), Math.hypot(ux, uy), 2)
}

function findGuideUnderBrush(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  radius: number,
) {
  const guides = groomStore.activeGroomAsset.guides
  if (!guides.length || radius <= 0) return null

  const rect = canvas.getBoundingClientRect()
  const pointerX = clientX - rect.left
  const pointerY = clientY - rect.top

  let bestDistanceSq = Infinity
  for (const guide of guides) {
    const pts = guide.points
    for (let i = 0; i < pts.length - 1; i += 1) {
      _guideA.set(pts[i][0], pts[i][1], pts[i][2]).applyMatrix4(mesh.matrixWorld)
      _guideB.set(pts[i + 1][0], pts[i + 1][1], pts[i + 1][2]).applyMatrix4(mesh.matrixWorld)
      _guideProjectedA.copy(_guideA).project(camera)
      _guideProjectedB.copy(_guideB).project(camera)
      if (_guideProjectedA.z < -1 && _guideProjectedB.z < -1) continue
      if (_guideProjectedA.z > 1 && _guideProjectedB.z > 1) continue

      const ax = (_guideProjectedA.x * 0.5 + 0.5) * rect.width
      const ay = (-_guideProjectedA.y * 0.5 + 0.5) * rect.height
      const bx = (_guideProjectedB.x * 0.5 + 0.5) * rect.width
      const by = (-_guideProjectedB.y * 0.5 + 0.5) * rect.height
      const abx = bx - ax
      const aby = by - ay
      const abLenSq = abx * abx + aby * aby
      const t = abLenSq > 1e-8
        ? THREE.MathUtils.clamp(((pointerX - ax) * abx + (pointerY - ay) * aby) / abLenSq, 0, 1)
        : 0
      const sx = ax + abx * t
      const sy = ay + aby * t
      const dx = pointerX - sx
      const dy = pointerY - sy
      const distanceSq = dx * dx + dy * dy
      _guideWorldPoint.copy(_guideA).lerp(_guideB, t)
      const brushRadiusPx = worldRadiusToScreenPixels(_guideWorldPoint, camera, canvas, radius)
      if (distanceSq > brushRadiusPx * brushRadiusPx) continue
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq
        _guideBestPoint.copy(_guideWorldPoint)
      }
    }
  }

  return Number.isFinite(bestDistanceSq) ? _guideBestPoint.clone() : null
}

function worldUnitsPerPixelAt(
  worldPoint: THREE.Vector3,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
) {
  const rect = canvas.getBoundingClientRect()
  const maybePerspective = camera as THREE.PerspectiveCamera
  if (maybePerspective.isPerspectiveCamera) {
    const distance = Math.max(1e-6, worldPoint.distanceTo(camera.position))
    const fov = THREE.MathUtils.degToRad(maybePerspective.fov)
    return (2 * Math.tan(fov * 0.5) * distance) / Math.max(1, rect.height)
  }

  const maybeOrtho = camera as THREE.OrthographicCamera
  if (maybeOrtho.isOrthographicCamera) {
    return ((maybeOrtho.top - maybeOrtho.bottom) / Math.max(1e-6, maybeOrtho.zoom)) / Math.max(1, rect.height)
  }

  return 0.001
}

function pointerDeltaInCameraPlane(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  prevClientX: number,
  prevClientY: number,
  clientX: number,
  clientY: number,
  anchorWorld: THREE.Vector3,
  maxLength: number,
) {
  const unitsPerPixel = worldUnitsPerPixelAt(anchorWorld, camera, canvas)
  const dx = clientX - prevClientX
  const dy = clientY - prevClientY
  _cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
  _cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
  _screenDeltaWorld
    .copy(_cameraRight).multiplyScalar(dx * unitsPerPixel)
    .addScaledVector(_cameraUp, -dy * unitsPerPixel)
  if (maxLength > 0 && _screenDeltaWorld.lengthSq() > maxLength * maxLength) {
    _screenDeltaWorld.setLength(maxLength)
  }

  _deltaLocalStart.copy(anchorWorld)
  _deltaLocalEnd.copy(anchorWorld).add(_screenDeltaWorld)
  mesh.worldToLocal(_deltaLocalStart)
  mesh.worldToLocal(_deltaLocalEnd)
  return _deltaLocalEnd.sub(_deltaLocalStart).clone()
}

// -----------------------------------------------------------------------------
// Main component
// -----------------------------------------------------------------------------

export default function GroomViewportTools() {
  const { activeGroomAsset, activeGroomTool, brushSize, brushStrength, activeScalpPaintChannel, showScalpMask } = useSnapshot(groomStore)
  const targetMesh = getRegisteredGroomMesh(activeGroomAsset.targetMeshId)
  const { gl, camera } = useThree()

  const brushHitRef = useRef<BrushHit>(null)
  const dragRef = useRef<DragState | null>(null)
  const isBrushTool = BRUSH_TOOLS.has(activeGroomTool)

  // Stable refs for values used inside DOM event handlers so we don't have
  // to re-install listeners on every change.
  const stateRef = useRef({ targetMesh, activeGroomTool, brushSize, brushStrength, activeScalpPaintChannel, isBrushTool })
  const cameraRef = useRef(camera)

  useLayoutEffect(() => {
    stateRef.current = { targetMesh, activeGroomTool, brushSize, brushStrength, activeScalpPaintChannel, isBrushTool }
    cameraRef.current = camera
  }, [targetMesh, activeGroomTool, brushSize, brushStrength, activeScalpPaintChannel, isBrushTool, camera])

  // ---------------------------------------------------------------------------
  // Scalp-mask visualization (rebuilt only when the set actually changes)
  // ---------------------------------------------------------------------------

  const maskMaterial = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      vertexColors: true,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    mat.polygonOffset = true
    mat.polygonOffsetFactor = -2
    mat.polygonOffsetUnits = -2
    return mat
  }, [])
  const flowMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, depthTest: true, toneMapped: false }),
    [],
  )

  // The scalp-mask geometry can grow to thousands of triangles during a paint
  // drag.  Rebuilding it from scratch on every pointermove is what stutters
  // the brush, so we coalesce rebuilds to one per animation frame and keep a
  // single buffer geometry that we resize in place.
  const scalpMaskGeometry = useMemo(() => new THREE.BufferGeometry(), [])
  const scalpFlowGeometry = useMemo(() => new THREE.BufferGeometry(), [])
  const maskGeometryDirty = useRef(0)

  useEffect(() => {
    if (!targetMesh || !showScalpMask) {
      scalpMaskGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
      scalpMaskGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
      scalpFlowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
      scalpFlowGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
      return
    }

    const rebuild = () => {
      const asset = groomStore.activeGroomAsset as GroomAsset
      const built = buildScalpOverlayGeometry(targetMesh, asset, groomStore.activeScalpPaintChannel)
      const pos = built?.getAttribute('position')
      const nor = built?.getAttribute('normal')
      const col = built?.getAttribute('color')
      if (pos && nor && col) {
        scalpMaskGeometry.setAttribute('position', pos)
        scalpMaskGeometry.setAttribute('normal', nor)
        scalpMaskGeometry.setAttribute('color', col)
      } else {
        scalpMaskGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
        scalpMaskGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
      }
      built?.dispose()

      const flowBuilt = groomStore.activeScalpPaintChannel === 'flow'
        ? buildScalpFlowGeometry(targetMesh, asset)
        : null
      const flowPos = flowBuilt?.getAttribute('position')
      const flowCol = flowBuilt?.getAttribute('color')
      if (flowPos && flowCol) {
        scalpFlowGeometry.setAttribute('position', flowPos)
        scalpFlowGeometry.setAttribute('color', flowCol)
      } else {
        scalpFlowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
        scalpFlowGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
      }
      flowBuilt?.dispose()
    }

    rebuild()

    // Re-check every animation frame.  Valtio mutations only set a flag — the
    // real rebuild waits for the next rAF, capping work at 60Hz regardless of
    // how many pointermove events fire.
    let raf = 0
    const loop = () => {
      if (maskGeometryDirty.current) {
        maskGeometryDirty.current = 0
        rebuild()
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [targetMesh, showScalpMask, activeScalpPaintChannel, scalpMaskGeometry, scalpFlowGeometry])

  // Listen to the root proxy so imported/replaced assets and channel map
  // mutations also rebuild.  The actual geometry work is still rAF-coalesced.
  useEffect(() => {
    return subscribe(groomStore, () => {
      maskGeometryDirty.current = 1
    })
  }, [])

  useEffect(() => () => maskMaterial.dispose(), [maskMaterial])
  useEffect(() => () => flowMaterial.dispose(), [flowMaterial])
  useEffect(() => () => scalpMaskGeometry.dispose(), [scalpMaskGeometry])
  useEffect(() => () => scalpFlowGeometry.dispose(), [scalpFlowGeometry])

  // ---------------------------------------------------------------------------
  // DOM-level pointer handling — bypasses R3F entirely for continuous drag
  // tracking that doesn't depend on the cursor being over geometry.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = gl.domElement as HTMLCanvasElement

    const resolveHit = (event: PointerEvent): ResolvedHit | null => {
      const { targetMesh: mesh, activeGroomTool: tool, brushSize: bs } = stateRef.current
      if (!mesh) return null

      const guideHit = GUIDE_EDIT_TOOLS.has(tool)
        ? findGuideUnderBrush(mesh, cameraRef.current, canvas, event.clientX, event.clientY, bs)
        : null
      const guideEffectWorldPos = guideHit?.clone() ?? null

      const withGuideEffect = (
        base: Omit<ResolvedHit, 'effectWorldPos' | 'onGuide'>,
      ): ResolvedHit => ({
        ...base,
        effectWorldPos: guideEffectWorldPos ?? base.worldPos.clone(),
        onGuide: !!guideEffectWorldPos,
      })

      const intersection = raycastMesh(mesh, cameraRef.current, canvas, event.clientX, event.clientY)
      if (intersection?.face) {
        const worldNormal = intersection.face.normal.clone()
          .transformDirection(intersection.object.matrixWorld)
          .normalize()
        return withGuideEffect({
          worldPos: intersection.point.clone(),
          worldNormal,
          triangleIndex: typeof intersection.faceIndex === 'number' ? intersection.faceIndex : null,
          onMesh: true,
          sourceMesh: mesh,
        })
      }

      const fallback = fallbackHitOnBoundingSphere(mesh, cameraRef.current, canvas, event.clientX, event.clientY)
      if (!fallback) return null
      return withGuideEffect({
        worldPos: fallback,
        worldNormal: cameraRef.current.position.clone().sub(fallback).normalize(),
        triangleIndex: null,
        onMesh: false,
        sourceMesh: mesh,
      })
    }

    const hitLocalEffectPoint = (hit: ResolvedHit) => hit.sourceMesh.worldToLocal(hit.effectWorldPos.clone())

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const { isBrushTool: brushy, activeGroomTool: tool, activeScalpPaintChannel: scalpPaintChannel, targetMesh: mesh, brushSize: bs, brushStrength: bst } = stateRef.current
      if (!brushy || !mesh) return

      const hit = resolveHit(event)
      if (!hit) return

      // Block camera + select target mesh
      setIsTransforming(true)
      setSceneSelectionMeshId((mesh.userData.groomMeshId as string | undefined) ?? null)
      try { canvas.setPointerCapture(event.pointerId) } catch { /* ignore */ }
      event.preventDefault()
      event.stopPropagation()

      brushHitRef.current = { worldPos: hit.worldPos, worldNormal: hit.worldNormal }
      const localPoint = hitLocalEffectPoint(hit)

      if (MASK_TOOLS.has(tool)) {
        if (!hit.onMesh) return
        const idx = hit.triangleIndex ?? findClosestTriangle(hit.sourceMesh, localPoint)
        if (idx === null) return
        dragRef.current = {
          pointerId: event.pointerId,
          lastPointLocal: localPoint.clone(),
          lastClientX: event.clientX,
          lastClientY: event.clientY,
          sourceMesh: hit.sourceMesh,
          tool,
          scalpPaintChannel,
        }
        beginGroomDrag()
        const affected = collectTrianglesInBrush(
          hit.sourceMesh, localPoint,
          bs * THREE.MathUtils.lerp(0.45, 1.1, bst),
        )
        const triangles = affected.length ? affected : [idx]
        if (scalpPaintChannel === 'mask') {
          updateScalpMaskTriangles(triangles, tool === 'paint-scalp' ? 'add' : 'remove')
        } else if (scalpPaintChannel !== 'flow') {
          updateScalpMapTriangles(triangles, scalpPaintChannel, tool === 'paint-scalp' ? 'add' : 'remove')
        } else {
          updateScalpFlowTriangles(triangles, new THREE.Vector3(), tool === 'paint-scalp' ? 'add' : 'remove')
        }
        return
      }

      if (tool === 'add-guide') {
        if (!hit.onMesh || hit.triangleIndex === null) return
        updateScalpMaskTriangles([hit.triangleIndex], 'add')
        addGuideAtSurfacePoint(hit.sourceMesh, hit.triangleIndex, localPoint)
        return
      }

      if (tool === 'smooth') {
        beginGroomDrag()
        dragRef.current = {
          pointerId: event.pointerId,
          lastPointLocal: localPoint.clone(),
          lastClientX: event.clientX,
          lastClientY: event.clientY,
          sourceMesh: hit.sourceMesh,
          tool,
          scalpPaintChannel,
        }
        updateGuideTools('smooth', localPoint)
        return
      }

      if (tool === 'cut') {
        beginGroomDrag()
        dragRef.current = {
          pointerId: event.pointerId,
          lastPointLocal: localPoint.clone(),
          lastClientX: event.clientX,
          lastClientY: event.clientY,
          sourceMesh: hit.sourceMesh,
          tool,
          scalpPaintChannel,
        }
        updateGuideTools('cut', localPoint)
        return
      }

      if (tool === 'delete-guide') {
        updateGuideTools('delete', localPoint)
        return
      }

      if (tool === 'comb') {
        dragRef.current = {
          pointerId: event.pointerId,
          lastPointLocal: localPoint.clone(),
          lastClientX: event.clientX,
          lastClientY: event.clientY,
          sourceMesh: hit.sourceMesh,
          tool,
          scalpPaintChannel,
        }
        beginGroomDrag()
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const hit = resolveHit(event)
      if (!hit) return
      brushHitRef.current = { worldPos: hit.worldPos, worldNormal: hit.worldNormal }

      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return

      const { brushSize: bs, brushStrength: bst } = stateRef.current
      const localPoint = hitLocalEffectPoint(hit)

      if (drag.tool === 'paint-scalp' || drag.tool === 'erase-scalp') {
        if (!hit.onMesh) return
        const affected = collectTrianglesInBrush(
          drag.sourceMesh, localPoint,
          bs * THREE.MathUtils.lerp(0.45, 1.1, bst),
        )
        if (affected.length) {
          if (drag.scalpPaintChannel === 'mask') {
            updateScalpMaskTriangles(affected, drag.tool === 'paint-scalp' ? 'add' : 'remove')
          } else if (drag.scalpPaintChannel === 'flow') {
            updateScalpFlowTriangles(
              affected,
              localPoint.clone().sub(drag.lastPointLocal),
              drag.tool === 'paint-scalp' ? 'add' : 'remove',
            )
          } else {
            updateScalpMapTriangles(affected, drag.scalpPaintChannel, drag.tool === 'paint-scalp' ? 'add' : 'remove')
          }
          drag.lastPointLocal.copy(localPoint)
        }
        return
      }

      if (drag.tool === 'smooth') {
        updateGuideTools('smooth', localPoint)
        return
      }

      if (drag.tool === 'cut') {
        updateGuideTools('cut', localPoint)
        return
      }

      if (drag.tool === 'comb') {
        if (!hit.onGuide && !hit.onMesh) {
          drag.lastClientX = event.clientX
          drag.lastClientY = event.clientY
          return
        }
        const delta = pointerDeltaInCameraPlane(
          drag.sourceMesh,
          cameraRef.current,
          canvas,
          drag.lastClientX,
          drag.lastClientY,
          event.clientX,
          event.clientY,
          hit.worldPos,
          bs * 0.75,
        )
        drag.lastPointLocal.copy(localPoint)
        drag.lastClientX = event.clientX
        drag.lastClientY = event.clientY
        updateGuideTools('comb', localPoint, delta)
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      const drag = dragRef.current
      if (drag && event.pointerId === drag.pointerId) {
        dragRef.current = null
        endGroomDrag()
      }
      setIsTransforming(false)
      try { canvas.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
    }

    // Listen on the canvas with capture phase = false; for moves we add a
    // window listener so off-canvas drags still register.
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [gl])

  // Hide the brush cursor when no brush tool is active.
  useEffect(() => {
    if (!isBrushTool) brushHitRef.current = null
  }, [isBrushTool])

  return (
    <group>
      {targetMesh && scalpMaskGeometry && (
        <FollowerGroup source={targetMesh}>
          <mesh geometry={scalpMaskGeometry} renderOrder={59}>
            <primitive object={maskMaterial} attach="material" />
          </mesh>
          <lineSegments geometry={scalpFlowGeometry} renderOrder={60}>
            <primitive object={flowMaterial} attach="material" />
          </lineSegments>
        </FollowerGroup>
      )}

      {isBrushTool && <BrushCursor brushSize={brushSize} hitRef={brushHitRef} />}
    </group>
  )
}
