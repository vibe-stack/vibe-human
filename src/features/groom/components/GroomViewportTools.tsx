import { useEffect, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useSnapshot } from 'valtio'
import * as THREE from 'three'
import { setIsTransforming } from '../../../appState'
import {
  collectTrianglesInBrush,
  computeTriangleIndexFromIntersection,
  getTriangleSurfaceData,
} from '../core/scalpBinding'
import {
  addGuideAtSurfacePoint,
  getRegisteredGroomMesh,
  getRegisteredGroomMeshes,
  groomStore,
  setSceneSelectionMeshId,
  updateGuideTools,
  updateScalpMaskTriangles,
} from '../store/groomStore'

type DragState = {
  pointerId: number
  lastPointLocal: THREE.Vector3
}

function buildScalpMaskGeometry(mesh: THREE.Mesh, triangleIndices: number[]) {
  const geometry = mesh.geometry
  if (!(geometry instanceof THREE.BufferGeometry) || !triangleIndices.length) return null

  const positions: number[] = []
  for (const triangleIndex of triangleIndices) {
    const surface = getTriangleSurfaceData(geometry, triangleIndex)
    if (!surface) continue

    positions.push(
      surface.a.x, surface.a.y, surface.a.z,
      surface.b.x, surface.b.y, surface.b.z,
      surface.b.x, surface.b.y, surface.b.z,
      surface.c.x, surface.c.y, surface.c.z,
      surface.c.x, surface.c.y, surface.c.z,
      surface.a.x, surface.a.y, surface.a.z,
    )
  }

  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return result
}

function FollowerMesh({
  source,
  onPointerDown,
  onPointerMove,
}: {
  source: THREE.Mesh
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void
}) {
  const ref = useRef<THREE.Mesh>(null)

  useFrame(() => {
    if (!ref.current) return
    ref.current.matrix.copy(source.matrixWorld)
  })

  return (
    <mesh
      ref={ref}
      geometry={source.geometry}
      matrixAutoUpdate={false}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      <meshBasicMaterial
        transparent
        opacity={0}
        depthWrite={false}
        side={THREE.DoubleSide}
        colorWrite={false}
      />
    </mesh>
  )
}

function FollowerGroup({
  source,
  children,
}: {
  source: THREE.Mesh
  children: React.ReactNode
}) {
  const ref = useRef<THREE.Group>(null)

  useFrame(() => {
    if (!ref.current) return
    ref.current.matrix.copy(source.matrixWorld)
  })

  return (
    <group ref={ref} matrixAutoUpdate={false}>
      {children}
    </group>
  )
}

export default function GroomViewportTools() {
  const { activeGroomAsset, activeGroomTool, brushSize, brushStrength, showScalpMask } = useSnapshot(groomStore)
  const targetMesh = getRegisteredGroomMesh(activeGroomAsset.targetMeshId)
  const dragRef = useRef<DragState | null>(null)
  const maskMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ color: '#f472b6', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }),
    [],
  )
  const scalpMaskGeometry = useMemo(() => {
    if (!targetMesh || !showScalpMask) return null
    return buildScalpMaskGeometry(targetMesh, [...activeGroomAsset.scalpMask.selectedTriangleIndices])
  }, [activeGroomAsset.scalpMask.selectedTriangleIndices, showScalpMask, targetMesh])

  useEffect(() => {
    const onPointerUp = () => {
      dragRef.current = null
      setIsTransforming(false)
    }

    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [])

  useEffect(() => () => maskMaterial.dispose(), [maskMaterial])
  useEffect(() => () => scalpMaskGeometry?.dispose(), [scalpMaskGeometry])

  const handleTargetPointerDown = (event: ThreeEvent<PointerEvent>, sourceMesh: THREE.Mesh) => {
    setSceneSelectionMeshId((sourceMesh.userData.groomMeshId as string | undefined) ?? null)

    if (!activeGroomAsset.targetMeshId || sourceMesh.userData.groomMeshId !== activeGroomAsset.targetMeshId) {
      return
    }

    const triangleIndex = computeTriangleIndexFromIntersection(event.intersections[0] ?? event)
    if (triangleIndex === null) return

    event.stopPropagation()
    const localPoint = sourceMesh.worldToLocal(event.point.clone())

    if (activeGroomTool === 'paint-scalp' || activeGroomTool === 'erase-scalp') {
      setIsTransforming(true)
      const affectedTriangles = collectTrianglesInBrush(
        sourceMesh,
        localPoint,
        brushSize * THREE.MathUtils.lerp(0.45, 1.1, brushStrength),
      )
      updateScalpMaskTriangles(
        affectedTriangles.length ? affectedTriangles : [triangleIndex],
        activeGroomTool === 'paint-scalp' ? 'add' : 'remove',
      )
      return
    }

    if (activeGroomTool === 'add-guide') {
      updateScalpMaskTriangles([triangleIndex], 'add')
      addGuideAtSurfacePoint(sourceMesh, triangleIndex, localPoint)
      return
    }

    if (activeGroomTool === 'smooth') {
      updateGuideTools('smooth', localPoint)
      return
    }

    if (activeGroomTool === 'cut') {
      updateGuideTools('cut', localPoint)
      return
    }

    if (activeGroomTool === 'delete-guide') {
      updateGuideTools('delete', localPoint)
      return
    }

    if (activeGroomTool === 'comb') {
      dragRef.current = { pointerId: event.pointerId, lastPointLocal: localPoint }
      setIsTransforming(true)
    }
  }

  const handleTargetPointerMove = (event: ThreeEvent<PointerEvent>, sourceMesh: THREE.Mesh) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || activeGroomTool !== 'comb') return

    const localPoint = sourceMesh.worldToLocal(event.point.clone())
    const delta = localPoint.clone().sub(drag.lastPointLocal)
    drag.lastPointLocal.copy(localPoint)
    updateGuideTools('comb', localPoint, delta)
  }

  const meshes = getRegisteredGroomMeshes().map((descriptor) => getRegisteredGroomMesh(descriptor.id)).filter((mesh): mesh is THREE.Mesh => mesh !== null)

  return (
    <group>
      {meshes.map((mesh) => (
        <FollowerMesh
          key={mesh.userData.groomMeshId as string}
          source={mesh}
          onPointerDown={(event: ThreeEvent<PointerEvent>) => handleTargetPointerDown(event, mesh)}
          onPointerMove={(event: ThreeEvent<PointerEvent>) => handleTargetPointerMove(event, mesh)}
        />
      ))}

      {targetMesh && scalpMaskGeometry && (
        <FollowerGroup source={targetMesh}>
          <lineSegments geometry={scalpMaskGeometry} renderOrder={59}>
            <primitive object={maskMaterial} attach="material" />
          </lineSegments>
        </FollowerGroup>
      )}
    </group>
  )
}