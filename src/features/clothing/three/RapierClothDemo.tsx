import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useSnapshot } from 'valtio'
import * as THREE from 'three/webgpu'
import RAPIER from '@dimforge/rapier3d-compat'
import { clothingStore } from '../state/clothingStore'
import type { PatternPiece } from '../state/clothingTypes'

type RapierWorld = InstanceType<(typeof RAPIER)['World']>
type RapierRigidBody = ReturnType<RapierWorld['createRigidBody']>

type ClothSpec = {
  cols: number
  rows: number
  width: number
  depth: number
  spacingX: number
  spacingZ: number
}

type ClothSimulation = {
  world: RapierWorld
  bodies: RapierRigidBody[]
  accumulator: number
}

const HEAD_CENTER = { x: 0, y: 0.03, z: 0.02 }
const HEAD_RADIUS = 0.34
const PARTICLE_RADIUS = 0.009
const FIXED_STEP = 1 / 90
const MAX_SUBSTEPS = 4

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function getPatternBounds(piece: PatternPiece | undefined) {
  const points = piece ? Object.values(piece.points) : []
  if (!points.length) return { width: 280, depth: 280 }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }

  return {
    width: maxX - minX || 280,
    depth: maxY - minY || 280,
  }
}

function makeClothSpec(piece: PatternPiece | undefined): ClothSpec {
  const bounds = getPatternBounds(piece)
  const unitScale = 0.004
  const width = clamp(bounds.width * unitScale, 0.6, 1.25)
  const depth = clamp(bounds.depth * unitScale, 0.6, 1.25)
  const targetSpacing = clamp((piece?.particleDistance ?? 22) * unitScale, 0.045, 0.09)
  const cols = Math.round(clamp(Math.round(width / targetSpacing) + 1, 12, 24))
  const rows = Math.round(clamp(Math.round(depth / targetSpacing) + 1, 12, 24))

  return {
    cols,
    rows,
    width,
    depth,
    spacingX: width / (cols - 1),
    spacingZ: depth / (rows - 1),
  }
}

function makeInitialPosition(spec: ClothSpec, col: number, row: number) {
  const u = col / (spec.cols - 1)
  const v = row / (spec.rows - 1)
  const x = (u - 0.5) * spec.width
  const z = (v - 0.48) * spec.depth
  const ripple = Math.sin(u * Math.PI * 2.0) * Math.sin(v * Math.PI) * 0.015

  return {
    x,
    y: 0.72 + ripple,
    z,
  }
}

function bodyAt(bodies: RapierRigidBody[], spec: ClothSpec, col: number, row: number) {
  return bodies[row * spec.cols + col]
}

function addSpring(
  world: RapierWorld,
  a: RapierRigidBody,
  b: RapierRigidBody,
  restLength: number,
  stiffness: number,
  damping: number,
) {
  world.createImpulseJoint(
    RAPIER.JointData.spring(restLength, stiffness, damping, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
    a,
    b,
    true,
  )
}

function createSimulation(spec: ClothSpec): ClothSimulation {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = FIXED_STEP
  world.numSolverIterations = 14
  world.numInternalPgsIterations = 2
  world.maxCcdSubsteps = 2

  const headBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(HEAD_CENTER.x, HEAD_CENTER.y, HEAD_CENTER.z),
  )
  world.createCollider(
    RAPIER.ColliderDesc.ball(HEAD_RADIUS)
      .setFriction(1.25)
      .setRestitution(0.02)
      .setContactSkin(0.012),
    headBody,
  )

  const shoulderBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.39, -0.01),
  )
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.48, 0.12, 0.22)
      .setFriction(1.1)
      .setRestitution(0.01)
      .setContactSkin(0.01),
    shoulderBody,
  )

  const chestBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.82, -0.02),
  )
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.31, 0.38, 0.17)
      .setFriction(1.05)
      .setRestitution(0.01)
      .setContactSkin(0.01),
    chestBody,
  )

  const bodies: RapierRigidBody[] = []

  for (let row = 0; row < spec.rows; row += 1) {
    for (let col = 0; col < spec.cols; col += 1) {
      const p = makeInitialPosition(spec, col, row)
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z)
          .setAdditionalMass(0.018)
          .setLinearDamping(0.65)
          .setAngularDamping(1.0)
          .lockRotations()
          .setCcdEnabled(true),
      )
      body.setAdditionalSolverIterations(8)
      world.createCollider(
        RAPIER.ColliderDesc.ball(PARTICLE_RADIUS)
          .setFriction(0.95)
          .setRestitution(0.0)
          .setContactSkin(0.004),
        body,
      )
      bodies.push(body)
    }
  }

  for (let row = 0; row < spec.rows; row += 1) {
    for (let col = 0; col < spec.cols; col += 1) {
      const current = bodyAt(bodies, spec, col, row)

      if (col + 1 < spec.cols) {
        addSpring(world, current, bodyAt(bodies, spec, col + 1, row), spec.spacingX, 52, 4.2)
      }
      if (row + 1 < spec.rows) {
        addSpring(world, current, bodyAt(bodies, spec, col, row + 1), spec.spacingZ, 52, 4.2)
      }
      if (col + 1 < spec.cols && row + 1 < spec.rows) {
        addSpring(world, current, bodyAt(bodies, spec, col + 1, row + 1), Math.hypot(spec.spacingX, spec.spacingZ), 34, 3.4)
      }
      if (col > 0 && row + 1 < spec.rows) {
        addSpring(world, current, bodyAt(bodies, spec, col - 1, row + 1), Math.hypot(spec.spacingX, spec.spacingZ), 34, 3.4)
      }
      if (col + 2 < spec.cols) {
        addSpring(world, current, bodyAt(bodies, spec, col + 2, row), spec.spacingX * 2, 18, 2.2)
      }
      if (row + 2 < spec.rows) {
        addSpring(world, current, bodyAt(bodies, spec, col, row + 2), spec.spacingZ * 2, 18, 2.2)
      }
    }
  }

  return { world, bodies, accumulator: 0 }
}

function createClothGeometry(spec: ClothSpec) {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(spec.cols * spec.rows * 3)
  const uvs = new Float32Array(spec.cols * spec.rows * 2)
  const indices: number[] = []

  for (let row = 0; row < spec.rows; row += 1) {
    for (let col = 0; col < spec.cols; col += 1) {
      const vertexIndex = row * spec.cols + col
      const p = makeInitialPosition(spec, col, row)

      positions[vertexIndex * 3 + 0] = p.x
      positions[vertexIndex * 3 + 1] = p.y
      positions[vertexIndex * 3 + 2] = p.z
      uvs[vertexIndex * 2 + 0] = col / (spec.cols - 1)
      uvs[vertexIndex * 2 + 1] = 1 - row / (spec.rows - 1)

      if (col + 1 < spec.cols && row + 1 < spec.rows) {
        const a = vertexIndex
        const b = vertexIndex + 1
        const c = vertexIndex + spec.cols
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  return geometry
}

function writeBodiesToGeometry(sim: ClothSimulation, geometry: THREE.BufferGeometry) {
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!positionAttr) return

  const positions = positionAttr.array as Float32Array
  for (let i = 0; i < sim.bodies.length; i += 1) {
    const translation = sim.bodies[i].translation()
    positions[i * 3 + 0] = translation.x
    positions[i * 3 + 1] = translation.y
    positions[i * 3 + 2] = translation.z
  }

  positionAttr.needsUpdate = true
  geometry.computeVertexNormals()
}

export default function RapierClothDemo() {
  const { garment, previewOptions, simRunning, simResetKey } = useSnapshot(clothingStore)
  const selectedPattern = garment.selectedPatternId ? garment.patterns[garment.selectedPatternId] as PatternPiece | undefined : undefined
  const spec = makeClothSpec(selectedPattern)
  const simKey = `${simResetKey}:${spec.cols}:${spec.rows}:${spec.width.toFixed(3)}:${spec.depth.toFixed(3)}`
  const geometry = useMemo(() => createClothGeometry(spec), [simKey])
  const simRef = useRef<ClothSimulation | null>(null)
  const [rapierReady, setRapierReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    setRapierReady(false)

    RAPIER.init().then(() => {
      if (cancelled) return

      simRef.current?.world.free()
      simRef.current = createSimulation(spec)
      writeBodiesToGeometry(simRef.current, geometry)
      setRapierReady(true)
    })

    return () => {
      cancelled = true
      simRef.current?.world.free()
      simRef.current = null
    }
  }, [geometry, simKey])

  useEffect(() => {
    return () => geometry.dispose()
  }, [geometry])

  useFrame((_, delta) => {
    const sim = simRef.current
    if (!sim || !rapierReady) return

    if (simRunning) {
      sim.accumulator += Math.min(delta, 1 / 20)
      let steps = 0
      while (sim.accumulator >= FIXED_STEP && steps < MAX_SUBSTEPS) {
        sim.world.step()
        sim.accumulator -= FIXED_STEP
        steps += 1
      }
    }

    writeBodiesToGeometry(sim, geometry)
  })

  return (
    <group>
      <mesh geometry={geometry} frustumCulled={false}>
        <meshStandardMaterial
          color="#5f8cff"
          roughness={0.82}
          metalness={0}
          transparent
          opacity={0.82}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {(previewOptions.showWireframe || previewOptions.showTriangulation) && (
        <mesh geometry={geometry} frustumCulled={false}>
          <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.24} depthWrite={false} />
        </mesh>
      )}
      {previewOptions.showTriangulation && (
        <group>
          <mesh position={[HEAD_CENTER.x, HEAD_CENTER.y, HEAD_CENTER.z]}>
            <sphereGeometry args={[HEAD_RADIUS, 32, 16]} />
            <meshBasicMaterial color="#8be9ff" wireframe transparent opacity={0.22} depthWrite={false} />
          </mesh>
          <mesh position={[0, -0.39, -0.01]}>
            <boxGeometry args={[0.96, 0.24, 0.44]} />
            <meshBasicMaterial color="#8be9ff" wireframe transparent opacity={0.16} depthWrite={false} />
          </mesh>
        </group>
      )}
    </group>
  )
}
