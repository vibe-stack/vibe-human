import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useSnapshot } from 'valtio'
import * as THREE from 'three'
import { createHairStrandMaterial } from '../shaders/hairStrandMaterial'
import { groomStore, getRegisteredGroomMesh } from '../store/groomStore'

function hexToColor(hex: string) {
  return new THREE.Color(hex)
}

function buildSegmentGeometry(
  lines: ReadonlyArray<{ points: ReadonlyArray<readonly [number, number, number]> }>,
  rootColor: THREE.Color,
  tipColor: THREE.Color,
) {
  const positions: number[] = []
  const colors: number[] = []

  for (const line of lines) {
    for (let index = 0; index < line.points.length - 1; index += 1) {
      const pointA = line.points[index]
      const pointB = line.points[index + 1]
      const ta = index / Math.max(1, line.points.length - 1)
      const tb = (index + 1) / Math.max(1, line.points.length - 1)
      const colorA = rootColor.clone().lerp(tipColor, ta)
      const colorB = rootColor.clone().lerp(tipColor, tb)

      positions.push(...pointA, ...pointB)
      colors.push(colorA.r, colorA.g, colorA.b, colorB.r, colorB.g, colorB.b)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}

export default function GroomRenderer() {
  const { activeGroomAsset, generatedStrands, showGeneratedStrands, showGuides } = useSnapshot(groomStore)
  const targetMesh = getRegisteredGroomMesh(activeGroomAsset.targetMeshId)
  const transformRef = useRef<THREE.Group>(null)
  const strandMaterial = useMemo(
    () => createHairStrandMaterial(activeGroomAsset.material),
    [activeGroomAsset.material],
  )
  const guideMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.92, toneMapped: false }),
    [],
  )

  const strandGeometry = useMemo(() => {
    if (!showGeneratedStrands || !generatedStrands.length) return null
    return buildSegmentGeometry(generatedStrands.map((strand) => ({ points: strand.points })), hexToColor(activeGroomAsset.material.rootColor), hexToColor(activeGroomAsset.material.tipColor))
  }, [activeGroomAsset.material.rootColor, activeGroomAsset.material.tipColor, generatedStrands, showGeneratedStrands])

  const guideGeometry = useMemo(() => {
    if (!showGuides || !activeGroomAsset.guides.length) return null
    return buildSegmentGeometry(activeGroomAsset.guides.map((guide) => ({ points: guide.points })), new THREE.Color('#7dd3fc'), new THREE.Color('#38bdf8'))
  }, [activeGroomAsset.guides, showGuides])

  useFrame(() => {
    if (!transformRef.current || !targetMesh) return
    transformRef.current.matrix.copy(targetMesh.matrixWorld)
  })

  useEffect(() => () => strandMaterial.dispose(), [strandMaterial])
  useEffect(() => () => guideMaterial.dispose(), [guideMaterial])
  useEffect(() => () => strandGeometry?.dispose(), [strandGeometry])
  useEffect(() => () => guideGeometry?.dispose(), [guideGeometry])

  if (!targetMesh || (!strandGeometry && !guideGeometry)) return null

  return (
    <group ref={transformRef} matrixAutoUpdate={false}>
      {strandGeometry && (
        <lineSegments geometry={strandGeometry} renderOrder={60}>
          <primitive object={strandMaterial} attach="material" />
        </lineSegments>
      )}
      {guideGeometry && (
        <lineSegments geometry={guideGeometry} renderOrder={61}>
          <primitive object={guideMaterial} attach="material" />
        </lineSegments>
      )}
    </group>
  )
}
