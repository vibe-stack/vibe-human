import * as THREE from 'three/webgpu'
import type { PatternPiece } from '../state/clothingTypes'
import { triangulatePattern } from '../geometry/triangulatePattern'

// Scale factor: pattern units (mm-ish) → Three.js world units
const PATTERN_SCALE = 0.002

export type GarmentGeometryResult = {
  geometry: THREE.BufferGeometry
}

/**
 * Build a Three.js BufferGeometry from a 2D PatternPiece.
 * The panel is placed as a flat quad in XY space (Z = zOffset).
 */
export function buildGarmentGeometry(piece: PatternPiece, zOffset = 0): GarmentGeometryResult {
  const { vertices, indices } = triangulatePattern(piece)

  if (vertices.length < 3 || indices.length < 3) {
    return { geometry: new THREE.BufferGeometry() }
  }

  // Compute centroid for UV normalisation
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const v of vertices) {
    if (v.x < minX) minX = v.x
    if (v.x > maxX) maxX = v.x
    if (v.y < minY) minY = v.y
    if (v.y > maxY) maxY = v.y
  }
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1

  const positions = new Float32Array(vertices.length * 3)
  const uvs       = new Float32Array(vertices.length * 2)

  for (let i = 0; i < vertices.length; i++) {
    const x = vertices[i].x * PATTERN_SCALE
    const y = -vertices[i].y * PATTERN_SCALE // flip Y so pattern-top is up in 3D
    positions[i * 3 + 0] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = zOffset

    uvs[i * 2 + 0] = (vertices[i].x - minX) / rangeX
    uvs[i * 2 + 1] = 1 - (vertices[i].y - minY) / rangeY
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  return { geometry }
}
