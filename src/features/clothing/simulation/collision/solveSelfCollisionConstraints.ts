import type { ClothSimMesh, DistanceConstraint } from '../types'

type SelfCollisionOptions = {
  radius: number
  stiffness: number
}

/**
 * Particle self-contact for cloth/cloth separation. The expensive topology and
 * storage are prepared once; each tick only refills typed arrays.
 */
export class ClothSelfCollisionSolver {
  private readonly bucketHeads: Int32Array
  private readonly bucketNext: Int32Array
  private readonly cellX: Int32Array
  private readonly cellY: Int32Array
  private readonly cellZ: Int32Array
  private readonly bucketMask: number
  private readonly adjacencyOffsets: Uint32Array
  private readonly adjacency: Uint32Array

  constructor(mesh: ClothSimMesh) {
    const bucketCount = nextPowerOfTwo(Math.max(32, mesh.particleCount * 2))
    this.bucketHeads = new Int32Array(bucketCount)
    this.bucketNext = new Int32Array(mesh.particleCount)
    this.cellX = new Int32Array(mesh.particleCount)
    this.cellY = new Int32Array(mesh.particleCount)
    this.cellZ = new Int32Array(mesh.particleCount)
    this.bucketMask = bucketCount - 1
    const adjacency = buildAdjacency(mesh)
    this.adjacencyOffsets = adjacency.offsets
    this.adjacency = adjacency.neighbors
  }

  solve(mesh: ClothSimMesh, options: SelfCollisionOptions) {
    const radius = options.radius
    const stiffness = options.stiffness
    if (mesh.particleCount < 2 || radius <= 0 || stiffness <= 0) return

    const { positions, invMass, particleCount } = mesh
    const radiusSq = radius * radius
    const invCellSize = 1 / radius
    const heads = this.bucketHeads
    const next = this.bucketNext
    const cellX = this.cellX
    const cellY = this.cellY
    const cellZ = this.cellZ
    const mask = this.bucketMask

    heads.fill(-1)
    for (let particle = 0; particle < particleCount; particle += 1) {
      const offset = particle * 3
      const cx = Math.floor(positions[offset] * invCellSize)
      const cy = Math.floor(positions[offset + 1] * invCellSize)
      const cz = Math.floor(positions[offset + 2] * invCellSize)
      const bucket = hashCell(cx, cy, cz) & mask
      cellX[particle] = cx
      cellY[particle] = cy
      cellZ[particle] = cz
      next[particle] = heads[bucket]
      heads[bucket] = particle
    }

    for (let a = 0; a < particleCount; a += 1) {
      const wa = invMass[a]
      if (wa <= 0) continue
      const acx = cellX[a]
      const acy = cellY[a]
      const acz = cellZ[a]

      for (let dx = -1; dx <= 1; dx += 1) {
        const qx = acx + dx
        for (let dy = -1; dy <= 1; dy += 1) {
          const qy = acy + dy
          for (let dz = -1; dz <= 1; dz += 1) {
            const qz = acz + dz
            let b = heads[hashCell(qx, qy, qz) & mask]
            while (b >= 0) {
              const nextB = next[b]
              if (
                b > a
                && cellX[b] === qx
                && cellY[b] === qy
                && cellZ[b] === qz
                && !this.areTopologicallyLinked(a, b)
              ) {
                this.solvePair(mesh, a, b, wa, radius, radiusSq, stiffness)
              }
              b = nextB
            }
          }
        }
      }
    }
  }

  private solvePair(
    mesh: ClothSimMesh,
    a: number,
    b: number,
    wa: number,
    radius: number,
    radiusSq: number,
    stiffness: number,
  ) {
    const { positions, invMass } = mesh
    const wb = invMass[b]
    const wsum = wa + wb
    if (wsum <= 1e-9) return

    const ia = a * 3
    const ib = b * 3
    let nx = positions[ib] - positions[ia]
    let ny = positions[ib + 1] - positions[ia + 1]
    let nz = positions[ib + 2] - positions[ia + 2]
    const distSq = nx * nx + ny * ny + nz * nz
    if (distSq >= radiusSq) return

    const worldDist = Math.sqrt(distSq)
    if (worldDist > 1e-7) {
      const invDist = 1 / worldDist
      nx *= invDist
      ny *= invDist
      nz *= invDist
    } else {
      const la = a * 2
      const lb = b * 2
      nx = mesh.panelLocalPositions[lb] - mesh.panelLocalPositions[la]
      ny = 0
      nz = mesh.panelLocalPositions[lb + 1] - mesh.panelLocalPositions[la + 1]
      const localDist = Math.hypot(nx, nz)
      if (localDist > 1e-7) {
        const invDist = 1 / localDist
        nx *= invDist
        nz *= invDist
      } else {
        nx = a & 1 ? 1 : -1
        nz = 0
      }
    }

    const correction = (radius - worldDist) * stiffness
    const scaleA = correction * (wa / wsum)
    const scaleB = correction * (wb / wsum)
    positions[ia] -= nx * scaleA
    positions[ia + 1] -= ny * scaleA
    positions[ia + 2] -= nz * scaleA
    positions[ib] += nx * scaleB
    positions[ib + 1] += ny * scaleB
    positions[ib + 2] += nz * scaleB
  }

  private areTopologicallyLinked(a: number, b: number) {
    const start = this.adjacencyOffsets[a]
    const end = this.adjacencyOffsets[a + 1]
    for (let i = start; i < end; i += 1) {
      if (this.adjacency[i] === b) return true
    }
    return false
  }
}

function buildAdjacency(mesh: ClothSimMesh) {
  const particleCount = mesh.particleCount
  const pairs: number[] = []
  addDistancePairs(pairs, particleCount, mesh.stretchConstraints)
  addDistancePairs(pairs, particleCount, mesh.shearConstraints)
  addDistancePairs(pairs, particleCount, mesh.seamConstraints)

  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const a = mesh.triangles[i]
    const b = mesh.triangles[i + 1]
    const c = mesh.triangles[i + 2]
    addPair(pairs, particleCount, a, b)
    addPair(pairs, particleCount, b, c)
    addPair(pairs, particleCount, c, a)
  }

  pairs.sort((a, b) => a - b)
  let uniqueCount = 0
  let previous = -1
  for (let i = 0; i < pairs.length; i += 1) {
    const key = pairs[i]
    if (key === previous) continue
    pairs[uniqueCount] = key
    uniqueCount += 1
    previous = key
  }

  const offsets = new Uint32Array(particleCount + 1)
  for (let i = 0; i < uniqueCount; i += 1) {
    const key = pairs[i]
    const a = Math.floor(key / particleCount)
    const b = key - a * particleCount
    offsets[a + 1] += 1
    offsets[b + 1] += 1
  }
  for (let i = 1; i < offsets.length; i += 1) offsets[i] += offsets[i - 1]

  const cursor = new Uint32Array(offsets)
  const neighbors = new Uint32Array(offsets[particleCount])
  for (let i = 0; i < uniqueCount; i += 1) {
    const key = pairs[i]
    const a = Math.floor(key / particleCount)
    const b = key - a * particleCount
    neighbors[cursor[a]] = b
    cursor[a] += 1
    neighbors[cursor[b]] = a
    cursor[b] += 1
  }

  return { offsets, neighbors }
}

function addDistancePairs(pairs: number[], particleCount: number, constraints: DistanceConstraint[]) {
  for (let i = 0; i < constraints.length; i += 1) addPair(pairs, particleCount, constraints[i].a, constraints[i].b)
}

function addPair(pairs: number[], particleCount: number, a: number, b: number) {
  if (a === b || a < 0 || b < 0 || a >= particleCount || b >= particleCount) return
  pairs.push(a < b ? a * particleCount + b : b * particleCount + a)
}

function nextPowerOfTwo(value: number) {
  let power = 1
  while (power < value) power <<= 1
  return power
}

function hashCell(x: number, y: number, z: number) {
  return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0
}
