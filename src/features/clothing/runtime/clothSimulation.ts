import * as THREE from 'three/webgpu'
import type { PatternDocument } from '../document/types'
import { compileGarmentRuntime } from '../compiler/compileGarmentRuntime'
import type { CompileQuality } from '../compiler/types'
import { XPBDClothSolver } from '../simulation/solver'
import type { GarmentRuntime, SkinAttachment, SolverParams } from '../simulation/types'
import { refreshSeamPlacementRest } from '../simulation/placement'
import { createRenderPanelEntry, updateRenderPanels, type RenderPanelEntry } from '../rendering/renderPanels'
import type { CharacterBody } from './characterBody'
import { arrangeGarmentOnBody, type BodyDepthMaps } from './garmentArrangement'
import type { PanelMetadata } from './garmentLibrary'
import { FABRICS, type FabricId } from './fabrics'

// Runtime cloth simulation for an animated character. Independent of React and
// of any particular character or garment: give it a CharacterBody and a
// PatternDocument, then call step() once per fixed step *after* the body has
// been updated for that step (animation → skeleton → body.update() → step()).

export const FIXED_DT = 1 / 60

// Substeps matter more than iterations here: limbs must not travel further than
// the cloth can respond to within one substep, or they tunnel through sleeves
// (measured: a walking Y Bot sheds a T-shirt at 4 substeps, keeps it at 6).
export const RUNTIME_QUALITY: Record<CompileQuality, { substeps: number; iterations: number; label: string }> = {
  low: { substeps: 5, iterations: 2, label: 'Low (fast)' },
  medium: { substeps: 6, iterations: 3, label: 'Medium' },
  high: { substeps: 8, iterations: 3, label: 'High' },
  ultra: { substeps: 10, iterations: 4, label: 'Ultra (slow)' },
}

/** Skin offset added to the thickest fabric for the collision rest distance. */
const SKIN_OFFSET = 0.004
const ANCHOR_COMPLIANCE = 4e-6
const SEWING_TIME = 0.9

export type ClothStats = {
  particles: number
  triangles: number
  constraints: number
  bodyTriangles: number
  stepMs: number
  bodyMs: number
  contacts: number
  penetrations: number
  maxPenetrationMm: number
  recovered: number
  /** Fraction of rendered garment vertices found inside the skin (sampled). */
  renderPenetration: number
  /** 99th-percentile stretch of structural edges vs rest (ratio - 1). */
  maxStretch: number
  attachments: number
  elapsed: number
  dressed: boolean
}

export class ClothSimulation {
  readonly group = new THREE.Group()
  readonly stats: ClothStats = emptyStats()
  quality: CompileQuality
  private body: CharacterBody | null = null
  private document: PatternDocument | null = null
  private runtime: GarmentRuntime | null = null
  private solver: XPBDClothSolver | null = null
  private renderPanels: RenderPanelEntry[] = []
  /** Signed render offset per panel: the fabric's visible outer face, outward from the body. */
  private renderOffsets: number[] = []
  private meshes: THREE.Mesh[] = []
  private materials = new Map<string, THREE.MeshStandardMaterial>()
  private anchorsBound = false
  private groundY = 0
  private renderCheckCounter = 0

  constructor(options: { quality?: CompileQuality; groundY?: number } = {}) {
    this.quality = options.quality ?? 'medium'
    this.groundY = options.groundY ?? 0
    this.group.name = 'cloth-simulation'
  }

  get hasGarment() {
    return this.solver !== null
  }

  get garmentDocument() {
    return this.document
  }

  /** Per-phase cost of the most recent step (ms). */
  get solverProfile() {
    return this.solver?.profile ?? { constraints: 0, selfCollision: 0, bodyCollision: 0, other: 0 }
  }

  /** Mean particle position, or null without a garment. */
  centroid() {
    const mesh = this.runtime?.simMesh
    if (!mesh || mesh.particleCount === 0) return null
    const p = mesh.positions
    const out = new THREE.Vector3()
    for (let i = 0; i < mesh.particleCount; i += 1) {
      out.x += p[i * 3]
      out.y += p[i * 3 + 1]
      out.z += p[i * 3 + 2]
    }
    return out.divideScalar(mesh.particleCount)
  }

  /**
   * Fraction of particles within `distance` of the skin: a pose-independent
   * "is the garment still being worn" measure (contacts drop to zero mid-jump
   * while the garment is still on; centroid offsets move with crouches).
   */
  nearSkinFraction(distance = 0.06) {
    const mesh = this.runtime?.simMesh
    const body = this.body
    if (!mesh || !body || mesh.particleCount === 0) return 0
    const contact = new Float32Array(14)
    let near = 0
    for (let i = 0; i < mesh.particleCount; i += 1) {
      if (body.collider.closest(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2], distance, contact)) near += 1
    }
    return near / mesh.particleCount
  }

  /** Sewing and gravity ramp are complete and waistbands are bound. */
  get dressed() {
    return this.anchorsBound
  }

  get assemblyDuration() {
    return SEWING_TIME + 0.75
  }

  /**
   * Compile `document`, wrap it around the body (which must be in its bind pose
   * at the origin) and start the sewing phase.
   */
  dress(document: PatternDocument, body: CharacterBody, maps: BodyDepthMaps) {
    this.clear()
    this.body = body
    this.document = document
    const compiled = compileGarmentRuntime(document, { quality: this.quality, seamSamples: 24 })
    const runtime = compiled.value
    this.runtime = runtime
    arrangeGarmentOnBody(runtime.simMesh, document, maps)
    refreshSeamPlacementRest(runtime.simMesh)

    const thickest = Math.max(...Object.values(document.panels).map((panel) => FABRICS[panel.fabricId as FabricId]?.thickness ?? 0.004))
    body.collider.thickness = SKIN_OFFSET + thickest
    const preset = RUNTIME_QUALITY[this.quality]
    const params: SolverParams = {
      gravity: -9.81,
      damping: averageDamping(document),
      substeps: preset.substeps,
      iterations: preset.iterations,
      dt: FIXED_DT,
      groundY: this.groundY,
      maxVelocity: 14,
      selfCollisionRadius: 0.012,
      selfCollisionStiffness: 0.45,
      sewingTime: SEWING_TIME,
      gravityDelayTime: SEWING_TIME * 0.7,
      gravityRampTime: 0.3,
      selfCollisionSurfaceContacts: new Set(Object.values(document.panels).map((panel) => (panel.metadata as PanelMetadata | undefined)?.garment)).size > 1,
    }
    this.solver = new XPBDClothSolver(runtime.simMesh, params)
    this.solver.contactCache.skinVertexContacts = this.skinFeatureContacts
    this.anchorsBound = false

    this.renderPanels = runtime.renderPanels.map((panel) => createRenderPanelEntry(panel))
    for (const entry of this.renderPanels) {
      const panel = document.panels[entry.panelId]
      const mesh = new THREE.Mesh(entry.geometry, this.materialFor(panel?.color ?? '#999999', panel?.fabricId))
      mesh.name = `garment:${entry.panelId}`
      mesh.frustumCulled = false
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.meshes.push(mesh)
      this.group.add(mesh)
    }
    updateRenderPanels(this.renderPanels, runtime.simMesh.positions)
    this.renderOffsets = this.renderPanels.map((entry) => {
      const panel = document.panels[entry.panelId]
      const halfThickness = FABRICS[panel?.fabricId as FabricId]?.thickness ?? 0.003
      return outwardSign(entry, body) * halfThickness
    })
    this.applyRenderOffsets()

    this.stats.particles = runtime.simMesh.particleCount
    this.stats.triangles = runtime.simMesh.triangles.length / 3
    this.stats.constraints = runtime.simMesh.stretchConstraints.length + runtime.simMesh.bendDistanceConstraints.length + runtime.simMesh.seamConstraints.length
    this.stats.bodyTriangles = body.triangleCount
    return compiled.issues
  }

  /** Advance one fixed step. The body must already hold this step's pose. */
  step() {
    const solver = this.solver
    const body = this.body
    if (!solver || !body) return
    const start = performance.now()
    solver.step({ version: 0, proxies: [], kinematicColliders: [body.collider] })
    if (!this.anchorsBound && solver.elapsed >= this.assemblyDuration) this.bindAnchors()
    this.stats.stepMs = this.stats.stepMs * 0.9 + (performance.now() - start) * 0.1
    this.stats.contacts = solver.bodyStats.contacts
    this.stats.penetrations = solver.bodyStats.penetrations
    this.stats.maxPenetrationMm = solver.bodyStats.maxPenetration * 1000
    this.stats.recovered = solver.bodyStats.recovered
    this.stats.elapsed = solver.elapsed
    this.stats.dressed = this.anchorsBound
  }

  /** Refresh render geometry from the latest particle positions. */
  updateRender() {
    if (!this.runtime) return
    updateRenderPanels(this.renderPanels, this.runtime.simMesh.positions)
    this.applyRenderOffsets()
    this.renderCheckCounter += 1
    if (this.renderCheckCounter % 20 === 0) {
      this.stats.renderPenetration = this.measureRenderPenetration()
      this.stats.maxStretch = this.measureMaxStretch()
    }
  }

  /** Teleporting the body (reset, character switch) must not fling the cloth. */
  notifyBodyTeleported() {
    this.solver?.clearContacts()
  }

  setQuality(quality: CompileQuality) {
    this.quality = quality
    const preset = RUNTIME_QUALITY[quality]
    this.solver?.setSolverIterations(preset.substeps, preset.iterations)
  }

  /** Experimental skin-vertex / cloth-face contacts (see KinematicContactCache.skinVertexContacts). */
  skinFeatureContacts = false

  setSkinFeatureContacts(enabled: boolean) {
    this.skinFeatureContacts = enabled
    if (this.solver) this.solver.contactCache.skinVertexContacts = enabled
  }

  setVisible(visible: boolean) {
    this.group.visible = visible
  }

  setWireframe(wireframe: boolean) {
    for (const material of this.materials.values()) material.wireframe = wireframe
  }

  clear() {
    for (const mesh of this.meshes) this.group.remove(mesh)
    for (const entry of this.renderPanels) entry.geometry.dispose()
    this.meshes = []
    this.renderPanels = []
    this.solver = null
    this.runtime = null
    this.document = null
    this.anchorsBound = false
    Object.assign(this.stats, emptyStats())
  }

  dispose() {
    this.clear()
    for (const material of this.materials.values()) material.dispose()
    this.materials.clear()
  }

  /**
   * Bind waistband particles to the skin once the garment has been sewn and has
   * settled. Each particle keeps its current offset from the nearest skin point,
   * so the garment is held where it settled rather than pulled tight.
   */
  private bindAnchors() {
    this.anchorsBound = true
    const runtime = this.runtime
    const body = this.body
    const document = this.document
    if (!runtime || !body || !document || !this.solver) return
    const mesh = runtime.simMesh
    const contact = new Float32Array(14)
    const attachments: SkinAttachment[] = []
    for (const panel of Object.values(document.panels)) {
      const meta = panel.metadata as PanelMetadata | undefined
      if (!meta?.anchorEdges.length) continue
      const segments = meta.anchorEdges
        .map((edgeId) => panel.edges.find((edge) => edge.id === edgeId))
        .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge))
        .map((edge) => [panel.points[edge.from], panel.points[edge.to]] as const)
      const tolerance = 4
      for (let particle = 0; particle < mesh.particleCount; particle += 1) {
        if (mesh.panelIds[particle] !== panel.id) continue
        const px = mesh.panelLocalPositions[particle * 2]
        const py = mesh.panelLocalPositions[particle * 2 + 1]
        if (!segments.some(([a, b]) => distanceToSegment(px, py, a.x, a.y, b.x, b.y) < tolerance)) continue
        const o = particle * 3
        if (!body.collider.closest(mesh.positions[o], mesh.positions[o + 1], mesh.positions[o + 2], 0.12, contact)) continue
        attachments.push({
          particle,
          triangle: contact[10],
          u: contact[11],
          v: contact[12],
          w: contact[13],
          offset: Math.max(contact[6], body.collider.thickness),
          compliance: ANCHOR_COMPLIANCE,
        })
      }
    }
    this.solver.setSkinAttachments(attachments)
    this.stats.attachments = attachments.length
  }

  /**
   * The simulation tracks the cloth mid-surface; what you see is its outer
   * face, half a fabric thickness further out. Rendering the mid-surface made
   * thick fabrics look sunk into the body.
   */
  private applyRenderOffsets() {
    this.renderPanels.forEach((entry, index) => {
      const offset = this.renderOffsets[index] ?? 0
      if (offset === 0) return
      const positions = entry.positionArray
      const normals = entry.normalArray
      for (let i = 0; i < entry.vertexCount * 3; i += 1) positions[i] += normals[i] * offset
    })
  }

  private measureRenderPenetration() {
    const body = this.body
    if (!body) return 0
    const contact = new Float32Array(14)
    let inside = 0
    let total = 0
    for (const entry of this.renderPanels) {
      const positions = entry.positionArray
      for (let v = 0; v < entry.vertexCount; v += 3) {
        const o = v * 3
        total += 1
        if (!body.collider.closest(positions[o], positions[o + 1], positions[o + 2], 0.03, contact)) continue
        if (contact[6] < -0.003) inside += 1
      }
    }
    return total ? inside / total : 0
  }

  /**
   * 99th-percentile structural edge stretch. The single worst edge is always a
   * millimetre-long sliver at a sharp pattern corner (crotch, underarm) and says
   * nothing about how the garment looks.
   */
  private measureMaxStretch() {
    const mesh = this.runtime?.simMesh
    if (!mesh || mesh.stretchConstraints.length === 0) return 0
    const p = mesh.positions
    const ratios = new Float32Array(mesh.stretchConstraints.length)
    mesh.stretchConstraints.forEach((c, i) => {
      const length = Math.hypot(p[c.b * 3] - p[c.a * 3], p[c.b * 3 + 1] - p[c.a * 3 + 1], p[c.b * 3 + 2] - p[c.a * 3 + 2])
      ratios[i] = c.rest > 1e-6 ? length / c.rest - 1 : 0
    })
    ratios.sort()
    return Math.max(0, ratios[Math.floor((ratios.length - 1) * 0.99)])
  }

  private materialFor(color: string, fabricId: string | undefined) {
    const key = `${color}:${fabricId ?? ''}`
    let material = this.materials.get(key)
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color,
        roughness: fabricId === 'silk' ? 0.4 : fabricId === 'leather' ? 0.55 : 0.9,
        metalness: 0,
        side: THREE.DoubleSide,
      })
      this.materials.set(key, material)
    }
    return material
  }
}

function emptyStats(): ClothStats {
  return {
    particles: 0,
    triangles: 0,
    constraints: 0,
    bodyTriangles: 0,
    stepMs: 0,
    bodyMs: 0,
    contacts: 0,
    penetrations: 0,
    maxPenetrationMm: 0,
    recovered: 0,
    renderPenetration: 0,
    maxStretch: 0,
    attachments: 0,
    elapsed: 0,
    dressed: false,
  }
}

/** +1 if the panel's computed normals point away from the body's vertical axis, else -1. */
function outwardSign(entry: RenderPanelEntry, body: CharacterBody) {
  const skin = body.vertices
  let cx = 0
  let cz = 0
  for (let i = 0; i < skin.length; i += 3) {
    cx += skin[i]
    cz += skin[i + 2]
  }
  cx /= skin.length / 3
  cz /= skin.length / 3
  const p = entry.positionArray
  const n = entry.normalArray
  let dot = 0
  for (let i = 0; i < entry.vertexCount; i += 1) {
    dot += n[i * 3] * (p[i * 3] - cx) + n[i * 3 + 2] * (p[i * 3 + 2] - cz)
  }
  return dot >= 0 ? 1 : -1
}

function averageDamping(document: PatternDocument) {
  const values = Object.values(document.panels).map((panel) => panel.damping).filter((value): value is number => Number.isFinite(value))
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0.05
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const abx = bx - ax
  const aby = by - ay
  const lengthSq = abx * abx + aby * aby
  const t = lengthSq < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq))
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t))
}
