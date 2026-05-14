import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useSnapshot } from 'valtio'
import * as THREE from 'three/webgpu'
import { createHairStrandMaterial, updateHairStrandMaterialUniforms, type HairMaterialOptions } from '../shaders/hairStrandMaterial'
import { groomStore, getRegisteredGroomMesh, registerHairMaterialForGroom, unregisterHairMaterialForGroom } from '../store/groomStore'
import type { GeneratedStrand } from '../core/types'

const CARD_MATERIAL_OPTIONS: HairMaterialOptions = {
  widthScale: 14,
  opacityScale: 1.12,
  cardPattern: 1,
  densityShadowScale: 1.35,
  flyawayOpacityBoost: 0,
}

const DETAIL_MATERIAL_OPTIONS: HairMaterialOptions = {
  widthScale: 1,
  opacityScale: 1,
  cardPattern: 0,
  densityShadowScale: 0.9,
  flyawayOpacityBoost: 0.2,
}

// ---------------------------------------------------------------------------
// Ribbon quad geometry
// For each strand segment we emit two triangles (a quad) that the vertex
// shader will expand into a camera-facing ribbon.  Each vertex stores:
//   position – the centre-line point (shader expands it sideways)
//   uv.x     – side: -1 (left) or +1 (right)
//   uv.y     – t along the strand (0 root → 1 tip)
//   rootDensity / flyawayMask / lengthScale – groom attributes for shading
// ---------------------------------------------------------------------------
function buildRibbonGeometry(
  lines: ReadonlyArray<GeneratedStrand>,
) {
  // Pre-size the typed arrays.  Each strand contributes (pts*2) vertices and
  // (pts-1)*6 indices.
  let vertCount = 0
  let idxCount = 0
  for (const line of lines) {
    if (line.points.length < 2) continue
    vertCount += line.points.length * 2
    idxCount += (line.points.length - 1) * 6
  }

  const positions = new Float32Array(vertCount * 3)
  const tangents = new Float32Array(vertCount * 3)
  const uvs = new Float32Array(vertCount * 2)
  const seeds = new Float32Array(vertCount)
  const rootDensities = new Float32Array(vertCount)
  const flyawayMasks = new Float32Array(vertCount)
  const lengthScales = new Float32Array(vertCount)
  const indices = new Uint32Array(idxCount)

  let vWrite = 0
  let iWrite = 0
  let vertexOffset = 0

  for (const line of lines) {
    const pts = line.points
    if (pts.length < 2) continue
    const last = pts.length - 1
    const seed = line.random
    const rootDensity = line.rootDensity
    const flyawayMask = line.flyawayMask
    const lengthScale = line.lengthScale

    for (let i = 0; i < pts.length; i += 1) {
      const t = i / last
      const px = pts[i][0], py = pts[i][1], pz = pts[i][2]

      // Forward-difference tangent (at the tip we reuse the last segment).
      const j = i < last ? i + 1 : i
      const k = i < last ? i : i - 1
      let tx = pts[j][0] - pts[k][0]
      let ty = pts[j][1] - pts[k][1]
      let tz = pts[j][2] - pts[k][2]
      const tl = Math.hypot(tx, ty, tz) || 1
      tx /= tl; ty /= tl; tz /= tl

      // Two vertices per ring (left=-1, right=+1) sharing pos/tangent/seed.
      positions[vWrite]     = px; positions[vWrite + 1] = py; positions[vWrite + 2] = pz
      positions[vWrite + 3] = px; positions[vWrite + 4] = py; positions[vWrite + 5] = pz
      tangents[vWrite]      = tx; tangents[vWrite + 1]  = ty; tangents[vWrite + 2]  = tz
      tangents[vWrite + 3]  = tx; tangents[vWrite + 4]  = ty; tangents[vWrite + 5]  = tz
      uvs[(vWrite / 3) * 2]     = -1; uvs[(vWrite / 3) * 2 + 1] = t
      uvs[(vWrite / 3) * 2 + 2] =  1; uvs[(vWrite / 3) * 2 + 3] = t
      seeds[vWrite / 3]     = seed
      seeds[vWrite / 3 + 1] = seed
      rootDensities[vWrite / 3]     = rootDensity
      rootDensities[vWrite / 3 + 1] = rootDensity
      flyawayMasks[vWrite / 3]     = flyawayMask
      flyawayMasks[vWrite / 3 + 1] = flyawayMask
      lengthScales[vWrite / 3]     = lengthScale
      lengthScales[vWrite / 3 + 1] = lengthScale
      vWrite += 6

      if (i > 0) {
        const bl = vertexOffset + (i - 1) * 2
        const br = vertexOffset + (i - 1) * 2 + 1
        const tl2 = vertexOffset + i * 2
        const tr = vertexOffset + i * 2 + 1
        indices[iWrite]     = bl; indices[iWrite + 1] = br; indices[iWrite + 2] = tl2
        indices[iWrite + 3] = br; indices[iWrite + 4] = tr; indices[iWrite + 5] = tl2
        iWrite += 6
      }
    }
    vertexOffset += pts.length * 2
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('tangent', new THREE.BufferAttribute(tangents, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('strandSeed', new THREE.BufferAttribute(seeds, 1))
  geo.setAttribute('rootDensity', new THREE.BufferAttribute(rootDensities, 1))
  geo.setAttribute('flyawayMask', new THREE.BufferAttribute(flyawayMasks, 1))
  geo.setAttribute('lengthScale', new THREE.BufferAttribute(lengthScales, 1))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
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

function selectVolumeCards(strands: readonly GeneratedStrand[], guideCount: number) {
  if (!strands.length) return []

  const targetCount = Math.min(
    1200,
    Math.max(96, guideCount * 8, Math.round(Math.sqrt(strands.length) * 5)),
  )
  const candidates = strands
    .filter((strand) => strand.rootDensity > 0.42 && strand.flyawayMask < 0.72)
    .sort((a, b) => {
      const scoreA = a.rootDensity * 2 + a.lengthScale - a.flyawayMask
      const scoreB = b.rootDensity * 2 + b.lengthScale - b.flyawayMask
      return scoreB - scoreA
    })
  const source = candidates.length >= 12 ? candidates : [...strands]
  const step = Math.max(1, Math.floor(source.length / targetCount))
  const cards: GeneratedStrand[] = []

  for (let index = 0; index < source.length && cards.length < targetCount; index += step) {
    cards.push(source[index])
  }

  return cards
}

function selectDetailStrands(strands: readonly GeneratedStrand[]) {
  if (strands.length <= 40_000) return strands

  const stride = strands.length > 70_000 ? 3 : 2
  const flyawayThreshold = 0.86
  return strands.filter((strand, index) => (
    index % stride === 0 ||
    strand.random > flyawayThreshold ||
    strand.flyawayMask > 0.68 ||
    strand.rootDensity < 0.38
  ))
}

export default function GroomRenderer() {
  const { activeGroomAsset, generatedStrands, showGeneratedStrands, showGuides } = useSnapshot(groomStore)
  const targetMesh = getRegisteredGroomMesh(activeGroomAsset.targetMeshId)
  const transformRef = useRef<THREE.Group>(null)

  const strandMaterial = useMemo(
    () => createHairStrandMaterial(activeGroomAsset.material, DETAIL_MATERIAL_OPTIONS),
    // Material is built once; all settings flow through uniform updates below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const cardMaterial = useMemo(() => {
    const mat = createHairStrandMaterial(activeGroomAsset.material, CARD_MATERIAL_OPTIONS)
    mat.name = 'HairVolumeCardMaterial'
    mat.alphaTest = 0.38
    mat.depthWrite = false
    return mat
    // Material is built once; all settings flow through uniform updates below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    updateHairStrandMaterialUniforms(strandMaterial, activeGroomAsset.material, DETAIL_MATERIAL_OPTIONS)
    updateHairStrandMaterialUniforms(cardMaterial, activeGroomAsset.material, CARD_MATERIAL_OPTIONS)
  }, [activeGroomAsset.material, strandMaterial, cardMaterial])

  const guideMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, toneMapped: false }),
    [],
  )

  const volumeCardGeometry = useMemo(() => {
    if (!showGeneratedStrands || !generatedStrands.length) return null
    const cards = selectVolumeCards(generatedStrands as GeneratedStrand[], activeGroomAsset.guides.length)
    if (!cards.length) return null
    return buildRibbonGeometry(cards)
  }, [activeGroomAsset.guides.length, generatedStrands, showGeneratedStrands])

  const strandGeometry = useMemo(() => {
    if (!showGeneratedStrands || !generatedStrands.length) return null
    const strands = selectDetailStrands(generatedStrands as GeneratedStrand[])
    return buildRibbonGeometry(strands)
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

  useEffect(() => {
    registerHairMaterialForGroom(strandMaterial)
    registerHairMaterialForGroom(cardMaterial)
    return () => {
      unregisterHairMaterialForGroom(strandMaterial)
      unregisterHairMaterialForGroom(cardMaterial)
    }
  }, [strandMaterial, cardMaterial])
  useEffect(() => () => strandMaterial.dispose(), [strandMaterial])
  useEffect(() => () => cardMaterial.dispose(), [cardMaterial])
  useEffect(() => () => guideMaterial.dispose(), [guideMaterial])
  useEffect(() => () => volumeCardGeometry?.dispose(), [volumeCardGeometry])
  useEffect(() => () => strandGeometry?.dispose(), [strandGeometry])
  useEffect(() => () => guideGeometry?.dispose(), [guideGeometry])

  if (!targetMesh || (!volumeCardGeometry && !strandGeometry && !guideGeometry)) return null

  return (
    <group ref={transformRef} matrixAutoUpdate={false}>
      {volumeCardGeometry && (
        <mesh geometry={volumeCardGeometry} renderOrder={58}>
          <primitive object={cardMaterial} attach="material" />
        </mesh>
      )}
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
