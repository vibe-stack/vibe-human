import { useEffect, useMemo, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import * as THREE from 'three/webgpu'
import { TransformControls } from '@react-three/drei'
import { setIsTransforming } from '../../../../appState'
import { clothingStore } from '../../state/clothingStore'
import { ClothingDebugView } from '../../debug/ClothingDebugView'
import { toPatternDocument } from '../../document/legacyAdapter'
import { useGarmentSimulation } from '../../rendering/useGarmentSimulation'
import { selectPattern, setPatternPlacement } from '../../state/clothingActions'
import type { GarmentDocument, PatternPlacement } from '../../state/clothingTypes'

/** Renders all cloth pieces + optional collision-surface debug viz. */
export default function ClothScene() {
  const { garment, placements, previewOptions, simRunning, simResetKey, simQuality, transformMode } = useSnapshot(clothingStore)
  const document = useMemo(
    () => toPatternDocument(garment as unknown as GarmentDocument, placements),
    [garment, placements],
  )
  const { runtime, renderPanels, colliderSnapshot } = useGarmentSimulation({
    document,
    quality: simQuality,
    resetKey: simResetKey,
    running: simRunning,
  })

  return (
    <group>
      {renderPanels.map((panel) => {
        const selected = panel.panelId === garment.selectedPatternId
        const placement = document.panels[panel.panelId]?.placement
        if (!placement) return null
        return (
          <group key={panel.panelId}>
            <mesh
              geometry={panel.geometry}
              frustumCulled={false}
              onPointerDown={(event) => {
                event.stopPropagation()
                selectPattern(panel.panelId)
              }}
            >
              <meshStandardMaterial
                color={selected ? '#75a4ff' : '#5f8cff'}
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
      {previewOptions.showTriangulation && <ClothingDebugView runtime={runtime} colliderSnapshot={colliderSnapshot} />}
    </group>
  )
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
