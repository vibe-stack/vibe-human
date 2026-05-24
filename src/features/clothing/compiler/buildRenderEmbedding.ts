import type { PatternDocument } from '../document/types'
import type { RenderEmbedding, RenderPanelRuntime } from '../simulation/types'
import type { GarmentTopology } from './types'

const VISUAL_SUBDIVISIONS = 4

export function buildRenderEmbedding(
  document: PatternDocument,
  topology: GarmentTopology,
) {
  const renderPanels: RenderPanelRuntime[] = []

  for (const panel of Object.values(document.panels)) {
    const info = topology.panelInfo[panel.id]
    if (!info || info.triangleIndices.length === 0) continue
    const built = buildPanelVisualMesh(info.triangleIndices, topology.simMesh.panelUvs)
    renderPanels.push({
      panelId: panel.id,
      indices: built.indices,
      panelUvs: built.panelUvs,
      embedding: built.embedding,
    })
  }

  return { renderPanels }
}

type VisualMeshBuild = {
  panelUvs: Float32Array
  indices: Uint32Array
  embedding: RenderEmbedding
}

function buildPanelVisualMesh(triangleIndices: Uint32Array, simUvs: Float32Array): VisualMeshBuild {
  const panelUvs: number[] = []
  const indices: number[] = []
  const simTriangles: number[] = []
  const barycentrics: number[] = []
  const welded = new Map<string, number>()
  const scale = 1e6

  const vertexFor = (
    simA: number,
    simB: number,
    simC: number,
    wa: number,
    wb: number,
    wc: number,
  ) => {
    const u = simUvs[simA * 2] * wa + simUvs[simB * 2] * wb + simUvs[simC * 2] * wc
    const v = simUvs[simA * 2 + 1] * wa + simUvs[simB * 2 + 1] * wb + simUvs[simC * 2 + 1] * wc
    const key = `${Math.round(u * scale)}:${Math.round(v * scale)}`
    const existing = welded.get(key)
    if (existing !== undefined) return existing

    const vertex = panelUvs.length / 2
    welded.set(key, vertex)
    panelUvs.push(u, v)
    simTriangles.push(simA, simB, simC)
    barycentrics.push(wa, wb, wc)
    return vertex
  }

  for (let triangle = 0; triangle < triangleIndices.length; triangle += 3) {
    const simA = triangleIndices[triangle]
    const simB = triangleIndices[triangle + 1]
    const simC = triangleIndices[triangle + 2]
    const grid: number[][] = []

    for (let i = 0; i <= VISUAL_SUBDIVISIONS; i += 1) {
      grid[i] = []
      for (let j = 0; j <= VISUAL_SUBDIVISIONS - i; j += 1) {
        const wa = 1 - (i + j) / VISUAL_SUBDIVISIONS
        const wb = i / VISUAL_SUBDIVISIONS
        const wc = j / VISUAL_SUBDIVISIONS
        grid[i][j] = vertexFor(simA, simB, simC, wa, wb, wc)
      }
    }

    for (let i = 0; i < VISUAL_SUBDIVISIONS; i += 1) {
      for (let j = 0; j < VISUAL_SUBDIVISIONS - i; j += 1) {
        const v0 = grid[i][j]
        const v1 = grid[i + 1][j]
        const v2 = grid[i][j + 1]
        indices.push(v0, v1, v2)
        if (j < VISUAL_SUBDIVISIONS - i - 1) indices.push(v1, grid[i + 1][j + 1], v2)
      }
    }
  }

  return {
    panelUvs: new Float32Array(panelUvs),
    indices: new Uint32Array(indices),
    embedding: {
      simTriangles: new Uint32Array(simTriangles),
      barycentrics: new Float32Array(barycentrics),
    },
  }
}
