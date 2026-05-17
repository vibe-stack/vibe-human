import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import type { ColliderSnapshot, GarmentRuntime } from '../simulation/types'

export function ClothingDebugView({
  runtime,
  colliderSnapshot,
}: {
  runtime: GarmentRuntime
  colliderSnapshot: ColliderSnapshot
}) {
  const particleGeometry = useMemo(() => new THREE.BufferGeometry(), [])
  const constraintGeometry = useMemo(() => new THREE.BufferGeometry(), [])
  const seamGeometry = useMemo(() => new THREE.BufferGeometry(), [])
  const particlePoints = useRef<THREE.Points>(null)

  useEffect(() => {
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(runtime.simMesh.positions, 3))
    constraintGeometry.setAttribute('position', new THREE.BufferAttribute(buildConstraintPositions(runtime, false), 3))
    seamGeometry.setAttribute('position', new THREE.BufferAttribute(buildConstraintPositions(runtime, true), 3))
    return () => {
      particleGeometry.dispose()
      constraintGeometry.dispose()
      seamGeometry.dispose()
    }
  }, [runtime, particleGeometry, constraintGeometry, seamGeometry])

  useFrame(() => {
    const particleAttr = particleGeometry.getAttribute('position') as THREE.BufferAttribute
    particleAttr.needsUpdate = true
    const constraintAttr = constraintGeometry.getAttribute('position') as THREE.BufferAttribute
    const seamAttr = seamGeometry.getAttribute('position') as THREE.BufferAttribute
    updateConstraintPositions(runtime, constraintAttr.array as Float32Array, false)
    updateConstraintPositions(runtime, seamAttr.array as Float32Array, true)
    constraintAttr.needsUpdate = true
    seamAttr.needsUpdate = true
  })

  return (
    <group>
      <points ref={particlePoints} geometry={particleGeometry} frustumCulled={false}>
        <pointsMaterial color="#ffffff" size={0.012} sizeAttenuation />
      </points>
      <lineSegments geometry={constraintGeometry} frustumCulled={false}>
        <lineBasicMaterial color="#5ea3ff" transparent opacity={0.32} />
      </lineSegments>
      <lineSegments geometry={seamGeometry} frustumCulled={false}>
        <lineBasicMaterial color="#ff9d4d" transparent opacity={0.9} />
      </lineSegments>
      {colliderSnapshot.proxies.map((proxy, index) => {
        if (proxy.kind === 'sphere') {
          return (
            <mesh key={`sphere-${index}`} position={[proxy.cx, proxy.cy, proxy.cz]}>
              <sphereGeometry args={[proxy.r + proxy.skin, 12, 12]} />
              <meshBasicMaterial color="#8be9ff" wireframe transparent opacity={0.25} />
            </mesh>
          )
        }
        if (proxy.kind === 'capsule') {
          const start = new THREE.Vector3(proxy.ax, proxy.ay, proxy.az)
          const end = new THREE.Vector3(proxy.bx, proxy.by, proxy.bz)
          const mid = start.clone().lerp(end, 0.5)
          const dir = end.clone().sub(start)
          const length = dir.length()
          const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
          return (
            <mesh key={`capsule-${index}`} position={[mid.x, mid.y, mid.z]} quaternion={[quat.x, quat.y, quat.z, quat.w]}>
              <capsuleGeometry args={[proxy.r + proxy.skin, Math.max(0.001, length - proxy.r * 2), 8, 12]} />
              <meshBasicMaterial color="#8be9ff" wireframe transparent opacity={0.22} />
            </mesh>
          )
        }
        return (
          <mesh key={`ellipsoid-${index}`} position={[proxy.cx, proxy.cy, proxy.cz]} quaternion={[proxy.qx, proxy.qy, proxy.qz, proxy.qw]} scale={[proxy.rx + proxy.skin, proxy.ry + proxy.skin, proxy.rz + proxy.skin]}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial color="#8be9ff" wireframe transparent opacity={0.2} />
          </mesh>
        )
      })}
    </group>
  )
}

function buildConstraintPositions(runtime: GarmentRuntime, seamsOnly: boolean) {
  const constraints = seamsOnly
    ? runtime.simMesh.seamConstraints
    : [...runtime.simMesh.stretchConstraints, ...runtime.simMesh.shearConstraints, ...runtime.simMesh.bendConstraints.map((constraint) => ({ a: constraint.a, b: constraint.c }))]
  const out = new Float32Array(constraints.length * 2 * 3)
  updateConstraintPositions(runtime, out, seamsOnly)
  return out
}

function updateConstraintPositions(runtime: GarmentRuntime, out: Float32Array, seamsOnly: boolean) {
  const positions = runtime.simMesh.positions
  const constraints = seamsOnly
    ? runtime.simMesh.seamConstraints
    : [...runtime.simMesh.stretchConstraints, ...runtime.simMesh.shearConstraints, ...runtime.simMesh.bendConstraints.map((constraint) => ({ a: constraint.a, b: constraint.c, rest: 0, compliance: 0, kind: 'stretch' as const }))]
  for (let index = 0; index < constraints.length; index += 1) {
    const constraint = constraints[index]
    const ia = constraint.a * 3
    const ib = constraint.b * 3
    out[index * 6] = positions[ia]
    out[index * 6 + 1] = positions[ia + 1]
    out[index * 6 + 2] = positions[ia + 2]
    out[index * 6 + 3] = positions[ib]
    out[index * 6 + 4] = positions[ib + 1]
    out[index * 6 + 5] = positions[ib + 2]
  }
}