import { useSnapshot } from 'valtio'
import { clothingStore } from '../../state/clothingStore'
import type { PatternPiece, PatternPlacement } from '../../state/clothingTypes'
import { HEAD, SHOULDER, TORSO } from '../body/bodyColliders'
import ClothPiece from './ClothPiece'

const CLOTH_DEFAULT_Y = 0.72

function defaultPlacement(index: number, count: number): PatternPlacement {
  return {
    position: { x: (index - (count - 1) / 2) * 0.08, y: CLOTH_DEFAULT_Y, z: index * 0.018 },
    rotation: { x: 0, y: 0, z: 0 },
  }
}

/**
 * Renders all cloth pieces + optional body collider debug viz. Tiny shell —
 * one ClothPiece per pattern.
 */
export default function ClothScene() {
  const { garment, placements, previewOptions, simRunning, simResetKey, simQuality, transformMode } = useSnapshot(clothingStore)
  const pieces = Object.values(garment.patterns) as PatternPiece[]

  return (
    <group>
      {pieces.map((piece, idx) => {
        const placement = (placements[piece.id] as PatternPlacement | undefined) ?? defaultPlacement(idx, pieces.length)
        return (
          <ClothPiece
            key={piece.id}
            piece={piece}
            placement={placement}
            selected={piece.id === garment.selectedPatternId}
            simRunning={simRunning}
            simResetKey={simResetKey}
            simQuality={simQuality}
            transformMode={transformMode}
            showWireframe={previewOptions.showWireframe}
          />
        )
      })}
      {previewOptions.showTriangulation && <BodyDebug />}
    </group>
  )
}

function BodyDebug() {
  return (
    <group>
      <mesh position={[HEAD.x, HEAD.y, HEAD.z]}>
        <sphereGeometry args={[HEAD.r, 24, 12]} />
        <meshBasicMaterial color="#8be9ff" wireframe transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh position={[(SHOULDER.ax + SHOULDER.bx) / 2, (SHOULDER.ay + SHOULDER.by) / 2, (SHOULDER.az + SHOULDER.bz) / 2]} rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[SHOULDER.r, Math.abs(SHOULDER.bx - SHOULDER.ax), 4, 12]} />
        <meshBasicMaterial color="#8be9ff" wireframe transparent opacity={0.18} depthWrite={false} />
      </mesh>
      <mesh position={[(TORSO.ax + TORSO.bx) / 2, (TORSO.ay + TORSO.by) / 2, (TORSO.az + TORSO.bz) / 2]}>
        <capsuleGeometry args={[TORSO.r, Math.abs(TORSO.by - TORSO.ay), 4, 12]} />
        <meshBasicMaterial color="#8be9ff" wireframe transparent opacity={0.16} depthWrite={false} />
      </mesh>
    </group>
  )
}
