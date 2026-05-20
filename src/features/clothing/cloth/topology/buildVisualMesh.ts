import * as THREE from 'three/webgpu'
import earcut from 'earcut'
import type { PatternPiece } from '../../state/clothingTypes'
import { samplePatternOutline, sampleEdgeLoop } from '../../geometry/patternSampling'

/**
 * High-resolution visual mesh from a pattern outline (hole-aware), with
 * each triangle barycentrically subdivided so the silhouette stays smooth
 * even when the sim grid is coarse. Stores per-vertex UVs in pattern-space
 * [0,1]² so the sim can be sampled bilinearly at render time.
 */

const SUBDIVISIONS = 18

type WeldBuffers = {
  uvs: Float32Array
  indices: Uint32Array
}

function weldUvVertices(uvs: Float32Array, indices: Uint32Array): WeldBuffers {
  const weldedUvs: number[] = []
  const weldedIndices = new Uint32Array(indices.length)
  const map = new Map<string, number>()
  const scale = 1e6

  for (let i = 0; i < indices.length; i += 1) {
    const src = indices[i]
    const u = uvs[src * 2]
    const v = uvs[src * 2 + 1]
    const key = `${Math.round(u * scale)}:${Math.round(v * scale)}`
    let dst = map.get(key)
    if (dst === undefined) {
      dst = weldedUvs.length / 2
      weldedUvs.push(u, v)
      map.set(key, dst)
    }
    weldedIndices[i] = dst
  }

  return {
    uvs: new Float32Array(weldedUvs),
    indices: weldedIndices,
  }
}

export type VisualMesh = {
  geometry: THREE.BufferGeometry
  /** Per-vertex UVs (flat) — kept here for the sampler. */
  uvs: Float32Array
}

export function buildVisualMesh(piece: PatternPiece): VisualMesh {
  const outerOutline = samplePatternOutline(piece, 12)
  const geometry = new THREE.BufferGeometry()

  if (outerOutline.length < 3) {
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(0), 2))
    return { geometry, uvs: new Float32Array(0) }
  }

  const bounds = patternBounds(piece)
  const flat: number[] = []
  const earcutVerts: { x: number; y: number }[] = []
  for (const p of outerOutline) { flat.push(p.x, p.y); earcutVerts.push(p) }
  const holeStarts: number[] = []
  for (const holeEdges of piece.holes ?? []) {
    const hole = sampleEdgeLoop(piece, holeEdges, 12)
    if (hole.length < 3) continue
    holeStarts.push(earcutVerts.length)
    for (const p of hole) { flat.push(p.x, p.y); earcutVerts.push(p) }
  }
  const triIndices = earcut(flat, holeStarts.length ? holeStarts : undefined, 2)
  if (triIndices.length < 3) {
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(0), 2))
    return { geometry, uvs: new Float32Array(0) }
  }

  const uvBuf: number[] = []
  const idxBuf: number[] = []
  const N = SUBDIVISIONS

  const toUv = (i: number) => ({
    u: (earcutVerts[i].x - bounds.minX) / bounds.width,
    v: (earcutVerts[i].y - bounds.minY) / bounds.depth,
  })

  for (let t = 0; t < triIndices.length; t += 3) {
    const A = toUv(triIndices[t + 0])
    const B = toUv(triIndices[t + 1])
    const C = toUv(triIndices[t + 2])
    const grid: number[][] = []
    for (let i = 0; i <= N; i += 1) {
      grid[i] = []
      for (let j = 0; j <= N - i; j += 1) {
        const wa = 1 - (i + j) / N
        const wb = i / N
        const wc = j / N
        const idx = uvBuf.length / 2
        uvBuf.push(A.u * wa + B.u * wb + C.u * wc, A.v * wa + B.v * wb + C.v * wc)
        grid[i][j] = idx
      }
    }
    for (let i = 0; i < N; i += 1) {
      for (let j = 0; j < N - i; j += 1) {
        const v0 = grid[i][j], v1 = grid[i + 1][j], v2 = grid[i][j + 1]
        idxBuf.push(v0, v1, v2)
        if (j < N - i - 1) idxBuf.push(v1, grid[i + 1][j + 1], v2)
      }
    }
  }

  const welded = weldUvVertices(new Float32Array(uvBuf), new Uint32Array(idxBuf))
  const positions = new Float32Array((welded.uvs.length / 2) * 3)
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(welded.uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(welded.indices, 1))
  geometry.computeVertexNormals()
  return { geometry, uvs: welded.uvs }
}

function patternBounds(piece: PatternPiece) {
  const pts = Object.values(piece.points)
  if (!pts.length) return { minX: -140, minY: -140, width: 280, depth: 280 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, width: maxX - minX || 1, depth: maxY - minY || 1 }
}
