import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import { useSnapshot } from 'valtio'
import * as THREE from 'three/webgpu'
import RAPIER from '@dimforge/rapier3d-compat'
import { setIsTransforming } from '../../../appState'
import { clothingStore } from '../state/clothingStore'
import { selectPattern, setPatternPlacement } from '../state/clothingActions'
import type { ClothSimQuality, PatternPiece, PatternPlacement } from '../state/clothingTypes'
import { triangulatePattern } from '../geometry/triangulatePattern'

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
  /** Sparse: indices that fall in holes / outside outline are null. */
  bodies: Array<RapierRigidBody | null>
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
const PARTICLE_RADIUS = 0.008
const FIXED_STEP = 1 / 90
const MAX_SUBSTEPS = 4
const PATTERN_UNIT_SCALE = 0.004
const RENDER_TRIANGLE_SUBDIVISIONS = 6
const CLOTH_LOCAL_Y = 0.72

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
    spacingScale: 0.95,
    minParticles: 14,
    maxParticles: 26,
    solverIterations: 14,
    internalPgsIterations: 2,
    bendStiffness: 18,
  },
  high: {
    spacingScale: 0.68,
    minParticles: 18,
    maxParticles: 36,
    solverIterations: 20,
    internalPgsIterations: 3,
    bendStiffness: 24,
  },
  ultra: {
    spacingScale: 0.5,
    minParticles: 22,
    maxParticles: 48,
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
  if (!points.length) return { minX: -140, minY: -140, width: 280, depth: 280 }

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
    minX,
    minY,
    width: maxX - minX || 1,
    depth: maxY - minY || 1,
  }
}

function getWorldPatternBounds(piece: PatternPiece | undefined): ShapeBounds {
  const bounds = getPatternBounds(piece)
  return {
    width: Math.max(bounds.width * PATTERN_UNIT_SCALE, 0.08),
    depth: Math.max(bounds.depth * PATTERN_UNIT_SCALE, 0.08),
  }
}

function makeClothSpec(piece: PatternPiece | undefined, quality: ClothSimQuality): ClothSpec {
  const bounds = getWorldPatternBounds(piece)
  const settings = QUALITY_SETTINGS[quality]
  const baseParticleDistance = (piece?.particleDistance ?? 22) * PATTERN_UNIT_SCALE
  const targetSpacing = clamp(baseParticleDistance * settings.spacingScale, 0.012, 0.12)
  const cols = Math.round(clamp(Math.round(bounds.width / targetSpacing) + 1, settings.minParticles, settings.maxParticles))
  const rows = Math.round(clamp(Math.round(bounds.depth / targetSpacing) + 1, settings.minParticles, settings.maxParticles))

  return {
    cols,
    rows,
    width: bounds.width,
    depth: bounds.depth,
    spacingX: bounds.width / (cols - 1),
    spacingZ: bounds.depth / (rows - 1),
  }
}

/**
 * Local-space spawn position for one cloth particle. We keep y around 0 so
 * the cloth's group origin sits at the cloth center — this puts the
 * TransformControls gizmo on the cloth instead of below the model. The
 * default placement adds the spawn height once at the group level.
 */
function makeInitialPosition(spec: ClothSpec, col: number, row: number) {
  const u = col / (spec.cols - 1)
  const v = row / (spec.rows - 1)
  const x = (u - 0.5) * spec.width
  const z = (v - 0.48) * spec.depth
  const ripple = Math.sin(u * Math.PI * 2.0) * Math.sin(v * Math.PI) * 0.015

  return { x, y: ripple, z }
}

function bodyAt(bodies: Array<RapierRigidBody | null>, spec: ClothSpec, col: number, row: number) {
  return bodies[row * spec.cols + col] ?? null
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

function createSimulation(
  spec: ClothSpec,
  quality: ClothSimQuality,
  piece: PatternPiece | undefined,
): ClothSimulation {
  const settings = QUALITY_SETTINGS[quality]
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = FIXED_STEP
  world.numSolverIterations = settings.solverIterations
  world.numInternalPgsIterations = settings.internalPgsIterations
  world.maxCcdSubsteps = 2

  const headBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(HEAD_CENTER.x, HEAD_CENTER.y, HEAD_CENTER.z))
  world.createCollider(
    RAPIER.ColliderDesc.ball(HEAD_RADIUS).setFriction(1.25).setRestitution(0.02).setContactSkin(0.012),
    headBody,
  )

  const shoulderBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.39, -0.01))
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.48, 0.12, 0.22).setFriction(1.1).setRestitution(0.01).setContactSkin(0.01),
    shoulderBody,
  )

  const chestBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.82, -0.02))
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.31, 0.38, 0.17).setFriction(1.05).setRestitution(0.01).setContactSkin(0.01),
    chestBody,
  )

  // Same active mask as the rendered topology — single source of truth so a
  // particle exists iff a visible triangle could touch it.
  const active = buildActiveMask(spec, piece)

  const bodies: Array<RapierRigidBody | null> = []

  for (let row = 0; row < spec.rows; row += 1) {
    for (let col = 0; col < spec.cols; col += 1) {
      const idx = row * spec.cols + col
      if (!active[idx]) { bodies.push(null); continue }

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
        RAPIER.ColliderDesc.ball(PARTICLE_RADIUS).setFriction(0.95).setRestitution(0.0).setContactSkin(0.004),
        body,
      )
      bodies.push(body)
    }
  }

  const link = (
    a: RapierRigidBody | null,
    b: RapierRigidBody | null,
    rest: number,
    stiff: number,
    damp: number,
  ) => { if (a && b) addSpring(world, a, b, rest, stiff, damp) }

  for (let row = 0; row < spec.rows; row += 1) {
    for (let col = 0; col < spec.cols; col += 1) {
      const current = bodyAt(bodies, spec, col, row)
      if (!current) continue

      if (col + 1 < spec.cols) link(current, bodyAt(bodies, spec, col + 1, row), spec.spacingX, 52, 4.2)
      if (row + 1 < spec.rows) link(current, bodyAt(bodies, spec, col, row + 1), spec.spacingZ, 52, 4.2)
      if (col + 1 < spec.cols && row + 1 < spec.rows) {
        link(current, bodyAt(bodies, spec, col + 1, row + 1), Math.hypot(spec.spacingX, spec.spacingZ), 34, 3.4)
      }
      if (col > 0 && row + 1 < spec.rows) {
        link(current, bodyAt(bodies, spec, col - 1, row + 1), Math.hypot(spec.spacingX, spec.spacingZ), 34, 3.4)
      }
      if (col + 2 < spec.cols) link(current, bodyAt(bodies, spec, col + 2, row), spec.spacingX * 2, settings.bendStiffness, 2.2)
      if (row + 2 < spec.rows) link(current, bodyAt(bodies, spec, col, row + 2), spec.spacingZ * 2, settings.bendStiffness, 2.2)
    }
  }

  return { world, bodies, accumulator: 0, disposed: false }
}

function createClothGeometry(spec: ClothSpec) {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(spec.cols * spec.rows * 3)
  const uvs = new Float32Array(spec.cols * spec.rows * 2)

  for (let row = 0; row < spec.rows; row += 1) {
    for (let col = 0; col < spec.cols; col += 1) {
      const vertexIndex = row * spec.cols + col
      const p = makeInitialPosition(spec, col, row)
      positions[vertexIndex * 3 + 0] = p.x
      positions[vertexIndex * 3 + 1] = p.y
      positions[vertexIndex * 3 + 2] = p.z
      uvs[vertexIndex * 2 + 0] = col / (spec.cols - 1)
      uvs[vertexIndex * 2 + 1] = 1 - row / (spec.rows - 1)
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
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

/** Compute the per-cell active mask. A cell is active iff its corresponding
 *  pattern-space point is inside the piece (outer outline minus holes). */
function buildActiveMask(spec: ClothSpec, piece: PatternPiece | undefined): boolean[] {
  const mask = new Array<boolean>(spec.cols * spec.rows).fill(true)
  if (!piece?.closed) return mask
  const bounds = getPatternBounds(piece)
  for (let row = 0; row < spec.rows; row += 1) {
    for (let col = 0; col < spec.cols; col += 1) {
      const u = col / (spec.cols - 1)
      const v = row / (spec.rows - 1)
      const px = bounds.minX + u * bounds.width
      const py = bounds.minY + v * bounds.depth
      mask[row * spec.cols + col] = pointInPatternPiece({ x: px, y: py }, piece)
    }
  }
  return mask
}

function updateClothTopologyFromPattern(geometry: THREE.BufferGeometry, spec: ClothSpec, piece: PatternPiece | undefined) {
  if (!piece?.closed) return
  const mask = buildActiveMask(spec, piece)
  const indices: number[] = []

  // Include a quad only if ALL FOUR corner particles exist (active). This
  // prevents triangles from referencing a never-written vertex stuck at
  // (0,0,0), which was producing the "edges at origin" spikes.
  for (let row = 0; row < spec.rows - 1; row += 1) {
    for (let col = 0; col < spec.cols - 1; col += 1) {
      const a = row * spec.cols + col
      const b = a + 1
      const c = a + spec.cols
      const d = c + 1
      if (!mask[a] || !mask[b] || !mask[c] || !mask[d]) continue
      indices.push(a, c, b, b, c, d)
    }
  }

  geometry.setIndex(indices)
  geometry.computeVertexNormals()
}

/**
 * Build a high-res renderable mesh from the (hole-aware) pattern outline.
 * Each earcut triangle is subdivided barycentrically into RTS² smaller
 * triangles so the silhouette is smooth even when the sim grid is coarse.
 * UVs are stored in pattern-space [0,1]² so we can sample the sim grid at
 * render time. This is the marvelous-designer-style decoupling: physics is
 * a sparse grid, visuals are a dense triangulation skinned to that grid.
 */
function createPatternRenderGeometry(piece: PatternPiece) {
  const { vertices, indices } = triangulatePattern(piece)
  const geometry = new THREE.BufferGeometry()

  if (vertices.length < 3 || indices.length < 3) {
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(0), 2))
    return geometry
  }

  const bounds = getPatternBounds(piece)
  const renderUvs: number[] = []
  const renderIndices: number[] = []
  const N = RENDER_TRIANGLE_SUBDIVISIONS

  function pushUv(u: number, v: number) {
    const index = renderUvs.length / 2
    renderUvs.push(u, v)
    return index
  }

  function vertexUv(index: number) {
    const v = vertices[index]
    return { u: (v.x - bounds.minX) / bounds.width, v: (v.y - bounds.minY) / bounds.depth }
  }

  for (let tri = 0; tri < indices.length; tri += 3) {
    const A = vertexUv(indices[tri + 0])
    const B = vertexUv(indices[tri + 1])
    const C = vertexUv(indices[tri + 2])
    const rows: number[][] = []
    for (let i = 0; i <= N; i += 1) {
      rows[i] = []
      for (let j = 0; j <= N - i; j += 1) {
        const wa = 1 - (i + j) / N
        const wb = i / N
        const wc = j / N
        rows[i][j] = pushUv(A.u * wa + B.u * wb + C.u * wc, A.v * wa + B.v * wb + C.v * wc)
      }
    }
    for (let i = 0; i < N; i += 1) {
      for (let j = 0; j < N - i; j += 1) {
        const v0 = rows[i][j]
        const v1 = rows[i + 1][j]
        const v2 = rows[i][j + 1]
        renderIndices.push(v0, v1, v2)
        if (j < N - i - 1) {
          renderIndices.push(v1, rows[i + 1][j + 1], v2)
        }
      }
    }
  }

  const positions = new Float32Array((renderUvs.length / 2) * 3)
  const uvs = new Float32Array(renderUvs)
  // Initialise positions to the rest layout so the first frame before sim
  // doesn't show a flattened mesh. The sim ticker will overwrite these.
  // (No spec available here — leave zero; sim init will write real values.)
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(renderIndices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Sample the sim grid bilinearly. Visual vertices live in pattern-space UV
 * [0,1]². Because the active mask used for body creation is derived from the
 * same `pointInPatternPiece` test that earcut respects, a visual vertex
 * inside the rendered mesh is in a quad whose 4 corner bodies all exist —
 * so the lerp is clean. We still guard against missing corners for safety.
 */
function sampleSimAt(sim: ClothSimulation, spec: ClothSpec, u: number, v: number, out: THREE.Vector3) {
  const gx = clamp(u, 0, 1) * (spec.cols - 1)
  const gy = clamp(v, 0, 1) * (spec.rows - 1)
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const x1 = Math.min(x0 + 1, spec.cols - 1)
  const y1 = Math.min(y0 + 1, spec.rows - 1)
  const tx = gx - x0
  const ty = gy - y0

  const ba = bodyAt(sim.bodies, spec, x0, y0)
  const bb = bodyAt(sim.bodies, spec, x1, y0)
  const bc = bodyAt(sim.bodies, spec, x0, y1)
  const bd = bodyAt(sim.bodies, spec, x1, y1)
  const fallback = ba ?? bb ?? bc ?? bd
  if (!fallback) return out.set(0, 0, 0)
  const a = ba ? vectorFromBody(ba) : vectorFromBody(fallback)
  const b = bb ? vectorFromBody(bb) : vectorFromBody(fallback)
  const c = bc ? vectorFromBody(bc) : vectorFromBody(fallback)
  const d = bd ? vectorFromBody(bd) : vectorFromBody(fallback)
  const top = a.lerp(b, tx)
  const bottom = c.lerp(d, tx)
  return out.copy(top.lerp(bottom, ty))
}

function writeVisualFromSim(sim: ClothSimulation, spec: ClothSpec, geometry: THREE.BufferGeometry) {
  if (sim.disposed) return
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!positionAttr || !uvAttr || uvAttr.count === 0) return
  const positions = positionAttr.array as Float32Array
  const uvs = uvAttr.array as Float32Array
  const p = new THREE.Vector3()
  for (let i = 0; i < positionAttr.count; i += 1) {
    sampleSimAt(sim, spec, uvs[i * 2 + 0], uvs[i * 2 + 1], p)
    positions[i * 3 + 0] = p.x
    positions[i * 3 + 1] = p.y
    positions[i * 3 + 2] = p.z
  }
  positionAttr.needsUpdate = true
  geometry.computeVertexNormals()
}

function warpSimulationToPattern(sim: ClothSimulation | null, previous: ShapeBounds, next: ShapeBounds) {
  if (!sim || sim.disposed) return
  const scaleX = clamp(next.width / previous.width, 0.35, 2.85)
  const scaleZ = clamp(next.depth / previous.depth, 0.35, 2.85)
  if (Math.abs(scaleX - 1) < 0.01 && Math.abs(scaleZ - 1) < 0.01) return

  for (const body of sim.bodies) {
    if (!body) continue
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
    const body = sim.bodies[i]
    if (!body) continue
    const translation = body.translation()
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

function defaultPlacement(index: number, count: number): PatternPlacement {
  return {
    position: { x: (index - (count - 1) / 2) * 0.08, y: CLOTH_LOCAL_Y, z: index * 0.018 },
    rotation: { x: 0, y: 0, z: 0 },
  }
}

type ClothPieceProps = {
  piece: PatternPiece
  index: number
  count: number
  selected: boolean
  placement?: PatternPlacement
  simRunning: boolean
  simResetKey: number
  simQuality: ClothSimQuality
  transformMode: 'translate' | 'rotate'
  showWireframe: boolean
  showTriangulation: boolean
}

function ClothPiece({
  piece,
  index,
  count,
  selected,
  placement,
  simRunning,
  simResetKey,
  simQuality,
  transformMode,
  showWireframe,
  showTriangulation,
}: ClothPieceProps) {
  const { camera } = useThree()
  const groupRef = useRef<THREE.Group>(null)
  const simRef = useRef<ClothSimulation | null>(null)
  const shapeBoundsRef = useRef<ShapeBounds | null>(null)
  const dragRef = useRef<ClothDragState | null>(null)
  const previousSimRunningRef = useRef(simRunning)
  const [rapierReady, setRapierReady] = useState(false)

  const simKey = `${piece.id}:${simResetKey}:${simQuality}`
  const patternRevision = JSON.stringify({
    points: Object.values(piece.points).map((point) => [point.id, point.x, point.y, point.in, point.out]),
    edges: piece.edges.map((edge) => [edge.id, edge.from, edge.to, edge.curve]),
    holes: piece.holes?.map((loop) => loop.map((edge) => [edge.id, edge.from, edge.to, edge.curve])),
  })
  const spec = useMemo(() => makeClothSpec(piece, simQuality), [piece.id, simKey])
  const simGeometry = useMemo(() => createClothGeometry(spec), [simKey, spec])
  const visualGeometry = useMemo(() => createPatternRenderGeometry(piece), [patternRevision, piece])
  const currentPlacement = placement ?? defaultPlacement(index, count)

  useEffect(() => {
    let cancelled = false
    setRapierReady(false)

    initRapierOnce().then(() => {
      if (cancelled) return
      const previous = simRef.current
      simRef.current = null
      disposeSimulation(previous)

      const next = createSimulation(spec, simQuality, piece)
      simRef.current = next
      shapeBoundsRef.current = getWorldPatternBounds(piece)
      updateClothTopologyFromPattern(simGeometry, spec, piece)
      writeBodiesToGeometry(next, simGeometry)
      writeVisualFromSim(next, spec, visualGeometry)
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
  }, [piece.id, simGeometry, simKey, simQuality, spec])

  useEffect(() => () => simGeometry.dispose(), [simGeometry])
  useEffect(() => () => visualGeometry.dispose(), [visualGeometry])

  useEffect(() => {
    const nextBounds = getWorldPatternBounds(piece)
    const previousBounds = shapeBoundsRef.current ?? nextBounds
    updateClothTopologyFromPattern(simGeometry, spec, piece)
    warpSimulationToPattern(simRef.current, previousBounds, nextBounds)
    shapeBoundsRef.current = nextBounds
    if (simRef.current && !simRef.current.disposed) {
      writeBodiesToGeometry(simRef.current, simGeometry)
      writeVisualFromSim(simRef.current, spec, visualGeometry)
    }
  }, [patternRevision, piece, simGeometry, spec, visualGeometry])

  function worldToLocalPoint(point: THREE.Vector3) {
    const group = groupRef.current
    return group ? group.worldToLocal(point.clone()) : point.clone()
  }

  function localToWorldPoint(point: THREE.Vector3) {
    const group = groupRef.current
    return group ? group.localToWorld(point.clone()) : point.clone()
  }

  function getDragParticles(localPoint: THREE.Vector3): DragParticle[] {
    const sim = simRef.current
    if (!sim || sim.disposed) return []

    let nearestIndex = -1
    let nearestDistanceSq = Infinity
    const radius = clamp(Math.max(spec.spacingX, spec.spacingZ) * 4.8, 0.16, 0.42)
    const radiusSq = radius * radius
    const particles: Array<DragParticle & { distanceSq: number }> = []

    for (let i = 0; i < sim.bodies.length; i += 1) {
      const body = sim.bodies[i]
      if (!body) continue
      const bodyPoint = vectorFromBody(body)
      const dSq = bodyPoint.distanceToSquared(localPoint)
      if (dSq < nearestDistanceSq) {
        nearestDistanceSq = dSq
        nearestIndex = i
      }
      if (dSq <= radiusSq) {
        const normalized = Math.sqrt(dSq) / radius
        particles.push({
          index: i,
          offset: bodyPoint.sub(localPoint),
          weight: clamp(1 - normalized * 0.75, 0.25, 1),
          distanceSq: dSq,
        })
      }
    }

    if (!particles.length && nearestIndex >= 0) {
      const nearestBody = sim.bodies[nearestIndex]
      if (nearestBody) {
        particles.push({
          index: nearestIndex,
          offset: vectorFromBody(nearestBody).sub(localPoint),
          weight: 1,
          distanceSq: nearestDistanceSq,
        })
      }
    }

    return particles
      .sort((a, b) => a.distanceSq - b.distanceSq)
      .slice(0, 96)
      .map(({ distanceSq: _distanceSq, ...particle }) => particle)
  }

  function intersectDragPlane(event: ThreeEvent<PointerEvent>, plane: THREE.Plane) {
    const worldPoint = event.ray.intersectPlane(plane, new THREE.Vector3())
    return worldPoint ? worldToLocalPoint(worldPoint) : null
  }

  function applyDragPull(drag: ClothDragState) {
    const sim = simRef.current
    if (!sim || sim.disposed) return

    for (const particle of drag.particles) {
      const body = sim.bodies[particle.index]
      if (!body) continue

      const current = vectorFromBody(body)
      const target = drag.point.clone().add(particle.offset)
      const linvel = body.linvel()
      const desiredVelocity = target.sub(current).multiplyScalar(18).add(drag.velocity.clone().multiplyScalar(0.95))
      const velocityDelta = desiredVelocity.sub(new THREE.Vector3(linvel.x, linvel.y, linvel.z))
      const maxDelta = 14
      if (velocityDelta.lengthSq() > maxDelta * maxDelta) velocityDelta.normalize().multiplyScalar(maxDelta)

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
    if (flick.lengthSq() > maxFlick * maxFlick) flick.normalize().multiplyScalar(maxFlick)

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
    selectPattern(piece.id)

    if (!simRunning) return

    const localPoint = worldToLocalPoint(event.point)
    const particles = getDragParticles(localPoint)
    if (!particles.length) return

    const normal = new THREE.Vector3()
    camera.getWorldDirection(normal)
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, localToWorldPoint(localPoint))

    dragRef.current = {
      particles,
      plane,
      point: localPoint,
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

  function bakePlacementIntoSimulation() {
    const sim = simRef.current
    if (!sim || sim.disposed) return

    // Build the transform from the AUTHORITATIVE placement, not the group
    // ref — drei's TransformControls juggling can desync the ref matrix.
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(currentPlacement.position.x, currentPlacement.position.y, currentPlacement.position.z),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(currentPlacement.rotation.x, currentPlacement.rotation.y, currentPlacement.rotation.z),
      ),
      new THREE.Vector3(1, 1, 1),
    )

    const p = new THREE.Vector3()
    for (const body of sim.bodies) {
      if (!body) continue
      const current = body.translation()
      p.set(current.x, current.y, current.z).applyMatrix4(matrix)
      body.setTranslation({ x: p.x, y: p.y, z: p.z }, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    }

    // Zero the group's transform imperatively AND in the store so we don't
    // get a frame where the visual mesh (now in world coords via sim) is
    // also offset by the React-driven group transform.
    const group = groupRef.current
    if (group) {
      group.position.set(0, 0, 0)
      group.rotation.set(0, 0, 0)
      group.updateMatrixWorld(true)
    }
    setPatternPlacement(piece.id, {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    })
  }

  useFrame((_, delta) => {
    const sim = simRef.current
    if (!sim || sim.disposed || !rapierReady) return

    try {
      if (simRunning && !previousSimRunningRef.current) {
        bakePlacementIntoSimulation()
      }
      previousSimRunningRef.current = simRunning

      if (dragRef.current) applyDragPull(dragRef.current)

      if (simRunning || dragRef.current) {
        sim.accumulator += Math.min(delta, 1 / 20)
        let steps = 0
        while (sim.accumulator >= FIXED_STEP && steps < MAX_SUBSTEPS) {
          sim.world.step()
          sim.accumulator -= FIXED_STEP
          steps += 1
        }
      }

      writeBodiesToGeometry(sim, simGeometry)
      writeVisualFromSim(sim, spec, visualGeometry)
    } catch (error) {
      console.error('Rapier cloth simulation failed; disposing invalid world.', error)
      simRef.current = null
      disposeSimulation(sim)
      setRapierReady(false)
      clothingStore.simRunning = false
    }
  })

  function updatePlacementFromGroup() {
    const group = groupRef.current
    if (!group) return
    setPatternPlacement(piece.id, {
      position: { x: group.position.x, y: group.position.y, z: group.position.z },
      rotation: { x: group.rotation.x, y: group.rotation.y, z: group.rotation.z },
    })
  }

  // High-res visual mesh decoupled from physics resolution (marvelous-style):
  // the sim is a coarse rapier grid; the rendered mesh is the earcut'd
  // pattern outline subdivided, with each vertex re-sampled from the sim
  // grid every frame via bilinear interpolation. This gives a smooth hole
  // silhouette without forcing the physics to a giant grid.
  const group = (
    <group
      ref={groupRef}
      position={[currentPlacement.position.x, currentPlacement.position.y, currentPlacement.position.z]}
      rotation={[currentPlacement.rotation.x, currentPlacement.rotation.y, currentPlacement.rotation.z]}
    >
      <mesh
        geometry={visualGeometry}
        frustumCulled={false}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
      >
        <meshStandardMaterial
          color={selected ? '#75a4ff' : '#5f8cff'}
          roughness={0.82}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>
      {(showWireframe || showTriangulation) && (
        <mesh geometry={visualGeometry} frustumCulled={false}>
          <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.24} depthWrite={false} />
        </mesh>
      )}
    </group>
  )

  if (selected && !simRunning) {
    return (
      <TransformControls
        mode={transformMode}
        size={0.72}
        onMouseDown={() => setIsTransforming(true)}
        onMouseUp={() => {
          updatePlacementFromGroup()
          setIsTransforming(false)
        }}
        onObjectChange={updatePlacementFromGroup}
      >
        {group}
      </TransformControls>
    )
  }

  return group
}

export default function RapierClothDemo() {
  const { garment, placements, previewOptions, simRunning, simResetKey, simQuality, transformMode } = useSnapshot(clothingStore)
  const pieces = Object.values(garment.patterns) as PatternPiece[]

  return (
    <group>
      {pieces.map((piece, index) => (
        <ClothPiece
          key={piece.id}
          piece={piece}
          index={index}
          count={pieces.length}
          selected={piece.id === garment.selectedPatternId}
          placement={placements[piece.id] as PatternPlacement | undefined}
          simRunning={simRunning}
          simResetKey={simResetKey}
          simQuality={simQuality}
          transformMode={transformMode}
          showWireframe={previewOptions.showWireframe}
          showTriangulation={previewOptions.showTriangulation}
        />
      ))}
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
