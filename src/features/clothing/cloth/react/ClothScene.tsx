import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useSnapshot } from 'valtio'
import { clothingStore } from '../../state/clothingStore'
import type { PatternPiece, PatternPlacement } from '../../state/clothingTypes'
import { getBodyCollisionMeshes, refitBodyMeshes, subscribeBodyMesh } from '../body/bodyMeshRegistry'
import ClothPiece from './ClothPiece'

const CLOTH_DEFAULT_Y = 0.72
// Refit the body BVH every Nth frame while sim is running. Refit is O(verts +
// nodes); typical character meshes can be 10k+ verts and several meshes,
// which can easily blow the frame budget if done every tick. Every-other-
// frame is a fine quality/perf tradeoff for cloth that moves much slower
// than the underlying character animation.
const REFIT_EVERY_N_FRAMES = 30

function defaultPlacement(index: number, count: number): PatternPlacement {
  return {
    position: { x: (index - (count - 1) / 2) * 0.08, y: CLOTH_DEFAULT_Y, z: index * 0.018 },
    rotation: { x: 0, y: 0, z: 0 },
  }
}

/** Renders all cloth pieces + optional collision-surface debug viz. */
export default function ClothScene() {
  const { garment, placements, previewOptions, simRunning, simResetKey, simQuality, transformMode } = useSnapshot(clothingStore)
  const pieces = Object.values(garment.patterns) as PatternPiece[]

  // Single global BVH refit loop — runs ONCE per frame regardless of how
  // many cloth pieces are mounted.
  const tickRef = useRef(0)
  useFrame(() => {
    tickRef.current = (tickRef.current + 1) % REFIT_EVERY_N_FRAMES
    if (tickRef.current !== 0) return
    if (!simRunning) return
    refitBodyMeshes()
  })

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
      {previewOptions.showTriangulation && <BodyCollisionDebug />}
    </group>
  )
}

/** Wireframe of the live (refit) collision meshes. Helps verify the BVH
 *  actually matches the posed character. */
function BodyCollisionDebug() {
  const [, force] = useState(0)
  useEffect(() => subscribeBodyMesh(() => force((n) => n + 1)), [])
  const meshes = getBodyCollisionMeshes()
  return (
    <group>
      {meshes.map((m) => (
        <primitive key={m.uuid} object={m}>
          <meshBasicMaterial color="#8be9ff" wireframe transparent opacity={0.25} depthWrite={false} />
        </primitive>
      ))}
    </group>
  )
}
