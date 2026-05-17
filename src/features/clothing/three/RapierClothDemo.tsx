import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useSnapshot } from 'valtio'
import * as THREE from 'three/webgpu'
import RAPIER from '@dimforge/rapier3d-compat'
import { setIsTransforming } from '../../../appState'
import { clothingStore } from '../state/clothingStore'
import type { ClothSimQuality, PatternPiece } from '../state/clothingTypes'

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
  disposed: boolean
}

type ShapeBounds = {
  width: number
  depth: number
}

type DragParticle = {
  index: number
  offset: THREE.Vector3
  weight: number
}

type ClothDragState = {
  particles: DragParticle[]
  plane: THREE.Plane
  point: THREE.Vector3
  previousPoint: THREE.Vector3
  velocity: THREE.Vector3
  lastTime: number
}

type QualitySettings = {
  spacingScale: number
  minParticles: number
  maxParticles: number
  solverIterations: number
  internalPgsIterations: number
  bendStiffness: number
}

const HEAD_CENTER = { x: 0, y: 0.03, z: 0.02 }
const HEAD_RADIUS = 0.34
const PARTICLE_RADIUS = 0.009
const FIXED_STEP = 1 / 90
const MAX_SUBSTEPS = 4
const QUALITY_SETTINGS: Record<ClothSimQuality, QualitySettings> = {
  low: {
    spacingScale: 1.35,
    minParticles: 10,
    maxParticles: 16,
    solverIterations: 8,
    internalPgsIterations: 1,
    bendStiffness: 12,
  },
  medium: {
    spacingScale: 1,
    minParticles: 12,
    maxParticles: 24,
    solverIterations: 14,
    internalPgsIterations: 2,
    bendStiffness: 18,
  },
  high: {
    spacingScale: 0.72,
    minParticles: 16,
    maxParticles: 32,
    solverIterations: 20,
    internalPgsIterations: 3,
    bendStiffness: 24,
  },
  ultra: {
    spacingScale: 0.55,
    minParticles: 20,
    maxParticles: 42,
    solverIterations: 28,
    internalPgsIterations: 4,
    bendStiffness: 30,
  },
}

let rapierInitPromise: Promise<void> | null = null

function initRapierOnce() {
  rapierInitPromise ??= RAPIER.init()
  return rapierInitPromise
}

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

function getWorldPatternBounds(piece: PatternPiece | undefined): ShapeBounds {
  const bounds = getPatternBounds(piece)
  const unitScale = 0.004
  return {
    width: clamp(bounds.width * unitScale, 0.6, 1.25),
    depth: clamp(bounds.depth * unitScale, 0.6, 1.25),
  }
}

function makeClothSpec(piece: PatternPiece | undefined, quality: ClothSimQuality): ClothSpec {
  const bounds = getPatternBounds(piece)
  const settings = QUALITY_SETTINGS[quality]
  const unitScale = 0.004
  const width = clamp(bounds.width * unitScale, 0.6, 1.25)
  const depth = clamp(bounds.depth * unitScale, 0.6, 1.25)
  const targetSpacing = clamp((piece?.particleDistance ?? 22) * unitScale * settings.spacingScale, 0.028, 0.12)
  const cols = Math.round(clamp(Math.round(width / targetSpacing) + 1, settings.minParticles, settings.maxParticles))
  const rows = Math.round(clamp(Math.round(depth / targetSpacing) + 1, settings.minParticles, settings.maxParticles))

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

function createSimulation(spec: ClothSpec, quality: ClothSimQuality): ClothSimulation {
  const settings = QUALITY_SETTINGS[quality]
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = FIXED_STEP
  world.numSolverIterations = settings.solverIterations
  world.numInternalPgsIterations = settings.internalPgsIterations
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
        addSpring(world, current, bodyAt(bodies, spec, col + 2, row), spec.spacingX * 2, settings.bendStiffness, 2.2)
      }
      if (row + 2 < spec.rows) {
        addSpring(world, current, bodyAt(bodies, spec, col, row + 2), spec.spacingZ * 2, settings.bendStiffness, 2.2)
      }
    }
  }

  return { world, bodies, accumulator: 0, disposed: false }
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

function pointInPolygon(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    const intersect = a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (intersect) inside = !inside
  }
  return inside
}

function getOrderedLoopPoints(piece: PatternPiece, edges = piece.edges) {
  return edges.map((edge) => piece.points[edge.from]).filter((point): point is NonNullable<typeof point> => Boolean(point))
}

function pointInPatternPiece(point: { x: number; y: number }, piece: PatternPiece) {
  const outer = getOrderedLoopPoints(piece)
  if (outer.length < 3 || !pointInPolygon(point, outer)) return false

  for (const holeEdges of piece.holes ?? []) {
    const hole = getOrderedLoopPoints(piece, holeEdges)
    if (hole.length >= 3 && pointInPolygon(point, hole)) return false
  }

  return true
}

function updateClothTopologyFromPattern(geometry: THREE.BufferGeometry, spec: ClothSpec, piece: PatternPiece | undefined) {
  if (!piece?.closed) return
  const bounds = getPatternBounds(piece)
  const minX = Math.min(...Object.values(piece.points).map((point) => point.x))
  const minY = Math.min(...Object.values(piece.points).map((point) => point.y))
  const indices: number[] = []

  for (let row = 0; row < spec.rows - 1; row += 1) {
    for (let col = 0; col < spec.cols - 1; col += 1) {
      const center = {
        x: minX + ((col + 0.5) / (spec.cols - 1)) * bounds.width,
        y: minY + ((row + 0.5) / (spec.rows - 1)) * bounds.depth,
      }
      if (!pointInPatternPiece(center, piece)) continue

      const a = row * spec.cols + col
      const b = a + 1
      const c = a + spec.cols
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  geometry.setIndex(indices)
  geometry.computeVertexNormals()
}

function warpSimulationToPattern(sim: ClothSimulation | null, previous: ShapeBounds, next: ShapeBounds) {
  if (!sim || sim.disposed) return
  const scaleX = clamp(next.width / previous.width, 0.72, 1.38)
  const scaleZ = clamp(next.depth / previous.depth, 0.72, 1.38)
  if (Math.abs(scaleX - 1) < 0.01 && Math.abs(scaleZ - 1) < 0.01) return

  for (const body of sim.bodies) {
    const p = body.translation()
    body.setTranslation({ x: p.x * scaleX, y: p.y, z: p.z * scaleZ }, true)
  }
}

function disposeSimulation(sim: ClothSimulation | null) {
  if (!sim || sim.disposed) return
  sim.disposed = true
  sim.bodies = []
  sim.world.free()
}

function writeBodiesToGeometry(sim: ClothSimulation, geometry: THREE.BufferGeometry) {
  if (sim.disposed) return false
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!positionAttr) return false

  const positions = positionAttr.array as Float32Array
  for (let i = 0; i < sim.bodies.length; i += 1) {
    const translation = sim.bodies[i].translation()
    positions[i * 3 + 0] = translation.x
    positions[i * 3 + 1] = translation.y
    positions[i * 3 + 2] = translation.z
  }

  positionAttr.needsUpdate = true
  geometry.computeVertexNormals()
  return true
}

function vectorFromBody(body: RapierRigidBody) {
  const p = body.translation()
  return new THREE.Vector3(p.x, p.y, p.z)
}

export default function RapierClothDemo() {
  const { camera } = useThree()
  const { garment, previewOptions, simRunning, simResetKey, simQuality } = useSnapshot(clothingStore)
  const selectedPattern = garment.selectedPatternId ? garment.patterns[garment.selectedPatternId] as PatternPiece | undefined : undefined
  const selectedPatternId = garment.selectedPatternId ?? 'none'
  const documentId = garment.id
  const simKey = `${documentId}:${selectedPatternId}:${simResetKey}:${simQuality}`
  const patternRevision = selectedPattern
    ? JSON.stringify({
      points: Object.values(selectedPattern.points).map((point) => [point.id, point.x, point.y, point.in, point.out]),
      edges: selectedPattern.edges.map((edge) => [edge.id, edge.from, edge.to, edge.curve]),
      holes: selectedPattern.holes?.map((loop) => loop.map((edge) => [edge.id, edge.from, edge.to, edge.curve])),
    })
    : 'none'
  const spec = useMemo(() => makeClothSpec(selectedPattern, simQuality), [simKey])
  const geometry = useMemo(() => createClothGeometry(spec), [simKey])
  const simRef = useRef<ClothSimulation | null>(null)
  const shapeBoundsRef = useRef<ShapeBounds | null>(null)
  const dragRef = useRef<ClothDragState | null>(null)
  const [rapierReady, setRapierReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    setRapierReady(false)

    initRapierOnce().then(() => {
      if (cancelled) return

      const previous = simRef.current
      simRef.current = null
      disposeSimulation(previous)

      const next = createSimulation(spec, simQuality)
      simRef.current = next
      shapeBoundsRef.current = getWorldPatternBounds(selectedPattern)
      updateClothTopologyFromPattern(geometry, spec, selectedPattern)
      writeBodiesToGeometry(next, geometry)
      setRapierReady(true)
    })

    return () => {
      cancelled = true
      dragRef.current = null
      setIsTransforming(false)
      const previous = simRef.current
      simRef.current = null
      disposeSimulation(previous)
    }
  }, [geometry, selectedPattern, simKey, simQuality, spec])

  useEffect(() => {
    return () => geometry.dispose()
  }, [geometry])

  useEffect(() => {
    const nextBounds = getWorldPatternBounds(selectedPattern)
    const previousBounds = shapeBoundsRef.current ?? nextBounds
    updateClothTopologyFromPattern(geometry, spec, selectedPattern)
    warpSimulationToPattern(simRef.current, previousBounds, nextBounds)
    shapeBoundsRef.current = nextBounds
  }, [geometry, patternRevision, selectedPattern, spec])

  function getDragParticles(point: THREE.Vector3): DragParticle[] {
    const sim = simRef.current
    if (!sim || sim.disposed) return []

    let nearestIndex = -1
    let nearestDistanceSq = Infinity
    const radius = clamp(Math.max(spec.spacingX, spec.spacingZ) * 4.8, 0.18, 0.36)
    const radiusSq = radius * radius
    const particles: Array<DragParticle & { distanceSq: number }> = []

    for (let i = 0; i < sim.bodies.length; i += 1) {
      const bodyPoint = vectorFromBody(sim.bodies[i])
      const dx = bodyPoint.x - point.x
      const dy = bodyPoint.y - point.y
      const dz = bodyPoint.z - point.z
      const dSq = dx * dx + dy * dy + dz * dz

      if (dSq < nearestDistanceSq) {
        nearestDistanceSq = dSq
        nearestIndex = i
      }
      if (dSq <= radiusSq) {
        const normalized = Math.sqrt(dSq) / radius
        particles.push({
          index: i,
          offset: bodyPoint.sub(point),
          weight: clamp(1 - normalized * 0.75, 0.25, 1),
          distanceSq: dSq,
        })
      }
    }

    if (!particles.length && nearestIndex >= 0) {
      particles.push({
        index: nearestIndex,
        offset: vectorFromBody(sim.bodies[nearestIndex]).sub(point),
        weight: 1,
        distanceSq: nearestDistanceSq,
      })
    }

    return particles
      .sort((a, b) => a.distanceSq - b.distanceSq)
      .slice(0, 72)
      .map(({ distanceSq: _distanceSq, ...particle }) => particle)
  }

  function intersectDragPlane(event: ThreeEvent<PointerEvent>, plane: THREE.Plane) {
    return event.ray.intersectPlane(plane, new THREE.Vector3())
  }

  function applyDragPull(drag: ClothDragState) {
    const sim = simRef.current
    if (!sim || sim.disposed) return

    for (const particle of drag.particles) {
      const body = sim.bodies[particle.index]
      if (!body) continue

      const current = vectorFromBody(body)
      const target = drag.point.clone().add(particle.offset)
      const error = target.sub(current)
      const linvel = body.linvel()
      const desiredVelocity = error.multiplyScalar(18).add(drag.velocity.clone().multiplyScalar(0.95))
      const velocityDelta = desiredVelocity.sub(new THREE.Vector3(linvel.x, linvel.y, linvel.z))
      const maxDelta = 14

      if (velocityDelta.lengthSq() > maxDelta * maxDelta) {
        velocityDelta.normalize().multiplyScalar(maxDelta)
      }

      const impulse = velocityDelta.multiplyScalar(0.018 * particle.weight)
      body.wakeUp()
      body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true)
    }

    clothingStore.simRunning = true
  }

  function applyReleaseFlick(drag: ClothDragState) {
    const sim = simRef.current
    if (!sim || sim.disposed || drag.velocity.lengthSq() < 0.01) return

    const flick = drag.velocity.clone()
    const maxFlick = 10
    if (flick.lengthSq() > maxFlick * maxFlick) {
      flick.normalize().multiplyScalar(maxFlick)
    }

    for (const particle of drag.particles) {
      const body = sim.bodies[particle.index]
      if (!body) continue
      const impulse = flick.clone().multiplyScalar(0.018 * 1.65 * particle.weight)
      body.wakeUp()
      body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true)
    }

    clothingStore.simRunning = true
  }

  function handlePointerDown(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation()
    const point = event.point.clone()
    const particles = getDragParticles(point)
    if (!particles.length) return

    const normal = new THREE.Vector3()
    camera.getWorldDirection(normal)
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point)

    dragRef.current = {
      particles,
      plane,
      point,
      previousPoint: point.clone(),
      velocity: new THREE.Vector3(),
      lastTime: performance.now(),
    }
    setIsTransforming(true)
    ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
  }

  function handlePointerMove(event: ThreeEvent<PointerEvent>) {
    const drag = dragRef.current
    if (!drag) return
    event.stopPropagation()
    const nextPoint = intersectDragPlane(event, drag.plane)
    if (!nextPoint) return

    const now = performance.now()
    const dt = Math.max((now - drag.lastTime) / 1000, 1 / 240)
    const instantaneousVelocity = nextPoint.clone().sub(drag.point).divideScalar(dt)

    drag.previousPoint.copy(drag.point)
    drag.point.copy(nextPoint)
    drag.velocity.lerp(instantaneousVelocity, 0.55)
    drag.lastTime = now
  }

  function handlePointerUp(event: ThreeEvent<PointerEvent>) {
    const drag = dragRef.current
    if (!drag) return
    event.stopPropagation()
    applyReleaseFlick(drag)
    dragRef.current = null
    setIsTransforming(false)
    ;(event.target as HTMLElement).releasePointerCapture?.(event.pointerId)
  }

  useFrame((_, delta) => {
    const sim = simRef.current
    if (!sim || sim.disposed || !rapierReady) return

    try {
      if (dragRef.current) {
        applyDragPull(dragRef.current)
      }

      if (simRunning || dragRef.current) {
        sim.accumulator += Math.min(delta, 1 / 20)
        let steps = 0
        while (sim.accumulator >= FIXED_STEP && steps < MAX_SUBSTEPS) {
          sim.world.step()
          sim.accumulator -= FIXED_STEP
          steps += 1
        }
      }

      writeBodiesToGeometry(sim, geometry)
    } catch (error) {
      console.error('Rapier cloth simulation failed; disposing invalid world.', error)
      simRef.current = null
      disposeSimulation(sim)
      setRapierReady(false)
      clothingStore.simRunning = false
    }
  })

  return (
    <group>
      <mesh
        geometry={geometry}
        frustumCulled={false}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
      >
        <meshStandardMaterial
          color="#5f8cff"
          roughness={0.82}
          metalness={0}
          side={THREE.DoubleSide}
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
