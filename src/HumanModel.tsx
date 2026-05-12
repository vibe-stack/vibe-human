import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { TransformControls, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { createSkinMaterial, type SkinTextures } from './skinMaterial'
import {
  buildModelingMorphs,
  MODELING_CONTROLS,
  type ModelingMode,
  type ModelingValues,
} from './characterModeling'
import { buildFacsMorphs, type EyeLookValues, type FacsValues } from './facs'
import ModelingOverlay from './ModelingOverlay'

type Props = {
  facsValues: FacsValues
  modelingValues: ModelingValues
  modelingMode: ModelingMode
  modelingSymmetric: boolean
  selectedModelingHandleId: string | null
  eyeLook2D: EyeLookValues
  wireframe: boolean
  showBones: boolean
  eyeLook: boolean
  focusLock: boolean
  skinTextures: SkinTextures
  showModelingOverlay: boolean
  onModelingValues: Dispatch<SetStateAction<ModelingValues>>
  onSelectedModelingHandleId: (id: string) => void
  onBoneDebug: (debug: BoneDebug | null) => void
  onTransformingChange: (isTransforming: boolean) => void
}

type BoneRest = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  worldPosition: THREE.Vector3
  parentWorldQuaternion: THREE.Quaternion
  worldQuaternion: THREE.Quaternion
}

type ObjectRest = {
  quaternion: THREE.Quaternion
  worldQuaternion: THREE.Quaternion
}

type MorphTargetMesh = THREE.Mesh & {
  morphTargetDictionary: Record<string, number>
  morphTargetInfluences: number[]
}

export type BoneDebug = {
  name: string
  position: [number, number, number]
  restPosition: [number, number, number]
  deltaPosition: [number, number, number]
  rotation: [number, number, number]
  deltaRotation: [number, number, number]
}

const MODEL_URL = `${import.meta.env.BASE_URL}human4.glb?v=identity-modeling-2026-05-10-1`
const SKIN_MESH_NAMES = new Set(['Head', 'Plane.002'])
const HEAD_LOOK_YAW = 1.05
const HEAD_LOOK_PITCH = 0.58
const NECK_LOOK_YAW = 0.18
const NECK_LOOK_PITCH = 0.1
const EYE_LOOK_ALPHA = 0.45
const FOCUS_LOCK_EYE_ALPHA = 0.18
const EYE_FORWARD = new THREE.Vector3(0, 0, 1)
const EYE_OBJECT_NAMES = ['Eye_L', 'Eye_R']

function normalizeBoneName(name: string) {
  return name.replace(/^DEF-/, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function getBoneByName(bones: Record<string, THREE.Bone>, name: string) {
  return (
    bones[name] ??
    Object.values(bones).find((bone) => normalizeBoneName(bone.name) === normalizeBoneName(name))
  )
}

function isSkinMesh(object: THREE.Object3D) {
  const mesh = object as THREE.Mesh
  return Boolean(mesh.isMesh && SKIN_MESH_NAMES.has(object.name))
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

export default function HumanModel({
  facsValues,
  modelingValues,
  modelingMode,
  modelingSymmetric,
  selectedModelingHandleId,
  eyeLook2D,
  wireframe,
  showBones,
  eyeLook,
  focusLock,
  skinTextures,
  showModelingOverlay,
  onModelingValues,
  onSelectedModelingHandleId,
  onBoneDebug,
  onTransformingChange,
}: Props) {
  const { scene } = useGLTF(MODEL_URL)

  const [lookTargetObject, setLookTargetObject] = useState<THREE.Group | null>(null)
  const bonesRef = useRef<Record<string, THREE.Bone>>({})
  const eyeObjectsRef = useRef<Record<string, THREE.Object3D>>({})
  const morphMeshesRef = useRef<MorphTargetMesh[]>([])
  const skeletonsRef = useRef<THREE.Skeleton[]>([])
  const restRef = useRef<Record<string, BoneRest>>({})
  const objectRestRef = useRef<Record<string, ObjectRest>>({})
  const tRef = useRef(1) // lerp progress, 1 = at target
  const [debugBones, setDebugBones] = useState<THREE.Bone[]>([])
  const [modelingBones, setModelingBones] = useState<Record<string, THREE.Bone>>({})
  const [selectedBone, setSelectedBone] = useState<THREE.Bone | null>(null)

  const facsValuesRef = useRef(facsValues)
  const modelingValuesRef = useRef(modelingValues)
  const eyeLook2DRef = useRef(eyeLook2D)

  // Sync refs so useFrame sees latest values without re-triggering effects
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
    if (!showBones) {
      onBoneDebug(null)
    }
    if (!showBones && !eyeLook && !focusLock) {
      onTransformingChange(false)
    }
  }, [eyeLook, focusLock, onBoneDebug, onTransformingChange, showBones])

  // Collect bones and snapshot rest pose once
  useEffect(() => {
    const bones: Record<string, THREE.Bone> = {}
    const eyeObjects: Record<string, THREE.Object3D> = {}
    const morphMeshes: MorphTargetMesh[] = []
    const skeletons: THREE.Skeleton[] = []

    scene.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh

      if (EYE_OBJECT_NAMES.includes(obj.name)) {
        eyeObjects[obj.name] = obj
      }

      const morphMesh = obj as Partial<MorphTargetMesh>
      if (morphMesh.morphTargetDictionary && morphMesh.morphTargetInfluences) {
        morphMeshes.push(morphMesh as MorphTargetMesh)
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

    const availableTargets = new Set(
      morphMeshes.flatMap((mesh) => Object.keys(mesh.morphTargetDictionary)),
    )
    const requiredTargets = MODELING_CONTROLS.flatMap((control) => [
      control.negativeTarget,
      control.positiveTarget,
    ])
    const missingTargets = requiredTargets.filter((target) => !availableTargets.has(target))

    if (missingTargets.length) {
      console.warn('Missing character modeling morph targets:', missingTargets)
    }

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
          quaternion: object.quaternion.clone(),
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
    }
  }, [scene])

  useFrame((_, delta) => {
    const bones = bonesRef.current
    const rest = restRef.current

    // DEBUG TEMP
    if (Math.random() < 0.005) {
      console.log('[modeling debug] bones:', Object.keys(bones).length, 'meshes:', morphMeshesRef.current.length, 'values:', JSON.stringify(modelingValuesRef.current))
    }

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
    }

    scene.updateMatrixWorld(true)
    for (const skeleton of skeletonsRef.current) {
      skeleton.update()
    }

    if (showBones && selectedBone) {
      const rest = restRef.current[selectedBone.name]
      if (!rest) return

      onBoneDebug(getBoneDebug(selectedBone, rest))
    }
  })

  // Apply TSL skin material, overriding whatever the GLB baked in
  useEffect(() => {
    let cancelled = false
    let mat: THREE.MeshPhysicalNodeMaterial | null = null

    createSkinMaterial(skinTextures)
      .then((created) => {
        if (cancelled) {
          created.dispose()
          return
        }
        mat = created
        scene.traverse((obj) => {
          if (!isSkinMesh(obj)) return
          const mesh = obj as THREE.Mesh
          mesh.material = mat as unknown as THREE.Material
        })
      })
      .catch((error: unknown) => {
        console.error('Failed to create skin material:', error)
      })

    return () => {
      cancelled = true
      mat?.dispose()
    }
  }, [scene, skinTextures])

  useEffect(() => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (isSkinMesh(obj) && mesh.material) {
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
              onMouseDown={() => onTransformingChange(true)}
              onMouseUp={() => onTransformingChange(false)}
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
          onMouseDown={() => onTransformingChange(true)}
          onObjectChange={() => {
            scene.updateMatrixWorld(true)
            for (const skeleton of skeletonsRef.current) {
              skeleton.update()
            }
          }}
          onMouseUp={() => {
            onTransformingChange(false)
            const rest = restRef.current[selectedBone.name]
            if (!rest) return

            const debug = getBoneDebug(selectedBone, rest)
            const poseKey = selectedBone.name.replace(/^DEF-/, '')
            console.log(
              `'${poseKey}': { position: [${debug.deltaPosition.join(', ')}] },`,
              debug,
            )
          }}
        />
      )}

      {!showBones && showModelingOverlay && (
        <ModelingOverlay
          mode={modelingMode}
          symmetric={modelingSymmetric}
          values={modelingValues}
          selectedHandleId={selectedModelingHandleId}
          bones={modelingBones}
          onSelectedHandleId={onSelectedModelingHandleId}
          onValues={onModelingValues}
          onTransformingChange={onTransformingChange}
        />
      )}
    </>
  )
}

useGLTF.preload(MODEL_URL)
