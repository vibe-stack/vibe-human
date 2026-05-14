import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useSnapshot } from 'valtio'
import * as THREE from 'three/webgpu'
import { createHairStrandMaterial, updateHairStrandMaterialUniforms } from '../shaders/hairStrandMaterial'
import { groomStore, getRegisteredGroomMesh } from '../store/groomStore'

// ---------------------------------------------------------------------------
// Ribbon quad geometry
// For each strand segment we emit two triangles (a quad) that the vertex
// shader will expand into a camera-facing ribbon.  Each vertex stores:
//   position – the centre-line point (shader expands it sideways)
//   color    – interpolated root→tip color
//   uv.x     – side: -1 (left) or +1 (right)
//   uv.y     – t along the strand (0 root → 1 tip)
// ---------------------------------------------------------------------------
function buildRibbonGeometry(
  lines: ReadonlyArray<{ points: ReadonlyArray<readonly [number, number, number]> }>,
) {
  const positions: number[] = []
  const tangents: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  let vertexOffset = 0

  for (const line of lines) {
    const pts = line.points
    if (pts.length < 2) continue
    const last = pts.length - 1

    for (let i = 0; i < pts.length; i += 1) {
      const t = i / last
      const px = pts[i][0], py = pts[i][1], pz = pts[i][2]

      // Forward-difference tangent (at the tip we reuse the last segment)
      const j = i < last ? i + 1 : i
      const k = i < last ? i : i - 1
      let tx = pts[j][0] - pts[k][0]
      let ty = pts[j][1] - pts[k][1]
      let tz = pts[j][2] - pts[k][2]
      const tl = Math.hypot(tx, ty, tz) || 1
      tx /= tl; ty /= tl; tz /= tl

      // Two vertices per ring (left, right) sharing position+tangent.
      positions.push(px, py, pz, px, py, pz)
      tangents.push(tx, ty, tz, tx, ty, tz)
      uvs.push(-1, t, 1, t)

      if (i > 0) {
        const bl = vertexOffset + (i - 1) * 2
        const br = vertexOffset + (i - 1) * 2 + 1
        const tl2 = vertexOffset + i * 2
        const tr = vertexOffset + i * 2 + 1
        indices.push(bl, br, tl2, br, tr, tl2)
      }
    }

    vertexOffset += pts.length * 2
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('tangent', new THREE.Float32BufferAttribute(tangents, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  return geo
}

// Guide curves stay as line segments — they're debug overlays, not hair
function buildSegmentGeometry(
  lines: ReadonlyArray<{ points: ReadonlyArray<readonly [number, number, number]> }>,
  rootColor: THREE.Color,
  tipColor: THREE.Color,
) {
  const positions: number[] = []
  const colors: number[] = []

  for (const line of lines) {
    for (let i = 0; i < line.points.length - 1; i += 1) {
      const pA = line.points[i]
      const pB = line.points[i + 1]
      const ta = i / Math.max(1, line.points.length - 1)
      const tb = (i + 1) / Math.max(1, line.points.length - 1)
      const cA = rootColor.clone().lerp(tipColor, ta)
      const cB = rootColor.clone().lerp(tipColor, tb)
      positions.push(...pA, ...pB)
      colors.push(cA.r, cA.g, cA.b, cB.r, cB.g, cB.b)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geo
}

export default function GroomRenderer() {
  const { activeGroomAsset, generatedStrands, showGeneratedStrands, showGuides } = useSnapshot(groomStore)
  const targetMesh = getRegisteredGroomMesh(activeGroomAsset.targetMeshId)
  const transformRef = useRef<THREE.Group>(null)

  const strandMaterial = useMemo(
    () => createHairStrandMaterial(activeGroomAsset.material),
    // Material is built once; all settings flow through uniform updates below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    updateHairStrandMaterialUniforms(strandMaterial, activeGroomAsset.material)
  }, [activeGroomAsset.material, strandMaterial])

  const guideMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, toneMapped: false }),
    [],
  )

  const strandGeometry = useMemo(() => {
    if (!showGeneratedStrands || !generatedStrands.length) return null
    return buildRibbonGeometry(generatedStrands.map((s) => ({ points: s.points })))
  }, [generatedStrands, showGeneratedStrands])

  const guideGeometry = useMemo(() => {
    if (!showGuides || !activeGroomAsset.guides.length) return null
    return buildSegmentGeometry(
      activeGroomAsset.guides.map((g) => ({ points: g.points })),
      new THREE.Color('#7dd3fc'),
      new THREE.Color('#38bdf8'),
    )
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
        <mesh geometry={strandGeometry} renderOrder={60}>
          <primitive object={strandMaterial} attach="material" />
        </mesh>
      )}
      {guideGeometry && (
        <lineSegments geometry={guideGeometry} renderOrder={61}>
          <primitive object={guideMaterial} attach="material" />
        </lineSegments>
      )}
    </group>
  )
}
