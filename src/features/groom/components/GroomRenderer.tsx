import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useSnapshot } from 'valtio'
import * as THREE from 'three/webgpu'
import { createHairStrandMaterial, updateHairStrandMaterialUniforms, type HairMaterialOptions } from '../shaders/hairStrandMaterial'
import { groomStore, getRegisteredGroomMesh, registerHairMaterialForGroom, unregisterHairMaterialForGroom } from '../store/groomStore'
import type { GeneratedStrand } from '../core/types'
import { buildHairCardMesh } from '../core/hairCardBuilder'
import { setLatestHairCardMesh } from '../core/hairCardExportState'

// Gap-filler cards rendered *behind* strands — subtle, semi-transparent.
const CARD_MATERIAL_OPTIONS: HairMaterialOptions = {
  widthScale: 1,
  opacityScale: 0.82,
  cardPattern: 1,
  geometryRibbon: 1,
  alphaHashStrength: 0.25,
  edgeSoftness: 1.85,
  rootFillScale: 0.74,
  densityShadowScale: 1.45,
  flyawayOpacityBoost: 0,
}


const DETAIL_MATERIAL_OPTIONS: HairMaterialOptions = {
  widthScale: 1,
  opacityScale: 1,
  cardPattern: 0,
  geometryRibbon: 0,
  alphaHashStrength: 1,
  edgeSoftness: 4,
  rootFillScale: 0,
  densityShadowScale: 0.9,
  flyawayOpacityBoost: 0,
}

const FLYAWAY_MATERIAL_OPTIONS: HairMaterialOptions = {
  widthScale: 0.8,
  opacityScale: 0.42,
  cardPattern: 0,
  geometryRibbon: 0,
  alphaHashStrength: 0.3,
  edgeSoftness: 2.7,
  rootFillScale: 0,
  densityShadowScale: 0.55,
  flyawayOpacityBoost: 0.32,
}

// ---------------------------------------------------------------------------
// Ribbon quad geometry
// For each strand segment we emit two triangles (a quad) that the vertex
// shader will expand into a camera-facing ribbon.  Each vertex stores:
//   position – the centre-line point (shader expands it sideways)
//   uv.x     – side: -1 (left) or +1 (right)
//   uv.y     – t along the strand (0 root → 1 tip)
//   rootDensity / rootOcclusion / flyawayMask / lengthScale – groom attributes for shading
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
  const rootOcclusions = new Float32Array(vertCount)
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
    const rootOcclusion = line.rootOcclusion ?? rootDensity
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
      rootOcclusions[vWrite / 3]     = rootOcclusion
      rootOcclusions[vWrite / 3 + 1] = rootOcclusion
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
  geo.setAttribute('rootOcclusion', new THREE.BufferAttribute(rootOcclusions, 1))
  geo.setAttribute('flyawayMask', new THREE.BufferAttribute(flyawayMasks, 1))
  geo.setAttribute('lengthScale', new THREE.BufferAttribute(lengthScales, 1))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  return geo
}

type CardGroup = {
  strands: GeneratedStrand[]
  score: number
}

function strandDensityScore(strand: GeneratedStrand) {
  return Math.max(strand.rootDensity, strand.rootOcclusion ?? 0)
}

function strandIsFlyaway(strand: GeneratedStrand) {
  return strand.flyawayMask > 0.68 || strand.random > 0.86
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(edge1 - edge0, 1e-6), 0, 1)
  return t * t * (3 - 2 * t)
}

function buildCardGroups(strands: readonly GeneratedStrand[], guideCount: number, complexity = 1, primaryMode = false): CardGroup[] {
  if (!strands.length) return []

  const grouped = new Map<number, GeneratedStrand[]>()
  for (const strand of strands) {
    if (strand.points.length < 2 || strandIsFlyaway(strand)) continue
    // In primary card mode include all strands so the full scalp is covered,
    // not just high-density zones.
    if (!primaryMode && strandDensityScore(strand) < 0.34) continue
    const group = grouped.get(strand.clumpId)
    if (group) group.push(strand)
    else grouped.set(strand.clumpId, [strand])
  }

  const groups: CardGroup[] = []
  for (const groupStrands of grouped.values()) {
    if (groupStrands.length < 2) continue
    let score = 0
    for (const strand of groupStrands) {
      score += strandDensityScore(strand) * 1.8 + strand.lengthScale * 0.5 - strand.flyawayMask
    }
    groups.push({ strands: groupStrands, score: score / groupStrands.length + Math.min(groupStrands.length, 18) * 0.045 })
  }

  // At complexity=1 we match the full groom density; at complexity=0.05 we
  // merge everything down to ~guideCount cards (one per guide area).
  const maxFull = Math.min(
    520,
    Math.max(48, guideCount * 4, Math.round(Math.sqrt(strands.length) * 2.2)),
  )
  const minCards = Math.max(guideCount, 8)
  const targetCount = Math.round(minCards + (maxFull - minCards) * complexity)

  return groups
    .sort((a, b) => b.score - a.score)
    .slice(0, targetCount)
}

function buildClumpCardGeometry(cardGroups: readonly CardGroup[], clumpRadius: number, primaryMode = false) {
  const validGroups = cardGroups.filter((group) => group.strands.some((strand) => strand.points.length >= 2))
  let vertCount = 0
  let idxCount = 0

  for (const group of validGroups) {
    const pointCount = Math.min(...group.strands.map((strand) => strand.points.length))
    if (pointCount < 2) continue
    vertCount += pointCount * 2
    idxCount += (pointCount - 1) * 6
  }

  const positions = new Float32Array(vertCount * 3)
  const tangents = new Float32Array(vertCount * 3)
  const uvs = new Float32Array(vertCount * 2)
  const seeds = new Float32Array(vertCount)
  const rootDensities = new Float32Array(vertCount)
  const rootOcclusions = new Float32Array(vertCount)
  const flyawayMasks = new Float32Array(vertCount)
  const lengthScales = new Float32Array(vertCount)
  const indices = new Uint32Array(idxCount)

  let vWrite = 0
  let iWrite = 0
  let vertexOffset = 0
  const center = new THREE.Vector3()
  const prevCenter = new THREE.Vector3()
  const nextCenter = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const root = new THREE.Vector3()
  const rootTangent = new THREE.Vector3()
  const side = new THREE.Vector3()
  const candidateSide = new THREE.Vector3()
  const point = new THREE.Vector3()
  const helper = new THREE.Vector3()

  for (const group of validGroups) {
    const source = [...group.strands]
      .sort((a, b) => strandDensityScore(b) - strandDensityScore(a))
      .slice(0, primaryMode ? 24 : 14)
    const pointCount = Math.min(...source.map((strand) => strand.points.length))
    if (pointCount < 2) continue

    let seed = 0
    let rootDensity = 0
    let rootOcclusion = 0
    let flyawayMask = 0
    let lengthScale = 0
    for (const strand of source) {
      seed += strand.random
      rootDensity += strand.rootDensity
      rootOcclusion += strand.rootOcclusion ?? strand.rootDensity
      flyawayMask += strand.flyawayMask
      lengthScale += strand.lengthScale
    }
    seed /= source.length
    rootDensity /= source.length
    rootOcclusion /= source.length
    flyawayMask /= source.length
    lengthScale /= source.length

    root.set(0, 0, 0)
    nextCenter.set(0, 0, 0)
    for (const strand of source) {
      root.add(point.fromArray(strand.points[0]))
      nextCenter.add(point.fromArray(strand.points[1]))
    }
    root.multiplyScalar(1 / source.length)
    nextCenter.multiplyScalar(1 / source.length)
    rootTangent.copy(nextCenter).sub(root).normalize()
    if (rootTangent.lengthSq() <= 1e-8) rootTangent.set(0, 1, 0)

    side.set(0, 0, 0)
    let rootSpread = 0
    for (const strand of source) {
      candidateSide.fromArray(strand.points[0]).sub(root)
      candidateSide.addScaledVector(rootTangent, -candidateSide.dot(rootTangent))
      const spread = candidateSide.length()
      rootSpread += spread
      if (spread > 1e-5) side.add(candidateSide.normalize().multiplyScalar(spread))
    }
    rootSpread /= source.length
    if (side.lengthSq() <= 1e-10) {
      helper.set(Math.abs(rootTangent.y) > 0.92 ? 1 : 0, Math.abs(rootTangent.y) > 0.92 ? 0 : 1, 0)
      side.crossVectors(rootTangent, helper)
    }
    side.normalize()

    // In primary card mode the width represents actual strand coverage, not a
    // gap-filler halo. Use the real spread with a tight cap so cards abut
    // rather than overlap. In gap-filler mode we keep the generous multipliers.
    const width = primaryMode
      ? THREE.MathUtils.clamp(
          Math.max(rootSpread * 2.0, source[0].widthRoot * 6, clumpRadius * 1.2),
          0.002,
          0.022,
        )
      : THREE.MathUtils.clamp(
          Math.max(clumpRadius * 1.85, rootSpread * 3.2, source[0].widthRoot * 9),
          0.004,
          0.055,
        )
    const last = pointCount - 1

    for (let i = 0; i < pointCount; i += 1) {
      const t = i / last
      center.set(0, 0, 0)
      prevCenter.set(0, 0, 0)
      nextCenter.set(0, 0, 0)
      const prevIndex = Math.max(0, i - 1)
      const nextIndex = Math.min(last, i + 1)

      for (const strand of source) {
        center.add(point.fromArray(strand.points[i]))
        prevCenter.add(point.fromArray(strand.points[prevIndex]))
        nextCenter.add(point.fromArray(strand.points[nextIndex]))
      }
      center.multiplyScalar(1 / source.length)
      prevCenter.multiplyScalar(1 / source.length)
      nextCenter.multiplyScalar(1 / source.length)
      tangent.copy(nextCenter).sub(prevCenter).normalize()
      if (tangent.lengthSq() <= 1e-8) tangent.copy(rootTangent)

      candidateSide.copy(side).addScaledVector(tangent, -side.dot(tangent))
      if (candidateSide.lengthSq() <= 1e-10) candidateSide.crossVectors(tangent, rootTangent)
      if (candidateSide.lengthSq() <= 1e-10) {
        helper.set(Math.abs(tangent.y) > 0.92 ? 1 : 0, Math.abs(tangent.y) > 0.92 ? 0 : 1, 0)
        candidateSide.crossVectors(tangent, helper)
      }
      candidateSide.normalize()

      const rootTaper = smoothstep(0, 0.18, t)
      const tipTaper = 1 - smoothstep(0.68, 1, t) * 0.86
      const profileWidth = width * (0.22 + rootTaper * 0.78) * tipTaper
      const halfWidth = profileWidth * 0.5
      const left = center.clone().addScaledVector(candidateSide, -halfWidth)
      const right = center.clone().addScaledVector(candidateSide, halfWidth)

      positions[vWrite]     = left.x;  positions[vWrite + 1] = left.y;  positions[vWrite + 2] = left.z
      positions[vWrite + 3] = right.x; positions[vWrite + 4] = right.y; positions[vWrite + 5] = right.z
      tangents[vWrite]      = tangent.x; tangents[vWrite + 1] = tangent.y; tangents[vWrite + 2] = tangent.z
      tangents[vWrite + 3]  = tangent.x; tangents[vWrite + 4] = tangent.y; tangents[vWrite + 5] = tangent.z
      uvs[(vWrite / 3) * 2]     = -1; uvs[(vWrite / 3) * 2 + 1] = t
      uvs[(vWrite / 3) * 2 + 2] =  1; uvs[(vWrite / 3) * 2 + 3] = t
      seeds[vWrite / 3] = seed
      seeds[vWrite / 3 + 1] = seed
      rootDensities[vWrite / 3] = rootDensity
      rootDensities[vWrite / 3 + 1] = rootDensity
      rootOcclusions[vWrite / 3] = rootOcclusion
      rootOcclusions[vWrite / 3 + 1] = rootOcclusion
      flyawayMasks[vWrite / 3] = flyawayMask
      flyawayMasks[vWrite / 3 + 1] = flyawayMask
      lengthScales[vWrite / 3] = lengthScale
      lengthScales[vWrite / 3 + 1] = lengthScale
      vWrite += 6

      if (i > 0) {
        const bl = vertexOffset + (i - 1) * 2
        const br = vertexOffset + (i - 1) * 2 + 1
        const tl = vertexOffset + i * 2
        const tr = vertexOffset + i * 2 + 1
        indices[iWrite] = bl; indices[iWrite + 1] = br; indices[iWrite + 2] = tl
        indices[iWrite + 3] = br; indices[iWrite + 4] = tr; indices[iWrite + 5] = tl
        iWrite += 6
      }
    }

    vertexOffset += pointCount * 2
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('tangent', new THREE.BufferAttribute(tangents, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('strandSeed', new THREE.BufferAttribute(seeds, 1))
  geo.setAttribute('rootDensity', new THREE.BufferAttribute(rootDensities, 1))
  geo.setAttribute('rootOcclusion', new THREE.BufferAttribute(rootOcclusions, 1))
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

function selectBodyStrands(strands: readonly GeneratedStrand[]) {
  const body = strands.filter((strand) => !strandIsFlyaway(strand))
  if (body.length <= 40_000) return body

  const stride = body.length > 70_000 ? 3 : 2
  return body.filter((strand, index) => (
    index % stride === 0 ||
    strandDensityScore(strand) < 0.38
  ))
}

function selectFlyawayStrands(strands: readonly GeneratedStrand[]) {
  const flyaways = strands.filter(strandIsFlyaway)
  const maxFlyaways = 10_000
  if (flyaways.length <= maxFlyaways) return flyaways

  const stride = Math.ceil(flyaways.length / maxFlyaways)
  return flyaways.filter((strand, index) => (
    index % stride === 0 ||
    strand.flyawayMask > 0.82
  ))
}

export default function GroomRenderer() {
  const { activeGroomAsset, generatedStrands, showGeneratedStrands, showGuides, renderMode, cardComplexity } = useSnapshot(groomStore)
  const targetMesh = getRegisteredGroomMesh(activeGroomAsset.targetMeshId)
  const transformRef = useRef<THREE.Group>(null)
  const isCardMode = renderMode === 'hair-cards'

  const strandMaterial = useMemo(
    () => createHairStrandMaterial(activeGroomAsset.material, DETAIL_MATERIAL_OPTIONS),
    // Material is built once; all settings flow through uniform updates below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const flyawayMaterial = useMemo(() => {
    const mat = createHairStrandMaterial(activeGroomAsset.material, FLYAWAY_MATERIAL_OPTIONS)
    mat.name = 'HairFlyawayMaterial'
    mat.transparent = true
    mat.alphaTest = 0.03
    mat.depthWrite = false
    return mat
    // Material is built once; all settings flow through uniform updates below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const cardMaterial = useMemo(() => {
    const mat = createHairStrandMaterial(activeGroomAsset.material, CARD_MATERIAL_OPTIONS)
    mat.name = 'HairVolumeCardMaterial'
    mat.transparent = true
    mat.alphaTest = 0.025
    mat.depthWrite = false
    return mat
    // Material is built once; all settings flow through uniform updates below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    updateHairStrandMaterialUniforms(strandMaterial, activeGroomAsset.material, DETAIL_MATERIAL_OPTIONS)
    updateHairStrandMaterialUniforms(flyawayMaterial, activeGroomAsset.material, FLYAWAY_MATERIAL_OPTIONS)
    updateHairStrandMaterialUniforms(cardMaterial, activeGroomAsset.material, CARD_MATERIAL_OPTIONS)
  }, [activeGroomAsset.material, strandMaterial, flyawayMaterial, cardMaterial])

  const guideMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, toneMapped: false }),
    [],
  )

  // Gap-filler volume cards shown behind strands in STRANDS mode.
  const volumeCardGeometry = useMemo(() => {
    if (isCardMode || !showGeneratedStrands || !generatedStrands.length) return null
    const cardGroups = buildCardGroups(generatedStrands as GeneratedStrand[], activeGroomAsset.guides.length)
    if (!cardGroups.length) return null
    return buildClumpCardGeometry(cardGroups, activeGroomAsset.settings.clumpRadius)
  }, [isCardMode, activeGroomAsset.guides.length, activeGroomAsset.settings.clumpRadius, generatedStrands, showGeneratedStrands])

  // Hair cards: atlas baked with correct melanin color, rendered with MeshBasicMaterial.
  const hairCardMesh = useMemo(() => {
    if (!isCardMode || !showGeneratedStrands || !generatedStrands.length) return null
    return buildHairCardMesh(generatedStrands as GeneratedStrand[], cardComplexity, activeGroomAsset.material)
  }, [isCardMode, cardComplexity, generatedStrands, showGeneratedStrands, activeGroomAsset.material])

  useEffect(() => {
    setLatestHairCardMesh(hairCardMesh)
    return () => setLatestHairCardMesh(null)
  }, [hairCardMesh])

  const strandGeometry = useMemo(() => {
    if (isCardMode || !showGeneratedStrands || !generatedStrands.length) return null
    const strands = selectBodyStrands(generatedStrands as GeneratedStrand[])
    if (!strands.length) return null
    return buildRibbonGeometry(strands)
  }, [isCardMode, generatedStrands, showGeneratedStrands])

  const flyawayGeometry = useMemo(() => {
    if (isCardMode || !showGeneratedStrands || !generatedStrands.length) return null
    const strands = selectFlyawayStrands(generatedStrands as GeneratedStrand[])
    if (!strands.length) return null
    return buildRibbonGeometry(strands)
  }, [isCardMode, generatedStrands, showGeneratedStrands])

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
    registerHairMaterialForGroom(flyawayMaterial)
    registerHairMaterialForGroom(cardMaterial)
    return () => {
      unregisterHairMaterialForGroom(strandMaterial)
      unregisterHairMaterialForGroom(flyawayMaterial)
      unregisterHairMaterialForGroom(cardMaterial)
    }
  }, [strandMaterial, flyawayMaterial, cardMaterial])
  useEffect(() => () => strandMaterial.dispose(), [strandMaterial])
  useEffect(() => () => flyawayMaterial.dispose(), [flyawayMaterial])
  useEffect(() => () => cardMaterial.dispose(), [cardMaterial])
  useEffect(() => () => guideMaterial.dispose(), [guideMaterial])
  useEffect(() => () => volumeCardGeometry?.dispose(), [volumeCardGeometry])
  useEffect(() => () => { hairCardMesh?.geometry.dispose(); hairCardMesh?.atlas.dispose() }, [hairCardMesh])
  useEffect(() => () => strandGeometry?.dispose(), [strandGeometry])
  useEffect(() => () => flyawayGeometry?.dispose(), [flyawayGeometry])
  useEffect(() => () => guideGeometry?.dispose(), [guideGeometry])

  const hasContent = volumeCardGeometry || hairCardMesh || strandGeometry || flyawayGeometry || guideGeometry
  if (!targetMesh || !hasContent) return null

  return (
    <group ref={transformRef} matrixAutoUpdate={false}>
      {volumeCardGeometry && (
        <mesh geometry={volumeCardGeometry} renderOrder={58}>
          <primitive object={cardMaterial} attach="material" />
        </mesh>
      )}
      {hairCardMesh && (
        <mesh geometry={hairCardMesh.geometry} renderOrder={60}>
          <meshStandardMaterial
            map={hairCardMesh.atlas}
            side={THREE.FrontSide}
            alphaTest={0.5}
            transparent={false}
            depthWrite
            depthTest
            roughness={0.88}
            metalness={0}
          />
        </mesh>
      )}
      {strandGeometry && (
        <mesh geometry={strandGeometry} renderOrder={60}>
          <primitive object={strandMaterial} attach="material" />
        </mesh>
      )}
      {flyawayGeometry && (
        <mesh geometry={flyawayGeometry} renderOrder={62}>
          <primitive object={flyawayMaterial} attach="material" />
        </mesh>
      )}
      {guideGeometry && (
        <lineSegments geometry={guideGeometry} renderOrder={63}>
          <primitive object={guideMaterial} attach="material" />
        </lineSegments>
      )}
    </group>
  )
}
