import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three/webgpu'
import { TransformControls } from '@react-three/drei'
import { setIsTransforming } from '../../../../appState'
import { clothingStore } from '../../state/clothingStore'
import { selectPattern, setPatternPlacement } from '../../state/clothingActions'
import type {
  ClothSimQuality,
  ClothingTransformMode,
  PatternPiece,
  PatternPlacement,
} from '../../state/clothingTypes'
import { useClothSolver } from './useClothSolver'
import { useClothDrag } from './useClothDrag'

type Props = {
  piece: PatternPiece
  placement: PatternPlacement
  selected: boolean
  simRunning: boolean
  simResetKey: number
  simQuality: ClothSimQuality
  transformMode: ClothingTransformMode
  showWireframe: boolean
}

/**
 * A single cloth piece.
 *
 * Architecture:
 *   - Solver positions are ALWAYS world-space; the visual mesh always
 *     receives world-space samples; both meshes live in identity-transform
 *     groups.
 *   - The TransformControls gizmo grabs an invisible "handle" Object3D
 *     parented at the cloth centroid. We translate/rotate solver particles
 *     to follow the handle. This way the gizmo never affects the visual
 *     mesh through a parent transform — only via the solver.
 *   - The handle and the cloth visual are SIBLINGS, never re-parented, so
 *     nothing remounts when selection changes. No snap.
 */
export default function ClothPiece(props: Props) {
  const {
    piece, placement, selected, simRunning, simResetKey, simQuality, transformMode, showWireframe,
  } = props

  const handleRef = useRef<THREE.Object3D>(null)
  const [handleNode, setHandleNode] = useState<THREE.Object3D | null>(null)

  const instance = useClothSolver({
    piece, quality: simQuality, resetKey: simResetKey, running: simRunning, placement,
  })

  const handlers = useClothDrag(instance, () => { clothingStore.simRunning = true })

  // Sync the invisible handle's transform to the placement whenever it
  // changes from the outside (e.g. reset). The solver's own placement-delta
  // hook is what propagates changes into particle positions.
  useEffect(() => {
    const h = handleRef.current
    if (!h) return
    h.position.set(placement.position.x, placement.position.y, placement.position.z)
    h.rotation.set(placement.rotation.x, placement.rotation.y, placement.rotation.z)
    h.updateMatrixWorld(true)
  }, [placement])

  function syncPlacementFromHandle() {
    const h = handleRef.current
    if (!h) return
    setPatternPlacement(piece.id, {
      position: { x: h.position.x, y: h.position.y, z: h.position.z },
      rotation: { x: h.rotation.x, y: h.rotation.y, z: h.rotation.z },
    })
  }

  return (
    <>
      {/* Cloth visual — identity transform; sampled from solver in world space. */}
      <mesh
        geometry={instance.visual.geometry}
        frustumCulled={false}
        onPointerDown={(e) => { selectPattern(piece.id); handlers.onPointerDown(e) }}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
      >
        <meshStandardMaterial
          color={selected ? '#75a4ff' : '#5f8cff'}
          roughness={0.82}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>
      {showWireframe && (
        <mesh geometry={instance.visual.geometry} frustumCulled={false}>
          <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.22} depthWrite={false} />
        </mesh>
      )}
      {/* Invisible gizmo handle, parented in world. */}
      <object3D
        ref={(o) => { handleRef.current = o; setHandleNode(o) }}
        position={[placement.position.x, placement.position.y, placement.position.z]}
        rotation={[placement.rotation.x, placement.rotation.y, placement.rotation.z]}
      />
      {selected && !simRunning && handleNode && (
        <TransformControls
          object={handleNode}
          mode={transformMode}
          size={0.7}
          onMouseDown={() => setIsTransforming(true)}
          onMouseUp={() => { syncPlacementFromHandle(); setIsTransforming(false) }}
          onObjectChange={syncPlacementFromHandle}
        />
      )}
    </>
  )
}
