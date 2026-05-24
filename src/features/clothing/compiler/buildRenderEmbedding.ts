import type { PatternDocument } from '../document/types'
import type { RenderEmbedding, RenderPanelRuntime } from '../simulation/types'
import type { GarmentTopology } from './types'

export function buildRenderEmbedding(
  document: PatternDocument,
  topology: GarmentTopology,
) {
  const renderPanels: RenderPanelRuntime[] = []

  for (const panel of Object.values(document.panels)) {
    const info = topology.panelInfo[panel.id]
    if (!info || info.triangleIndices.length === 0) continue
    const panelMesh = buildPanelVisualMesh(info.particleIndices, info.triangleIndices, topology.simMesh.panelUvs)
    const embedding = embedPanelVertices(info.particleIndices, info.triangleIndices)
    renderPanels.push({
      panelId: panel.id,
      indices: panelMesh.indices,
      panelUvs: panelMesh.panelUvs,
      embedding,
    })
  }

  return { renderPanels }
}

type VisualMeshBuffers = {
  panelUvs: Float32Array
  indices: Uint32Array
}

function buildPanelVisualMesh(
  particleIndices: number[],
  triangleIndices: Uint32Array,
  simUvs: Float32Array,
): VisualMeshBuffers {
  const localByGlobal = new Map<number, number>()
  const panelUvs = new Float32Array(particleIndices.length * 2)
  for (let local = 0; local < particleIndices.length; local += 1) {
    const global = particleIndices[local]
    localByGlobal.set(global, local)
    panelUvs[local * 2] = simUvs[global * 2]
    panelUvs[local * 2 + 1] = simUvs[global * 2 + 1]
  }

  const indices = new Uint32Array(triangleIndices.length)
  for (let i = 0; i < triangleIndices.length; i += 1) {
    indices[i] = localByGlobal.get(triangleIndices[i]) ?? 0
  }

  return { panelUvs, indices }
}

function embedPanelVertices(particleIndices: number[], triangleIndices: Uint32Array): RenderEmbedding {
  const simTriangles = new Uint32Array(particleIndices.length * 3)
  const barycentrics = new Float32Array(particleIndices.length * 3)
  const triangleByParticle = new Map<number, { offset: number; slot: number }>()

  for (let i = 0; i < triangleIndices.length; i += 3) {
    if (!triangleByParticle.has(triangleIndices[i])) triangleByParticle.set(triangleIndices[i], { offset: i, slot: 0 })
    if (!triangleByParticle.has(triangleIndices[i + 1])) triangleByParticle.set(triangleIndices[i + 1], { offset: i, slot: 1 })
    if (!triangleByParticle.has(triangleIndices[i + 2])) triangleByParticle.set(triangleIndices[i + 2], { offset: i, slot: 2 })
  }

  for (let vertex = 0; vertex < particleIndices.length; vertex += 1) {
    const offset = vertex * 3
    const particle = particleIndices[vertex]
    const triangle = triangleByParticle.get(particle)
    if (!triangle) continue
    simTriangles[offset] = triangleIndices[triangle.offset]
    simTriangles[offset + 1] = triangleIndices[triangle.offset + 1]
    simTriangles[offset + 2] = triangleIndices[triangle.offset + 2]
    barycentrics[offset + triangle.slot] = 1
  }

  return { simTriangles, barycentrics }
}
