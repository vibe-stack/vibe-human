import * as THREE from 'three'
import {
  MAX_GUIDE_COUNT,
  createGroomEntityId,
} from './groomAsset'
import { getTriangleSurfaceData } from './scalpBinding'
import type { GuideCurve, GroomModifierSettings, ScalpBinding, Vec3Tuple } from './types'

function vectorToTuple(vector: THREE.Vector3): Vec3Tuple {
  return [vector.x, vector.y, vector.z]
}

function tupleToVector(vector: Vec3Tuple) {
  return new THREE.Vector3(vector[0], vector[1], vector[2])
}

function createGuidePoints(
  rootPoint: THREE.Vector3,
  normal: THREE.Vector3,
  length: number,
  segments: number,
) {
  const points: Vec3Tuple[] = []
  const direction = normal.clone().normalize()
  const up = new THREE.Vector3(0, 1, 0)
  const fallback = Math.abs(direction.dot(up)) > 0.92 ? new THREE.Vector3(1, 0, 0) : up
  const sideways = new THREE.Vector3().crossVectors(direction, fallback).normalize()

  for (let index = 0; index <= segments; index += 1) {
    const t = segments === 0 ? 0 : index / segments
    const point = rootPoint.clone()
      .addScaledVector(direction, length * t)
      .addScaledVector(sideways, length * 0.06 * t * (1 - t))
      .addScaledVector(up, -length * 0.05 * t * t)

    points.push(vectorToTuple(point))
  }

  return points
}

export function createGuideCurve(
  root: ScalpBinding,
  rootPoint: THREE.Vector3,
  normal: THREE.Vector3,
  settings: GroomModifierSettings,
  groupId = 'main',
): GuideCurve {
  return {
    id: createGroomEntityId('guide'),
    root,
    points: createGuidePoints(rootPoint, normal, settings.guideLength, settings.guideSegments),
    radius: settings.guideRadius,
    length: settings.guideLength,
    groupId,
  }
}

function cumulativeLengths(points: THREE.Vector3[]) {
  const lengths = [0]
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(lengths[index - 1] + points[index].distanceTo(points[index - 1]))
  }
  return lengths
}

export function resampleGuidePoints(points: Vec3Tuple[], segmentCount: number) {
  if (points.length < 2) return points

  const vectors = points.map(tupleToVector)
  const lengths = cumulativeLengths(vectors)
  const totalLength = lengths[lengths.length - 1] || 1
  const resampled: Vec3Tuple[] = []

  for (let segmentIndex = 0; segmentIndex <= segmentCount; segmentIndex += 1) {
    const distance = (segmentIndex / segmentCount) * totalLength
    let spanIndex = 1

    while (spanIndex < lengths.length && lengths[spanIndex] < distance) {
      spanIndex += 1
    }

    if (spanIndex >= lengths.length) {
      resampled.push(points[points.length - 1])
      continue
    }

    const start = vectors[spanIndex - 1]
    const end = vectors[spanIndex]
    const startDistance = lengths[spanIndex - 1]
    const endDistance = lengths[spanIndex]
    const alpha = endDistance === startDistance ? 0 : (distance - startDistance) / (endDistance - startDistance)
    resampled.push(vectorToTuple(start.clone().lerp(end, alpha)))
  }

  return resampled
}

function scaleGuidePoints(points: Vec3Tuple[], scale: number) {
  if (points.length < 2) return points

  const root = tupleToVector(points[0])
  return points.map((point, index) => {
    if (index === 0) return point
    return vectorToTuple(tupleToVector(point).sub(root).multiplyScalar(scale).add(root))
  })
}

function preserveSegmentLengths(originalPoints: Vec3Tuple[], deformedPoints: THREE.Vector3[]) {
  if (originalPoints.length < 2 || deformedPoints.length < 2) return deformedPoints

  const constrained = [tupleToVector(originalPoints[0])]
  for (let index = 1; index < originalPoints.length; index += 1) {
    const originalPrev = tupleToVector(originalPoints[index - 1])
    const originalPoint = tupleToVector(originalPoints[index])
    const segmentLength = originalPoint.distanceTo(originalPrev)
    const prev = constrained[index - 1]
    const direction = deformedPoints[index].clone().sub(prev)

    if (direction.lengthSq() <= 1e-12) {
      direction.copy(originalPoint).sub(originalPrev)
    }
    if (direction.lengthSq() <= 1e-12) {
      constrained.push(prev.clone())
    } else {
      constrained.push(prev.clone().addScaledVector(direction.normalize(), segmentLength))
    }
  }

  return constrained
}

export function applyGuideSettingsToGuides(
  guides: GuideCurve[],
  settings: GroomModifierSettings,
  selectedGuideId: string | null,
) {
  return guides.map((guide) => {
    if (selectedGuideId && guide.id !== selectedGuideId) return guide

    const scaledPoints = scaleGuidePoints(
      guide.points,
      guide.length <= 0 ? 1 : settings.guideLength / guide.length,
    )

    return {
      ...guide,
      points: resampleGuidePoints(scaledPoints, settings.guideSegments),
      radius: settings.guideRadius,
      length: settings.guideLength,
    }
  })
}

export function generateGuidesFromScalpSelection(
  mesh: THREE.Mesh,
  meshId: string,
  triangleIndices: number[],
  settings: GroomModifierSettings,
) {
  const geometry = mesh.geometry
  if (!(geometry instanceof THREE.BufferGeometry) || !triangleIndices.length) return []

  const targetCount = Math.min(
    MAX_GUIDE_COUNT,
    Math.max(1, Math.round(triangleIndices.length / 3)),
  )
  const step = triangleIndices.length / targetCount
  const guides: GuideCurve[] = []

  for (let guideIndex = 0; guideIndex < targetCount; guideIndex += 1) {
    const triangleIndex = triangleIndices[Math.min(triangleIndices.length - 1, Math.floor(guideIndex * step))]
    const surface = getTriangleSurfaceData(geometry, triangleIndex)
    if (!surface) continue

    guides.push(
      createGuideCurve(
        {
          meshId,
          triangleIndex,
          barycentric: [1 / 3, 1 / 3, 1 / 3],
          localNormalOffset: 0.0015,
        },
        surface.centroid,
        surface.normal,
        settings,
      ),
    )
  }

  return guides.slice(0, MAX_GUIDE_COUNT)
}

export function guideRootPosition(guide: GuideCurve) {
  return tupleToVector(guide.points[0] ?? [0, 0, 0])
}

// Distance from `pointLocal` to the closest point on the polyline that
// represents the guide.  Also returns the t parameter (0..1) of the closest
// point, so tools can apply their effect more strongly at the strand tip when
// the user is grooming the tip rather than the root.
const _ga = new THREE.Vector3()
const _gb = new THREE.Vector3()
const _gd = new THREE.Vector3()
const _gp = new THREE.Vector3()
function guideClosestPoint(guide: GuideCurve, pointLocal: THREE.Vector3): { distance: number; t: number } {
  const pts = guide.points
  if (pts.length === 0) return { distance: Infinity, t: 0 }
  if (pts.length === 1) {
    _ga.set(pts[0][0], pts[0][1], pts[0][2])
    return { distance: _ga.distanceTo(pointLocal), t: 0 }
  }

  let bestDistSq = Infinity
  let bestSegment = 0
  let bestLocalT = 0
  for (let i = 0; i < pts.length - 1; i += 1) {
    _ga.set(pts[i][0], pts[i][1], pts[i][2])
    _gb.set(pts[i + 1][0], pts[i + 1][1], pts[i + 1][2])
    _gd.subVectors(_gb, _ga)
    const segLenSq = _gd.lengthSq() || 1e-12
    const u = THREE.MathUtils.clamp(
      _gp.subVectors(pointLocal, _ga).dot(_gd) / segLenSq,
      0, 1,
    )
    _gp.copy(_ga).addScaledVector(_gd, u)
    const distSq = _gp.distanceToSquared(pointLocal)
    if (distSq < bestDistSq) {
      bestDistSq = distSq
      bestSegment = i
      bestLocalT = u
    }
  }

  const segments = pts.length - 1
  const t = (bestSegment + bestLocalT) / segments
  return { distance: Math.sqrt(bestDistSq), t }
}

function guideFalloff(guide: GuideCurve, pointLocal: THREE.Vector3, radius: number) {
  const { distance } = guideClosestPoint(guide, pointLocal)
  if (distance > radius) return 0
  return 1 - distance / radius
}

export function combGuidesAtPoint(
  guides: GuideCurve[],
  pointLocal: THREE.Vector3,
  deltaLocal: THREE.Vector3,
  radius: number,
  strength: number,
) {
  return guides.map((guide) => {
    const { distance, t: hitT } = guideClosestPoint(guide, pointLocal)
    if (distance > radius) return guide
    const falloff = 1 - distance / radius

    // Per-vertex weighting: stronger at the hit location, soft falloff toward
    // root (locked) and toward the strand end.  Vertices below the hit also
    // get partial influence so combing the tip drags the upper half along
    // with it — this is how XGen / Houdini behave.
    const segments = Math.max(1, guide.points.length - 1)
    const deformedPoints = guide.points.map((point, index) => {
      if (index === 0) return tupleToVector(point) // root is bound to scalp
      const t = index / segments
      // Bias: a triangular tent centered at hitT, but anything above it
      // gets at least 60% of the influence (so the tip follows the hand).
      const above = t >= hitT
      const dt = above ? (t - hitT) : (hitT - t)
      const tent = above
        ? 1 - dt * 0.4
        : Math.max(0, 1 - dt * 1.6)
      const w = falloff * strength * tent
      return tupleToVector(point).addScaledVector(deltaLocal, w)
    })

    return {
      ...guide,
      points: preserveSegmentLengths(guide.points, deformedPoints).map(vectorToTuple),
    }
  })
}

export function smoothGuidesAtPoint(guides: GuideCurve[], pointLocal: THREE.Vector3, radius: number) {
  return guides.map((guide) => {
    const falloff = guideFalloff(guide, pointLocal, radius)
    if (falloff <= 0 || guide.points.length < 3) return guide

    const vectors = guide.points.map(tupleToVector)
    const nextPoints = vectors.map((point, index) => {
      if (index === 0 || index === vectors.length - 1) return point.clone()

      return vectors[index - 1]
        .clone()
        .add(vectors[index + 1])
        .multiplyScalar(0.5)
        .lerp(point, 0.35)
    })

    return {
      ...guide,
      points: nextPoints.map(vectorToTuple),
    }
  })
}

export function cutGuidesAtPoint(
  guides: GuideCurve[],
  pointLocal: THREE.Vector3,
  radius: number,
  strength: number,
) {
  const cutScale = 1 - Math.min(0.65, Math.max(0.08, strength * 0.45))

  return guides.map((guide) => {
    const falloff = guideFalloff(guide, pointLocal, radius)
    if (falloff <= 0) return guide

    const nextScale = 1 - (1 - cutScale) * falloff
    return {
      ...guide,
      points: scaleGuidePoints(guide.points, nextScale),
      length: guide.length * nextScale,
    }
  })
}

export function deleteGuidesAtPoint(guides: GuideCurve[], pointLocal: THREE.Vector3, radius: number) {
  return guides.filter((guide) => guideFalloff(guide, pointLocal, radius) <= 0)
}
