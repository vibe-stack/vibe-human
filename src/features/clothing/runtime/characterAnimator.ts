import * as THREE from 'three/webgpu'
import { applyRestPose, type PreparedCharacter } from './characterRig'
import type { BakedClip } from './animationRetarget'

// Fixed-step character animation with root motion.
//
// The cloth loop advances this animator in exactly the same fixed steps as the
// solver, so the skin pose the cloth collides against at step N is the pose
// the character was animated to at step N — no frame-rate-dependent mismatch.

export class CharacterAnimator {
  readonly character: PreparedCharacter
  readonly mixer: THREE.AnimationMixer
  readonly clips = new Map<string, BakedClip>()
  /** Playback speed multiplier ("movement intensity"). */
  timeScale = 1
  /** When false the root motion is ignored and the character stays in place. */
  travel = true
  private current: THREE.AnimationAction | null = null
  private currentId: string | null = null
  private readonly actions = new Map<string, THREE.AnimationAction>()
  private readonly yAxis = new THREE.Vector3(0, 1, 0)
  private readonly scratch = new THREE.Vector3()

  constructor(character: PreparedCharacter) {
    this.character = character
    this.mixer = new THREE.AnimationMixer(character.model)
  }

  get playing() {
    return this.currentId
  }

  addClip(id: string, baked: BakedClip) {
    this.clips.set(id, baked)
  }

  /** Cross-fade to clip `id` (from the bind pose if nothing is playing). */
  play(id: string, fade = 0.35) {
    const baked = this.clips.get(id)
    if (!baked) return
    if (this.currentId === id && this.current) return
    let action = this.actions.get(id)
    if (!action) {
      action = this.mixer.clipAction(baked.clip)
      this.actions.set(id, action)
    }
    action.reset()
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.enabled = true
    action.setEffectiveTimeScale(1)
    action.setEffectiveWeight(1)
    if (this.current && this.current !== action) {
      action.play()
      this.current.crossFadeTo(action, fade, false)
    } else {
      action.fadeIn(fade).play()
    }
    this.current = action
    this.currentId = id
  }

  /** Advance animation and root motion by `dt` seconds of simulation time. */
  step(dt: number) {
    const scaled = dt * this.timeScale
    if (this.travel) this.applyRootMotion(scaled)
    this.mixer.update(scaled)
  }

  /** Stop everything and return to the bind pose at the origin. */
  reset() {
    this.mixer.stopAllAction()
    this.current = null
    this.currentId = null
    applyRestPose(this.character.restPose)
    this.character.container.position.set(0, 0, 0)
    this.character.container.quaternion.identity()
    this.character.container.updateMatrixWorld(true)
  }

  dispose() {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.character.model)
  }

  private applyRootMotion(dt: number) {
    const container = this.character.container
    let yawRate = 0
    const velocity = this.scratch.set(0, 0, 0)
    for (const [id, action] of this.actions) {
      if (!action.isRunning()) continue
      const weight = action.getEffectiveWeight()
      if (weight <= 0) continue
      const motion = this.clips.get(id)?.rootMotion
      if (!motion) continue
      velocity.addScaledVector(motion.velocity, weight)
      yawRate += motion.yawRate * weight
    }
    if (velocity.lengthSq() === 0 && yawRate === 0) return
    velocity.multiplyScalar(dt).applyQuaternion(container.quaternion)
    container.position.add(velocity)
    container.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(this.yAxis, yawRate * dt))
  }
}
