import * as THREE from 'three'
import type { ScalpBinding } from './types'

// -----------------------------------------------------------------------------
// Per-geometry spatial cache.
//
// The grooming brush previously walked every triangle of the head (~50k tris)
// per pointermove and allocated several Vector3s for each one — a hot loop
// that froze the whole app on every drag tick.  We now build, on demand, a
// flat Float32Array of triangle centroids + normals + areas, plus a hash grid
// that lets a brush radius query return only the buckets it actually touches.
// The cache is invalidated when the geometry's UUID changes.
// -----------------------------------------------------------------------------

type GeometryCache = {
  uuid: string
  triangleCount: number
  centroidsX: Float32Array  // [tri]
  centroidsY: Float32Array
  centroidsZ: Float32Array
  normalsX: Float32Array
  normalsY: Float32Array
  normalsZ: Float32Array
  areas: Float32Array
  cellSize: number
  cellOriginX: number
  cellOriginY: number
  cellOriginZ: number
  cellsX: number
  cellsY: number
  cellsZ: number
  // grid: flattened Uint32Array of (start,end) offsets per cell, plus a single
  // Uint32Array of triangle ids ordered by cell.
  cellStart: Uint32Array
  cellEnd: Uint32Array
  cellTriangleIds: Uint32Array
}

const geometryCaches = new WeakMap<THREE.BufferGeometry, GeometryCache>()

// Scratch vectors reused across hot paths.
const _vA = new THREE.Vector3()
const _vB = new THREE.Vector3()
const _vC = new THREE.Vector3()
const _ab = new THREE.Vector3()
const _ac = new THREE.Vector3()
const _cross = new THREE.Vector3()

function buildCache(geometry: THREE.BufferGeometry): GeometryCache {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const index = geometry.index
  if (!position) throw new Error('Geometry has no position attribute')

  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3)

  const centroidsX = new Float32Array(triangleCount)
  const centroidsY = new Float32Array(triangleCount)
  const centroidsZ = new Float32Array(triangleCount)
  const normalsX = new Float32Array(triangleCount)
  const normalsY = new Float32Array(triangleCount)
  const normalsZ = new Float32Array(triangleCount)
  const areas = new Float32Array(triangleCount)

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  let totalArea = 0

  for (let t = 0; t < triangleCount; t += 1) {
    const i0 = index ? index.getX(t * 3)     : t * 3
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2

    _vA.fromBufferAttribute(position, i0)
    _vB.fromBufferAttribute(position, i1)
    _vC.fromBufferAttribute(position, i2)

    const cx = (_vA.x + _vB.x + _vC.x) / 3
    const cy = (_vA.y + _vB.y + _vC.y) / 3
    const cz = (_vA.z + _vB.z + _vC.z) / 3
    centroidsX[t] = cx
    centroidsY[t] = cy
    centroidsZ[t] = cz

    _ab.subVectors(_vB, _vA)
    _ac.subVectors(_vC, _vA)
    _cross.crossVectors(_ab, _ac)
    const len = _cross.length()
    if (len > 1e-20) {
      normalsX[t] = _cross.x / len
      normalsY[t] = _cross.y / len
      normalsZ[t] = _cross.z / len
    }
    const area = 0.5 * len
    areas[t] = area
    totalArea += area

    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx
    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy
    if (cz < minZ) minZ = cz; if (cz > maxZ) maxZ = cz
  }

  // Pick a cell size so we get roughly cbrt(N) cells per axis — keeps memory
  // bounded and the average bucket small.  Clamp so degenerate meshes don't
  // explode the grid.
  const meanArea = triangleCount > 0 ? totalArea / triangleCount : 1e-4
  const cellSize = Math.max(Math.sqrt(meanArea) * 4, 1e-3)

  const span = (lo: number, hi: number) => Math.max(1, Math.ceil((hi - lo) / cellSize) + 1)
  const cellsX = span(minX, maxX)
  const cellsY = span(minY, maxY)
  const cellsZ = span(minZ, maxZ)

  const cellCount = cellsX * cellsY * cellsZ
  const cellCounts = new Uint32Array(cellCount)

  // 1st pass: histogram cell occupancy
  for (let t = 0; t < triangleCount; t += 1) {
    const cx = Math.min(cellsX - 1, Math.floor((centroidsX[t] - minX) / cellSize))
    const cy = Math.min(cellsY - 1, Math.floor((centroidsY[t] - minY) / cellSize))
    const cz = Math.min(cellsZ - 1, Math.floor((centroidsZ[t] - minZ) / cellSize))
    cellCounts[cx + cy * cellsX + cz * cellsX * cellsY] += 1
  }

  const cellStart = new Uint32Array(cellCount)
  const cellEnd = new Uint32Array(cellCount)
  let cursor = 0
  for (let c = 0; c < cellCount; c += 1) {
    cellStart[c] = cursor
    cursor += cellCounts[c]
    cellEnd[c] = cursor
    cellCounts[c] = 0 // reuse as write cursor
  }
  const cellTriangleIds = new Uint32Array(cursor)
  for (let t = 0; t < triangleCount; t += 1) {
    const cx = Math.min(cellsX - 1, Math.floor((centroidsX[t] - minX) / cellSize))
    const cy = Math.min(cellsY - 1, Math.floor((centroidsY[t] - minY) / cellSize))
    const cz = Math.min(cellsZ - 1, Math.floor((centroidsZ[t] - minZ) / cellSize))
    const c = cx + cy * cellsX + cz * cellsX * cellsY
    cellTriangleIds[cellStart[c] + cellCounts[c]] = t
    cellCounts[c] += 1
  }

  return {
    uuid: geometry.uuid,
    triangleCount,
    centroidsX, centroidsY, centroidsZ,
    normalsX, normalsY, normalsZ,
    areas,
    cellSize,
    cellOriginX: minX, cellOriginY: minY, cellOriginZ: minZ,
    cellsX, cellsY, cellsZ,
    cellStart, cellEnd, cellTriangleIds,
  }
}

function getCache(geometry: THREE.BufferGeometry): GeometryCache {
  let cache = geometryCaches.get(geometry)
  if (cache && cache.uuid === geometry.uuid) return cache
  cache = buildCache(geometry)
  geometryCaches.set(geometry, cache)
  return cache
}

export function invalidateGeometryCache(geometry: THREE.BufferGeometry) {
  geometryCaches.delete(geometry)
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export function getTriangleCount(geometry: THREE.BufferGeometry) {
  const indexCount = geometry.index?.count
  if (typeof indexCount === 'number') return Math.floor(indexCount / 3)
  const positionCount = geometry.getAttribute('position')?.count ?? 0
  return Math.floor(positionCount / 3)
}

export function computeTriangleIndexFromIntersection(intersection: THREE.Intersection<THREE.Object3D>) {
  return typeof intersection.faceIndex === 'number' ? intersection.faceIndex : null
}

export function getTriangleVertexIndices(geometry: THREE.BufferGeometry, triangleIndex: number) {
  const index = geometry.index
  const start = triangleIndex * 3
  if (index) {
    if (start + 2 >= index.count) return null
    return [index.getX(start), index.getX(start + 1), index.getX(start + 2)] as const
  }
  const position = geometry.getAttribute('position')
  if (!position || start + 2 >= position.count) return null
  return [start, start + 1, start + 2] as const
}

export function getTriangleVertices(
  geometry: THREE.BufferGeometry,
  triangleIndex: number,
  outA: THREE.Vector3,
  outB: THREE.Vector3,
  outC: THREE.Vector3,
) {
  const position = geometry.getAttribute('position')
  const indices = getTriangleVertexIndices(geometry, triangleIndex)
  if (!position || !indices) return null
  outA.fromBufferAttribute(position, indices[0])
  outB.fromBufferAttribute(position, indices[1])
  outC.fromBufferAttribute(position, indices[2])
  return { a: outA, b: outB, c: outC, indices }
}

const _bary = new THREE.Vector3()
export function computeBarycentricForPoint(
  point: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): [number, number, number] {
  THREE.Triangle.getBarycoord(point, a, b, c, _bary)
  return [_bary.x, _bary.y, _bary.z]
}

// Reusable surface-data type — allocating-free version uses the writers below.
export type TriangleSurface = {
  a: THREE.Vector3
  b: THREE.Vector3
  c: THREE.Vector3
  indices: readonly [number, number, number]
  centroid: THREE.Vector3
  normal: THREE.Vector3
}

const _surfaceA = new THREE.Vector3()
const _surfaceB = new THREE.Vector3()
const _surfaceC = new THREE.Vector3()
const _surfaceCentroid = new THREE.Vector3()
const _surfaceNormal = new THREE.Vector3()

/**
 * Returns triangle data backed by *shared* vectors — cheap, allocation-free.
 * Callers MUST consume the returned vectors before requesting another
 * triangle; use `getTriangleSurfaceDataOwned` if you need to keep the values.
 */
export function getTriangleSurfaceData(geometry: THREE.BufferGeometry, triangleIndex: number) {
  const v = getTriangleVertices(geometry, triangleIndex, _surfaceA, _surfaceB, _surfaceC)
  if (!v) return null
  const cache = getCache(geometry)
  if (triangleIndex >= cache.triangleCount) return null
  _surfaceCentroid.set(cache.centroidsX[triangleIndex], cache.centroidsY[triangleIndex], cache.centroidsZ[triangleIndex])
  _surfaceNormal.set(cache.normalsX[triangleIndex], cache.normalsY[triangleIndex], cache.normalsZ[triangleIndex])
  return {
    a: _surfaceA, b: _surfaceB, c: _surfaceC, indices: v.indices,
    centroid: _surfaceCentroid, normal: _surfaceNormal,
  } as TriangleSurface
}

/** Like `getTriangleSurfaceData` but returns owned copies — use when storing the result. */
export function getTriangleSurfaceDataOwned(geometry: THREE.BufferGeometry, triangleIndex: number) {
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const v = getTriangleVertices(geometry, triangleIndex, a, b, c)
  if (!v) return null
  const cache = getCache(geometry)
  if (triangleIndex >= cache.triangleCount) return null
  const centroid = new THREE.Vector3(cache.centroidsX[triangleIndex], cache.centroidsY[triangleIndex], cache.centroidsZ[triangleIndex])
  const normal = new THREE.Vector3(cache.normalsX[triangleIndex], cache.normalsY[triangleIndex], cache.normalsZ[triangleIndex])
  return { a, b, c, indices: v.indices, centroid, normal } as TriangleSurface
}

/** Triangle area — pulled from the cache. */
export function getTriangleArea(geometry: THREE.BufferGeometry, triangleIndex: number) {
  const cache = getCache(geometry)
  return triangleIndex < cache.triangleCount ? cache.areas[triangleIndex] : 0
}

// -----------------------------------------------------------------------------
// Brush queries (spatial-hash accelerated).
// -----------------------------------------------------------------------------

export function collectTrianglesInBrush(
  mesh: THREE.Mesh,
  pointLocal: THREE.Vector3,
  radius: number,
) {
  const geometry = mesh.geometry
  if (!(geometry instanceof THREE.BufferGeometry)) return []
  const cache = getCache(geometry)
  const radiusSq = radius * radius

  // Find cell-range that the radius covers.
  const lo = (axis: 'X' | 'Y' | 'Z', value: number, count: number) => {
    const origin = axis === 'X' ? cache.cellOriginX : axis === 'Y' ? cache.cellOriginY : cache.cellOriginZ
    return Math.max(0, Math.min(count - 1, Math.floor((value - origin) / cache.cellSize)))
  }
  const cxLo = lo('X', pointLocal.x - radius, cache.cellsX)
  const cxHi = lo('X', pointLocal.x + radius, cache.cellsX)
  const cyLo = lo('Y', pointLocal.y - radius, cache.cellsY)
  const cyHi = lo('Y', pointLocal.y + radius, cache.cellsY)
  const czLo = lo('Z', pointLocal.z - radius, cache.cellsZ)
  const czHi = lo('Z', pointLocal.z + radius, cache.cellsZ)

  const result: number[] = []
  const px = pointLocal.x, py = pointLocal.y, pz = pointLocal.z

  for (let cz = czLo; cz <= czHi; cz += 1) {
    for (let cy = cyLo; cy <= cyHi; cy += 1) {
      for (let cx = cxLo; cx <= cxHi; cx += 1) {
        const cellIdx = cx + cy * cache.cellsX + cz * cache.cellsX * cache.cellsY
        const start = cache.cellStart[cellIdx]
        const end = cache.cellEnd[cellIdx]
        for (let k = start; k < end; k += 1) {
          const t = cache.cellTriangleIds[k]
          const dx = cache.centroidsX[t] - px
          const dy = cache.centroidsY[t] - py
          const dz = cache.centroidsZ[t] - pz
          if (dx * dx + dy * dy + dz * dz <= radiusSq) result.push(t)
        }
      }
    }
  }

  return result
}

/**
 * Returns the closest triangle to `pointLocal` in the mesh — useful for
 * grooming operations when the cursor isn't over the scalp directly (e.g.
 * combing the tips of strands that hang past the silhouette).
 */
export function findClosestTriangle(mesh: THREE.Mesh, pointLocal: THREE.Vector3): number | null {
  const geometry = mesh.geometry
  if (!(geometry instanceof THREE.BufferGeometry)) return null
  const cache = getCache(geometry)
  if (cache.triangleCount === 0) return null

  let bestT = -1
  let bestDistSq = Infinity
  const px = pointLocal.x, py = pointLocal.y, pz = pointLocal.z
  for (let t = 0; t < cache.triangleCount; t += 1) {
    const dx = cache.centroidsX[t] - px
    const dy = cache.centroidsY[t] - py
    const dz = cache.centroidsZ[t] - pz
    const d = dx * dx + dy * dy + dz * dz
    if (d < bestDistSq) { bestDistSq = d; bestT = t }
  }
  return bestT >= 0 ? bestT : null
}

// -----------------------------------------------------------------------------
// Binding resolution (used by guide rooting).
// -----------------------------------------------------------------------------

const _bindA = new THREE.Vector3()
const _bindB = new THREE.Vector3()
const _bindC = new THREE.Vector3()
const _bindNormalMatrix = new THREE.Matrix3()
const _bindWorldNormal = new THREE.Vector3()

export function resolveScalpBinding(binding: ScalpBinding, mesh: THREE.Mesh) {
  const geometry = mesh.geometry
  if (!(geometry instanceof THREE.BufferGeometry)) return null

  const v = getTriangleVertices(geometry, binding.triangleIndex, _bindA, _bindB, _bindC)
  if (!v) return null

  const [wa, wb, wc] = binding.barycentric
  const localPosition = new THREE.Vector3()
    .addScaledVector(_bindA, wa)
    .addScaledVector(_bindB, wb)
    .addScaledVector(_bindC, wc)

  const cache = getCache(geometry)
  const localNormal = new THREE.Vector3(
    cache.normalsX[binding.triangleIndex],
    cache.normalsY[binding.triangleIndex],
    cache.normalsZ[binding.triangleIndex],
  )
  localPosition.addScaledVector(localNormal, binding.localNormalOffset)

  const worldPosition = localPosition.clone().applyMatrix4(mesh.matrixWorld)
  _bindNormalMatrix.getNormalMatrix(mesh.matrixWorld)
  const worldNormal = _bindWorldNormal.copy(localNormal).applyMatrix3(_bindNormalMatrix).normalize().clone()

  return { localPosition, worldPosition, localNormal, worldNormal }
}
