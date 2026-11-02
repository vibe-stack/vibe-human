import * as THREE from 'three/webgpu'
import type { RenderPanelRuntime } from '../simulation/types'

// Render-side garment geometry: one BufferGeometry per pattern panel, embedded
// in the simulation mesh by barycentric coordinates and re-evaluated per frame.

export type RenderPanelEntry = {
  panelId: string
  panel: RenderPanelRuntime
  geometry: THREE.BufferGeometry
  positionArray: Float32Array
  normalArray: Float32Array
  smoothScratch: Float32Array
  vertexCount: number
  indices: Uint32Array
  neighborOffsets: Uint32Array
  neighbors: Uint32Array
}

// Taubin λ|μ smoothing: a shrinking Laplacian pass followed by an inflating one
// of slightly larger magnitude, so the render surface loses faceting without
// losing volume. (Plain Laplacian passes pulled the garment inward and off the
// body silhouette; the old inflate pass was a no-op because negative factors
// were rejected.)
const VISUAL_SMOOTHING_PASSES = 2
const VISUAL_SMOOTHING_ALPHA = 0.33
const VISUAL_SMOOTHING_INFLATE = -0.34

export function createRenderPanelEntry(panel: RenderPanelRuntime): RenderPanelEntry {
  const vertexCount = panel.panelUvs.length / 2
  const positionArray = new Float32Array(vertexCount * 3)
  const normalArray = new Float32Array(vertexCount * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(panel.panelUvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(panel.indices, 1))
  const adjacency = buildAdjacency(vertexCount, panel.indices)
  return {
    panelId: panel.panelId,
    panel,
    geometry,
    positionArray,
    normalArray,
    smoothScratch: new Float32Array(vertexCount * 3),
    vertexCount,
    indices: panel.indices,
    neighborOffsets: adjacency.offsets,
    neighbors: adjacency.neighbors,
  }
}

export function updateRenderPanels(entries: RenderPanelEntry[], positions: Float32Array) {
  for (const entry of entries) {
    const { panel, vertexCount } = entry
    const array = entry.positionArray
    const simTriangles = panel.embedding.simTriangles
    const barycentrics = panel.embedding.barycentrics
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const base = vertex * 3
      const ia = simTriangles[base] * 3
      const ib = simTriangles[base + 1] * 3
      const ic = simTriangles[base + 2] * 3
      const wa = barycentrics[base]
      const wb = barycentrics[base + 1]
      const wc = barycentrics[base + 2]
      array[base] = positions[ia] * wa + positions[ib] * wb + positions[ic] * wc
      array[base + 1] = positions[ia + 1] * wa + positions[ib + 1] * wb + positions[ic + 1] * wc
      array[base + 2] = positions[ia + 2] * wa + positions[ib + 2] * wb + positions[ic + 2] * wc
    }
    taubinSmooth(array, entry.smoothScratch, entry.neighborOffsets, entry.neighbors, VISUAL_SMOOTHING_PASSES, VISUAL_SMOOTHING_ALPHA, VISUAL_SMOOTHING_INFLATE)
    computeVertexNormalsFlat(array, entry.indices, entry.normalArray, vertexCount)
    ;(entry.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(entry.geometry.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true
    // Invalidate the cached bounding sphere so raycasting uses current positions.
    entry.geometry.boundingSphere = null
  }
}

// Specialized, allocation-free replacement for THREE's computeVertexNormals on a
// fixed indexed topology. Replicates THREE exactly: area-weighted face normal
// (C-B)x(A-B) accumulated per vertex, then per-vertex normalize (zero-length
// stays zero, matching Vector3.normalize()).
export function computeVertexNormalsFlat(
  positions: Float32Array,
  indices: Uint32Array,
  normals: Float32Array,
  vertexCount: number,
) {
  const normalLen = vertexCount * 3
  for (let i = 0; i < normalLen; i += 1) normals[i] = 0

  for (let i = 0; i < indices.length; i += 3) {
    const vA = indices[i]
    const vB = indices[i + 1]
    const vC = indices[i + 2]
    const iA = vA * 3
    const iB = vB * 3
    const iC = vC * 3

    const cbx = positions[iC] - positions[iB]
    const cby = positions[iC + 1] - positions[iB + 1]
    const cbz = positions[iC + 2] - positions[iB + 2]
    const abx = positions[iA] - positions[iB]
    const aby = positions[iA + 1] - positions[iB + 1]
    const abz = positions[iA + 2] - positions[iB + 2]

    const nx = cby * abz - cbz * aby
    const ny = cbz * abx - cbx * abz
    const nz = cbx * aby - cby * abx

    normals[iA] += nx; normals[iA + 1] += ny; normals[iA + 2] += nz
    normals[iB] += nx; normals[iB + 1] += ny; normals[iB + 2] += nz
    normals[iC] += nx; normals[iC + 1] += ny; normals[iC + 2] += nz
  }

  for (let i = 0; i < normalLen; i += 3) {
    const x = normals[i]
    const y = normals[i + 1]
    const z = normals[i + 2]
    const len = Math.sqrt(x * x + y * y + z * z) || 1
    const inv = 1 / len
    normals[i] = x * inv
    normals[i + 1] = y * inv
    normals[i + 2] = z * inv
  }
}

function buildAdjacency(vertexCount: number, indices: Uint32Array) {
  const neighborSets = Array.from({ length: vertexCount }, () => new Set<number>())
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]
    const b = indices[i + 1]
    const c = indices[i + 2]
    neighborSets[a].add(b); neighborSets[a].add(c)
    neighborSets[b].add(a); neighborSets[b].add(c)
    neighborSets[c].add(a); neighborSets[c].add(b)
  }
  const offsets = new Uint32Array(vertexCount + 1)
  let total = 0
  for (let i = 0; i < vertexCount; i += 1) {
    offsets[i] = total
    total += neighborSets[i].size
  }
  offsets[vertexCount] = total
  const neighbors = new Uint32Array(total)
  let cursor = 0
  for (let i = 0; i < vertexCount; i += 1) {
    for (const n of neighborSets[i]) neighbors[cursor++] = n
  }
  return { offsets, neighbors }
}

export function taubinSmooth(
  positions: Float32Array,
  scratch: Float32Array,
  neighborOffsets: Uint32Array,
  neighbors: Uint32Array,
  passes: number,
  lambda: number,
  mu: number,
) {
  for (let pass = 0; pass < passes; pass += 1) {
    laplacianPass(positions, scratch, neighborOffsets, neighbors, lambda)
    laplacianPass(positions, scratch, neighborOffsets, neighbors, mu)
  }
}

function laplacianPass(
  positions: Float32Array,
  scratch: Float32Array,
  neighborOffsets: Uint32Array,
  neighbors: Uint32Array,
  alpha: number,
) {
  if (alpha === 0) return
  const vertexCount = neighborOffsets.length - 1
  scratch.set(positions)
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const start = neighborOffsets[vertex]
    const end = neighborOffsets[vertex + 1]
    const neighborCount = end - start
    if (neighborCount === 0) continue
    let avgX = 0
    let avgY = 0
    let avgZ = 0
    for (let i = start; i < end; i += 1) {
      const n = neighbors[i] * 3
      avgX += scratch[n]
      avgY += scratch[n + 1]
      avgZ += scratch[n + 2]
    }
    const inv = 1 / neighborCount
    avgX *= inv
    avgY *= inv
    avgZ *= inv
    const base = vertex * 3
    positions[base] = scratch[base] + (avgX - scratch[base]) * alpha
    positions[base + 1] = scratch[base + 1] + (avgY - scratch[base + 1]) * alpha
    positions[base + 2] = scratch[base + 2] + (avgZ - scratch[base + 2]) * alpha
  }
}
