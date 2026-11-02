import * as THREE from 'three/webgpu'
import { KinematicBodyCollider } from '../simulation/collision/kinematicBodyCollider'
import { BODY_PARTS, type BodyPart, type PreparedCharacter } from './characterRig'

// The collision body of an animated character.
//
// Built from every visible mesh under the character, skinned or rigidly
// parented to a bone (Quaternius-style robots, props, visors), so no assumption
// about how a model is split into meshes. The render meshes are clustered into
// a lighter proxy (vertex clustering per body part — clusters never merge an arm
// into the torso, so no webbing appears across the armpit when the arm moves)
// and re-skinned on the CPU once per fixed step.

// The cloth lattice is ~3–4 cm; a 2 cm skin keeps body shape while keeping
// broad-phase candidate lists short (the dominant collision cost).
const TARGET_MAX_TRIANGLES = 8000

type SkinnedSource = { kind: 'skinned'; mesh: THREE.SkinnedMesh }

type RigidSource = { kind: 'rigid'; mesh: THREE.Mesh }

type MeshSource = SkinnedSource | RigidSource

export type CharacterBodyOptions = {
  /** Cloth rest distance above the skin (m). */
  thickness?: number
  friction?: number
  /** Clustering cell size (m); smaller = more faithful, slower. */
  cellSize?: number
}

export class CharacterBody {
  readonly character: PreparedCharacter
  readonly collider: KinematicBodyCollider
  /** Body part of each collider vertex. */
  readonly vertexPart: Uint8Array
  readonly triangleCount: number
  readonly vertexCount: number
  /** Latest sampled skin positions (world space). */
  readonly vertices: Float32Array
  private readonly sources: MeshSource[]
  private readonly vertexSource: Uint16Array
  private readonly basePositions: Float32Array
  private readonly skinIndex: Uint16Array
  private readonly skinWeight: Float32Array
  private readonly skinMatrices: Float32Array[]
  private readonly scratchMatrix = new THREE.Matrix4()
  private readonly lastRoot = new THREE.Vector3()
  private readonly rootStep = new Float32Array(3)

  constructor(character: PreparedCharacter, options: CharacterBodyOptions = {}) {
    this.character = character
    character.container.updateMatrixWorld(true)
    const sources = collectMeshSources(character.model)
    if (sources.length === 0) throw new Error('Character has no meshes to collide with')
    this.sources = sources

    const height = character.height || 1.75
    let cellSize = options.cellSize ?? 0.02 * (height / 1.75)
    let topology = clusterTopology(sources, character, cellSize)
    while (topology.indices.length / 3 > TARGET_MAX_TRIANGLES && cellSize < 0.05) {
      cellSize *= 1.25
      topology = clusterTopology(sources, character, cellSize)
    }

    this.vertexCount = topology.vertexCount
    this.triangleCount = topology.indices.length / 3
    this.vertexPart = topology.vertexPart
    this.vertexSource = topology.vertexSource
    this.basePositions = topology.basePositions
    this.skinIndex = topology.skinIndex
    this.skinWeight = topology.skinWeight
    this.skinMatrices = sources.map((source) => new Float32Array(source.kind === 'skinned' ? source.mesh.skeleton.bones.length * 16 : 16))
    this.vertices = new Float32Array(this.vertexCount * 3)
    this.collider = new KinematicBodyCollider(topology.indices, this.vertexCount, {
      thickness: options.thickness ?? 0.008,
      friction: options.friction ?? 0.6,
    })
    this.sample()
    this.collider.pushPose(this.vertices, true)
  }

  /** Re-skin the proxy from the current skeleton pose (call after updateMatrixWorld). */
  sample() {
    for (let s = 0; s < this.sources.length; s += 1) {
      const source = this.sources[s]
      const out = this.skinMatrices[s]
      if (source.kind === 'rigid') {
        out.set(source.mesh.matrixWorld.elements)
        continue
      }
      const mesh = source.mesh
      const skeleton = mesh.skeleton
      // world = matrixWorld · bindMatrixInverse · Σ wᵢ (boneWorldᵢ · boneInverseᵢ) · bindMatrix · v
      const meshToWorld = this.scratchMatrix.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse)
      const boneMatrix = new THREE.Matrix4()
      for (let b = 0; b < skeleton.bones.length; b += 1) {
        boneMatrix.multiplyMatrices(skeleton.bones[b].matrixWorld, skeleton.boneInverses[b])
        boneMatrix.premultiply(meshToWorld)
        out.set(boneMatrix.elements, b * 16)
      }
    }

    const { vertices, vertexSource, basePositions, skinIndex, skinWeight, skinMatrices } = this
    for (let v = 0; v < this.vertexCount; v += 1) {
      const matrices = skinMatrices[vertexSource[v]]
      const bx = basePositions[v * 3]
      const by = basePositions[v * 3 + 1]
      const bz = basePositions[v * 3 + 2]
      let x = 0
      let y = 0
      let z = 0
      for (let k = 0; k < 4; k += 1) {
        const weight = skinWeight[v * 4 + k]
        if (weight === 0) continue
        const m = skinIndex[v * 4 + k] * 16
        x += weight * (matrices[m] * bx + matrices[m + 4] * by + matrices[m + 8] * bz + matrices[m + 12])
        y += weight * (matrices[m + 1] * bx + matrices[m + 5] * by + matrices[m + 9] * bz + matrices[m + 13])
        z += weight * (matrices[m + 2] * bx + matrices[m + 6] * by + matrices[m + 10] * bz + matrices[m + 14])
      }
      vertices[v * 3] = x
      vertices[v * 3 + 1] = y
      vertices[v * 3 + 2] = z
    }
  }

  /**
   * Sample the current pose and hand it to the collider as the end of the next
   * fixed step. `teleport` snaps (reset, character switch) so no skin velocity
   * is implied.
   */
  update(teleport = false) {
    this.character.container.updateMatrixWorld(true)
    this.sample()
    const root = this.character.container.position
    this.rootStep[0] = root.x - this.lastRoot.x
    this.rootStep[1] = root.y - this.lastRoot.y
    this.rootStep[2] = root.z - this.lastRoot.z
    this.lastRoot.copy(root)
    this.collider.pushPose(this.vertices, teleport, this.rootStep)
  }

  partIndex(part: BodyPart) {
    return BODY_PARTS.indexOf(part)
  }
}

function collectMeshSources(model: THREE.Object3D): MeshSource[] {
  const sources: MeshSource[] = []
  model.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !mesh.visible) return
    const position = mesh.geometry?.getAttribute('position')
    if (!position || position.count < 3) return
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    if (material && (material as THREE.Material).transparent && (material as THREE.Material).opacity < 0.2) return
    const skinned = mesh as THREE.SkinnedMesh
    if (skinned.isSkinnedMesh && skinned.skeleton && skinned.geometry.getAttribute('skinIndex')) {
      sources.push({ kind: 'skinned', mesh: skinned })
    } else {
      sources.push({ kind: 'rigid', mesh })
    }
  })
  return sources
}

type ClusterTopology = {
  vertexCount: number
  indices: Uint32Array
  vertexPart: Uint8Array
  vertexSource: Uint16Array
  basePositions: Float32Array
  skinIndex: Uint16Array
  skinWeight: Float32Array
}

function clusterTopology(sources: MeshSource[], character: PreparedCharacter, cellSize: number): ClusterTopology {
  const rig = character.rig
  const inv = 1 / cellSize
  const world = new THREE.Vector3()
  const local = new THREE.Vector3()

  // Pass 1: every source vertex → world rest position, body part, cluster key.
  type Vertex = { source: number; index: number; x: number; y: number; z: number; part: number; cluster: number }
  const perSource: Vertex[][] = []
  const clusterOf = new Map<string, number>()
  const clusterSum: number[] = []
  const clusterCount: number[] = []

  sources.forEach((source, sourceIndex) => {
    const mesh = source.mesh
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    const list: Vertex[] = []
    const rigidPart = rig ? partForObject(mesh, rig.partOfBone) : 0
    for (let i = 0; i < position.count; i += 1) {
      local.fromBufferAttribute(position, i)
      if (source.kind === 'skinned') {
        source.mesh.applyBoneTransform(i, world.copy(local))
        world.applyMatrix4(mesh.matrixWorld)
      } else {
        world.copy(local).applyMatrix4(mesh.matrixWorld)
      }
      const part = source.kind === 'skinned' && rig ? dominantPart(source.mesh, i, rig.partOfBone) : rigidPart
      const key = `${part}:${Math.floor(world.x * inv)}:${Math.floor(world.y * inv)}:${Math.floor(world.z * inv)}`
      let cluster = clusterOf.get(key)
      if (cluster === undefined) {
        cluster = clusterCount.length
        clusterOf.set(key, cluster)
        clusterSum.push(0, 0, 0)
        clusterCount.push(0)
      }
      clusterSum[cluster * 3] += world.x
      clusterSum[cluster * 3 + 1] += world.y
      clusterSum[cluster * 3 + 2] += world.z
      clusterCount[cluster] += 1
      list.push({ source: sourceIndex, index: i, x: world.x, y: world.y, z: world.z, part, cluster })
    }
    perSource.push(list)
  })

  // Pass 2: representative = the real vertex nearest its cluster centroid, so
  // the proxy is re-skinned with genuine skin weights.
  const clusterCountTotal = clusterCount.length
  const representative = new Array<Vertex | null>(clusterCountTotal).fill(null)
  const bestDist = new Float64Array(clusterCountTotal).fill(Infinity)
  for (const list of perSource) {
    for (const vertex of list) {
      const cluster = vertex.cluster
      const n = clusterCount[cluster]
      const dx = vertex.x - clusterSum[cluster * 3] / n
      const dy = vertex.y - clusterSum[cluster * 3 + 1] / n
      const dz = vertex.z - clusterSum[cluster * 3 + 2] / n
      const dist = dx * dx + dy * dy + dz * dz
      if (dist < bestDist[cluster]) { bestDist[cluster] = dist; representative[cluster] = vertex }
    }
  }

  // Pass 3: remap triangles, fixing per-mesh winding so normals face outward.
  const indices: number[] = []
  const seen = new Set<string>()
  sources.forEach((source, sourceIndex) => {
    const geometry = source.mesh.geometry
    const list = perSource[sourceIndex]
    const index = geometry.index
    const triangleCount = index ? index.count / 3 : list.length / 3
    const at = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k)
    // Signed volume of the source mesh in rest pose: negative = inward winding.
    let volume = 0
    for (let t = 0; t < triangleCount; t += 1) {
      const a = list[at(t, 0)], b = list[at(t, 1)], c = list[at(t, 2)]
      volume += a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)
    }
    const flip = volume < 0
    for (let t = 0; t < triangleCount; t += 1) {
      const a = list[at(t, 0)].cluster
      const b = list[at(t, 1)].cluster
      const c = list[at(t, 2)].cluster
      if (a === b || b === c || a === c) continue
      const key = [a, b, c].sort((x, y) => x - y).join(',')
      if (seen.has(key)) continue
      seen.add(key)
      if (flip) indices.push(a, c, b)
      else indices.push(a, b, c)
    }
  })

  // Compact to clusters actually referenced by a triangle.
  const remap = new Int32Array(clusterCountTotal).fill(-1)
  let vertexCount = 0
  for (const cluster of indices) if (remap[cluster] < 0) remap[cluster] = vertexCount++
  const vertexPart = new Uint8Array(vertexCount)
  const vertexSource = new Uint16Array(vertexCount)
  const basePositions = new Float32Array(vertexCount * 3)
  const skinIndex = new Uint16Array(vertexCount * 4)
  const skinWeight = new Float32Array(vertexCount * 4)
  for (let cluster = 0; cluster < clusterCountTotal; cluster += 1) {
    const v = remap[cluster]
    if (v < 0) continue
    const rep = representative[cluster]!
    const source = sources[rep.source]
    vertexPart[v] = rep.part
    vertexSource[v] = rep.source
    local.fromBufferAttribute(source.mesh.geometry.getAttribute('position') as THREE.BufferAttribute, rep.index)
    if (source.kind === 'skinned') {
      local.applyMatrix4(source.mesh.bindMatrix)
      const si = source.mesh.geometry.getAttribute('skinIndex') as THREE.BufferAttribute
      const sw = source.mesh.geometry.getAttribute('skinWeight') as THREE.BufferAttribute
      let total = 0
      for (let k = 0; k < 4; k += 1) {
        skinIndex[v * 4 + k] = si.getComponent(rep.index, k)
        const weight = sw.getComponent(rep.index, k)
        skinWeight[v * 4 + k] = weight
        total += weight
      }
      if (total > 0 && Math.abs(total - 1) > 1e-4) for (let k = 0; k < 4; k += 1) skinWeight[v * 4 + k] /= total
    } else {
      skinIndex[v * 4] = 0
      skinWeight[v * 4] = 1
    }
    basePositions[v * 3] = local.x
    basePositions[v * 3 + 1] = local.y
    basePositions[v * 3 + 2] = local.z
  }

  return {
    vertexCount,
    indices: Uint32Array.from(indices, (cluster) => remap[cluster]),
    vertexPart,
    vertexSource,
    basePositions,
    skinIndex,
    skinWeight,
  }
}

function dominantPart(mesh: THREE.SkinnedMesh, vertex: number, partOfBone: Map<THREE.Bone, BodyPart>) {
  const si = mesh.geometry.getAttribute('skinIndex') as THREE.BufferAttribute
  const sw = mesh.geometry.getAttribute('skinWeight') as THREE.BufferAttribute
  let best = 0
  let bestWeight = -1
  for (let k = 0; k < 4; k += 1) {
    const weight = sw.getComponent(vertex, k)
    if (weight > bestWeight) { bestWeight = weight; best = si.getComponent(vertex, k) }
  }
  const bone = mesh.skeleton.bones[best]
  return BODY_PARTS.indexOf(bone ? partOfBone.get(bone) ?? 'torso' : 'torso')
}

function partForObject(object: THREE.Object3D, partOfBone: Map<THREE.Bone, BodyPart>) {
  let current: THREE.Object3D | null = object
  while (current) {
    const part = partOfBone.get(current as THREE.Bone)
    if (part) return BODY_PARTS.indexOf(part)
    current = current.parent
  }
  return 0
}
