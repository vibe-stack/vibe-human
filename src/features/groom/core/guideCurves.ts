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
    Math.max(1, Math.round(triangleIndices.length / 10)),
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

function guideFalloff(guide: GuideCurve, pointLocal: THREE.Vector3, radius: number) {
  const distance = guideRootPosition(guide).distanceTo(pointLocal)
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
    const falloff = guideFalloff(guide, pointLocal, radius)
    if (falloff <= 0) return guide

    return {
      ...guide,
      points: guide.points.map((point, index) => {
        if (index === 0) return point
        const t = index / Math.max(1, guide.points.length - 1)
        const next = tupleToVector(point).addScaledVector(deltaLocal, falloff * strength * t)
        return vectorToTuple(next)
      }),
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
