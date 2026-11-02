import * as THREE from 'three/webgpu'
import { applyRestPose, normalizeBoneName, type PreparedCharacter } from './characterRig'

// Animation retargeting + root-motion extraction.
//
// Clips are re-baked in character space: for every mapped bone the source's
// world rotation *delta from its rest pose* is applied to the target's rest
// pose, after a per-bone calibration that aligns the target rest bone direction
// with the source's (so a T-pose clip drives an A-pose rig correctly). Bones are
// matched by normalised name first (any Mixamo variant) and by semantic role
// from the skeleton analysis otherwise (Quaternius, Cesium, custom rigs).
//
// Root motion is extracted from the hips: the clip is baked *in place* with the
// linear part of the hips' horizontal travel and yaw removed, and that motion
// is returned as a velocity + yaw rate that the animator applies to the
// character container. Cross-fades between clips therefore blend velocities
// instead of sliding the body back to the clip origin, and loops never pop.

const SAMPLE_RATE = 30

export type RootMotion = {
  /** Container-space horizontal velocity (m/s) at clip time scale 1. */
  velocity: THREE.Vector3
  /** Yaw rate (rad/s). */
  yawRate: number
}

export type BakedClip = {
  clip: THREE.AnimationClip
  rootMotion: RootMotion
  /** Number of target bones that received animation. */
  mappedBones: number
}

type RestData = {
  worldQuat: Map<THREE.Object3D, THREE.Quaternion>
  worldPos: Map<THREE.Object3D, THREE.Vector3>
}

/**
 * Bake `clip` (authored for `source`) onto `target`. Pass the same character as
 * source and target to bake a character's own clip in place with root motion
 * extracted.
 */
export function bakeClip(clip: THREE.AnimationClip, source: PreparedCharacter, target: PreparedCharacter, name = clip.name): BakedClip | null {
  const sourceRig = source.rig
  const targetRig = target.rig
  if (!sourceRig || !targetRig) return null

  applyRestPose(source.restPose)
  applyRestPose(target.restPose)
  const sourceRest = captureCharacterSpace(source, sourceRig.bones)
  const targetRest = captureCharacterSpace(target, targetRig.bones)

  // Bone mapping target → source.
  const sourceByName = new Map(sourceRig.bones.map((bone) => [normalizeBoneName(bone.name), bone]))
  const mapping = new Map<THREE.Bone, THREE.Bone>()
  for (const bone of targetRig.bones) {
    const byName = source === target ? bone : sourceByName.get(normalizeBoneName(bone.name))
    if (byName) { mapping.set(bone, byName); continue }
    const role = targetRig.roleOfBone.get(bone)
    const byRole = role ? sourceRig.boneByRole.get(role) : undefined
    if (byRole) mapping.set(bone, byRole)
  }
  if (!mapping.has(targetRig.hips) || mapping.size < 6) return null

  // Per-bone calibration: rotate the target rest pose so each mapped bone points
  // where the source rest bone points.
  const calibration = new Map<THREE.Bone, THREE.Quaternion>()
  for (const [targetBone, sourceBone] of mapping) {
    const q = new THREE.Quaternion()
    if (targetBone !== targetRig.hips && source !== target) {
      const targetChild = primaryMappedChild(targetBone, mapping)
      const sourceChild = targetChild ? mapping.get(targetChild) : undefined
      if (targetChild && sourceChild) {
        const dt = targetRest.worldPos.get(targetChild)!.clone().sub(targetRest.worldPos.get(targetBone)!)
        const ds = sourceRest.worldPos.get(sourceChild)!.clone().sub(sourceRest.worldPos.get(sourceBone)!)
        if (dt.lengthSq() > 1e-10 && ds.lengthSq() > 1e-10) q.setFromUnitVectors(dt.normalize(), ds.normalize())
      }
    }
    calibration.set(targetBone, q)
  }

  // Sample the source.
  const mixer = new THREE.AnimationMixer(source.model)
  const action = mixer.clipAction(clip)
  action.setLoop(THREE.LoopOnce, 1)
  action.clampWhenFinished = true
  action.play()
  const frameCount = Math.max(2, Math.round(clip.duration * SAMPLE_RATE) + 1)
  const times = new Float32Array(frameCount)
  const sourceWorld: Array<Map<THREE.Bone, THREE.Quaternion>> = []
  const sourceHips: THREE.Vector3[] = []
  const containerInverse = new THREE.Matrix4()
  const containerQuatInverse = new THREE.Quaternion()
  for (let f = 0; f < frameCount; f += 1) {
    const t = Math.min(clip.duration, f / SAMPLE_RATE)
    times[f] = t
    mixer.setTime(t)
    source.container.updateMatrixWorld(true)
    containerInverse.copy(source.container.matrixWorld).invert()
    source.container.getWorldQuaternion(containerQuatInverse).invert()
    const frame = new Map<THREE.Bone, THREE.Quaternion>()
    for (const sourceBone of new Set(mapping.values())) {
      frame.set(sourceBone, sourceBone.getWorldQuaternion(new THREE.Quaternion()).premultiply(containerQuatInverse))
    }
    sourceWorld.push(frame)
    sourceHips.push(sourceRig.hips.getWorldPosition(new THREE.Vector3()).applyMatrix4(containerInverse))
  }
  action.stop()
  mixer.uncacheRoot(source.model)
  applyRestPose(source.restPose)

  // Hips trajectory in target space (scaled by leg length).
  const sourceHipsRest = sourceRest.worldPos.get(sourceRig.hips)!
  const targetHipsRest = targetRest.worldPos.get(targetRig.hips)!
  const scale = source === target ? 1 : Math.max(0.2, targetHipsRest.y) / Math.max(0.2, sourceHipsRest.y)
  const hipsPath = sourceHips.map((p) => p.clone().sub(sourceHipsRest).multiplyScalar(scale).add(targetHipsRest))

  // Root motion: linear horizontal travel and yaw between first and last frame.
  const hipsSourceRestQuat = sourceRest.worldQuat.get(mapping.get(targetRig.hips)!)!
  const yawAt = (f: number) => yawOf(sourceWorld[f].get(mapping.get(targetRig.hips)!)!.clone().multiply(hipsSourceRestQuat.clone().invert()))
  let totalYaw = 0
  for (let f = 1; f < frameCount; f += 1) totalYaw += wrapAngle(yawAt(f) - yawAt(f - 1))
  const travel = hipsPath[frameCount - 1].clone().sub(hipsPath[0]).setY(0)
  const duration = Math.max(1e-3, clip.duration)
  const isLocomotion = travel.length() > 0.05 || Math.abs(totalYaw) > 0.05
  const rootMotion: RootMotion = {
    velocity: isLocomotion ? travel.clone().divideScalar(duration) : new THREE.Vector3(),
    yawRate: isLocomotion ? totalYaw / duration : 0,
  }

  // Bake target local rotations with the root (linear) motion removed.
  const tracks: THREE.KeyframeTrack[] = []
  const quatValues = new Map<THREE.Bone, Float32Array>()
  for (const bone of targetRig.bones) if (mapping.has(bone)) quatValues.set(bone, new Float32Array(frameCount * 4))
  const hipsValues = new Float32Array(frameCount * 3)
  const hipsParentInverse = parentInverse(target, targetRig.hips)
  const targetWorld = new Map<THREE.Object3D, THREE.Quaternion>()
  const local = new THREE.Quaternion()
  const delta = new THREE.Quaternion()
  const rootYawInverse = new THREE.Quaternion()
  const yAxis = new THREE.Vector3(0, 1, 0)

  for (let f = 0; f < frameCount; f += 1) {
    const progress = times[f] / duration
    const rootYaw = isLocomotion ? totalYaw * progress : 0
    rootYawInverse.setFromAxisAngle(yAxis, -rootYaw)
    targetWorld.clear()
    for (const bone of targetRig.bones) {
      const parent = bone.parent!
      const parentWorld = targetWorld.get(parent) ?? targetRest.worldQuat.get(parent) ?? new THREE.Quaternion()
      const sourceBone = mapping.get(bone)
      let world: THREE.Quaternion
      if (sourceBone) {
        const sourceRestQuat = sourceRest.worldQuat.get(sourceBone)!
        delta.copy(sourceWorld[f].get(sourceBone)!).multiply(local.copy(sourceRestQuat).invert())
        world = delta.clone().multiply(calibration.get(bone)!).multiply(targetRest.worldQuat.get(bone)!)
        // Root yaw moves to the container, so it must leave *every* bone's world
        // rotation. Removing it from the hips alone let each child's local
        // rotation re-absorb it: the upper body kept turning with the clip and
        // snapped back by the whole turn (90–180°) at every loop seam.
        world.premultiply(rootYawInverse)
        local.copy(parentWorld).invert().multiply(world)
        const values = quatValues.get(bone)!
        if (f > 0) {
          const previous = f - 1
          const dot = values[previous * 4] * local.x + values[previous * 4 + 1] * local.y + values[previous * 4 + 2] * local.z + values[previous * 4 + 3] * local.w
          if (dot < 0) local.set(-local.x, -local.y, -local.z, -local.w)
        }
        values.set([local.x, local.y, local.z, local.w], f * 4)
      } else {
        world = parentWorld.clone().multiply(bone.quaternion)
      }
      targetWorld.set(bone, world)
    }
    const hips = hipsPath[f].clone()
    if (isLocomotion) {
      hips.sub(travel.clone().multiplyScalar(progress))
      const offset = hips.clone().sub(targetHipsRest).setY(0).applyAxisAngle(yAxis, -rootYaw)
      hips.set(targetHipsRest.x + offset.x, hips.y, targetHipsRest.z + offset.z)
    }
    hips.applyMatrix4(hipsParentInverse)
    hipsValues.set([hips.x, hips.y, hips.z], f * 3)
  }

  for (const [bone, values] of quatValues) {
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, Array.from(times), Array.from(values)))
  }
  tracks.push(new THREE.VectorKeyframeTrack(`${targetRig.hips.uuid}.position`, Array.from(times), Array.from(hipsValues)))
  applyRestPose(target.restPose)
  return { clip: new THREE.AnimationClip(name, clip.duration, tracks), rootMotion, mappedBones: mapping.size }
}

function captureCharacterSpace(character: PreparedCharacter, bones: THREE.Bone[]): RestData {
  character.container.updateMatrixWorld(true)
  const inverse = character.container.matrixWorld.clone().invert()
  const quatInverse = character.container.getWorldQuaternion(new THREE.Quaternion()).invert()
  const worldQuat = new Map<THREE.Object3D, THREE.Quaternion>()
  const worldPos = new Map<THREE.Object3D, THREE.Vector3>()
  const record = (object: THREE.Object3D) => {
    worldQuat.set(object, object.getWorldQuaternion(new THREE.Quaternion()).premultiply(quatInverse))
    worldPos.set(object, object.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse))
  }
  for (const bone of bones) {
    record(bone)
    if (bone.parent) record(bone.parent)
  }
  return { worldQuat, worldPos }
}

function parentInverse(character: PreparedCharacter, bone: THREE.Bone) {
  character.container.updateMatrixWorld(true)
  const containerInverse = character.container.matrixWorld.clone().invert()
  const parentInContainer = containerInverse.multiply(bone.parent!.matrixWorld)
  return parentInContainer.invert()
}

function primaryMappedChild(bone: THREE.Bone, mapping: Map<THREE.Bone, THREE.Bone>) {
  const mappedChildren = bone.children.filter((child): child is THREE.Bone => mapping.has(child as THREE.Bone))
  if (mappedChildren.length === 1) return mappedChildren[0]
  // Several mapped children (hand → fingers, hips → legs + spine): calibration
  // would be ambiguous, keep the rest orientation.
  return null
}

function yawOf(q: THREE.Quaternion) {
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
  return Math.atan2(forward.x, forward.z)
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}
