import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { CompileQuality } from '../clothing/compiler/types'
import { prepareCharacter, applyRestPose, applyDressingPose, type PreparedCharacter } from '../clothing/runtime/characterRig'
import { CharacterBody } from '../clothing/runtime/characterBody'
import { CharacterAnimator } from '../clothing/runtime/characterAnimator'
import { bakeClip } from '../clothing/runtime/animationRetarget'
import { measureBody, type BodyMeasurements } from '../clothing/runtime/bodyMeasurements'
import { buildBodyDepthMaps } from '../clothing/runtime/garmentArrangement'
import { buildOutfitDocument, type OutfitItem } from '../clothing/runtime/garmentLibrary'
import { ClothSimulation, FIXED_DT, type ClothStats } from '../clothing/runtime/clothSimulation'
import { LAB_CLIPS, SOURCE_RIG_URL, clipUrl, type LabCharacterEntry } from './labCatalog'

// Owns the cloth test scene. Every fixed step runs, in this order:
//   1. animation   (mixer + root motion, fixed dt × intensity)
//   2. skeleton    (container.updateMatrixWorld)
//   3. body skin   (CharacterBody.update → collider pose for this step)
//   4. cloth       (ClothSimulation.step against that pose)
// and once per rendered frame the garment render geometry is refreshed.

export type LabPhase = 'idle' | 'loading' | 'dressing' | 'animating' | 'error'

export type LabSnapshot = {
  phase: LabPhase
  message: string
  characterName: string
  rigSummary: string
  clips: Array<{ id: string; name: string; native: boolean }>
  stats: ClothStats & { fps: number; bodyMs: number; frameMs: number; colliderVertices: number }
  measurements: { height: number; chest: number; waist: number; hips: number } | null
}

const MAX_STEPS_PER_FRAME = 3

export class ClothLabController {
  readonly root = new THREE.Group()
  readonly cloth: ClothSimulation
  paused = false
  outfit: OutfitItem[] = [{ kind: 'tshirt' }]
  clipId = 'walk'
  private character: PreparedCharacter | null = null
  private body: CharacterBody | null = null
  private animator: CharacterAnimator | null = null
  private measurements: BodyMeasurements | null = null
  private sourceRig: Promise<PreparedCharacter | null> | null = null
  private clipJson = new Map<string, Promise<THREE.AnimationClip | null>>()
  private nativeClipIds: string[] = []
  private phase: LabPhase = 'idle'
  private message = ''
  private characterName = ''
  private rigSummary = ''
  private accumulator = 0
  private fps = 60
  private frameMs = 0
  private bodyMs = 0
  private listeners = new Set<() => void>()
  private colliderDebug: THREE.Mesh | null = null
  private showCollider = false
  private loadToken = 0

  constructor(quality: CompileQuality = 'medium') {
    this.cloth = new ClothSimulation({ quality, groundY: 0 })
    this.root.add(this.cloth.group)
  }

  // ---- observation ---------------------------------------------------------

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  snapshot(): LabSnapshot {
    const m = this.measurements
    return {
      phase: this.phase,
      message: this.message,
      characterName: this.characterName,
      rigSummary: this.rigSummary,
      clips: [
        ...LAB_CLIPS.filter((clip) => this.animator?.clips.has(clip.id)).map((clip) => ({ id: clip.id, name: clip.name, native: false })),
        ...this.nativeClipIds.map((id) => ({ id, name: `${id.replace(/^native:/, '')} (own clip)`, native: true })),
      ],
      stats: { ...this.cloth.stats, fps: this.fps, bodyMs: this.bodyMs, frameMs: this.frameMs, colliderVertices: this.body?.vertexCount ?? 0 },
      measurements: m ? { height: m.height, chest: m.chest.circumference, waist: m.waist.circumference, hips: m.hips.circumference } : null,
    }
  }

  get characterContainer() {
    return this.character?.container ?? null
  }

  /** World position of a body landmark for camera focus. */
  landmark(name: 'hips' | 'chest' | 'shoulder' | 'armpit' | 'elbow' | 'waist' | 'knee' | 'head') {
    const rig = this.character?.rig
    if (!rig) return null
    const p = new THREE.Vector3()
    switch (name) {
      case 'hips': return rig.hips.getWorldPosition(p)
      case 'chest': return rig.chest.getWorldPosition(p)
      case 'head': return (rig.head ?? rig.chest).getWorldPosition(p)
      case 'shoulder': return (rig.arms.L.upper ?? rig.chest).getWorldPosition(p)
      case 'armpit': return (rig.arms.L.upper ?? rig.chest).getWorldPosition(p).lerp(rig.chest.getWorldPosition(new THREE.Vector3()), 0.35).add(new THREE.Vector3(0, -0.08, 0))
      case 'elbow': return (rig.arms.L.lower ?? rig.chest).getWorldPosition(p)
      case 'waist': return rig.hips.getWorldPosition(p).add(new THREE.Vector3(0, 0.12, 0))
      case 'knee': return (rig.legs.L.lower ?? rig.hips).getWorldPosition(p)
    }
  }

  // ---- loading -------------------------------------------------------------

  async loadCharacter(entry: LabCharacterEntry | File) {
    const token = ++this.loadToken
    this.setPhase('loading', `Loading ${entry instanceof File ? entry.name : entry.name}…`)
    try {
      const { object, animations } = await loadModel(entry)
      if (token !== this.loadToken) return
      const prepared = prepareCharacter(object)
      if (!prepared.rig) throw new Error('No humanoid skeleton found (needs a hips bone with two legs and a spine with two arms).')
      this.disposeCharacter()
      this.character = prepared
      this.characterName = entry instanceof File ? entry.name : entry.name
      this.root.add(prepared.container)
      enableShadows(prepared.model)

      this.body = new CharacterBody(prepared)
      this.animator = new CharacterAnimator(prepared)
      this.rigSummary = `${prepared.rig.bones.length} bones · ${this.body.vertexCount} skin verts / ${this.body.triangleCount} tris · height ${prepared.height.toFixed(2)} m`
      this.measurements = measureBody(this.body.vertices, this.body.vertexPart, prepared)
      this.rebuildColliderDebug()

      // Clip library (Mixamo clips authored on Y Bot) retargeted onto this rig,
      // plus the character's own clips baked in place.
      this.setPhase('loading', 'Retargeting animations…')
      const source = await this.loadSourceRig()
      if (token !== this.loadToken) return
      const clips = await Promise.all(LAB_CLIPS.map((clip) => this.loadClip(clip.id)))
      if (token !== this.loadToken) return
      LAB_CLIPS.forEach((entryClip, index) => {
        const clip = clips[index]
        if (!clip || !source) return
        const baked = bakeClip(clip, source, prepared, entryClip.name)
        if (baked) this.animator!.addClip(entryClip.id, baked)
      })
      this.nativeClipIds = []
      for (const clip of animations) {
        if (!clip.tracks.length || clip.duration < 0.2) continue
        const id = `native:${clip.name || 'clip'}`
        const baked = bakeClip(clip, prepared, prepared, clip.name)
        if (!baked) continue
        this.animator.addClip(id, baked)
        this.nativeClipIds.push(id)
      }
      applyRestPose(prepared.restPose)
      if (!this.animator.clips.has(this.clipId)) this.clipId = this.animator.clips.keys().next().value ?? this.clipId
      this.redress()
    } catch (error) {
      console.error('[cloth-lab] load failed', error)
      this.setPhase('error', error instanceof Error ? error.message : String(error))
    }
  }

  private loadSourceRig() {
    this.sourceRig ??= loadModel(SOURCE_RIG_URL)
      .then(({ object }) => prepareCharacter(object))
      .catch((error) => {
        console.error('[cloth-lab] source rig failed', error)
        return null
      })
    return this.sourceRig
  }

  private loadClip(id: string) {
    let promise = this.clipJson.get(id)
    if (!promise) {
      promise = fetch(clipUrl(id))
        .then((response) => (response.ok ? response.json() : null))
        .then((json) => (json ? THREE.AnimationClip.parse(json) : null))
        .catch(() => null)
      this.clipJson.set(id, promise)
    }
    return promise
  }

  // ---- controls ------------------------------------------------------------

  /** Return to the bind pose, re-dress, and hold paused on the freshly arranged garment. */
  reset() {
    this.redress()
    this.setPaused(true)
  }

  /** Re-dress and run: sew in bind pose, then play the selected clip from its first frame. */
  restart() {
    this.redress()
    this.setPaused(false)
  }

  private redress() {
    const character = this.character
    const body = this.body
    const animator = this.animator
    if (!character || !body || !animator || !character.rig) return
    animator.reset()
    applyDressingPose(character)
    body.update(true)
    this.cloth.notifyBodyTeleported()
    this.measurements = measureBody(body.vertices, body.vertexPart, character)
    const maps = buildBodyDepthMaps(body.vertices, body.collider.indices, this.measurements.chest.centerZ)
    const document = buildOutfitDocument(this.outfit, this.measurements)
    const issues = this.cloth.dress(document, body, maps)
    for (const issue of issues) if (issue.severity === 'error') console.warn('[cloth-lab]', issue.message)
    this.accumulator = 0
    this.setPhase('dressing', 'Sewing garment in bind pose…')
  }

  setOutfit(items: OutfitItem[]) {
    this.outfit = items
    this.redress()
  }

  /** Switch animation while the simulation keeps running (cross-fade, no reset). */
  setClip(id: string) {
    this.clipId = id
    if (this.phase === 'animating') this.animator?.play(id)
    this.emit()
  }

  setPaused(paused: boolean) {
    this.paused = paused
    this.emit()
  }

  setIntensity(timeScale: number) {
    if (this.animator) this.animator.timeScale = timeScale
  }

  setTravel(travel: boolean) {
    if (this.animator) this.animator.travel = travel
  }

  setQuality(quality: CompileQuality) {
    this.cloth.setQuality(quality)
  }

  setCharacterVisible(visible: boolean) {
    if (this.character) this.character.model.visible = visible
  }

  setClothWireframe(wireframe: boolean) {
    this.cloth.setWireframe(wireframe)
  }

  setColliderVisible(visible: boolean) {
    this.showCollider = visible
    if (this.colliderDebug) this.colliderDebug.visible = visible
  }

  /** Step exactly one fixed step (while paused). */
  stepOnce() {
    this.fixedStep()
    this.cloth.updateRender()
    this.emit()
  }

  // ---- frame loop ----------------------------------------------------------

  tick(delta: number) {
    const frameStart = performance.now()
    this.fps = this.fps * 0.95 + (delta > 0 ? 1 / delta : 60) * 0.05
    if (!this.paused && this.body && this.cloth.hasGarment) {
      this.accumulator += Math.min(delta, 0.1)
      let steps = 0
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        this.fixedStep()
        this.accumulator -= FIXED_DT
        steps += 1
      }
      // Never spiral: drop time we could not simulate (the sim slows down instead).
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0
      this.cloth.updateRender()
    }
    if (this.colliderDebug && this.showCollider && this.body) {
      ;(this.colliderDebug.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    }
    this.frameMs = this.frameMs * 0.9 + (performance.now() - frameStart) * 0.1
  }

  private fixedStep() {
    const body = this.body
    const animator = this.animator
    if (!body || !animator) return
    if (this.phase === 'dressing') {
      if (this.cloth.dressed) {
        // Slow pose transition out of the bind pose so the drape can follow the
        // arms down instead of being yanked.
        animator.play(this.clipId, 1.6)
        this.setPhase('animating', '')
      }
    }
    if (this.phase === 'animating') animator.step(FIXED_DT)
    const bodyStart = performance.now()
    body.update()
    this.bodyMs = this.bodyMs * 0.9 + (performance.now() - bodyStart) * 0.1
    this.cloth.step()
  }

  dispose() {
    this.disposeCharacter()
    this.cloth.dispose()
    this.listeners.clear()
  }

  private disposeCharacter() {
    this.animator?.dispose()
    if (this.character) this.root.remove(this.character.container)
    if (this.colliderDebug) {
      this.root.remove(this.colliderDebug)
      this.colliderDebug.geometry.dispose()
      this.colliderDebug = null
    }
    this.cloth.clear()
    this.character = null
    this.body = null
    this.animator = null
    this.measurements = null
  }

  private rebuildColliderDebug() {
    if (!this.body) return
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.body.vertices, 3))
    geometry.setIndex(new THREE.BufferAttribute(this.body.collider.indices, 1))
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#46e0a0', wireframe: true, transparent: true, opacity: 0.35 }))
    mesh.frustumCulled = false
    mesh.visible = this.showCollider
    mesh.name = 'collider-debug'
    this.colliderDebug = mesh
    this.root.add(mesh)
  }

  private setPhase(phase: LabPhase, message: string) {
    this.phase = phase
    this.message = message
    this.emit()
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}

async function loadModel(source: LabCharacterEntry | File | string): Promise<{ object: THREE.Object3D; animations: THREE.AnimationClip[] }> {
  const url = typeof source === 'string' ? source : source instanceof File ? URL.createObjectURL(source) : source.url
  const name = typeof source === 'string' ? source : source instanceof File ? source.name : source.url
  try {
    if (/\.fbx(\?|$)/i.test(name)) {
      const object = await new FBXLoader().loadAsync(url)
      return { object, animations: object.animations ?? [] }
    }
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const gltf = await loader.loadAsync(url)
    return { object: gltf.scene, animations: gltf.animations ?? [] }
  } finally {
    if (source instanceof File) URL.revokeObjectURL(url)
  }
}

function enableShadows(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
  })
}
