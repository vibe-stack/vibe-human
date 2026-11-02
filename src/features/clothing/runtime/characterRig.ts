import * as THREE from 'three/webgpu'

// Character preparation and humanoid skeleton analysis.
//
// Nothing here depends on bone *names*: landmarks come from the bone hierarchy
// and rest-pose geometry (legs are the subtrees that reach the ground, the spine
// is the subtree that reaches highest, arms branch sideways off the spine).
// Name patterns are only used as tie-breakers inside a chain that topology has
// already identified (e.g. which bone of an arm chain is the wrist), so Mixamo,
// Quaternius, Cesium and hand-made rigs all resolve the same way.

export type BodyPart = 'torso' | 'head' | 'armL' | 'armR' | 'legL' | 'legR'

export const BODY_PARTS: BodyPart[] = ['torso', 'head', 'armL', 'armR', 'legL', 'legR']

export type Limb = {
  /** Bones from the limb root (clavicle / thigh) to its tip. */
  bones: THREE.Bone[]
  /** Proximal joint (shoulder joint / hip joint), character space. */
  root: THREE.Vector3
  /** Middle joint (elbow / knee). */
  mid: THREE.Vector3
  /** Distal joint (wrist / ankle). */
  end: THREE.Vector3
  /** Farthest point (finger tip / toe). */
  tip: THREE.Vector3
  upper: THREE.Bone | null
  lower: THREE.Bone | null
  hand: THREE.Bone | null
}

export type HumanoidRig = {
  bones: THREE.Bone[]
  hips: THREE.Bone
  /** Spine chain from the hips (exclusive) up to the head (inclusive). */
  spine: THREE.Bone[]
  chest: THREE.Bone
  neck: THREE.Bone | null
  head: THREE.Bone | null
  neckBase: THREE.Vector3
  headTop: number
  arms: { L: Limb; R: Limb }
  legs: { L: Limb; R: Limb }
  partOfBone: Map<THREE.Bone, BodyPart>
  /** Semantic role per bone (e.g. 'armL.upper', 'spine1'), used to retarget across naming conventions. */
  roleOfBone: Map<THREE.Bone, string>
  boneByRole: Map<string, THREE.Bone>
  /** Rest-pose bone positions in character space. */
  restPosition: Map<THREE.Bone, THREE.Vector3>
  height: number
}

export type RestPose = Map<THREE.Object3D, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>

export type PreparedCharacter = {
  /** Moves the character in the world (root motion, locomotion). */
  container: THREE.Group
  /** Fixed normalisation (scale to human height, feet on y=0, facing +Z). */
  normalizer: THREE.Group
  model: THREE.Object3D
  restPose: RestPose
  rig: HumanoidRig | null
  height: number
}

const MIN_HUMAN_HEIGHT = 1.2
const MAX_HUMAN_HEIGHT = 2.4
const DEFAULT_HUMAN_HEIGHT = 1.75

/**
 * Wrap a loaded model so it stands on y=0, centred at the origin, faces +Z and
 * has a human scale. Captures the rest pose (glTF / FBX node transforms) so the
 * character can always be returned to its bind pose for dressing.
 */
export function prepareCharacter(model: THREE.Object3D): PreparedCharacter {
  const container = new THREE.Group()
  container.name = 'cloth-character'
  const normalizer = new THREE.Group()
  normalizer.name = 'cloth-character-normalizer'
  container.add(normalizer)
  normalizer.add(model)

  model.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh) mesh.frustumCulled = false
  })

  const restPose = captureRestPose(model)
  container.updateMatrixWorld(true)

  let bounds = preciseBounds(model)
  let height = bounds.max.y - bounds.min.y
  if (!(height >= MIN_HUMAN_HEIGHT && height <= MAX_HUMAN_HEIGHT) && height > 1e-6) {
    normalizer.scale.setScalar(DEFAULT_HUMAN_HEIGHT / height)
    container.updateMatrixWorld(true)
    bounds = preciseBounds(model)
    height = bounds.max.y - bounds.min.y
  }

  const center = bounds.getCenter(new THREE.Vector3())
  normalizer.position.set(-center.x, -bounds.min.y, -center.z)
  container.updateMatrixWorld(true)

  let rig = analyzeHumanoid(model, height)
  // glTF characters face +Z by convention; trust the toes when they clearly
  // disagree (some exporters face -Z).
  if (rig && facesBackward(rig)) {
    normalizer.rotation.y = Math.PI
    normalizer.position.set(center.x, -bounds.min.y, center.z)
    container.updateMatrixWorld(true)
    rig = analyzeHumanoid(model, height)
  }

  return { container, normalizer, model, restPose, rig, height }
}

export function captureRestPose(model: THREE.Object3D): RestPose {
  const pose: RestPose = new Map()
  model.traverse((object) => {
    pose.set(object, {
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    })
  })
  return pose
}

export function applyRestPose(pose: RestPose) {
  for (const [object, rest] of pose) {
    object.position.copy(rest.position)
    object.quaternion.copy(rest.quaternion)
    object.scale.copy(rest.scale)
  }
}

function preciseBounds(model: THREE.Object3D) {
  const box = new THREE.Box3()
  model.updateMatrixWorld(true)
  model.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !mesh.visible) return
    box.expandByObject(mesh, true)
  })
  if (box.isEmpty()) box.setFromObject(model)
  return box
}

function facesBackward(rig: HumanoidRig) {
  let forward = 0
  for (const leg of [rig.legs.L, rig.legs.R]) {
    const dz = leg.tip.z - leg.end.z
    const horizontal = Math.hypot(leg.tip.x - leg.end.x, dz)
    if (horizontal < 0.03) continue
    forward += dz / horizontal
  }
  return forward < -1.2
}

// ---------------------------------------------------------------------------
// Skeleton analysis
// ---------------------------------------------------------------------------

const HAND_HINT = /hand|wrist|palm/i
const FOREARM_HINT = /fore|lower|elbow/i
const FOOT_HINT = /foot|ankle/i
const SHIN_HINT = /shin|calf|lower|knee|(^|[^a-z])leg/i

export function analyzeHumanoid(model: THREE.Object3D, height: number): HumanoidRig | null {
  model.updateMatrixWorld(true)
  const bones: THREE.Bone[] = []
  model.traverse((object) => {
    if ((object as THREE.Bone).isBone) bones.push(object as THREE.Bone)
  })
  if (bones.length < 5) return null

  const boneSet = new Set(bones)
  const position = new Map<THREE.Bone, THREE.Vector3>()
  for (const bone of bones) position.set(bone, bone.getWorldPosition(new THREE.Vector3()))
  const children = (bone: THREE.Bone) => bone.children.filter((child): child is THREE.Bone => boneSet.has(child as THREE.Bone))

  // Subtree extents (min y, max y, max lateral reach) per bone.
  const extent = new Map<THREE.Bone, { minY: number; maxY: number; maxAbsX: number }>()
  const visit = (bone: THREE.Bone): { minY: number; maxY: number; maxAbsX: number } => {
    const p = position.get(bone)!
    const result = { minY: p.y, maxY: p.y, maxAbsX: Math.abs(p.x) }
    for (const child of children(bone)) {
      const e = visit(child)
      result.minY = Math.min(result.minY, e.minY)
      result.maxY = Math.max(result.maxY, e.maxY)
      result.maxAbsX = Math.max(result.maxAbsX, e.maxAbsX)
    }
    extent.set(bone, result)
    return result
  }
  const roots = bones.filter((bone) => !boneSet.has(bone.parent as THREE.Bone))
  for (const root of roots) visit(root)

  // Hips: the shallowest bone with two child subtrees that reach well below it
  // (legs) and one that reaches above it (spine).
  const depthOf = (bone: THREE.Bone) => {
    let depth = 0
    let current: THREE.Object3D | null = bone.parent
    while (current && boneSet.has(current as THREE.Bone)) { depth += 1; current = current.parent }
    return depth
  }
  let hips: THREE.Bone | null = null
  let legRoots: THREE.Bone[] = []
  let spineRoot: THREE.Bone | null = null
  const candidates = [...bones].sort((a, b) => depthOf(a) - depthOf(b))
  for (const bone of candidates) {
    const p = position.get(bone)!
    const kids = children(bone)
    // Legs: subtrees that hang well below. 10% of height, because some rigs end
    // the leg chain at the knee and keep the feet as separate IK bones.
    const down = kids.filter((child) => extent.get(child)!.minY < p.y - 0.1 * height && extent.get(child)!.maxY < p.y + 0.05 * height)
    const up = kids.filter((child) => extent.get(child)!.maxY > p.y + 0.2 * height)
    if (down.length >= 2 && up.length >= 1) {
      hips = bone
      legRoots = down.sort((a, b) => extent.get(a)!.minY - extent.get(b)!.minY).slice(0, 2)
      spineRoot = up.sort((a, b) => extent.get(b)!.maxY - extent.get(a)!.maxY)[0]
      break
    }
  }
  // Rigs whose legs hang off a root above the pelvis (or a spine bone) — fall
  // back to: spine = highest-reaching child chain, legs = two lowest subtrees.
  if (!hips || !spineRoot) return null

  // Spine: follow the child reaching highest.
  const spine: THREE.Bone[] = []
  let cursor: THREE.Bone | null = spineRoot
  while (cursor) {
    spine.push(cursor)
    const next: THREE.Bone[] = children(cursor)
    cursor = next.length ? next.sort((a, b) => extent.get(b)!.maxY - extent.get(a)!.maxY)[0] : null
  }

  // Chest: the spine bone with two lateral branches (the arms).
  let chest: THREE.Bone | null = null
  let armRoots: THREE.Bone[] = []
  for (const bone of spine) {
    const p = position.get(bone)!
    const lateral = children(bone).filter((child) => !spine.includes(child) && extent.get(child)!.maxAbsX > Math.abs(p.x) + 0.15 * height)
    if (lateral.length >= 2) {
      chest = bone
      armRoots = lateral.sort((a, b) => extent.get(b)!.maxAbsX - extent.get(a)!.maxAbsX).slice(0, 2)
      break
    }
  }
  if (!chest || armRoots.length < 2) return null

  const chestIndex = spine.indexOf(chest)
  const neck = spine[chestIndex + 1] ?? null
  const head = spine[chestIndex + 2] ?? neck
  const neckBase = (neck ? position.get(neck)! : position.get(chest)!).clone()
  const headTop = extent.get(spineRoot)!.maxY

  const buildArm = (root: THREE.Bone) => buildLimb(root, position, children, extent, 'arm', height)
  const buildLeg = (root: THREE.Bone) => buildLimb(root, position, children, extent, 'leg', height, bones)
  const [armA, armB] = armRoots.map(buildArm)
  const [legA, legB] = legRoots.map(buildLeg)
  // Character left is +X when facing +Z.
  const arms = armA.root.x >= armB.root.x ? { L: armA, R: armB } : { L: armB, R: armA }
  const legs = legA.root.x >= legB.root.x ? { L: legA, R: legB } : { L: legB, R: legA }

  const partOfBone = new Map<THREE.Bone, BodyPart>()
  const roleOfBone = new Map<THREE.Bone, string>()
  for (const bone of bones) partOfBone.set(bone, 'torso')
  const markSubtree = (bone: THREE.Bone, part: BodyPart) => {
    partOfBone.set(bone, part)
    for (const child of children(bone)) markSubtree(child, part)
  }
  for (const bone of spine.slice(chestIndex + 1)) {
    partOfBone.set(bone, 'head')
    for (const child of children(bone)) if (!spine.includes(child)) markSubtree(child, 'head')
  }
  const markLimb = (limb: Limb, part: BodyPart, prefix: string) => {
    for (const bone of limb.bones) markSubtree(bone, part)
    // A clavicle ahead of the shoulder joint belongs to the torso surface.
    for (const bone of limb.bones) {
      if (bone === limb.upper) break
      partOfBone.set(bone, 'torso')
      roleOfBone.set(bone, `${prefix}.clavicle`)
    }
    if (limb.upper) roleOfBone.set(limb.upper, `${prefix}.upper`)
    if (limb.lower) roleOfBone.set(limb.lower, `${prefix}.lower`)
    if (limb.hand) roleOfBone.set(limb.hand, `${prefix}.hand`)
    const handIndex = limb.hand ? limb.bones.indexOf(limb.hand) : -1
    if (handIndex >= 0 && limb.bones[handIndex + 1]) roleOfBone.set(limb.bones[handIndex + 1], `${prefix}.toe`)
  }
  markLimb(arms.L, 'armL', 'armL')
  markLimb(arms.R, 'armR', 'armR')
  markLimb(legs.L, 'legL', 'legL')
  markLimb(legs.R, 'legR', 'legR')
  roleOfBone.set(hips, 'hips')
  const torsoSpine = spine.slice(0, chestIndex + 1)
  torsoSpine.forEach((bone, index) => roleOfBone.set(bone, index === torsoSpine.length - 1 ? 'chest' : `spine${index}`))
  if (neck) roleOfBone.set(neck, 'neck')
  if (head && head !== neck) roleOfBone.set(head, 'head')

  const boneByRole = new Map<string, THREE.Bone>()
  for (const [bone, role] of roleOfBone) boneByRole.set(role, bone)

  return {
    bones,
    hips,
    spine,
    chest,
    neck,
    head,
    neckBase,
    headTop,
    arms,
    legs,
    partOfBone,
    roleOfBone,
    boneByRole,
    restPosition: position,
    height,
  }
}

function buildLimb(
  root: THREE.Bone,
  position: Map<THREE.Bone, THREE.Vector3>,
  children: (bone: THREE.Bone) => THREE.Bone[],
  extent: Map<THREE.Bone, { minY: number; maxY: number; maxAbsX: number }>,
  kind: 'arm' | 'leg',
  height: number,
  allBones?: THREE.Bone[],
): Limb {
  // Follow the child that reaches farthest along the limb.
  const chain: THREE.Bone[] = []
  let cursor: THREE.Bone | null = root
  while (cursor) {
    chain.push(cursor)
    const next: THREE.Bone[] = children(cursor)
    if (!next.length) break
    cursor = kind === 'arm'
      ? next.sort((a, b) => extent.get(b)!.maxAbsX - extent.get(a)!.maxAbsX)[0]
      : next.sort((a, b) => extent.get(a)!.minY - extent.get(b)!.minY)[0]
  }
  const pos = (bone: THREE.Bone) => position.get(bone)!

  if (kind === 'arm') {
    // Shoulder joint: first chain bone clearly away from the body midline (x=0
    // after normalisation), which skips a clavicle that starts at the spine.
    let upperIndex = chain.findIndex((bone, index) => index > 0 && Math.abs(pos(bone).x) > 0.035 * height)
    if (upperIndex < 0 || chain.length - upperIndex < 3) upperIndex = Math.min(1, chain.length - 1)
    if (Math.abs(pos(chain[0]).x) > 0.09 * height) upperIndex = 0
    const upper = chain[upperIndex]
    let handIndex = chain.findIndex((bone, index) => index > upperIndex + 1 && HAND_HINT.test(bone.name))
    if (handIndex < 0) handIndex = chain.findIndex((bone, index) => index > upperIndex + 1 && children(bone).length >= 3)
    if (handIndex < 0) handIndex = nearestFraction(chain, upperIndex, pos, 0.72)
    let lowerIndex = chain.findIndex((bone, index) => index > upperIndex && index < handIndex && FOREARM_HINT.test(bone.name))
    if (lowerIndex < 0) lowerIndex = Math.max(upperIndex + 1, Math.min(handIndex - 1, nearestFraction(chain, upperIndex, pos, 0.4)))
    const tip = chain.reduce((best, bone) => (Math.abs(pos(bone).x) > Math.abs(best.x) ? pos(bone) : best), pos(chain[0]))
    return {
      bones: chain,
      root: pos(upper).clone(),
      mid: pos(chain[lowerIndex]).clone(),
      end: pos(chain[handIndex]).clone(),
      tip: tip.clone(),
      upper,
      lower: chain[lowerIndex],
      hand: chain[handIndex],
    }
  }

  const hip = pos(root)
  const ground = 0
  let footIndex = chain.findIndex((bone, index) => index > 0 && FOOT_HINT.test(bone.name))
  if (footIndex < 0) footIndex = chain.findIndex((bone, index) => index > 0 && pos(bone).y < hip.y - 0.8 * (hip.y - ground))
  let ankle: THREE.Vector3
  let foot: THREE.Bone | null
  if (footIndex >= 0) {
    foot = chain[footIndex]
    ankle = pos(foot).clone()
  } else {
    // Leg chain ends at the knee (IK rigs keep the foot elsewhere): use the
    // lowest bone on this side of the body.
    const side = Math.sign(hip.x) || 1
    const lowest = (allBones ?? chain)
      .filter((bone) => Math.sign(pos(bone).x) === side && pos(bone).y < 0.2 * height)
      .sort((a, b) => pos(a).y - pos(b).y)[0]
    ankle = lowest ? pos(lowest).clone().setY(Math.max(pos(lowest).y, 0.05 * height)) : new THREE.Vector3(hip.x, 0.05 * height, hip.z)
    foot = lowest ?? null
  }
  let kneeIndex = chain.findIndex((bone, index) => index > 0 && (footIndex < 0 || index < footIndex) && SHIN_HINT.test(bone.name))
  const midY = (hip.y + ankle.y) / 2
  if (kneeIndex < 0) {
    let best = -1
    let bestDist = Infinity
    chain.forEach((bone, index) => {
      if (index === 0 || (footIndex >= 0 && index >= footIndex)) return
      const dist = Math.abs(pos(bone).y - midY)
      if (dist < bestDist) { bestDist = dist; best = index }
    })
    kneeIndex = best
  }
  const knee = kneeIndex >= 0 ? pos(chain[kneeIndex]).clone() : hip.clone().lerp(ankle, 0.5)
  const tip = footIndex >= 0 && chain[footIndex + 1] ? pos(chain[chain.length - 1]).clone() : ankle.clone()
  return {
    bones: chain,
    root: hip.clone(),
    mid: knee,
    end: ankle,
    tip,
    upper: root,
    lower: kneeIndex >= 0 ? chain[kneeIndex] : null,
    hand: foot,
  }
}

function nearestFraction(chain: THREE.Bone[], startIndex: number, pos: (bone: THREE.Bone) => THREE.Vector3, fraction: number) {
  const start = pos(chain[startIndex])
  const total = start.distanceTo(pos(chain[chain.length - 1])) || 1
  let best = Math.min(chain.length - 1, startIndex + 1)
  let bestDist = Infinity
  for (let i = startIndex + 1; i < chain.length; i += 1) {
    const f = start.distanceTo(pos(chain[i])) / total
    const dist = Math.abs(f - fraction)
    if (dist < bestDist) { bestDist = dist; best = i }
  }
  return best
}

/** Normalised bone name for cross-rig matching ("mixamorig:LeftArm" → "leftarm"). */
export function normalizeBoneName(name: string) {
  return name.replace(/^mixamorig\d*[:_]?/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

/**
 * Limb joint positions in the *current* pose (character container space),
 * falling back to the rest-pose landmark where the rig has no bone for a joint.
 */
export function currentLimbJoints(character: PreparedCharacter, limb: Limb) {
  character.container.updateMatrixWorld(true)
  const toLocal = character.container.matrixWorld.clone().invert()
  const at = (bone: THREE.Bone | null, fallback: THREE.Vector3) => (bone ? bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(toLocal) : fallback.clone())
  return { root: at(limb.upper, limb.root), mid: at(limb.lower, limb.mid), end: at(limb.hand, limb.end) }
}

/** Arm elevation the garment patterns are cut for (kimono sleeves need near-horizontal arms). */
const DRESSING_ARM_ELEVATION = -Math.PI / 18
/** Rest poses with arms lower than this are raised for dressing. */
const HANGING_ARM_ELEVATION = -Math.PI / 7

/**
 * Pose a character is dressed in: its rest pose, with arms that hang down
 * (A-pose or relaxed rest poses) raised to near-horizontal. Garments are sewn
 * with one-piece (kimono) sleeves, which only have room for the arm when the
 * arm is roughly horizontal; Mixamo T-poses are left untouched. The animation
 * then blends out of this pose.
 */
export function applyDressingPose(character: PreparedCharacter) {
  applyRestPose(character.restPose)
  character.container.updateMatrixWorld(true)
  const rig = character.rig
  if (!rig) return
  for (const limb of [rig.arms.L, rig.arms.R]) {
    const upper = limb.upper
    const lower = limb.lower
    if (!upper || !lower || upper === lower) continue
    const start = upper.getWorldPosition(new THREE.Vector3())
    const direction = lower.getWorldPosition(new THREE.Vector3()).sub(start)
    if (direction.lengthSq() < 1e-8) continue
    direction.normalize()
    if (Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)) > HANGING_ARM_ELEVATION) continue
    // Raise in the plane of the arm and the body's side (keep its heading).
    const lateral = new THREE.Vector3(Math.sign(start.x) || 1, 0, 0)
    const target = lateral.multiplyScalar(Math.cos(DRESSING_ARM_ELEVATION)).setY(Math.sin(DRESSING_ARM_ELEVATION)).normalize()
    const worldRotation = new THREE.Quaternion().setFromUnitVectors(direction, target)
    const boneWorld = upper.getWorldQuaternion(new THREE.Quaternion())
    const parentWorld = upper.parent ? upper.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion()
    upper.quaternion.copy(parentWorld.invert().multiply(worldRotation.multiply(boneWorld)))
    upper.updateMatrixWorld(true)
  }
  character.container.updateMatrixWorld(true)
}

