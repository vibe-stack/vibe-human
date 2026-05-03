import { useEffect, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { type BonePose, EMOTIONS } from './emotions'

type Props = {
  emotion: string
  intensity: number
  wireframe: boolean
}

type BoneRest = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  parentWorldQuaternion: THREE.Quaternion
}

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

export default function HumanModel({ emotion, intensity, wireframe }: Props) {
  const { scene } = useGLTF('/human.glb')

  const bonesRef = useRef<Record<string, THREE.Bone>>({})
  const restRef = useRef<Record<string, BoneRest>>({})
  const tRef = useRef(1) // lerp progress, 1 = at target

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
    scene.traverse((obj) => {
      if ((obj as THREE.Bone).isBone) {
        bones[obj.name] = obj as THREE.Bone
      }
    })
    bonesRef.current = bones

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

        targetPos = r.position.clone().addScaledVector(delta, scale)
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
  return <primitive object={scene} position={[0, -3.1, 0]} />
}

useGLTF.preload('/human.glb')
