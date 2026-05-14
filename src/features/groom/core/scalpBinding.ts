import * as THREE from 'three'
import type { ScalpBinding } from './types'

const barycentricTarget = new THREE.Vector3()
const centroidTarget = new THREE.Vector3()

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

export function computeBarycentricForPoint(
  point: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): [number, number, number] {
  THREE.Triangle.getBarycoord(point, a, b, c, barycentricTarget)
  return [barycentricTarget.x, barycentricTarget.y, barycentricTarget.z]
}

export function getTriangleSurfaceData(geometry: THREE.BufferGeometry, triangleIndex: number) {
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const vertices = getTriangleVertices(geometry, triangleIndex, a, b, c)
  if (!vertices) return null

  const centroid = centroidTarget.copy(a).add(b).add(c).multiplyScalar(1 / 3).clone()
  const normal = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3())
  return {
    ...vertices,
    centroid,
    normal,
  }
}

export function collectTrianglesInBrush(
  mesh: THREE.Mesh,
  pointLocal: THREE.Vector3,
  radius: number,
) {
  const geometry = mesh.geometry
  if (!(geometry instanceof THREE.BufferGeometry)) return []

  const radiusSq = radius * radius
  const triangleCount = getTriangleCount(geometry)
  const result: number[] = []

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const data = getTriangleSurfaceData(geometry, triangleIndex)
    if (!data) continue

    if (data.centroid.distanceToSquared(pointLocal) <= radiusSq) {
      result.push(triangleIndex)
    }
  }

  return result
}

export function resolveScalpBinding(binding: ScalpBinding, mesh: THREE.Mesh) {
  const geometry = mesh.geometry
  if (!(geometry instanceof THREE.BufferGeometry)) return null

  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const vertices = getTriangleVertices(geometry, binding.triangleIndex, a, b, c)
  if (!vertices) return null

  const [wa, wb, wc] = binding.barycentric
  const localPosition = new THREE.Vector3()
    .addScaledVector(a, wa)
    .addScaledVector(b, wb)
    .addScaledVector(c, wc)

  const localNormal = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3())
  localPosition.addScaledVector(localNormal, binding.localNormalOffset)

  const worldPosition = localPosition.clone().applyMatrix4(mesh.matrixWorld)
  const worldNormal = localNormal
    .clone()
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld))
    .normalize()

  return {
    localPosition,
    worldPosition,
    localNormal,
    worldNormal,
  }
}
