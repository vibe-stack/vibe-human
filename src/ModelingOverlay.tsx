import { Billboard } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { useSnapshot } from 'valtio'
import * as THREE from 'three'
import { appState, setIsTransforming, setModelingValues, setSelectedModelingHandleId } from './appState'
import {
  clampModelingValue,
  getModelingHandles,
  type ModelingHandle,
} from './characterModeling'

type Props = {
  bones: Record<string, THREE.Bone>
}

type DragState = {
  pointerId: number
  handle: ModelingHandle
  startX: number
  startY: number
  startValue: number
}

const TRANSFORM_COLOR = '#f4f4f5'
const SCULPT_COLOR = '#f8fafc'
const ACTIVE_COLOR = '#7dd3fc'
const fallbackVector = new THREE.Vector3()
const noseRootVector = new THREE.Vector3()
const noseTipVector = new THREE.Vector3()

function dragDelta(handle: ModelingHandle, dx: number, dy: number) {
  const speed = handle.mode === 'transform' ? 0.0065 : 0.008

  if (handle.axis === 'x') {
    const sideSign = handle.side === 'left' ? -1 : 1
    return dx * sideSign * speed
  }

  return -dy * speed
}

export default function ModelingOverlay({ bones }: Props) {
  const {
    modelingMode: mode,
    modelingSymmetric: symmetric,
    modelingValues: values,
    selectedModelingHandleId: selectedHandleId,
  } = useSnapshot(appState)
  const handles = useMemo(() => getModelingHandles(mode, symmetric), [mode, symmetric])
  const dragRef = useRef<DragState | null>(null)

  useEffect(() => {
    const onMove = (event: globalThis.PointerEvent) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return

      event.preventDefault()
      const nextValue = clampModelingValue(
        drag.handle.controlId,
        drag.startValue + dragDelta(drag.handle, event.clientX - drag.startX, event.clientY - drag.startY),
      )
      setModelingValues((prev) => ({ ...prev, [drag.handle.controlId]: nextValue }))
    }

    const onUp = (event: globalThis.PointerEvent) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return

      dragRef.current = null
      setIsTransforming(false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  return (
    <group>
      {handles.map((handle) => {
        const value = values[handle.controlId] ?? 0
        const selected = selectedHandleId === handle.id
        const position = getBoneEstimatedPosition(
          handle,
          bones,
          new THREE.Vector3(),
        ).toArray() as [number, number, number]

        return (
          <ModelingHandleDot
            key={handle.id}
            handle={handle}
            position={position}
            selected={selected}
            onPointerDown={(event) => {
              event.stopPropagation()
              setSelectedModelingHandleId(handle.id)
              dragRef.current = {
                pointerId: event.pointerId,
                handle,
                startX: event.clientX,
                startY: event.clientY,
                startValue: value,
              }
              setIsTransforming(true)
            }}
            onDoubleClick={(event) => {
              event.stopPropagation()
              setSelectedModelingHandleId(handle.id)
              setModelingValues((prev) => {
                const next = { ...prev }
                for (const id of handle.controlIds) next[id] = 0
                return next
              })
            }}
          />
        )
      })}
    </group>
  )
}

function ModelingHandleDot({
  handle,
  position,
  selected,
  onPointerDown,
  onDoubleClick,
}: {
  handle: ModelingHandle
  position: [number, number, number]
  selected: boolean
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void
  onDoubleClick: (event: ThreeEvent<MouseEvent>) => void
}) {
  const transform = handle.mode === 'transform'
  const radius = transform ? 0.0045 : 0.00225
  const hitRadius = transform ? 0.014 : 0.009
  const fillOpacity = transform ? (selected ? 0.82 : 0.5) : selected ? 0.12 : 0.02
  const ringOpacity = transform ? 0.62 : selected ? 0.7 : 0.28
  const color = selected ? ACTIVE_COLOR : transform ? TRANSFORM_COLOR : SCULPT_COLOR

  return (
    <Billboard position={position} follow lockX={false} lockY={false} lockZ={false}>
      <group
        renderOrder={1000}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
      >
        <mesh renderOrder={1000}>
          <circleGeometry args={[hitRadius, 28]} />
          <meshBasicMaterial
            transparent
            opacity={0.01}
            depthTest={false}
            depthWrite={false}
            color={color}
          />
        </mesh>
        <mesh renderOrder={1001}>
          <circleGeometry args={[radius, 36]} />
          <meshBasicMaterial
            transparent
            opacity={fillOpacity}
            depthTest={false}
            depthWrite={false}
            color={color}
          />
        </mesh>
        <mesh renderOrder={1002}>
          <torusGeometry args={[radius, transform ? 0.00115 : 0.00065, 8, 40]} />
          <meshBasicMaterial
            transparent
            opacity={ringOpacity}
            depthTest={false}
            depthWrite={false}
            color={color}
          />
        </mesh>
      </group>
    </Billboard>
  )
}

function normalizeBoneName(name: string) {
  return name.replace(/^DEF-/, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function getBoneByName(bones: Record<string, THREE.Bone>, name: string) {
  const normalized = normalizeBoneName(name)
  return (
    bones[name] ??
    Object.values(bones).find((bone) => normalizeBoneName(bone.name) === normalized) ??
    null
  )
}

function sideSuffix(handle: ModelingHandle) {
  if (handle.side === 'left') return 'L'
  if (handle.side === 'right') return 'R'
  return null
}

function getAnchorBoneNames(handle: ModelingHandle) {
  const side = sideSuffix(handle)
  const controlId = handle.controlId

  if (controlId.includes('.browRidge.')) {
    return side ? [`brow.B.${side}.002`, `brow.T.${side}.002`] : ['brow.B.L.002', 'brow.B.R.002']
  }
  if (controlId.includes('.forehead.')) {
    return side ? [`forehead.${side}.001`, `forehead.${side}.002`] : ['forehead.L.001', 'forehead.R.001']
  }
  if (controlId.includes('.cheekbone.') || controlId.includes('.upperJaw.')) {
    return side ? [`cheek.T.${side}`, `cheek.B.${side}`] : ['cheek.T.L', 'cheek.T.R']
  }
  if (controlId.includes('upperRim')) {
    return side ? [`lid.T.${side}.001`, `lid.T.${side}.002`] : ['lid.T.L.001', 'lid.T.R.001']
  }
  if (controlId.includes('lowerRim')) {
    return side ? [`lid.B.${side}.001`, `lid.B.${side}.002`] : ['lid.B.L.001', 'lid.B.R.001']
  }
  if (controlId.includes('.eye.')) {
    return side ? [`lid.T.${side}.002`, `brow.B.${side}.002`] : ['lid.T.L.002', 'lid.T.R.002']
  }
  if (controlId.includes('.temple.')) {
    return side ? [`forehead.${side}.002`, `brow.T.${side}`] : ['forehead.L.002', 'forehead.R.002']
  }
  if (controlId.includes('.lowerJaw.')) {
    return side ? [`chin.${side}`, `jaw.${side}`] : ['chin.L', 'chin.R']
  }
  if (controlId.includes('.chin.')) {
    return side ? [`chin.${side}`, 'chin.001'] : ['chin', 'chin.001']
  }
  if (controlId.includes('.nose.nostril.')) {
    return side ? [`nose.${side}.001`, `nose.${side}`] : ['nose.L.001', 'nose.R.001']
  }
  if (controlId.includes('.nose.bridge.')) {
    return ['nose', 'nose.001']
  }
  if (controlId.includes('.nose.nasalBone.')) {
    return ['nose.001', 'nose.002']
  }
  if (controlId.includes('.nose.upperCartilage.')) {
    return ['nose.002', 'nose.003']
  }
  if (controlId.includes('.nose.lowerCartilage.')) {
    return ['nose.003', 'nose.004']
  }
  if (controlId.includes('.nose.tip.')) {
    return ['nose.004']
  }
  if (controlId.includes('.nose.')) {
    return ['nose.001', 'nose.002']
  }
  if (controlId.includes('.upperLip.') || controlId.includes('.philtrum.')) {
    return side ? [`lip.T.${side}`, `lip.T.${side}.001`] : ['lip.T.L', 'lip.T.R']
  }
  if (controlId.includes('.lowerLip.')) {
    return side ? [`lip.B.${side}`, `lip.B.${side}.001`] : ['lip.B.L', 'lip.B.R']
  }
  if (controlId.includes('.mouth.')) {
    return side ? [`lip.T.${side}.001`, `lip.B.${side}.001`] : ['lip.T.L.001', 'lip.T.R.001']
  }
  if (controlId.includes('.braincase.') || controlId.includes('.head.')) {
    return ['RT_Head', 'head']
  }

  return []
}

function getBoneEstimatedPosition(
  handle: ModelingHandle,
  bones: Record<string, THREE.Bone>,
  out: THREE.Vector3,
) {
  if (isCenterNoseControl(handle.controlId) && getNoseChainPosition(handle, bones, out)) {
    return out
  }

  const boneNames = getAnchorBoneNames(handle)
  out.set(0, 0, 0)

  let count = 0
  for (const boneName of boneNames) {
    const bone = getBoneByName(bones, boneName)
    if (!bone) continue

    bone.getWorldPosition(fallbackVector)
    out.add(fallbackVector)
    count += 1
  }

  if (count > 0) {
    out.multiplyScalar(1 / count)

    const fallback = handle.position
    out.x = fallback[0]
    out.y += getAnchorYOffset(handle)
    out.z += getAnchorZOffset(handle)
    return out
  }

  return out.set(...handle.position)
}

function isCenterNoseControl(controlId: string) {
  return controlId.includes('.nose.') && !controlId.includes('.nose.nostril.')
}

function getNoseChainPosition(
  handle: ModelingHandle,
  bones: Record<string, THREE.Bone>,
  out: THREE.Vector3,
) {
  const hasRoot = getAverageBonePosition(['nose', 'nose.001'], bones, noseRootVector)
  const hasTip = getAverageBonePosition(['nose.004', 'nose.003'], bones, noseTipVector)
  if (!hasRoot || !hasTip) return false

  out.copy(noseRootVector).lerp(noseTipVector, getNoseChainT(handle.controlId))
  out.x = handle.position[0]
  out.y += getAnchorYOffset(handle)
  out.z += getAnchorZOffset(handle)
  return true
}

function getAverageBonePosition(
  names: string[],
  bones: Record<string, THREE.Bone>,
  out: THREE.Vector3,
) {
  out.set(0, 0, 0)
  let count = 0

  for (const name of names) {
    const bone = getBoneByName(bones, name)
    if (!bone) continue

    bone.getWorldPosition(fallbackVector)
    out.add(fallbackVector)
    count += 1
  }

  if (!count) return false
  out.multiplyScalar(1 / count)
  return true
}

function getNoseChainT(controlId: string) {
  if (controlId.includes('.nose.bridge.')) return 0.08
  if (controlId.includes('.nose.nasalBone.')) return 0.3
  if (controlId.includes('.nose.upperCartilage.')) return 0.54
  if (controlId.includes('.nose.lowerCartilage.')) return 0.72
  if (controlId.includes('.nose.tip.')) return 0.92
  return 0.4
}

function getAnchorYOffset(handle: ModelingHandle) {
  const id = handle.controlId
  if (id.includes('.forehead.')) return 0.035
  if (id.includes('.browRidge.')) return 0.01
  if (id.includes('.eye.')) return 0.006
  if (id.includes('.cheekbone.')) return 0.018
  if (id.includes('.nose.bridge.')) return 0.006
  if (id.includes('.nose.upperCartilage.')) return -0.002
  if (id.includes('.nose.lowerCartilage.')) return -0.006
  if (id.includes('.nose.tip.')) return -0.004
  if (id.includes('.upperJaw.')) return -0.01
  if (id.includes('.lowerJaw.')) return -0.018
  if (id.includes('.upperLip.')) return 0.005
  if (id.includes('.lowerLip.')) return -0.006
  if (id.includes('.chin.')) return -0.012
  return 0
}

function getAnchorZOffset(handle: ModelingHandle) {
  const id = handle.controlId
  if (id.includes('.forehead.') || id.includes('.browRidge.')) return 0.01
  if (id.includes('.eye.')) return 0.018
  if (id.includes('.cheekbone.')) return 0.012
  if (id.includes('.nose.bridge.')) return 0.008
  if (id.includes('.nose.nasalBone.')) return 0.012
  if (id.includes('.nose.upperCartilage.')) return 0.014
  if (id.includes('.nose.lowerCartilage.')) return 0.014
  if (id.includes('.nose.tip.')) return 0.018
  if (id.includes('.nose.')) return 0.01
  if (id.includes('.mouth.') || id.includes('.Lip.') || id.includes('.philtrum.')) return 0.012
  if (id.includes('.chin.')) return 0.01
  return 0
}
