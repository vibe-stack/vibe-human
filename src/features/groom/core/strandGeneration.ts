import * as THREE from 'three'
import {
  MAX_CHILDREN_PER_GUIDE,
  MAX_GUIDE_COUNT,
  sanitizeGeneratedStrands,
} from './groomAsset'
import type { GeneratedStrand, GroomAsset, Vec3Tuple } from './types'

function tupleToVector(point: Vec3Tuple) {
  return new THREE.Vector3(point[0], point[1], point[2])
}

function vectorToTuple(point: THREE.Vector3): Vec3Tuple {
  return [point.x, point.y, point.z]
}

function hashString(input: string) {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function mulberry32(seed: number) {
  return () => {
    let next = (seed += 0x6d2b79f5)
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

function makeBasis(tangent: THREE.Vector3, seed: number) {
  const helper = Math.abs(tangent.y) > 0.92
    ? new THREE.Vector3(1, 0, (seed % 7) * 0.01)
    : new THREE.Vector3(0, 1, (seed % 11) * 0.01)
  const normal = new THREE.Vector3().crossVectors(tangent, helper).normalize()
  const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize()
  return { normal, binormal }
}

function smoothstep(min: number, max: number, value: number) {
  const x = THREE.MathUtils.clamp((value - min) / (max - min), 0, 1)
  return x * x * (3 - 2 * x)
}

function getPointTangent(points: THREE.Vector3[], index: number) {
  if (index <= 0) {
    return points[1].clone().sub(points[0]).normalize()
  }
  if (index >= points.length - 1) {
    return points[index].clone().sub(points[index - 1]).normalize()
  }

  return points[index + 1].clone().sub(points[index - 1]).normalize()
}

export function generateStrandsFromGuides(asset: GroomAsset): GeneratedStrand[] {
  const settings = asset.settings
  const actualChildrenPerGuide = Math.min(
    MAX_CHILDREN_PER_GUIDE,
    Math.max(1, Math.round(settings.childrenPerGuide * settings.density)),
  )
  const strands: GeneratedStrand[] = []

  for (const guide of asset.guides.slice(0, MAX_GUIDE_COUNT)) {
    if (guide.points.length < 2) continue

    const guidePoints = guide.points.map(tupleToVector)
    const root = guidePoints[0]
    const rootTangent = getPointTangent(guidePoints, 0)
    const guideSeed = hashString(guide.id)
    const rootBasis = makeBasis(rootTangent, guideSeed)

    for (let childIndex = 0; childIndex < actualChildrenPerGuide; childIndex += 1) {
      const strandSeed = hashString(`${guide.id}:${childIndex}`)
      const random = mulberry32(strandSeed)
      const angle = random() * Math.PI * 2
      const radius = Math.sqrt(random()) * settings.clumpRadius
      const rootOffset = rootBasis.normal
        .clone()
        .multiplyScalar(Math.cos(angle) * radius)
        .addScaledVector(rootBasis.binormal, Math.sin(angle) * radius)

      const noisePhase = random() * Math.PI * 2
      const curlPhase = random() * Math.PI * 2
      const frizzPhase = random() * Math.PI * 2
      const cutScale = 1 - settings.cutRandomness * random() * 0.35
      const points: Vec3Tuple[] = []

      for (let pointIndex = 0; pointIndex < guidePoints.length; pointIndex += 1) {
        const t = pointIndex / Math.max(1, guidePoints.length - 1)
        const basePoint = guidePoints[pointIndex].clone()
        const tangent = getPointTangent(guidePoints, pointIndex)
        const basis = makeBasis(tangent, strandSeed + pointIndex)
        const clumpFade = 1 - settings.clumpStrength * smoothstep(0.05, 1, t)
        const noiseAmp = settings.noiseAmplitude * (0.2 + t * 0.8)
        const curlAmp = settings.curlStrength * smoothstep(0, 1, t)
        const frizzAmp = settings.frizzStrength * (0.15 + t * 0.85)

        const point = basePoint
          .add(rootOffset.clone().multiplyScalar(1 - t * 0.92))
          .add(rootOffset.clone().multiplyScalar(-(1 - clumpFade)))
          .add(
            basis.normal.clone().multiplyScalar(
              Math.sin(t * settings.noiseFrequency * Math.PI * 2 + noisePhase) * noiseAmp,
            ),
          )
          .add(
            basis.binormal.clone().multiplyScalar(
              Math.cos(t * settings.noiseFrequency * Math.PI * 2 + noisePhase * 0.75) * noiseAmp * 0.7,
            ),
          )
          .add(
            basis.normal.clone().multiplyScalar(
              Math.sin(t * settings.curlFrequency * Math.PI * 2 + curlPhase) * curlAmp,
            ),
          )
          .add(
            basis.binormal.clone().multiplyScalar(
              Math.cos(t * settings.curlFrequency * Math.PI * 2 + curlPhase) * curlAmp,
            ),
          )
          .add(
            basis.normal.clone().multiplyScalar(
              Math.sin(t * (settings.curlFrequency * 3 + 9) * Math.PI * 2 + frizzPhase) * frizzAmp,
            ),
          )

        point.sub(root).multiplyScalar(cutScale).add(root)
        points.push(vectorToTuple(point))
      }

      strands.push({
        id: `${guide.id}-child-${childIndex}`,
        guideId: guide.id,
        points,
        widthRoot: settings.strandWidthRoot,
        widthTip: settings.strandWidthTip,
        random: strandSeed / 0xffffffff,
      })
    }
  }

  return sanitizeGeneratedStrands(strands)
}
