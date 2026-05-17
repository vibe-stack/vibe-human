import { useEffect, useRef } from 'react'
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

/** A single cloth piece: solver + mesh + gizmo. Small on purpose. */
export default function ClothPiece(props: Props) {
  const { piece, placement, selected, simRunning, simResetKey, simQuality, transformMode, showWireframe } = props
  const groupRef = useRef<THREE.Group>(null)

  const instance = useClothSolver({
    piece, quality: simQuality, resetKey: simResetKey, running: simRunning, placement,
  })

  const handlers = useClothDrag(instance, () => { clothingStore.simRunning = true })

  // Visual mesh is rendered in world space (sampleSimAtUv writes world
  // positions every frame from the solver, which itself stores world
  // positions). Therefore the group transform is identity during sim —
  // it only carries the gizmo position before sim runs.
  useEffect(() => {
    const g = groupRef.current
    if (!g) return
    if (simRunning) {
      g.position.set(0, 0, 0)
      g.rotation.set(0, 0, 0)
    } else {
      g.position.set(placement.position.x, placement.position.y, placement.position.z)
      g.rotation.set(placement.rotation.x, placement.rotation.y, placement.rotation.z)
    }
  }, [simRunning, placement])

  function syncPlacementFromGroup() {
    const g = groupRef.current
    if (!g) return
    setPatternPlacement(piece.id, {
      position: { x: g.position.x, y: g.position.y, z: g.position.z },
      rotation: { x: g.rotation.x, y: g.rotation.y, z: g.rotation.z },
    })
  }

  const mesh = (
    <group ref={groupRef}>
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
    </group>
  )

  if (selected && !simRunning) {
    return (
      <TransformControls
        mode={transformMode}
        size={0.7}
        onMouseDown={() => setIsTransforming(true)}
        onMouseUp={() => { syncPlacementFromGroup(); setIsTransforming(false) }}
        onObjectChange={syncPlacementFromGroup}
      >
        {mesh}
      </TransformControls>
    )
  }
  return mesh
}
