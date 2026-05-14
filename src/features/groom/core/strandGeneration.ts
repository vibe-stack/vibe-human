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

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

// Triangle area in 3-D
function triangleArea(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  return new THREE.Triangle(a, b, c).getArea()
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

// ---------------------------------------------------------------------------
// Per-strand procedural effects (frizz, curl, noise) — applied after
// interpolation so the overall shape comes from guides, effects are on top.
// ---------------------------------------------------------------------------

function applyStrandEffects(
  points: THREE.Vector3[],
  settings: GroomAsset['settings'],
  rng: () => number,
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

    const noiseAmp = settings.noiseAmplitude * (0.2 + t * 0.8)
    const curlAmp = settings.curlStrength * smoothstep(0, 0.3, t)
    const frizzAmp = settings.frizzStrength * (0.1 + t * 0.9)

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
  // strandDensity is strands/cm² — triangles are in metres, 1 m² = 10000 cm²
  const strandsPerM2 = settings.strandDensity * 10_000

  for (const triIndex of scalpMask.selectedTriangleIndices) {
    const surface = getTriangleSurfaceData(geometry, triIndex)
    if (!surface) continue

    const area = triangleArea(surface.a, surface.b, surface.c) // m²
    const expectedStrands = area * strandsPerM2
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

      // Procedural effects
      const finalPoints = applyStrandEffects(basePoints, settings, rng)

      strands.push({
        id: `tri${triIndex}-s${si}`,
        guideId: influences[0]?.guide.id ?? '',
        points: finalPoints.map(vectorToTuple),
        widthRoot: asset.material.strandWidthRoot,
        widthTip: asset.material.strandWidthTip,
        random: strandSeedLocal / 0xffffffff,
      })
    }

    if (strands.length >= MAX_STRAND_COUNT) break
  }

  return strands
}
