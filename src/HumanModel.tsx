import { useEffect, useRef, useState } from 'react'
import { TransformControls, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { type BonePose, EMOTIONS } from './emotions'

type Props = {
  emotion: string
  intensity: number
  wireframe: boolean
  showBones: boolean
}

type BoneRest = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  parentWorldQuaternion: THREE.Quaternion
}

const MODEL_URL = '/human.glb?v=deform-bones-2026-05-03-2'
const WORLD_POSITION_GAIN = 2.2

const DEFORM_ALIASES: Record<string, string[]> = {
  jaw_master: ['DEF-jaw_master'],
  'lip.T': ['DEF-lip.T.L', 'DEF-lip.T.R'],
  'lip.B': ['DEF-lip.B.L', 'DEF-lip.B.R'],
  nose_master: ['DEF-nose'],
}

function getRuntimePose(
  boneName: string,
  poses: Record<string, BonePose>,
  bones: Record<string, THREE.Bone>,
) {
  const directPose = poses[boneName]
  const deformBoneName = `DEF-${boneName}`
  const hasRetarget = Boolean(bones[deformBoneName] || DEFORM_ALIASES[boneName])

  // Rigify control bones export without Blender's constraint evaluation.
  // If a matching deform bone exists, only drive the deform bone at runtime.
  if (directPose && !hasRetarget) return directPose

  if (boneName.startsWith('DEF-')) {
    const controlName = boneName.slice(4)
    if (poses[controlName]) return poses[controlName]
  }

  for (const [controlName, targets] of Object.entries(DEFORM_ALIASES)) {
    if (targets.includes(boneName)) return poses[controlName]
  }

  return undefined
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

export default function HumanModel({ emotion, intensity, wireframe, showBones }: Props) {
  const { scene } = useGLTF(MODEL_URL)

  const bonesRef = useRef<Record<string, THREE.Bone>>({})
  const skeletonsRef = useRef<THREE.Skeleton[]>([])
  const restRef = useRef<Record<string, BoneRest>>({})
  const tRef = useRef(1) // lerp progress, 1 = at target
  const [debugBones, setDebugBones] = useState<THREE.Bone[]>([])
  const [selectedBone, setSelectedBone] = useState<THREE.Bone | null>(null)

  const emotionRef = useRef(emotion)
  const intensityRef = useRef(intensity)

  // Sync refs so useFrame sees latest values without re-triggering effects
  useEffect(() => {
    emotionRef.current = emotion
    intensityRef.current = intensity
    tRef.current = 0 // restart lerp
  }, [emotion, intensity])

  // Collect bones and snapshot rest pose once
  useEffect(() => {
    const bones: Record<string, THREE.Bone> = {}
    const skeletons: THREE.Skeleton[] = []

    scene.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh

      if (mesh.isSkinnedMesh) {
        skeletons.push(mesh.skeleton)

        for (const bone of mesh.skeleton.bones) {
          bones[bone.name] = bone
        }
      }
    })

    bonesRef.current = bones
    skeletonsRef.current = skeletons
    setDebugBones(
      Object.values(bones)
        .filter((bone) => FACE_BONE_PATTERN.test(bone.name))
        .sort((a, b) => a.name.localeCompare(b.name)),
    )

    scene.updateMatrixWorld(true)
    const rest: Record<string, BoneRest> = {}
    for (const [name, bone] of Object.entries(bones)) {
      const parentWorldQuaternion = new THREE.Quaternion()
      bone.parent?.getWorldQuaternion(parentWorldQuaternion)

      rest[name] = {
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        parentWorldQuaternion,
      }
    }
    restRef.current = rest
    tRef.current = 1
  }, [scene])

  useFrame((_, delta) => {
    const bones = bonesRef.current
    const rest = restRef.current
    if (!Object.keys(bones).length) return

    tRef.current = Math.min(1, tRef.current + delta * 5)
    const t = tRef.current

    const emo = EMOTIONS[emotionRef.current] ?? EMOTIONS['neutral']
    const scale = intensityRef.current

    if (!showBones) {
      for (const [name, bone] of Object.entries(bones)) {
        const r = rest[name]
        if (!r) continue

        const pose = getRuntimePose(name, emo.bones, bones)

        // Target position
        let targetPos = r.position
        if (pose?.position || pose?.worldPosition) {
          const delta = new THREE.Vector3(...(pose.position ?? pose.worldPosition ?? [0, 0, 0]))

          if (pose.worldPosition) {
            delta.applyQuaternion(r.parentWorldQuaternion.clone().invert())
          }

          targetPos = r.position.clone().addScaledVector(
            delta,
            scale * (pose.worldPosition ? WORLD_POSITION_GAIN : 1),
          )
        }

        // Target rotation
        let targetQ = r.quaternion
        if (pose?.rotation) {
          const delta_q = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              pose.rotation[0] * scale,
              pose.rotation[1] * scale,
              pose.rotation[2] * scale,
            )
          )
          targetQ = r.quaternion.clone().multiply(delta_q)
        }

        bone.position.lerp(targetPos, t)
        bone.quaternion.slerp(targetQ, t)
      }
    }

    scene.updateMatrixWorld(true)
    for (const skeleton of skeletonsRef.current) {
      skeleton.update()
    }
  })

  useEffect(() => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh && mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        mats.forEach((m) => {
          ;(m as THREE.MeshStandardMaterial).wireframe = wireframe
        })
      }
    })
  }, [scene, wireframe])

  // Head bounding box is Y=[2.76, 3.49]; shift -3.1 to center at origin
  return (
    <>
      <primitive object={scene} position={[0, -3.1, 0]} />

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
          onObjectChange={() => {
            scene.updateMatrixWorld(true)
            for (const skeleton of skeletonsRef.current) {
              skeleton.update()
            }
          }}
        />
      )}
    </>
  )
}

useGLTF.preload(MODEL_URL)
