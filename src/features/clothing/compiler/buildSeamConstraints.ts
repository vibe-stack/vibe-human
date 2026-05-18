import type { PatternDocument } from '../document/types'
import type { DistanceConstraint } from '../simulation/types'
import type { CompiledPanelSimMesh } from './buildPanelSimMesh'
import { samplePanelEdge } from './buildPanelSimMesh'

const PATTERN_UNIT_SCALE = 0.004

export function buildSeamConstraints(
  document: PatternDocument,
  panels: Record<string, CompiledPanelSimMesh>,
  seamSamples: number,
): DistanceConstraint[] {
  const constraints: DistanceConstraint[] = []

  for (const seam of Object.values(document.seams)) {
    const panelA = document.panels[seam.a.panelId]
    const panelB = document.panels[seam.b.panelId]
    const meshA = panels[seam.a.panelId]
    const meshB = panels[seam.b.panelId]
    if (!panelA || !panelB || !meshA || !meshB) continue

    const pointsA = samplePanelEdge(panelA, seam.a.edgeId, seamSamples, seam.a.reversed)
    const pointsB = orientSeamSamples(
      panelA,
      pointsA,
      panelB,
      samplePanelEdge(panelB, seam.b.edgeId, seamSamples, seam.b.reversed),
    )
    const edgeParticlesA = orderedEdgeParticles(panelA, meshA, pointsA)
    const edgeParticlesB = orderedEdgeParticles(panelB, meshB, pointsB)
    const count = Math.min(edgeParticlesA.length, edgeParticlesB.length)
    const seen = new Set<string>()

    if (count >= 2) {
      for (let index = 0; index < count; index += 1) {
        const particleA = sampleOrderedParticle(edgeParticlesA, index, count)
        const particleB = sampleOrderedParticle(edgeParticlesB, index, count)
        if (particleA < 0 || particleB < 0 || particleA === particleB) continue
        const key = particleA < particleB ? `${particleA}:${particleB}` : `${particleB}:${particleA}`
        if (seen.has(key)) continue
        seen.add(key)
        constraints.push({
          a: particleA,
          b: particleB,
          rest: particleDistance(meshA, particleA, meshB, particleB),
          targetRest: 0,
          compliance: 0.00002 + (1 - seam.strength) * 0.0003,
          kind: 'seam',
        })
      }
      continue
    }

    const fallbackCount = Math.min(pointsA.length, pointsB.length)
    for (let index = 0; index < fallbackCount; index += 1) {
      const particleA = nearestParticle(meshA, pointsA[index].x, pointsA[index].y)
      const particleB = nearestParticle(meshB, pointsB[index].x, pointsB[index].y)
      if (particleA < 0 || particleB < 0 || particleA === particleB) continue
      const key = particleA < particleB ? `${particleA}:${particleB}` : `${particleB}:${particleA}`
      if (seen.has(key)) continue
      seen.add(key)
      constraints.push({
        a: particleA,
        b: particleB,
        rest: particleDistance(meshA, particleA, meshB, particleB),
        targetRest: 0,
        compliance: 0.00002 + (1 - seam.strength) * 0.0003,
        kind: 'seam',
      })
    }
  }

  return constraints
}

function orientSeamSamples(
  panelA: PatternDocument['panels'][string],
  pointsA: Array<{ x: number; y: number }>,
  panelB: PatternDocument['panels'][string],
  pointsB: Array<{ x: number; y: number }>,
) {
  if (pointsA.length < 2 || pointsB.length < 2) return pointsB
  const lastA = pointsA.length - 1
  const lastB = pointsB.length - 1
  const forwardCost =
    worldDistanceSq(panelA, pointsA[0], panelB, pointsB[0])
    + worldDistanceSq(panelA, pointsA[lastA], panelB, pointsB[lastB])
  const reversedCost =
    worldDistanceSq(panelA, pointsA[0], panelB, pointsB[lastB])
    + worldDistanceSq(panelA, pointsA[lastA], panelB, pointsB[0])
  return reversedCost + 1e-8 < forwardCost ? [...pointsB].reverse() : pointsB
}

function orderedEdgeParticles(
  panel: PatternDocument['panels'][string],
  mesh: CompiledPanelSimMesh,
  edgePoints: Array<{ x: number; y: number }>,
) {
  if (edgePoints.length < 2 || mesh.panelInfo.particleIndices.length === 0) return []
  const toleranceSq = Math.max(36, (panel.particleDistance * 0.55) ** 2)
  const matches: Array<{ particle: number; t: number; distSq: number }> = []

  for (let localIndex = 0; localIndex < mesh.panelInfo.particleIndices.length; localIndex += 1) {
    const projection = projectPointToPolyline(
      edgePoints,
      mesh.panelLocalPositions[localIndex * 2],
      mesh.panelLocalPositions[localIndex * 2 + 1],
    )
    if (!projection || projection.distSq > toleranceSq) continue
    matches.push({
      particle: mesh.panelInfo.particleIndices[localIndex],
      t: projection.t,
      distSq: projection.distSq,
    })
  }

  matches.sort((a, b) => a.t - b.t || a.distSq - b.distSq)
  return matches.map((match) => match.particle)
}

function sampleOrderedParticle(sequence: number[], index: number, count: number) {
  if (!sequence.length) return -1
  if (count <= 1 || sequence.length === 1) return sequence[0]
  return sequence[Math.round((index / (count - 1)) * (sequence.length - 1))]
}

function projectPointToPolyline(points: Array<{ x: number; y: number }>, x: number, y: number) {
  if (points.length < 2) return null
  let bestDistSq = Infinity
  let bestT = 0
  let total = 0
  let traversed = 0
  const lengths = new Array<number>(points.length - 1).fill(0)

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    lengths[index] = length
    total += length
  }
  if (total <= 1e-6) return null

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    const segX = end.x - start.x
    const segY = end.y - start.y
    const segLenSq = segX * segX + segY * segY
    const u = segLenSq <= 1e-9
      ? 0
      : clamp01(((x - start.x) * segX + (y - start.y) * segY) / segLenSq)
    const closestX = start.x + segX * u
    const closestY = start.y + segY * u
    const dx = x - closestX
    const dy = y - closestY
    const distSq = dx * dx + dy * dy
    if (distSq < bestDistSq) {
      bestDistSq = distSq
      bestT = (traversed + lengths[index] * u) / total
    }
    traversed += lengths[index]
  }

  return { t: bestT, distSq: bestDistSq }
}

function worldDistanceSq(
  panelA: PatternDocument['panels'][string],
  pointA: { x: number; y: number },
  panelB: PatternDocument['panels'][string],
  pointB: { x: number; y: number },
) {
  const a = applyPlacementFromPattern(pointA.x, pointA.y, panelA)
  const b = applyPlacementFromPattern(pointB.x, pointB.y, panelB)
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function particleDistance(
  meshA: CompiledPanelSimMesh,
  particleA: number,
  meshB: CompiledPanelSimMesh,
  particleB: number,
) {
  const ia = localParticleOffset(meshA, particleA)
  const ib = localParticleOffset(meshB, particleB)
  if (ia < 0 || ib < 0) return 0
  const ax = meshA.positions[ia]
  const ay = meshA.positions[ia + 1]
  const az = meshA.positions[ia + 2]
  const bx = meshB.positions[ib]
  const by = meshB.positions[ib + 1]
  const bz = meshB.positions[ib + 2]
  return Math.hypot(bx - ax, by - ay, bz - az)
}

function localParticleOffset(mesh: CompiledPanelSimMesh, particle: number) {
  const first = mesh.panelInfo.particleIndices[0]
  if (first === undefined) return -1
  const localParticle = particle - first
  const offset = localParticle * 3
  return offset >= 0 && offset + 2 < mesh.positions.length ? offset : -1
}

function nearestParticle(
  mesh: CompiledPanelSimMesh,
  x: number,
  y: number,
) {
  let best = -1
  let bestDist = Infinity
  for (let localIndex = 0; localIndex < mesh.panelInfo.particleIndices.length; localIndex += 1) {
    const dx = mesh.panelLocalPositions[localIndex * 2] - x
    const dy = mesh.panelLocalPositions[localIndex * 2 + 1] - y
    const dist = dx * dx + dy * dy
    if (dist < bestDist) {
      bestDist = dist
      best = mesh.panelInfo.particleIndices[localIndex]
    }
  }
  return best
}

function applyPlacementFromPattern(x: number, y: number, panel: PatternDocument['panels'][string]) {
  const bounds = panelBounds(panel)
  const worldX = ((x - bounds.minX) / bounds.width - 0.5) * bounds.width * PATTERN_UNIT_SCALE
  const worldY = (0.5 - (y - bounds.minY) / bounds.height) * bounds.height * PATTERN_UNIT_SCALE
  const q = quatFromEuler(panel.placement.rotation.x, panel.placement.rotation.y, panel.placement.rotation.z)
  const rotated = rotateVec(worldX, worldY, 0, q.x, q.y, q.z, q.w)
  return {
    x: rotated.x + panel.placement.position.x,
    y: rotated.y + panel.placement.position.y,
    z: rotated.z + panel.placement.position.z,
  }
}

function panelBounds(panel: PatternDocument['panels'][string]) {
  const points = Object.values(panel.points)
  if (!points.length) return { minX: -140, minY: -140, width: 280, height: 280 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return { minX, minY, width: maxX - minX || 1, height: maxY - minY || 1 }
}

function quatFromEuler(x: number, y: number, z: number) {
  const c1 = Math.cos(x / 2)
  const s1 = Math.sin(x / 2)
  const c2 = Math.cos(y / 2)
  const s2 = Math.sin(y / 2)
  const c3 = Math.cos(z / 2)
  const s3 = Math.sin(z / 2)
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  }
}

function rotateVec(x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number) {
  const tx = 2 * (qy * z - qz * y)
  const ty = 2 * (qz * x - qx * z)
  const tz = 2 * (qx * y - qy * x)
  return {
    x: x + qw * tx + (qy * tz - qz * ty),
    y: y + qw * ty + (qz * tx - qx * tz),
    z: z + qw * tz + (qx * ty - qy * tx),
  }
}

function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value
}
