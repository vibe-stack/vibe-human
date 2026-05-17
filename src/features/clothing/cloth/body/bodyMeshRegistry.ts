import * as THREE from 'three/webgpu'
import { MeshBVH, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'

/**
 * Source of truth for "which meshes should the cloth collide with". Owned
 * by the character viewer (HumanModel), consumed by the cloth scene.
 *
 * For each registered skinned mesh we maintain a parallel collision-only
 * THREE.Mesh whose vertices are baked from the skinned source each frame,
 * with the BVH refit in place. The collision mesh is detached from the
 * scene graph (no parent) so it carries an explicit world matrix that
 * matches the live source — no surprise parent transforms.
 */

;(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree?: typeof computeBoundsTree }).computeBoundsTree ??= computeBoundsTree
;(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree?: typeof disposeBoundsTree }).disposeBoundsTree ??= disposeBoundsTree

type Listener = () => void

type RegistryEntry = {
  collisionMesh: THREE.Mesh
  source: THREE.SkinnedMesh | THREE.Mesh
  skinningScratch?: { vertex: THREE.Vector3; target: THREE.Vector3 }
}

const state = {
  entries: new Map<string, RegistryEntry>(),
  listeners: new Set<Listener>(),
}

export function registerBodyMesh(key: string, source: THREE.Mesh | THREE.SkinnedMesh) {
  unregisterBodyMesh(key)

  // Clone the geometry — the BVH lives on this clone, and `applyBoneTransform`
  // will populate it each frame. We keep a fresh `index` and `position`
  // attribute since refit relies on them being mutable.
  const baked = source.geometry.clone()
  const bvh = new MeshBVH(baked)
  ;(baked as unknown as { boundsTree?: MeshBVH }).boundsTree = bvh

  const collisionMesh = new THREE.Mesh(baked)
  // Fully manual transform — never inherit from a parent we don't control.
  collisionMesh.matrixAutoUpdate = false
  collisionMesh.matrixWorldAutoUpdate = false
  source.updateMatrixWorld(true)
  collisionMesh.matrixWorld.copy(source.matrixWorld)
  // Decompose to mirror locally too, just in case something queries .matrix.
  collisionMesh.matrix.copy(source.matrixWorld)

  state.entries.set(key, {
    collisionMesh,
    source,
    skinningScratch: (source as THREE.SkinnedMesh).isSkinnedMesh
      ? { vertex: new THREE.Vector3(), target: new THREE.Vector3() }
      : undefined,
  })
  state.listeners.forEach((l) => l())
}

export function unregisterBodyMesh(key: string) {
  const entry = state.entries.get(key)
  if (!entry) return
  const geom = entry.collisionMesh.geometry as THREE.BufferGeometry & { disposeBoundsTree?: () => void }
  geom.disposeBoundsTree?.()
  geom.dispose()
  state.entries.delete(key)
  state.listeners.forEach((l) => l())
}

export function unregisterAll() {
  for (const k of [...state.entries.keys()]) unregisterBodyMesh(k)
}

export function getBodyCollisionMeshes(): THREE.Mesh[] {
  return Array.from(state.entries.values(), (e) => e.collisionMesh)
}

export function subscribeBodyMesh(fn: Listener): () => void {
  state.listeners.add(fn)
  return () => { state.listeners.delete(fn) }
}

/**
 * Walk every registered source mesh, bake its current pose into the
 * collision mesh's position attribute, and refit the BVH in place. No
 * allocations, no normal recomputation (BVH doesn't need normals;
 * `getTriangleNormal` in the solver derives them from positions).
 */
export function refitBodyMeshes() {
  if (state.entries.size === 0) return
  for (const entry of state.entries.values()) refitEntry(entry)
}

function refitEntry(entry: RegistryEntry) {
  entry.source.updateMatrixWorld(true)
  entry.collisionMesh.matrixWorld.copy(entry.source.matrixWorld)
  entry.collisionMesh.matrix.copy(entry.source.matrixWorld)

  const skinned = entry.source as THREE.SkinnedMesh
  if (!skinned.isSkinnedMesh || !entry.skinningScratch) return

  const srcPos = skinned.geometry.getAttribute('position') as THREE.BufferAttribute
  const dstGeom = entry.collisionMesh.geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH }
  const dstPos = dstGeom.getAttribute('position') as THREE.BufferAttribute
  const v = entry.skinningScratch.vertex
  const t = entry.skinningScratch.target
  for (let i = 0; i < srcPos.count; i += 1) {
    v.fromBufferAttribute(srcPos, i)
    skinned.applyBoneTransform(i, t.copy(v))
    dstPos.setXYZ(i, t.x, t.y, t.z)
  }
  dstPos.needsUpdate = true
  // BVH refit is enough — we don't need normals for collision queries,
  // they're recomputed per-triangle from indices in the solver.
  dstGeom.boundsTree?.refit()
}
