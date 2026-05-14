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
  updateGuideTools,
  updateScalpMaskTriangles,
} from '../store/groomStore'
import type { GroomTool } from '../core/types'

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
}

const BRUSH_TOOLS = new Set<GroomTool>(['paint-scalp', 'erase-scalp', 'add-guide', 'comb', 'smooth', 'cut', 'delete-guide'])
const MASK_TOOLS = new Set<GroomTool>(['paint-scalp', 'erase-scalp'])
const GUIDE_EDIT_TOOLS = new Set<GroomTool>(['comb', 'smooth', 'cut', 'delete-guide'])

// -----------------------------------------------------------------------------
// Scalp-mask visualization geometry
// -----------------------------------------------------------------------------

function buildScalpMaskGeometry(mesh: THREE.Mesh, triangleIndices: ReadonlyArray<number>) {
  const geometry = mesh.geometry
  if (!(geometry instanceof THREE.BufferGeometry) || !triangleIndices.length) return null

  const positions = new Float32Array(triangleIndices.length * 18)
  const normals = new Float32Array(triangleIndices.length * 18)
  let cursor = 0
  for (const triangleIndex of triangleIndices) {
    const surface = getTriangleSurfaceData(geometry, triangleIndex)
    if (!surface) continue
    const { a, b, c, normal } = surface
    // Write CCW + CW windings so it's visible from either side without DoubleSide.
    const verts = [a, b, c, a, c, b]
    for (const v of verts) {
      positions[cursor]     = v.x
      positions[cursor + 1] = v.y
      positions[cursor + 2] = v.z
      normals[cursor]       = normal.x
      normals[cursor + 1]   = normal.y
      normals[cursor + 2]   = normal.z
      cursor += 3
    }
  }

  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions.subarray(0, cursor), 3))
  result.setAttribute('normal', new THREE.Float32BufferAttribute(normals.subarray(0, cursor), 3))
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
  const { activeGroomAsset, activeGroomTool, brushSize, brushStrength, showScalpMask } = useSnapshot(groomStore)
  const targetMesh = getRegisteredGroomMesh(activeGroomAsset.targetMeshId)
  const { gl, camera } = useThree()

  const brushHitRef = useRef<BrushHit>(null)
  const dragRef = useRef<DragState | null>(null)
  const isBrushTool = BRUSH_TOOLS.has(activeGroomTool)

  // Stable refs for values used inside DOM event handlers so we don't have
  // to re-install listeners on every change.
  const stateRef = useRef({ targetMesh, activeGroomTool, brushSize, brushStrength, isBrushTool })
  const cameraRef = useRef(camera)

  useLayoutEffect(() => {
    stateRef.current = { targetMesh, activeGroomTool, brushSize, brushStrength, isBrushTool }
    cameraRef.current = camera
  }, [targetMesh, activeGroomTool, brushSize, brushStrength, isBrushTool, camera])

  // ---------------------------------------------------------------------------
  // Scalp-mask visualization (rebuilt only when the set actually changes)
  // ---------------------------------------------------------------------------

  const maskMaterial = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      color: '#22c55e',
      transparent: true,
      opacity: 0.35,
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

  // The scalp-mask geometry can grow to thousands of triangles during a paint
  // drag.  Rebuilding it from scratch on every pointermove is what stutters
  // the brush, so we coalesce rebuilds to one per animation frame and keep a
  // single buffer geometry that we resize in place.
  const scalpMaskGeometry = useMemo(() => new THREE.BufferGeometry(), [])
  const maskGeometryDirty = useRef(0)
  const lastMaskTriangleIds = useRef<readonly number[] | null>(null)

  useEffect(() => {
    if (!targetMesh || !showScalpMask) {
      scalpMaskGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
      lastMaskTriangleIds.current = null
      return
    }

    const rebuild = () => {
      const ids = groomStore.activeGroomAsset.scalpMask.selectedTriangleIndices
      if (ids === lastMaskTriangleIds.current) return
      lastMaskTriangleIds.current = ids
      const built = buildScalpMaskGeometry(targetMesh, ids)
      const pos = built?.getAttribute('position')
      const nor = built?.getAttribute('normal')
      if (pos && nor) {
        scalpMaskGeometry.setAttribute('position', pos)
        scalpMaskGeometry.setAttribute('normal', nor)
      } else {
        scalpMaskGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
      }
      built?.dispose()
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
  }, [targetMesh, showScalpMask, scalpMaskGeometry])

  // Listen to the proxy directly (sidesteps the useSnapshot full-render
  // pathway) and flag the mask geometry dirty whenever the triangle set
  // changes — Valtio's subscribe is fine-grained enough that this only fires
  // when the mask actually changes.
  useEffect(() => {
    let lastIds = groomStore.activeGroomAsset.scalpMask.selectedTriangleIndices
    return subscribe(groomStore.activeGroomAsset.scalpMask, () => {
      const ids = groomStore.activeGroomAsset.scalpMask.selectedTriangleIndices
      if (ids !== lastIds) { lastIds = ids; maskGeometryDirty.current = 1 }
    })
  }, [])

  useEffect(() => () => maskMaterial.dispose(), [maskMaterial])
  useEffect(() => () => scalpMaskGeometry.dispose(), [scalpMaskGeometry])

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
      const { isBrushTool: brushy, activeGroomTool: tool, targetMesh: mesh, brushSize: bs, brushStrength: bst } = stateRef.current
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
        }
        beginGroomDrag()
        const affected = collectTrianglesInBrush(
          hit.sourceMesh, localPoint,
          bs * THREE.MathUtils.lerp(0.45, 1.1, bst),
        )
        updateScalpMaskTriangles(affected.length ? affected : [idx], tool === 'paint-scalp' ? 'add' : 'remove')
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
          updateScalpMaskTriangles(affected, drag.tool === 'paint-scalp' ? 'add' : 'remove')
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
        </FollowerGroup>
      )}

      {isBrushTool && <BrushCursor brushSize={brushSize} hitRef={brushHitRef} />}
    </group>
  )
}
