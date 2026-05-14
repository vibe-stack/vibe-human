import * as THREE from 'three'
import { MAX_STRAND_COUNT } from './groomAsset'
import { getTriangleSurfaceData } from './scalpBinding'
import type { GeneratedStrand, GroomAsset, GuideCurve, Vec3Tuple } from './types'

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function tupleToVector(p: Vec3Tuple) {
  return new THREE.Vector3(p[0], p[1], p[2])
}

function vectorToTuple(v: THREE.Vector3): Vec3Tuple {
  return [v.x, v.y, v.z]
}

function mulberry32(seed: number) {
  return () => {
    let s = (seed += 0x6d2b79f5)
    s = Math.imul(s ^ (s >>> 15), s | 1)
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61)
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296
  }
}

function hashU32(x: number) {
  x = ((x >>> 16) ^ x) * 0x45d9f3b
  x = ((x >>> 16) ^ x) * 0x45d9f3b
  return ((x >>> 16) ^ x) >>> 0
}

function hashStringU32(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

// Triangle area in 3-D
function triangleArea(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  return new THREE.Triangle(a, b, c).getArea()
}

function triangleCentroid(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  return new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3)
}

// Random point inside triangle via barycentric (Osada et al. uniform sampling)
function randomPointInTriangle(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  r1: number,
  r2: number,
): THREE.Vector3 {
  const sqrtR1 = Math.sqrt(r1)
  const u = 1 - sqrtR1
  const v = sqrtR1 * (1 - r2)
  const w = sqrtR1 * r2
  return new THREE.Vector3(
    u * a.x + v * b.x + w * c.x,
    u * a.y + v * b.y + w * c.y,
    u * a.z + v * b.z + w * c.z,
  )
}

// ---------------------------------------------------------------------------
// Guide influence — find the K nearest guides to a scalp point and return
// inverse-distance weights (same approach as XGen / Houdini Groom).
// ---------------------------------------------------------------------------

const K_NEAREST = 4

type WeightedGuide = { guide: GuideCurve; weight: number }

type ClumpData = {
  id: number
  rootPoint: THREE.Vector3
}

type ScalpDensityData = {
  triangleEdgeDistance: Map<number, number>
  maxDistance: number
}

function findInfluenceGuides(
  rootPoint: THREE.Vector3,
  guides: GuideCurve[],
): WeightedGuide[] {
  // Collect distances to all guides
  const dists: { guide: GuideCurve; distSq: number }[] = []
  for (const guide of guides) {
    const guideRoot = tupleToVector(guide.points[0] ?? [0, 0, 0])
    dists.push({ guide, distSq: rootPoint.distanceToSquared(guideRoot) })
  }

  // Partial sort — keep K nearest
  dists.sort((a, b) => a.distSq - b.distSq)
  const nearest = dists.slice(0, K_NEAREST)

  // If the closest guide is exactly on the point, return it with full weight
  if (nearest[0]?.distSq === 0) {
    return [{ guide: nearest[0].guide, weight: 1 }]
  }

  // Inverse-distance weighting (IDW, power=2)
  const weighted = nearest.map((d) => ({ guide: d.guide, weight: 1 / d.distSq }))
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0)
  return weighted.map((w) => ({ ...w, weight: w.weight / totalWeight }))
}

// ---------------------------------------------------------------------------
// Interpolate strand shape from weighted guides.
// All guide point arrays are resampled to the same segment count.
// ---------------------------------------------------------------------------

function interpolateStrandPoints(
  influences: WeightedGuide[],
  rootPoint: THREE.Vector3,
  segmentCount: number,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = []

  for (let seg = 0; seg <= segmentCount; seg += 1) {
    const t = seg / segmentCount
    const blended = new THREE.Vector3()

    for (const { guide, weight } of influences) {
      const guidePoints = guide.points
      const guideRoot = tupleToVector(guidePoints[0] ?? [0, 0, 0])

      // Sample guide at parameter t (linear interpolation along its points)
      const rawIndex = t * (guidePoints.length - 1)
      const lo = Math.floor(rawIndex)
      const hi = Math.min(lo + 1, guidePoints.length - 1)
      const frac = rawIndex - lo
      const pA = tupleToVector(guidePoints[lo] ?? [0, 0, 0])
      const pB = tupleToVector(guidePoints[hi] ?? [0, 0, 0])
      const guidePoint = pA.lerp(pB, frac)

      // Express guide point as an offset from the guide root, apply to our root
      const offset = guidePoint.sub(guideRoot)
      blended.addScaledVector(offset, weight)
    }

    points.push(rootPoint.clone().add(blended))
  }

  return points
}

function guideRootFrame(guide: GuideCurve) {
  const root = tupleToVector(guide.points[0] ?? [0, 0, 0])
  const next = tupleToVector(guide.points[1] ?? guide.points[0] ?? [0, 1, 0])
  const normal = next.sub(root).normalize()
  if (normal.lengthSq() <= 1e-12) normal.set(0, 1, 0)
  const helper = Math.abs(normal.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const tangent = new THREE.Vector3().crossVectors(helper, normal).normalize()
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize()
  return { root, tangent, bitangent }
}

function resolveClumpData(
  rootPoint: THREE.Vector3,
  nearestGuide: GuideCurve | undefined,
  settings: GroomAsset['settings'],
): ClumpData | null {
  if (!nearestGuide || settings.clumpStrength <= 0 || settings.clumpRadius <= 0.0001) return null

  const { root: guideRoot, tangent, bitangent } = guideRootFrame(nearestGuide)
  const offset = rootPoint.clone().sub(guideRoot)
  const radius = settings.clumpRadius
  const x = offset.dot(tangent)
  const y = offset.dot(bitangent)
  const cellX = Math.floor(x / radius)
  const cellY = Math.floor(y / radius)
  const guideHash = hashStringU32(nearestGuide.id)
  const id = hashU32(guideHash ^ hashU32((cellX + 8192) * 73856093) ^ hashU32((cellY + 8192) * 19349663))
  const rng = mulberry32(id)
  const jitterX = (rng() - 0.5) * radius * 0.42
  const jitterY = (rng() - 0.5) * radius * 0.42
  const centerX = (cellX + 0.5) * radius + jitterX
  const centerY = (cellY + 0.5) * radius + jitterY

  return {
    id,
    rootPoint: guideRoot
      .clone()
      .addScaledVector(tangent, centerX)
      .addScaledVector(bitangent, centerY),
  }
}

function applyClumpAttraction(
  points: THREE.Vector3[],
  clumpPoints: THREE.Vector3[],
  rootPoint: THREE.Vector3,
  clumpRoot: THREE.Vector3,
  strength: number,
) {
  if (points.length < 2 || clumpPoints.length !== points.length || strength <= 0) return points

  const rootOffset = rootPoint.clone().sub(clumpRoot)
  const result: THREE.Vector3[] = []
  const last = points.length - 1
  for (let i = 0; i < points.length; i += 1) {
    const t = i / last
    const lock = smoothstep(0.08, 1, t) * strength
    const preservedRootOffset = rootOffset.clone().multiplyScalar(Math.pow(1 - t, 1.55))
    const target = clumpPoints[i].clone().add(preservedRootOffset)
    result.push(points[i].clone().lerp(target, lock))
  }

  result[0].copy(rootPoint)
  return result
}

function buildScalpDensityData(geometry: THREE.BufferGeometry, triangleIndices: readonly number[]): ScalpDensityData {
  const centroids = new Map<number, THREE.Vector3>()
  const triangleEdges = new Map<number, string[]>()
  const edgeCounts = new Map<string, number>()
  const edgeCentroids: THREE.Vector3[] = []
  const triangleEdgeDistance = new Map<number, number>()

  for (const triangleIndex of triangleIndices) {
    const surface = getTriangleSurfaceData(geometry, triangleIndex)
    if (!surface) continue
    const centroid = triangleCentroid(surface.a, surface.b, surface.c)
    centroids.set(triangleIndex, centroid)
    const vertexIds = surface.indices
    const edgeKeys = [
      `${Math.min(vertexIds[0], vertexIds[1])}:${Math.max(vertexIds[0], vertexIds[1])}`,
      `${Math.min(vertexIds[1], vertexIds[2])}:${Math.max(vertexIds[1], vertexIds[2])}`,
      `${Math.min(vertexIds[2], vertexIds[0])}:${Math.max(vertexIds[2], vertexIds[0])}`,
    ]
    triangleEdges.set(triangleIndex, edgeKeys)
    for (const key of edgeKeys) {
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1)
    }
  }

  for (const [triangleIndex, edgeKeys] of triangleEdges) {
    if (edgeKeys.some((key) => (edgeCounts.get(key) ?? 0) === 1)) {
      const centroid = centroids.get(triangleIndex)
      if (centroid) edgeCentroids.push(centroid)
    }
  }

  if (!edgeCentroids.length) {
    for (const centroid of centroids.values()) edgeCentroids.push(centroid)
  }

  let maxDistance = 0
  for (const [triangleIndex, centroid] of centroids) {
    let bestDistSq = Infinity
    for (const edgeCentroid of edgeCentroids) {
      bestDistSq = Math.min(bestDistSq, centroid.distanceToSquared(edgeCentroid))
    }
    const distance = Math.sqrt(bestDistSq)
    triangleEdgeDistance.set(triangleIndex, distance)
    maxDistance = Math.max(maxDistance, distance)
  }

  return { triangleEdgeDistance, maxDistance }
}

function rootDensityForTriangle(triangleIndex: number, densityData: ScalpDensityData, settings: GroomAsset['settings']) {
  const distance = densityData.triangleEdgeDistance.get(triangleIndex) ?? 0
  const fadeDistance = Math.max(settings.clumpRadius * 2.5, 0.006)
  const edgeRamp = smoothstep(0, fadeDistance, distance)
  const interiorRamp = densityData.maxDistance <= 1e-6
    ? 1
    : smoothstep(0, Math.max(fadeDistance, densityData.maxDistance * 0.75), distance)
  const density = THREE.MathUtils.clamp(0.18 + edgeRamp * 0.82, 0, 1)
  return { distance, edgeRamp, interiorRamp, density }
}

function scalePointsFromRoot(points: THREE.Vector3[], scale: number) {
  if (points.length < 2 || scale === 1) return points
  const root = points[0].clone()
  return points.map((point, index) => {
    if (index === 0) return point.clone()
    return point.clone().sub(root).multiplyScalar(scale).add(root)
  })
}

// ---------------------------------------------------------------------------
// Per-strand procedural effects (frizz, curl, noise) — applied after
// interpolation so the overall shape comes from guides, effects are on top.
// ---------------------------------------------------------------------------

function applyStrandEffects(
  points: THREE.Vector3[],
  settings: GroomAsset['settings'],
  rng: () => number,
  effectScale = 1,
): THREE.Vector3[] {
  if (points.length < 2) return points

  const noisePhase = rng() * Math.PI * 2
  const curlPhase = rng() * Math.PI * 2
  const frizzPhase = rng() * Math.PI * 2
  const cutScale = 1 - settings.cutRandomness * rng() * 0.4

  const root = points[0].clone()
  const result: THREE.Vector3[] = []

  for (let i = 0; i < points.length; i += 1) {
    const t = i / Math.max(1, points.length - 1)

    // Local frame from segment direction
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(points.length - 1, i + 1)]
    const tangent = next.clone().sub(prev).normalize()
    const helperAxis = Math.abs(tangent.y) > 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0)
    const basisN = new THREE.Vector3().crossVectors(tangent, helperAxis).normalize()
    const basisB = new THREE.Vector3().crossVectors(tangent, basisN)

    const noiseAmp = settings.noiseAmplitude * effectScale * (0.2 + t * 0.8)
    const curlAmp = settings.curlStrength * smoothstep(0, 0.3, t)
    const frizzAmp = settings.frizzStrength * effectScale * (0.1 + t * 0.9)

    const p = points[i].clone()
      .addScaledVector(basisN, Math.sin(t * settings.noiseFrequency * Math.PI * 2 + noisePhase) * noiseAmp)
      .addScaledVector(basisB, Math.cos(t * settings.noiseFrequency * Math.PI * 2 + noisePhase * 0.7) * noiseAmp * 0.6)
      .addScaledVector(basisN, Math.sin(t * settings.curlFrequency * Math.PI * 2 + curlPhase) * curlAmp)
      .addScaledVector(basisB, Math.cos(t * settings.curlFrequency * Math.PI * 2 + curlPhase) * curlAmp)
      .addScaledVector(basisN, Math.sin(t * (settings.curlFrequency * 2.7 + 8) * Math.PI * 2 + frizzPhase) * frizzAmp)

    // Scale from root by cutScale
    p.sub(root).multiplyScalar(cutScale).add(root)
    result.push(p)
  }

  return result
}

// ---------------------------------------------------------------------------
// Main entry point — scalp-coverage strand generation
//
// Algorithm (matching XGen / Houdini Groom):
//   For every triangle in the scalp mask:
//     1. Compute how many strands this triangle contributes (area × density)
//     2. For each strand, sample a random point on the triangle
//     3. Find the K nearest guides and compute IDW-blended shape
//     4. Apply per-strand procedural effects
// ---------------------------------------------------------------------------

export function generateStrandsFromGuides(
  asset: GroomAsset,
  mesh?: THREE.Mesh,
): GeneratedStrand[] {
  const { guides, settings, scalpMask } = asset

  if (guides.length === 0 || scalpMask.selectedTriangleIndices.length === 0) return []

  // Need mesh geometry for triangle positions
  const geometry = mesh?.geometry
  if (!geometry || !(geometry instanceof THREE.BufferGeometry)) return []

  const strands: GeneratedStrand[] = []
  const densityData = buildScalpDensityData(geometry, scalpMask.selectedTriangleIndices)
  // strandDensity is strands/cm² — triangles are in metres, 1 m² = 10000 cm²
  const strandsPerM2 = settings.strandDensity * 10_000

  for (const triIndex of scalpMask.selectedTriangleIndices) {
    const surface = getTriangleSurfaceData(geometry, triIndex)
    if (!surface) continue

    const rootDensity = rootDensityForTriangle(triIndex, densityData, settings)
    const area = triangleArea(surface.a, surface.b, surface.c) // m²
    const expectedStrands = area * strandsPerM2 * rootDensity.density
    // Stochastic rounding so low-density settings still cover the surface
    const strandSeed = hashU32(triIndex)
    const rngTriangle = mulberry32(strandSeed)
    const fractional = expectedStrands - Math.floor(expectedStrands)
    const count = Math.floor(expectedStrands) + (rngTriangle() < fractional ? 1 : 0)

    for (let si = 0; si < count; si += 1) {
      if (strands.length >= MAX_STRAND_COUNT) break

      const strandSeedLocal = hashU32(strandSeed ^ hashU32(si + 1))
      const rng = mulberry32(strandSeedLocal)

      // Random point on triangle (uniform area sampling)
      const rootPoint = randomPointInTriangle(surface.a, surface.b, surface.c, rng(), rng())

      // Offset slightly along normal so strand roots sit above scalp
      rootPoint.addScaledVector(surface.normal, 0.0008)

      // Guide interpolation
      const influences = findInfluenceGuides(rootPoint, guides)
      const basePoints = interpolateStrandPoints(influences, rootPoint, settings.guideSegments)
      const clumpData = resolveClumpData(rootPoint, influences[0]?.guide, settings)
      let shapedPoints = basePoints
      const clumpId = clumpData?.id ?? hashStringU32(influences[0]?.guide.id ?? '')

      if (clumpData) {
        const clumpInfluences = findInfluenceGuides(clumpData.rootPoint, guides)
        const clumpBasePoints = interpolateStrandPoints(clumpInfluences, clumpData.rootPoint, settings.guideSegments)
        const clumpRng = mulberry32(clumpData.id)
        const clumpGuidePoints = applyStrandEffects(clumpBasePoints, settings, clumpRng, 0.25)
        shapedPoints = applyClumpAttraction(
          basePoints,
          clumpGuidePoints,
          rootPoint,
          clumpData.rootPoint,
          settings.clumpStrength,
        )
      }

      // Procedural effects
      const finalPoints = applyStrandEffects(
        shapedPoints,
        settings,
        rng,
        1 - settings.clumpStrength * 0.45,
      )
      const lengthScale = THREE.MathUtils.clamp(
        0.45 + rootDensity.edgeRamp * 0.55 - rng() * settings.cutRandomness * 0.18,
        0.25,
        1,
      )
      const flyawayMask = THREE.MathUtils.clamp((1 - rootDensity.edgeRamp) * 0.55 + rng() * 0.45, 0, 1)
      const finalScaledPoints = scalePointsFromRoot(finalPoints, lengthScale)

      strands.push({
        id: `tri${triIndex}-s${si}`,
        guideId: influences[0]?.guide.id ?? '',
        points: finalScaledPoints.map(vectorToTuple),
        widthRoot: asset.material.strandWidthRoot,
        widthTip: asset.material.strandWidthTip,
        random: strandSeedLocal / 0xffffffff,
        rootDensity: rootDensity.density,
        edgeDistance: rootDensity.distance,
        lengthScale,
        flyawayMask,
        clumpId,
      })
    }

    if (strands.length >= MAX_STRAND_COUNT) break
  }

  return strands
}
