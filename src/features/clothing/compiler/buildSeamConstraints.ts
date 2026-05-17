import type { PatternDocument } from '../document/types'
import type { DistanceConstraint } from '../simulation/types'
import type { CompiledPanelSimMesh } from './buildPanelSimMesh'
import { samplePanelEdge } from './buildPanelSimMesh'

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
    const pointsB = samplePanelEdge(panelB, seam.b.edgeId, seamSamples, seam.b.reversed)
    const count = Math.min(pointsA.length, pointsB.length)
    const seen = new Set<string>()

    for (let index = 0; index < count; index += 1) {
      const particleA = nearestParticle(meshA.seamSamplePoints, pointsA[index].x, pointsA[index].y)
      const particleB = nearestParticle(meshB.seamSamplePoints, pointsB[index].x, pointsB[index].y)
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
  particles: Array<{ particle: number; x: number; y: number }>,
  x: number,
  y: number,
) {
  let best = -1
  let bestDist = Infinity
  for (const particle of particles) {
    const dx = particle.x - x
    const dy = particle.y - y
    const dist = dx * dx + dy * dy
    if (dist < bestDist) {
      bestDist = dist
      best = particle.particle
    }
  }
  return best
}
