import { useEffect, useRef, useState } from 'react'
import { TransformControls, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useSnapshot } from 'valtio'
import * as THREE from 'three/webgpu'
import { appState, setBoneDebug, setIsTransforming, type CharacterRenderMode, type PoseTestLandmark } from './appState'
import { createBodySkinMaterial, createEyeMaterial, createSkinMaterial } from './skinMaterial'
import GroomRenderer from './features/groom/components/GroomRenderer'
import GroomViewportTools from './features/groom/components/GroomViewportTools'
import { registerGroomMeshes, registerSkinMaterialForGroom, unregisterSkinMaterialForGroom } from './features/groom/store/groomStore'
import {
  buildBodyProxySnapshotFromBones,
  clearBodyProxySnapshot,
  setBodyProxySnapshot,
} from './features/clothing/simulation/collision/bodyProxyRegistry'
import {
  buildModelingMorphs,
  MODELING_CONTROLS,
} from './characterModeling'
import { buildFacsMorphs } from './facs'
import ModelingOverlay from './ModelingOverlay'

type BoneRest = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  worldPosition: THREE.Vector3
  parentWorldQuaternion: THREE.Quaternion
  worldQuaternion: THREE.Quaternion
}

type ObjectRest = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  worldPosition: THREE.Vector3
  worldQuaternion: THREE.Quaternion
}

type MorphTargetMesh = THREE.Mesh & {
  morphTargetDictionary: Record<string, number>
  morphTargetInfluences: number[]
}

type MeshMaterialValue = THREE.Material | THREE.Material[]

type PoseSegmentSpec = {
  bone: string
  child?: string
  from: number
  to: number
}

type PoseAimSettings = {
  mirror: boolean
  strength: number
  minVisibility: number
}

export type BoneDebug = {
  name: string
  position: [number, number, number]
  restPosition: [number, number, number]
  deltaPosition: [number, number, number]
  rotation: [number, number, number]
  deltaRotation: [number, number, number]
}

const MODEL_URL = `${import.meta.env.BASE_URL}human5.glb?v=full-body-2026-05-17-1`
const LEGACY_HEAD_MESH_NAMES = new Set(['Head'])
const HEAD_SKIN_MATERIAL_ALIASES = ['mhead', 'tslheadskin', 'tslskin']
const BODY_SKIN_MATERIAL_ALIASES = ['mbody', 'tslbodyskin']
const HEAD_GEOMETRY_MIN_Y = 2.65
const BODY_GEOMETRY_MAX_Y = 3.0
const BODY_GEOMETRY_MIN_HEIGHT = 1.5
const MODEL_BASE_POSITION = new THREE.Vector3(0, -3.1, 0)
const HEAD_LOOK_YAW = 1.05
const HEAD_LOOK_PITCH = 0.58
const NECK_LOOK_YAW = 0.18
const NECK_LOOK_PITCH = 0.1
const EYE_LOOK_ALPHA = 0.45
const FOCUS_LOCK_EYE_ALPHA = 0.18
const EYE_FORWARD = new THREE.Vector3(0, 0, 1)
const EYE_OBJECT_NAMES = ['Eye_L', 'Eye_R']
const EYE_MESH_NAMES = new Set(EYE_OBJECT_NAMES)
const HEAD_POSE_DRIVER_BONE = 'DEF-spine.006'
const HEAD_POSE_FOLLOW_BONE_PATTERN = /^DEF-(brow|cheek|chin|ear|eye|forehead|jaw|lid|lip|nose|teeth)/
const POSE_SEGMENTS: PoseSegmentSpec[] = [
  { bone: 'DEF-spine.003', child: 'DEF-spine.004', from: 23, to: 11 },
  { bone: 'DEF-spine.004', child: 'DEF-spine.005', from: 23, to: 11 },
  { bone: 'DEF-spine.005', child: 'DEF-spine.006', from: 23, to: 11 },
  { bone: 'DEF-spine.006', from: 11, to: 0 },

  { bone: 'DEF-upper_arm.L', child: 'DEF-forearm.L.001', from: 11, to: 13 },
  { bone: 'DEF-forearm.L.001', child: 'DEF-hand.L', from: 13, to: 15 },
  { bone: 'DEF-hand.L', child: 'DEF-f_middle.01.L', from: 15, to: 19 },
  { bone: 'DEF-upper_arm.R', child: 'DEF-forearm.R.001', from: 12, to: 14 },
  { bone: 'DEF-forearm.R.001', child: 'DEF-hand.R', from: 14, to: 16 },
  { bone: 'DEF-hand.R', child: 'DEF-f_middle.01.R', from: 16, to: 20 },

  { bone: 'DEF-thigh.L', child: 'DEF-thigh.L.001', from: 23, to: 25 },
  { bone: 'DEF-thigh.L.001', child: 'DEF-foot.L', from: 25, to: 27 },
  { bone: 'DEF-foot.L', child: 'DEF-toe.L', from: 27, to: 31 },
  { bone: 'DEF-thigh.R', child: 'DEF-thigh.R.001', from: 24, to: 26 },
  { bone: 'DEF-thigh.R.001', child: 'DEF-foot.R', from: 26, to: 28 },
  { bone: 'DEF-foot.R', child: 'DEF-toe.R', from: 28, to: 32 },
]

const SOLID_CHARACTER_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.72,
  metalness: 0,
})

function normalizeBoneName(name: string) {
  return name.replace(/^DEF-/, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function getBoneByName(bones: Record<string, THREE.Bone>, name: string) {
  return (
    bones[name] ??
    Object.values(bones).find((bone) => normalizeBoneName(bone.name) === normalizeBoneName(name))
  )
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  const mesh = object as THREE.Mesh
  return Boolean(mesh.isMesh)
}

function materialNames(mesh: THREE.Mesh) {
  const material = mesh.material
  const materials = Array.isArray(material) ? material : material ? [material] : []
  return materials.map((mat) => mat.name).filter(Boolean)
}

function normalizeMaterialName(name: string) {
  return name
    .replace(/\.\d+$/, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
}

function materialNameMatches(name: string, aliases: string[]) {
  const normalized = normalizeMaterialName(name)
  return aliases.some((alias) => normalized === alias || normalized.includes(alias))
}

function hasNamedMaterial(object: THREE.Object3D, aliases: string[]) {
  return isMesh(object) && materialNames(object).some((name) => materialNameMatches(name, aliases))
}

function geometryYBounds(mesh: THREE.Mesh) {
  const geometry = mesh.geometry
  if (!geometry) return null
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const box = geometry.boundingBox
  return box ? { min: box.min.y, max: box.max.y, height: box.max.y - box.min.y } : null
}

function isHeadGeometry(mesh: THREE.Mesh) {
  const bounds = geometryYBounds(mesh)
  return Boolean(bounds && bounds.min >= HEAD_GEOMETRY_MIN_Y)
}

function isBodyGeometry(mesh: THREE.Mesh) {
  const bounds = geometryYBounds(mesh)
  return Boolean(
    bounds &&
    bounds.min < HEAD_GEOMETRY_MIN_Y &&
    bounds.max <= BODY_GEOMETRY_MAX_Y &&
    bounds.height >= BODY_GEOMETRY_MIN_HEIGHT
  )
}

function isSkinCandidateMesh(object: THREE.Object3D) {
  if (!isMesh(object) || isEyeMesh(object)) return false
  const mesh = object as THREE.SkinnedMesh
  const bounds = geometryYBounds(object)
  return Boolean(
    mesh.isSkinnedMesh ||
    bounds?.height && bounds.height > 0.4
  )
}

function isHeadSkinMesh(object: THREE.Object3D) {
  if (!isMesh(object) || isBodyGeometry(object)) return false
  return Boolean(
    isHeadGeometry(object) ||
    LEGACY_HEAD_MESH_NAMES.has(object.name) ||
    hasNamedMaterial(object, HEAD_SKIN_MATERIAL_ALIASES)
  )
}

function isBodySkinMesh(object: THREE.Object3D) {
  if (!isMesh(object)) return false
  return Boolean(
    isBodyGeometry(object) ||
    hasNamedMaterial(object, BODY_SKIN_MATERIAL_ALIASES) ||
    /body/i.test(object.name)
  )
}

function isEyeMesh(object: THREE.Object3D) {
  const mesh = object as THREE.Mesh
  return Boolean(mesh.isMesh && EYE_MESH_NAMES.has(object.name))
}

function isRenderableCharacterMesh(object: THREE.Object3D): object is THREE.Mesh {
  return Boolean((object as THREE.Mesh).isMesh)
}

function applySolidCharacterMaterials(
  scene: THREE.Object3D,
  fullMaterials: WeakMap<THREE.Mesh, MeshMaterialValue>,
) {
  scene.traverse((obj) => {
    if (!isRenderableCharacterMesh(obj)) return
    if (obj.material !== SOLID_CHARACTER_MATERIAL) {
      fullMaterials.set(obj, obj.material as MeshMaterialValue)
    }
    obj.material = SOLID_CHARACTER_MATERIAL
  })
}

function restoreFullCharacterMaterials(
  scene: THREE.Object3D,
  fullMaterials: WeakMap<THREE.Mesh, MeshMaterialValue>,
) {
  scene.traverse((obj) => {
    if (!isRenderableCharacterMesh(obj)) return
    const material = fullMaterials.get(obj)
    if (material) obj.material = material
  })
}

function replaceNamedMaterialSlots(
  mesh: THREE.Mesh,
  aliases: string[],
  replacement: THREE.Material,
) {
  const material = mesh.material
  if (Array.isArray(material)) {
    let replaced = false
    mesh.material = material.map((mat) => {
      if (!materialNameMatches(mat.name, aliases)) return mat
      replaced = true
      return replacement
    })
    return replaced
  }

  if (material && materialNameMatches(material.name, aliases)) {
    mesh.material = replacement
    return true
  }

  return false
}

function applyHeadSkinMaterial(object: THREE.Object3D, material: THREE.Material) {
  if (!isMesh(object)) return false
  if (isBodyGeometry(object)) return false
  if (replaceNamedMaterialSlots(object, HEAD_SKIN_MATERIAL_ALIASES, material)) return true
  if (isHeadGeometry(object)) {
    object.material = material
    return true
  }
  if (!object.material && LEGACY_HEAD_MESH_NAMES.has(object.name)) {
    object.material = material
    return true
  }
  if (LEGACY_HEAD_MESH_NAMES.has(object.name)) {
    object.material = material
    return true
  }
  return false
}

function applyBodySkinMaterial(object: THREE.Object3D, material: THREE.Material) {
  if (!isMesh(object)) return false
  if (replaceNamedMaterialSlots(object, BODY_SKIN_MATERIAL_ALIASES, material)) return true
  if (isBodyGeometry(object)) {
    object.material = material
    return true
  }
  if (isSkinCandidateMesh(object) && !isHeadGeometry(object)) {
    object.material = material
    return true
  }
  if (!object.material && /body/i.test(object.name)) {
    object.material = material
    return true
  }
  if (/body/i.test(object.name)) {
    object.material = material
    return true
  }
  return false
}

const FACE_BONE_PATTERN = /^DEF-(brow|cheek|chin|eye|forehead|jaw|lid|lip|nose|teeth)/

function getBoneColor(name: string, selected: boolean) {
  if (selected) return '#fbbf24'
  if (name.includes('brow') || name.includes('forehead')) return '#a78bfa'
  if (name.includes('lid') || name.includes('eye')) return '#38bdf8'
  if (name.includes('lip') || name.includes('jaw') || name.includes('chin')) return '#fb7185'
  if (name.includes('cheek') || name.includes('nose')) return '#34d399'
  return '#f8fafc'
}

function BoneHandle({
  bone,
  selected,
  onSelect,
}: {
  bone: THREE.Bone
  selected: boolean
  onSelect: (bone: THREE.Bone) => void
}) {
  const ref = useRef<THREE.Mesh>(null)

  useFrame(() => {
    if (!ref.current) return
    bone.getWorldPosition(ref.current.position)
  })

  return (
    <mesh
      ref={ref}
      renderOrder={1000}
      onPointerDown={(event) => {
        event.stopPropagation()
        onSelect(bone)
      }}
    >
      <sphereGeometry args={[selected ? 0.011 : 0.007, 12, 12]} />
      <meshBasicMaterial
        color={getBoneColor(bone.name, selected)}
        depthTest={false}
        depthWrite={false}
        transparent
        opacity={selected ? 1 : 0.72}
      />
    </mesh>
  )
}

function roundTuple(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z].map((value) => Number(value.toFixed(5))) as [
    number,
    number,
    number,
  ]
}

function getBoneDebug(bone: THREE.Bone, rest: BoneRest): BoneDebug {
  const rotation = new THREE.Euler().setFromQuaternion(bone.quaternion)
  const restRotation = new THREE.Euler().setFromQuaternion(rest.quaternion)

  return {
    name: bone.name,
    position: roundTuple(bone.position),
    restPosition: roundTuple(rest.position),
    deltaPosition: roundTuple(bone.position.clone().sub(rest.position)),
    rotation: roundTuple(new THREE.Vector3(rotation.x, rotation.y, rotation.z)),
    deltaRotation: roundTuple(
      new THREE.Vector3(
        rotation.x - restRotation.x,
        rotation.y - restRotation.y,
        rotation.z - restRotation.z,
      ),
    ),
  }
}

function getLookFactors(origin: THREE.Vector3, target: THREE.Vector3) {
  const delta = target.clone().sub(origin)
  const zDistance = Math.max(Math.abs(delta.z), 0.25)

  return {
    x: THREE.MathUtils.clamp(delta.x / (zDistance * 0.75), -1, 1),
    y: THREE.MathUtils.clamp(delta.y / (zDistance * 0.55), -1, 1),
  }
}

function getWorldLookQuaternion(lookX: number, lookY: number, yawAmount: number, pitchAmount: number) {
  const yaw = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    lookX * yawAmount,
  )
  const pitch = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    -lookY * pitchAmount,
  )

  return yaw.multiply(pitch)
}

function aimObjectForwardAtTarget(
  object: THREE.Object3D,
  rest: ObjectRest,
  target: THREE.Vector3,
  alpha: number,
) {
  const parentWorldQuaternion = new THREE.Quaternion()
  object.parent?.getWorldQuaternion(parentWorldQuaternion)

  const objectPosition = object.getWorldPosition(new THREE.Vector3())
  const targetDirectionWorld = target.clone().sub(objectPosition).normalize()
  const targetDirectionParent = targetDirectionWorld.applyQuaternion(
    parentWorldQuaternion.clone().invert(),
  )
  const restForwardParent = EYE_FORWARD.clone().applyQuaternion(rest.quaternion)
  const delta = new THREE.Quaternion().setFromUnitVectors(restForwardParent, targetDirectionParent)

  object.quaternion.slerp(delta.multiply(rest.quaternion), alpha)
}

function poseLandmarkVisible(landmark: PoseTestLandmark | undefined, minVisibility: number) {
  if (!landmark) return false
  return (landmark.visibility ?? landmark.presence ?? 1) >= minVisibility
}

function poseVector(landmark: PoseTestLandmark, mirror: boolean, out = new THREE.Vector3()) {
  const mirrorSign = mirror ? -1 : 1
  return out.set(landmark.x * mirrorSign, -landmark.y, -landmark.z)
}

function poseMidpoint(
  landmarks: PoseTestLandmark[],
  a: number,
  b: number,
  settings: PoseAimSettings,
  out: THREE.Vector3,
) {
  if (
    !poseLandmarkVisible(landmarks[a], settings.minVisibility) ||
    !poseLandmarkVisible(landmarks[b], settings.minVisibility)
  ) {
    return false
  }

  const va = poseVector(landmarks[a], settings.mirror, new THREE.Vector3())
  const vb = poseVector(landmarks[b], settings.mirror, new THREE.Vector3())
  out.copy(va).add(vb).multiplyScalar(0.5)
  return true
}

function getRestAimDirection(
  bone: THREE.Bone,
  rest: Record<string, BoneRest>,
  bones: Record<string, THREE.Bone>,
  childName: string | undefined,
  out: THREE.Vector3,
) {
  const boneRest = rest[bone.name]
  const child = childName ? getBoneByName(bones, childName) : null
  const childRest = child ? rest[child.name] : null

  if (boneRest && childRest) {
    return out.copy(childRest.worldPosition).sub(boneRest.worldPosition).normalize()
  }

  if (!boneRest) return null
  return out.set(0, 1, 0).applyQuaternion(boneRest.worldQuaternion).normalize()
}

function aimBoneAtPoseSegment(
  spec: PoseSegmentSpec,
  landmarks: PoseTestLandmark[],
  bones: Record<string, THREE.Bone>,
  rest: Record<string, BoneRest>,
  settings: PoseAimSettings,
) {
  const bone = getBoneByName(bones, spec.bone)
  const boneRest = bone ? rest[bone.name] : null
  const from = landmarks[spec.from]
  const to = landmarks[spec.to]
  if (
    !bone ||
    !boneRest ||
    !poseLandmarkVisible(from, settings.minVisibility) ||
    !poseLandmarkVisible(to, settings.minVisibility)
  ) {
    return false
  }

  const fromVector = poseVector(from, settings.mirror, new THREE.Vector3())
  const toVector = poseVector(to, settings.mirror, new THREE.Vector3())
  const targetDirection = toVector.sub(fromVector)
  if (targetDirection.lengthSq() < 0.00001) return false
  targetDirection.normalize()

  const restDirection = getRestAimDirection(
    bone,
    rest,
    bones,
    spec.child,
    new THREE.Vector3(),
  )
  if (!restDirection) return false

  const delta = new THREE.Quaternion().setFromUnitVectors(restDirection, targetDirection)
  const targetWorldQuaternion = delta.multiply(boneRest.worldQuaternion)
  const parentWorldQuaternion = new THREE.Quaternion()
  bone.parent?.getWorldQuaternion(parentWorldQuaternion)
  const targetLocalQuaternion = parentWorldQuaternion.invert().multiply(targetWorldQuaternion)

  bone.quaternion.slerp(targetLocalQuaternion, settings.strength)
  return true
}

function applyMediaPipePose(
  landmarks: PoseTestLandmark[],
  bones: Record<string, THREE.Bone>,
  rest: Record<string, BoneRest>,
  scene: THREE.Object3D,
  settings: PoseAimSettings,
) {
  let applied = 0
  for (const spec of POSE_SEGMENTS) {
    if (aimBoneAtPoseSegment(spec, landmarks, bones, rest, settings)) {
      applied += 1
      scene.updateMatrixWorld(true)
    }
  }
  return applied
}

function applyWorldTransformToBone(
  bone: THREE.Bone,
  targetWorldPosition: THREE.Vector3,
  targetWorldQuaternion: THREE.Quaternion,
) {
  const parentWorldQuaternion = new THREE.Quaternion()
  const parentWorldPosition = new THREE.Vector3()
  const parentWorldScale = new THREE.Vector3()
  bone.parent?.matrixWorld.decompose(parentWorldPosition, parentWorldQuaternion, parentWorldScale)

  bone.position.copy(targetWorldPosition).sub(parentWorldPosition).applyQuaternion(parentWorldQuaternion.invert())
  bone.quaternion.copy(parentWorldQuaternion.multiply(targetWorldQuaternion))
}

function applyWorldTransformToObject(
  object: THREE.Object3D,
  targetWorldPosition: THREE.Vector3,
  targetWorldQuaternion: THREE.Quaternion,
) {
  const parentWorldQuaternion = new THREE.Quaternion()
  const parentWorldPosition = new THREE.Vector3()
  const parentWorldScale = new THREE.Vector3()
  object.parent?.matrixWorld.decompose(parentWorldPosition, parentWorldQuaternion, parentWorldScale)

  object.position.copy(targetWorldPosition).sub(parentWorldPosition).applyQuaternion(parentWorldQuaternion.invert())
  object.quaternion.copy(parentWorldQuaternion.multiply(targetWorldQuaternion))
}

function applyHeadPoseFollowers(
  bones: Record<string, THREE.Bone>,
  rest: Record<string, BoneRest>,
  eyeObjects: Record<string, THREE.Object3D>,
  objectRest: Record<string, ObjectRest>,
  scene: THREE.Object3D,
  strength: number,
) {
  const driver = getBoneByName(bones, HEAD_POSE_DRIVER_BONE)
  const driverRest = driver ? rest[driver.name] : null
  if (!driver || !driverRest) return

  scene.updateMatrixWorld(true)
  const driverWorldPosition = driver.getWorldPosition(new THREE.Vector3())
  const driverWorldQuaternion = driver.getWorldQuaternion(new THREE.Quaternion())
  const headDelta = driverWorldQuaternion.clone().multiply(driverRest.worldQuaternion.clone().invert())
  const targetPosition = new THREE.Vector3()
  const targetQuaternion = new THREE.Quaternion()

  for (const [name, bone] of Object.entries(bones)) {
    const boneRest = rest[name]
    if (!boneRest || !HEAD_POSE_FOLLOW_BONE_PATTERN.test(name)) continue

    targetPosition
      .copy(boneRest.worldPosition)
      .sub(driverRest.worldPosition)
      .applyQuaternion(headDelta)
      .add(driverWorldPosition)
    targetQuaternion.copy(headDelta).multiply(boneRest.worldQuaternion)

    const blendedPosition = bone.getWorldPosition(new THREE.Vector3()).lerp(targetPosition, strength)
    const blendedQuaternion = bone.getWorldQuaternion(new THREE.Quaternion()).slerp(targetQuaternion, strength)
    applyWorldTransformToBone(bone, blendedPosition, blendedQuaternion)
  }

  for (const [name, object] of Object.entries(eyeObjects)) {
    const restObject = objectRest[name]
    if (!restObject) continue

    targetPosition
      .copy(restObject.worldPosition)
      .sub(driverRest.worldPosition)
      .applyQuaternion(headDelta)
      .add(driverWorldPosition)
    targetQuaternion.copy(headDelta).multiply(restObject.worldQuaternion)

    const blendedPosition = object.getWorldPosition(new THREE.Vector3()).lerp(targetPosition, strength)
    const blendedQuaternion = object.getWorldQuaternion(new THREE.Quaternion()).slerp(targetQuaternion, strength)
    applyWorldTransformToObject(object, blendedPosition, blendedQuaternion)
  }
}

function applyMorphTargets(
  meshes: MorphTargetMesh[],
  targets: Record<string, number>,
  alpha: number,
) {
  for (const mesh of meshes) {
    for (const [targetName, index] of Object.entries(mesh.morphTargetDictionary)) {
      const targetValue = targets[targetName] ?? 0
      mesh.morphTargetInfluences[index] = THREE.MathUtils.lerp(
        mesh.morphTargetInfluences[index] ?? 0,
        targetValue,
        alpha,
      )
    }
  }
}

export default function HumanModel() {
  const {
    facsValues,
    modelingValues,
    eyeLook2D,
    wireframe,
    showBones,
    eyeLook,
    focusLock,
    skinTextures,
    poreScale,
    poreNormalStrength,
    wrinkleNormalStrength,
    flipNormalY,
    oiliness,
    surfaceRoughness,
    toneDepth,
    subsurfaceStrength,
    showHair,
    showModeling: showModelingOverlay,
    characterRenderMode,
    poseTestEnabled,
    poseTestMirror,
    poseTestRigStrength,
    poseTestMinVisibility,
    poseTestFollowPosition,
    poseTestPositionScale,
    poseTestWorldLandmarks,
  } = useSnapshot(appState)
  const { scene } = useGLTF(MODEL_URL)

  const [lookTargetObject, setLookTargetObject] = useState<THREE.Group | null>(null)
  const bonesRef = useRef<Record<string, THREE.Bone>>({})
  const eyeObjectsRef = useRef<Record<string, THREE.Object3D>>({})
  const morphMeshesRef = useRef<MorphTargetMesh[]>([])
  const skeletonsRef = useRef<THREE.Skeleton[]>([])
  const bodyCollisionMeshesRef = useRef<THREE.SkinnedMesh[]>([])
  const headCollisionMeshesRef = useRef<THREE.SkinnedMesh[]>([])
  const restRef = useRef<Record<string, BoneRest>>({})
  const objectRestRef = useRef<Record<string, ObjectRest>>({})
  const tRef = useRef(1) // lerp progress, 1 = at target
  const [debugBones, setDebugBones] = useState<THREE.Bone[]>([])
  const [modelingBones, setModelingBones] = useState<Record<string, THREE.Bone>>({})
  const [selectedBone, setSelectedBone] = useState<THREE.Bone | null>(null)

  const characterRenderModeRef = useRef<CharacterRenderMode>(characterRenderMode)
  const fullMaterialsRef = useRef(new WeakMap<THREE.Mesh, MeshMaterialValue>())
  const facsValuesRef = useRef(facsValues)
  const modelingValuesRef = useRef(modelingValues)
  const eyeLook2DRef = useRef(eyeLook2D)
  const poseTestWorldLandmarksRef = useRef<PoseTestLandmark[] | null>(poseTestWorldLandmarks ? [...poseTestWorldLandmarks] : null)
  const poseTestEnabledRef = useRef(poseTestEnabled)
  const poseTestSettingsRef = useRef({
    mirror: poseTestMirror,
    strength: poseTestRigStrength,
    minVisibility: poseTestMinVisibility,
  })
  const poseTestFollowPositionRef = useRef(poseTestFollowPosition)
  const poseTestPositionScaleRef = useRef(poseTestPositionScale)
  const poseHipCalibrationRef = useRef<THREE.Vector3 | null>(null)

  // Sync refs so useFrame sees latest values without re-triggering effects
  useEffect(() => {
    characterRenderModeRef.current = characterRenderMode
    if (characterRenderMode === 'solid') {
      applySolidCharacterMaterials(scene, fullMaterialsRef.current)
    } else {
      restoreFullCharacterMaterials(scene, fullMaterialsRef.current)
    }
  }, [characterRenderMode, scene])

  useEffect(() => {
    facsValuesRef.current = facsValues
    tRef.current = 0 // restart lerp
  }, [facsValues])

  useEffect(() => {
    modelingValuesRef.current = modelingValues
    tRef.current = 0
  }, [modelingValues])

  useEffect(() => {
    eyeLook2DRef.current = eyeLook2D
  }, [eyeLook2D])

  useEffect(() => {
    poseTestWorldLandmarksRef.current = poseTestWorldLandmarks ? [...poseTestWorldLandmarks] : null
  }, [poseTestWorldLandmarks])

  useEffect(() => {
    poseTestEnabledRef.current = poseTestEnabled
    if (!poseTestEnabled) {
      poseHipCalibrationRef.current = null
      scene.position.copy(MODEL_BASE_POSITION)
    }
  }, [poseTestEnabled, scene])

  useEffect(() => {
    poseTestSettingsRef.current = {
      mirror: poseTestMirror,
      strength: poseTestRigStrength,
      minVisibility: poseTestMinVisibility,
    }
  }, [poseTestMinVisibility, poseTestMirror, poseTestRigStrength])

  useEffect(() => {
    poseTestFollowPositionRef.current = poseTestFollowPosition
  }, [poseTestFollowPosition])

  useEffect(() => {
    poseTestPositionScaleRef.current = poseTestPositionScale
  }, [poseTestPositionScale])

  useEffect(() => {
    if (!showBones) {
      setBoneDebug(null)
    }
    if (!showBones && !eyeLook && !focusLock) {
      setIsTransforming(false)
    }
  }, [eyeLook, focusLock, showBones])

  // Collect bones and snapshot rest pose once
  useEffect(() => {
    const bones: Record<string, THREE.Bone> = {}
    const eyeObjects: Record<string, THREE.Object3D> = {}
    const morphMeshes: MorphTargetMesh[] = []
    const skeletons: THREE.Skeleton[] = []
    const groomMeshes: THREE.Mesh[] = []
    const bodyCollisionMeshes: THREE.SkinnedMesh[] = []
    const headCollisionMeshes: THREE.SkinnedMesh[] = []

    scene.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh

      if (EYE_OBJECT_NAMES.includes(obj.name)) {
        eyeObjects[obj.name] = obj
      }

      const morphMesh = obj as Partial<MorphTargetMesh>
      if (morphMesh.morphTargetDictionary && morphMesh.morphTargetInfluences) {
        morphMeshes.push(morphMesh as MorphTargetMesh)
      }

      if (isHeadSkinMesh(obj)) {
        groomMeshes.push(obj as THREE.Mesh)
        if (mesh.isSkinnedMesh) headCollisionMeshes.push(mesh)
      }

      if (isBodySkinMesh(obj) && mesh.isSkinnedMesh) {
        bodyCollisionMeshes.push(mesh)
      }

      if (mesh.isSkinnedMesh) {
        skeletons.push(mesh.skeleton)

        for (const bone of mesh.skeleton.bones) {
          bones[bone.name] = bone
        }
      }
    })

    bonesRef.current = bones
    eyeObjectsRef.current = eyeObjects
    morphMeshesRef.current = morphMeshes
    skeletonsRef.current = skeletons
    bodyCollisionMeshesRef.current = bodyCollisionMeshes
    headCollisionMeshesRef.current = headCollisionMeshes
    registerGroomMeshes(groomMeshes)

    const availableTargets = new Set(
      morphMeshes.flatMap((mesh) => Object.keys(mesh.morphTargetDictionary)),
    )
    const requiredTargets = MODELING_CONTROLS.flatMap((control) => [
      control.negativeTarget,
      control.positiveTarget,
    ]).filter((target): target is string => target !== null)
    requiredTargets.filter((target) => !availableTargets.has(target))

    const nextDebugBones = Object.values(bones)
      .filter((bone) => FACE_BONE_PATTERN.test(bone.name))
      .sort((a, b) => a.name.localeCompare(b.name))

    scene.updateMatrixWorld(true)
    const rest: Record<string, BoneRest> = {}
    for (const [name, bone] of Object.entries(bones)) {
      const parentWorldQuaternion = new THREE.Quaternion()
      bone.parent?.getWorldQuaternion(parentWorldQuaternion)

      rest[name] = {
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        worldPosition: bone.getWorldPosition(new THREE.Vector3()),
        parentWorldQuaternion,
        worldQuaternion: bone.getWorldQuaternion(new THREE.Quaternion()),
      }
    }
    restRef.current = rest
    objectRestRef.current = Object.fromEntries(
      Object.entries(eyeObjects).map(([name, object]) => [
        name,
        {
          position: object.position.clone(),
          quaternion: object.quaternion.clone(),
          worldPosition: object.getWorldPosition(new THREE.Vector3()),
          worldQuaternion: object.getWorldQuaternion(new THREE.Quaternion()),
        },
      ]),
    )
    tRef.current = 1

    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        setDebugBones(nextDebugBones)
        setModelingBones(bones)
      }
    })

    return () => {
      cancelled = true
      clearBodyProxySnapshot()
    }
  }, [scene])

  useFrame((_, delta) => {
    const bones = bonesRef.current
    const rest = restRef.current

    if (!Object.keys(bones).length) return

    tRef.current = Math.min(1, tRef.current + delta * 5)
    const t = tRef.current

    const facsMorphs = buildFacsMorphs(facsValuesRef.current)
    const modelingMorphs = buildModelingMorphs(modelingValuesRef.current)
    const runtimeMorphs = { ...modelingMorphs, ...facsMorphs }
    const lookEnabled = (eyeLook || focusLock) && !showBones
    const lookTarget = lookTargetObject?.getWorldPosition(new THREE.Vector3()) ?? null
    const headBone = getBoneByName(bones, 'RT_Head') ?? getBoneByName(bones, 'head')
    const headOrigin =
      headBone?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, 0.1, 0.15)
    const look = lookEnabled && lookTarget ? getLookFactors(headOrigin, lookTarget) : null

    applyMorphTargets(morphMeshesRef.current, runtimeMorphs, t)

    if (!showBones) {
      for (const [name, bone] of Object.entries(bones)) {
        const r = rest[name]
        if (!r) continue

        bone.position.lerp(r.position, t)
        bone.quaternion.slerp(r.quaternion, t)
      }

      if (look && lookTarget) {
        const headDelta = getWorldLookQuaternion(
          look.x,
          look.y,
          HEAD_LOOK_YAW,
          HEAD_LOOK_PITCH,
        )
        const neckDelta = getWorldLookQuaternion(
          look.x,
          look.y,
          NECK_LOOK_YAW,
          NECK_LOOK_PITCH,
        )

        if (focusLock) {
          const rtHead = getBoneByName(bones, 'RT_Head')
          const rtHeadRest = rtHead ? restRef.current[rtHead.name] : undefined
          if (rtHead && rtHeadRest) {
            rtHead.quaternion.slerp(rtHeadRest.quaternion.clone().multiply(headDelta), 0.35)
          }

          for (const [name, delta] of [
            ['DEF-spine.006', neckDelta],
            ['DEF-spine.005', neckDelta],
            ['DEF-spine.004', neckDelta],
          ] as const) {
            const bone = getBoneByName(bones, name)
            const rest = bone ? restRef.current[bone.name] : undefined
            if (!bone || !rest) continue

            bone.quaternion.slerp(rest.quaternion.clone().multiply(delta), 0.3)
          }
        }

        scene.updateMatrixWorld(true)

        for (const [name, object] of Object.entries(eyeObjectsRef.current)) {
          const rest = objectRestRef.current[name]
          if (!rest) continue

          aimObjectForwardAtTarget(
            object,
            rest,
            lookTarget,
            focusLock ? FOCUS_LOCK_EYE_ALPHA : EYE_LOOK_ALPHA,
          )
        }
      } else {
        for (const [name, object] of Object.entries(eyeObjectsRef.current)) {
          const rest = objectRestRef.current[name]
          if (!rest) continue

          object.position.lerp(rest.position, 0.25)
          object.quaternion.slerp(rest.quaternion, 0.25)
        }
      }

      // 2D eye look overlay (driven by FaceOverlay XY pad)
      const eLook = eyeLook2DRef.current
      const eyeL = eyeObjectsRef.current['Eye_L']
      const restL = objectRestRef.current['Eye_L']
      if (eyeL && restL && (Math.abs(eLook.leftX) > 0.001 || Math.abs(eLook.leftY) > 0.001)) {
        const q = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(eLook.leftY * -0.38, eLook.leftX * 0.42, 0),
        )
        eyeL.quaternion.copy(restL.quaternion.clone().multiply(q))
      }
      const eyeR = eyeObjectsRef.current['Eye_R']
      const restR = objectRestRef.current['Eye_R']
      if (eyeR && restR && (Math.abs(eLook.rightX) > 0.001 || Math.abs(eLook.rightY) > 0.001)) {
        const q = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(eLook.rightY * -0.38, eLook.rightX * 0.42, 0),
        )
        eyeR.quaternion.copy(restR.quaternion.clone().multiply(q))
      }

      const poseLandmarks = poseTestEnabledRef.current ? poseTestWorldLandmarksRef.current : null
      if (poseLandmarks?.length) {
        const poseSettings = poseTestSettingsRef.current
        applyMediaPipePose(poseLandmarks, bones, rest, scene, poseSettings)
        applyHeadPoseFollowers(
          bones,
          rest,
          eyeObjectsRef.current,
          objectRestRef.current,
          scene,
          poseSettings.strength,
        )

        if (poseTestFollowPositionRef.current) {
          const hipCenter = new THREE.Vector3()
          if (poseMidpoint(poseLandmarks, 23, 24, poseSettings, hipCenter)) {
            if (!poseHipCalibrationRef.current) {
              poseHipCalibrationRef.current = hipCenter.clone()
            }
            const offset = hipCenter
              .sub(poseHipCalibrationRef.current)
              .multiplyScalar(poseTestPositionScaleRef.current)
            scene.position.set(
              MODEL_BASE_POSITION.x + offset.x,
              MODEL_BASE_POSITION.y + offset.y * 0.35,
              MODEL_BASE_POSITION.z + offset.z,
            )
          }
        } else {
          poseHipCalibrationRef.current = null
          scene.position.lerp(MODEL_BASE_POSITION, 0.2)
        }
      } else if (!poseTestEnabledRef.current) {
        scene.position.lerp(MODEL_BASE_POSITION, 0.2)
      }
    }

    scene.updateMatrixWorld(true)
    for (const skeleton of skeletonsRef.current) {
      skeleton.update()
    }
    setBodyProxySnapshot(buildBodyProxySnapshotFromBones(bones, {
      bodyMeshes: bodyCollisionMeshesRef.current,
      headMeshes: headCollisionMeshesRef.current,
    }))

    if (showBones && selectedBone) {
      const rest = restRef.current[selectedBone.name]
      if (!rest) return

      setBoneDebug(getBoneDebug(selectedBone, rest))
    }
  })

  // Apply TSL skin materials, overriding the placeholder GLB materials.
  useEffect(() => {
    let cancelled = false
    let headMat: THREE.Material | null = null
    let bodyMat: THREE.Material | null = null

    const settings = {
      poreScale,
      poreNormalStrength,
      wrinkleNormalStrength,
      flipNormalY,
      oiliness,
      surfaceRoughness,
      toneDepth,
      subsurfaceStrength,
    }

    createSkinMaterial(skinTextures, settings, { name: 'TSL_HeadSkin' })
      .then((createdHeadMat) => {
        if (cancelled) {
          createdHeadMat.dispose()
          return
        }
        headMat = createdHeadMat
        let matched = 0
        scene.traverse((obj) => {
          if (applyHeadSkinMaterial(obj, headMat as unknown as THREE.Material)) matched += 1
        })
        if (matched === 0) {
          console.warn('No mesh/material slot matched the head skin material names M_Head/TSL_HeadSkin.')
        }
        // Let the groom system push follicle tint updates into the head material.
        registerSkinMaterialForGroom(headMat as unknown as THREE.Material)
        if (characterRenderModeRef.current === 'solid') {
          applySolidCharacterMaterials(scene, fullMaterialsRef.current)
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to create head skin material:', error)
      })

    createBodySkinMaterial(settings)
      .then((createdBodyMat) => {
        if (cancelled) {
          createdBodyMat.dispose()
          return
        }
        bodyMat = createdBodyMat
        let matched = 0
        scene.traverse((obj) => {
          if (applyBodySkinMaterial(obj, bodyMat as unknown as THREE.Material)) matched += 1
        })
        if (matched === 0) {
          console.warn('No mesh/material slot matched the body skin material names M_Body/TSL_BodySkin.')
        }
        if (characterRenderModeRef.current === 'solid') {
          applySolidCharacterMaterials(scene, fullMaterialsRef.current)
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to create body skin material:', error)
      })

    return () => {
      cancelled = true
      if (headMat) {
        unregisterSkinMaterialForGroom(headMat as unknown as THREE.Material)
        headMat.dispose()
      }
      bodyMat?.dispose()
    }
  }, [flipNormalY, oiliness, poreNormalStrength, poreScale, scene, skinTextures, subsurfaceStrength, surfaceRoughness, toneDepth, wrinkleNormalStrength])

  useEffect(() => {
    let cancelled = false
    let mat: THREE.MeshPhysicalNodeMaterial | null = null

    createEyeMaterial()
      .then((created) => {
        if (cancelled) {
          created.dispose()
          return
        }
        mat = created
        scene.traverse((obj) => {
          if (!isEyeMesh(obj)) return
          const mesh = obj as THREE.Mesh
          mesh.material = mat as unknown as THREE.Material
        })
        if (characterRenderModeRef.current === 'solid') {
          applySolidCharacterMaterials(scene, fullMaterialsRef.current)
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to create eye material:', error)
      })

    return () => {
      cancelled = true
      mat?.dispose()
    }
  }, [scene])

  useEffect(() => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if ((isHeadSkinMesh(obj) || isBodySkinMesh(obj)) && mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        mats.forEach((m) => {
          ;(m as THREE.MeshStandardMaterial).wireframe = wireframe
        })
      }
    })
  }, [scene, wireframe, skinTextures])

  // Head bounding box is Y=[2.76, 3.49]; shift -3.1 to center at origin
  return (
    <>
      <primitive object={scene} position={[0, -3.1, 0]} />

      {(eyeLook || focusLock) && !showBones && (
        <>
          <group
            ref={(node) => {
              if (node && node !== lookTargetObject) setLookTargetObject(node)
            }}
            position={[0, 0.14, 0.68]}
          >
            <mesh renderOrder={1000}>
              <sphereGeometry args={[0.025, 24, 24]} />
              <meshBasicMaterial color="#ef4444" depthTest={false} depthWrite={false} />
            </mesh>
          </group>
          {lookTargetObject && (
            <TransformControls
              object={lookTargetObject}
              mode="translate"
              space="world"
              size={0.5}
              onMouseDown={() => setIsTransforming(true)}
              onMouseUp={() => setIsTransforming(false)}
            />
          )}
        </>
      )}

      {showBones &&
        debugBones.map((bone) => (
          <BoneHandle
            key={bone.uuid}
            bone={bone}
            selected={selectedBone === bone}
            onSelect={setSelectedBone}
          />
        ))}

      {showBones && selectedBone && (
        <TransformControls
          object={selectedBone}
          mode="translate"
          space="local"
          size={0.35}
          onMouseDown={() => setIsTransforming(true)}
          onObjectChange={() => {
            scene.updateMatrixWorld(true)
            for (const skeleton of skeletonsRef.current) {
              skeleton.update()
            }
          }}
          onMouseUp={() => {
            setIsTransforming(false)
            const rest = restRef.current[selectedBone.name]
            if (!rest) return

            getBoneDebug(selectedBone, rest)
          }}
        />
      )}

      {!showBones && showModelingOverlay && (
        <ModelingOverlay bones={modelingBones} />
      )}

      {showHair && (
        <>
          <GroomRenderer />
          <GroomViewportTools />
        </>
      )}
    </>
  )
}

useGLTF.preload(MODEL_URL)
