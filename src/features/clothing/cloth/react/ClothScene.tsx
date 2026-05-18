import { useEffect, useMemo, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import * as THREE from 'three/webgpu'
import { TransformControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { setIsTransforming } from '../../../../appState'
import { clothingStore } from '../../state/clothingStore'
import { ClothingDebugView } from '../../debug/ClothingDebugView'
import { toPatternDocument } from '../../document/legacyAdapter'
import { useGarmentSimulation } from '../../rendering/useGarmentSimulation'
import { selectPattern, setPatternPlacement } from '../../state/clothingActions'
import type { GarmentDocument, PatternPlacement } from '../../state/clothingTypes'

const _raycaster = new THREE.Raycaster()
const _ndc = new THREE.Vector2()
const _hitScratch = new THREE.Vector3()

/** Renders all cloth pieces + optional collision-surface debug viz. */
export default function ClothScene() {
  const { garment, placements, previewOptions, simRunning, simResetKey, simQuality, transformMode, collisionAvatar } = useSnapshot(clothingStore)
  const document = useMemo(
    () => toPatternDocument(garment as unknown as GarmentDocument, placements),
    [garment, placements],
  )
  const { camera, gl } = useThree()
  const grabRef = useRef<{
    panelId: string
    particle: number
    plane: THREE.Plane
    target: THREE.Vector3
    lastTarget: THREE.Vector3
    lastTime: number
    velocity: THREE.Vector3
    pointerId: number
    onMove: (event: PointerEvent) => void
    onRelease: (event: PointerEvent) => void
  } | null>(null)

  const { runtime, renderPanels, colliderSnapshot, grab } = useGarmentSimulation({
    document,
    quality: simQuality,
    resetKey: simResetKey,
    running: simRunning,
    enabled: true,
    collision: {
      mode: collisionAvatar.mode,
      buildRequestId: collisionAvatar.buildRequestId,
      globalInflate: collisionAvatar.globalInflate,
      normalOffset: collisionAvatar.normalOffset,
      perRegionInflate: { ...collisionAvatar.perRegionInflate },
      skinOffset: collisionAvatar.skinOffset,
      garmentThickness: collisionAvatar.garmentThickness,
      meshCellSize: collisionAvatar.meshCellSize,
      meshSampleStride: collisionAvatar.meshSampleStride,
      enableVertexTriangle: collisionAvatar.enableVertexTriangle,
      debugPerf: collisionAvatar.debugPerf,
      includeLowResMesh: previewOptions.showCollisionLowResMesh,
      showCapsules: previewOptions.showCollisionCapsules,
      showEllipsoids: previewOptions.showCollisionEllipsoids,
    },
  })

  useEffect(() => {
    if (simRunning) return
    const state = grabRef.current
    if (!state) return
    const canvas = gl.domElement
    canvas.removeEventListener('pointermove', state.onMove)
    canvas.removeEventListener('pointerup', state.onRelease)
    canvas.removeEventListener('pointercancel', state.onRelease)
    canvas.removeEventListener('lostpointercapture', state.onRelease)
    if (canvas.hasPointerCapture(state.pointerId)) canvas.releasePointerCapture(state.pointerId)
    grab.release()
    grabRef.current = null
  }, [simRunning, gl, grab])

  return (
    <group>
      {renderPanels.map((panel) => {
        const selected = panel.panelId === garment.selectedPatternId
        const docPanel = document.panels[panel.panelId]
        const placement = docPanel?.placement
        if (!placement) return null
        const baseColor = docPanel?.color ?? '#5f8cff'
        const displayColor = selected ? tintForSelection(baseColor) : baseColor
        return (
          <group key={panel.panelId}>
            <mesh
              geometry={panel.geometry}
              frustumCulled={false}
              onPointerDown={(event) => {
                event.stopPropagation()
                if (!simRunning) {
                  selectPattern(panel.panelId)
                  return
                }
                if (grabRef.current) return
                const grabPoint = event.point.clone()
                const particle = grab.nearestParticleInPanel(panel.panelId, grabPoint.x, grabPoint.y, grabPoint.z)
                if (particle < 0) return
                const cameraForward = event.camera.getWorldDirection(new THREE.Vector3())
                const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(cameraForward, grabPoint)
                const canvas = gl.domElement
                canvas.setPointerCapture(event.pointerId)
                const state = {
                  panelId: panel.panelId,
                  particle,
                  plane,
                  target: grabPoint.clone(),
                  lastTarget: grabPoint.clone(),
                  lastTime: performance.now(),
                  velocity: new THREE.Vector3(),
                  pointerId: event.pointerId,
                  onMove: (nativeEvent: PointerEvent) => {
                    if (nativeEvent.pointerId !== state.pointerId) return
                    const rect = canvas.getBoundingClientRect()
                    const ndcX = ((nativeEvent.clientX - rect.left) / rect.width) * 2 - 1
                    const ndcY = -((nativeEvent.clientY - rect.top) / rect.height) * 2 + 1
                    _raycaster.setFromCamera(_ndc.set(ndcX, ndcY), camera)
                    const hit = _raycaster.ray.intersectPlane(state.plane, _hitScratch)
                    if (!hit) return
                    const now = performance.now()
                    const dtMs = Math.max(1, now - state.lastTime)
                    const invDt = 1000 / dtMs
                    state.velocity.set(
                      (hit.x - state.lastTarget.x) * invDt,
                      (hit.y - state.lastTarget.y) * invDt,
                      (hit.z - state.lastTarget.z) * invDt,
                    )
                    state.lastTarget.copy(state.target)
                    state.target.copy(hit)
                    state.lastTime = now
                    grab.update(state.particle, hit.x, hit.y, hit.z, state.velocity.x, state.velocity.y, state.velocity.z)
                  },
                  onRelease: (nativeEvent: PointerEvent) => {
                    if (nativeEvent.pointerId !== state.pointerId) return
                    canvas.removeEventListener('pointermove', state.onMove)
                    canvas.removeEventListener('pointerup', state.onRelease)
                    canvas.removeEventListener('pointercancel', state.onRelease)
                    canvas.removeEventListener('lostpointercapture', state.onRelease)
                    grab.release()
                    grabRef.current = null
                  },
                }
                canvas.addEventListener('pointermove', state.onMove)
                canvas.addEventListener('pointerup', state.onRelease)
                canvas.addEventListener('pointercancel', state.onRelease)
                canvas.addEventListener('lostpointercapture', state.onRelease)
                grabRef.current = state
                grab.start(particle, grabPoint.x, grabPoint.y, grabPoint.z)
              }}
            >
              <meshStandardMaterial
                color={displayColor}
                roughness={0.82}
                metalness={0}
                side={THREE.DoubleSide}
              />
            </mesh>
            {previewOptions.showWireframe && (
              <mesh geometry={panel.geometry} frustumCulled={false}>
                <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.22} depthWrite={false} />
              </mesh>
            )}
            <PanelTransformHandle
              panelId={panel.panelId}
              placement={placement}
              selected={selected}
              simRunning={simRunning}
              transformMode={transformMode}
            />
          </group>
        )
      })}
      {(previewOptions.showTriangulation || previewOptions.showCollisionProxies) && (
        <ClothingDebugView
          runtime={runtime}
          colliderSnapshot={colliderSnapshot}
          showClothDebug={previewOptions.showTriangulation}
          showCollisionProxies={previewOptions.showCollisionProxies}
          showLowResMesh={previewOptions.showCollisionLowResMesh}
        />
      )}
    </group>
  )
}

const _tintColor = new THREE.Color()
function tintForSelection(hex: string) {
  try {
    _tintColor.set(hex)
    const hsl = { h: 0, s: 0, l: 0 }
    _tintColor.getHSL(hsl)
    _tintColor.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), Math.min(1, hsl.l + 0.12))
    return `#${_tintColor.getHexString()}`
  } catch {
    return hex
  }
}

function PanelTransformHandle({
  panelId,
  placement,
  selected,
  simRunning,
  transformMode,
}: {
  panelId: string
  placement: PatternPlacement
  selected: boolean
  simRunning: boolean
  transformMode: 'translate' | 'rotate'
}) {
  const handleRef = useRef<THREE.Object3D>(null)
  const [handleNode, setHandleNode] = useState<THREE.Object3D | null>(null)

  useEffect(() => {
    const handle = handleRef.current
    if (!handle) return
    handle.position.set(placement.position.x, placement.position.y, placement.position.z)
    handle.rotation.set(placement.rotation.x, placement.rotation.y, placement.rotation.z)
    handle.updateMatrixWorld(true)
  }, [placement])

  function syncPlacementFromHandle() {
    const handle = handleRef.current
    if (!handle) return
    setPatternPlacement(panelId, {
      position: { x: handle.position.x, y: handle.position.y, z: handle.position.z },
      rotation: { x: handle.rotation.x, y: handle.rotation.y, z: handle.rotation.z },
    })
  }

  return (
    <>
      <object3D
        ref={(object) => {
          handleRef.current = object
          setHandleNode(object)
        }}
        position={[placement.position.x, placement.position.y, placement.position.z]}
        rotation={[placement.rotation.x, placement.rotation.y, placement.rotation.z]}
      />
      {selected && !simRunning && handleNode && (
        <TransformControls
          object={handleNode}
          mode={transformMode}
          size={0.7}
          onMouseDown={() => setIsTransforming(true)}
          onMouseUp={() => {
            syncPlacementFromHandle()
            setIsTransforming(false)
          }}
          onObjectChange={syncPlacementFromHandle}
        />
      )}
    </>
  )
}
