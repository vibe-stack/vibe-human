import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three/webgpu'
import { ArrowLeft, Pause, Play, RotateCcw, SkipForward, StepForward, Upload } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { CompileQuality } from '../clothing/compiler/types'
import { RUNTIME_QUALITY } from '../clothing/runtime/clothSimulation'
import { FABRICS, FABRIC_IDS, type FabricId } from '../clothing/runtime/fabrics'
import { GARMENTS, GARMENT_KINDS, type GarmentKind } from '../clothing/runtime/garmentLibrary'
import { ClothLabController, type LabSnapshot } from './labController'
import { LAB_CHARACTERS, LAB_CLIPS, LAB_OUTFITS } from './labCatalog'
import { runStabilityMatrix, type MatrixRow } from './labQa'

type OrbitControlsHandle = { target: THREE.Vector3; update(): void }

type FocusName = 'body' | 'shoulder' | 'armpit' | 'elbow' | 'waist' | 'knee'

declare global {
  interface Window {
    /** Automation handle for E2E QA of the cloth lab. */
    __clothLab?: ClothLabController
    __clothLabQa?: { runStabilityMatrix: typeof runStabilityMatrix }
  }
}

export default function ClothLab({ onExit }: { onExit: () => void }) {
  const controller = useMemo(() => new ClothLabController('medium'), [])
  const [characterId, setCharacterId] = useState(LAB_CHARACTERS[0].id)
  const [outfit, setOutfit] = useState<Array<{ kind: GarmentKind; fabric: FabricId }>>([{ kind: 'tshirt', fabric: 'jersey' }])
  const [intensity, setIntensity] = useState(1)
  const [travel, setTravel] = useState(true)
  const [quality, setQuality] = useState<CompileQuality>('medium')
  const [showBody, setShowBody] = useState(true)
  const [showCollider, setShowCollider] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [skinFeatures, setSkinFeatures] = useState(false)
  const [focus, setFocus] = useState<{ name: FocusName; nonce: number }>({ name: 'body', nonce: 0 })
  const [matrixRows, setMatrixRows] = useState<MatrixRow[]>([])
  const [matrixRunning, setMatrixRunning] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const snapshot = useLabSnapshot(controller)

  useEffect(() => {
    window.__clothLab = controller
    window.__clothLabQa = { runStabilityMatrix }
    return () => {
      if (window.__clothLab === controller) delete window.__clothLab
      controller.dispose()
    }
  }, [controller])

  useEffect(() => {
    const entry = LAB_CHARACTERS.find((item) => item.id === characterId)
    if (entry) void controller.loadCharacter(entry)
  }, [characterId, controller])

  useEffect(() => { controller.setIntensity(intensity) }, [controller, intensity, snapshot.characterName])
  useEffect(() => { controller.setTravel(travel) }, [controller, travel, snapshot.characterName])
  useEffect(() => { controller.setQuality(quality) }, [controller, quality])
  useEffect(() => { controller.setCharacterVisible(showBody) }, [controller, showBody, snapshot.characterName])
  useEffect(() => { controller.setColliderVisible(showCollider) }, [controller, showCollider, snapshot.characterName])
  useEffect(() => { controller.setClothWireframe(wireframe) }, [controller, wireframe, snapshot.stats.particles])
  useEffect(() => { controller.cloth.setSkinFeatureContacts(skinFeatures) }, [controller, skinFeatures])

  const applyOutfit = (items: Array<{ kind: GarmentKind; fabric: FabricId }>) => {
    setOutfit(items)
    controller.setOutfit(items)
  }

  const toggleGarment = (kind: GarmentKind) => {
    const exists = outfit.some((item) => item.kind === kind)
    const region = GARMENTS[kind].region
    const next = exists
      ? outfit.filter((item) => item.kind !== kind)
      : [
          // One garment per body region (plus the jacket as an outer layer).
          ...outfit.filter((item) => kind === 'jacket' || item.kind === 'jacket' || (GARMENTS[item.kind].region !== region && GARMENTS[item.kind].region !== 'full' && region !== 'full')),
          { kind, fabric: GARMENTS[kind].defaultFabric },
        ]
    if (next.length === 0) return
    applyOutfit(next.sort((a, b) => GARMENTS[a.kind].layer - GARMENTS[b.kind].layer))
  }

  const setGarmentFabric = (kind: GarmentKind, fabric: FabricId) => {
    applyOutfit(outfit.map((item) => (item.kind === kind ? { ...item, fabric } : item)))
  }

  const runMatrix = async () => {
    setMatrixRunning(true)
    setMatrixRows([])
    const clip = controller.clipId
    try {
      await runStabilityMatrix(controller, {
        clips: LAB_CLIPS.map((entry) => entry.id).filter((id) => snapshot.clips.some((item) => item.id === id)),
        seconds: 6,
        onRow: (row) => setMatrixRows((rows) => [...rows, row]),
      })
    } finally {
      controller.setClip(clip)
      controller.restart()
      setMatrixRunning(false)
    }
  }

  const stats = snapshot.stats
  const busy = snapshot.phase === 'loading' || matrixRunning

  return (
    <div className="dark w-screen h-screen flex bg-[#0b0c10] text-white/85">
      <div className="relative flex-1 min-w-0">
        <Canvas
          shadows
          camera={{ position: [1.6, 1.5, 3.4], fov: 35, near: 0.05, far: 200 }}
          gl={async (props) => {
            const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false, ...props } as never)
            await renderer.init()
            renderer.outputColorSpace = THREE.SRGBColorSpace
            renderer.toneMapping = THREE.ACESFilmicToneMapping
            renderer.toneMappingExposure = 1.0
            return renderer as never
          }}
          className="w-full h-full"
        >
          <LabScene controller={controller} focus={focus} />
        </Canvas>

        <button
          type="button"
          onClick={onExit}
          className="absolute left-3 top-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/12 bg-black/60 backdrop-blur text-[11px] font-mono tracking-wider hover:bg-black/80"
        >
          <ArrowLeft size={13} /> STUDIO
        </button>

        <div className="absolute left-3 bottom-3 flex flex-wrap gap-1 max-w-[70%]">
          {(['body', 'shoulder', 'armpit', 'elbow', 'waist', 'knee'] as FocusName[]).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setFocus({ name, nonce: Date.now() })}
              className="px-2 py-1 rounded border border-white/12 bg-black/55 backdrop-blur text-[10px] font-mono uppercase tracking-wider hover:bg-white/10"
            >
              {name}
            </button>
          ))}
        </div>

        <div className="absolute right-3 top-3 px-2.5 py-1.5 rounded-md border border-white/10 bg-black/60 backdrop-blur font-mono text-[10px] leading-4 text-white/70 pointer-events-none">
          <div className={cn('font-bold tracking-wider', snapshot.phase === 'error' ? 'text-red-400' : snapshot.phase === 'animating' ? 'text-emerald-300' : 'text-amber-300')}>
            {snapshot.phase.toUpperCase()}{controller.paused && snapshot.phase !== 'loading' ? ' · PAUSED' : ''}
          </div>
          {snapshot.message && <div className="max-w-72">{snapshot.message}</div>}
          <div>{stats.fps.toFixed(0)} fps · frame {stats.frameMs.toFixed(1)} ms</div>
          <div>cloth {stats.stepMs.toFixed(2)} ms/step · skin {stats.bodyMs.toFixed(2)} ms</div>
        </div>
      </div>

      <aside className="w-[340px] shrink-0 h-full overflow-y-auto border-l border-white/8 bg-[#0e0f15] px-4 py-3 space-y-4 text-[12px]">
        <header>
          <h1 className="text-[13px] font-semibold tracking-wide">Cloth simulation lab</h1>
          <p className="text-white/45 text-[11px] mt-0.5">XPBD garments on animated, independently sourced characters.</p>
        </header>

        <Section title="Character">
          <select
            value={characterId}
            disabled={busy}
            onChange={(event) => setCharacterId(event.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5"
          >
            {LAB_CHARACTERS.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
          <p className="text-white/45 text-[11px]">{LAB_CHARACTERS.find((entry) => entry.id === characterId)?.note}</p>
          {snapshot.rigSummary && <p className="text-white/35 text-[10px] font-mono">{snapshot.rigSummary}</p>}
          <input
            ref={fileRef}
            type="file"
            accept=".glb,.gltf,.fbx"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void controller.loadCharacter(file)
              event.target.value = ''
            }}
          />
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={buttonClass()}>
            <Upload size={13} /> Import GLB / glTF / FBX character
          </button>
        </Section>

        <Section title="Animation">
          <select
            value={controller.clipId}
            onChange={(event) => controller.setClip(event.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5"
          >
            {snapshot.clips.map((clip) => <option key={clip.id} value={clip.id}>{clip.name}</option>)}
          </select>
          <label className="flex items-center justify-between gap-2">
            <span className="text-white/55">Movement intensity</span>
            <span className="font-mono">{intensity.toFixed(2)}×</span>
          </label>
          <input type="range" min={0.25} max={2.5} step={0.05} value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} className="w-full" />
          <label className="flex items-center gap-2 text-white/70">
            <input type="checkbox" checked={travel} onChange={(event) => setTravel(event.target.checked)} /> Root motion (character travels / turns)
          </label>
        </Section>

        <Section title="Garments">
          <div className="grid grid-cols-2 gap-1">
            {LAB_OUTFITS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyOutfit(preset.items.map((item) => ({ kind: item.kind, fabric: item.fabric ?? GARMENTS[item.kind].defaultFabric })))}
                className="px-2 py-1 rounded border border-white/10 bg-white/4 hover:bg-white/10 text-[11px] text-left"
              >
                {preset.name}
              </button>
            ))}
          </div>
          <div className="space-y-1 pt-1">
            {GARMENT_KINDS.map((kind) => {
              const item = outfit.find((entry) => entry.kind === kind)
              return (
                <div key={kind} className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 flex-1">
                    <input type="checkbox" checked={Boolean(item)} onChange={() => toggleGarment(kind)} />
                    {GARMENTS[kind].name}
                  </label>
                  <select
                    disabled={!item}
                    value={item?.fabric ?? GARMENTS[kind].defaultFabric}
                    onChange={(event) => setGarmentFabric(kind, event.target.value as FabricId)}
                    className="bg-white/5 border border-white/10 rounded px-1 py-0.5 text-[11px] disabled:opacity-40"
                  >
                    {FABRIC_IDS.map((id) => <option key={id} value={id}>{FABRICS[id].name}</option>)}
                  </select>
                </div>
              )
            })}
          </div>
        </Section>

        <Section title="Simulation">
          <div className="grid grid-cols-2 gap-1">
            <button type="button" className={buttonClass()} onClick={() => controller.setPaused(!controller.paused)}>
              {controller.paused ? <><Play size={13} /> Resume</> : <><Pause size={13} /> Pause</>}
            </button>
            <button type="button" className={buttonClass()} onClick={() => controller.stepOnce()} disabled={!controller.paused}>
              <StepForward size={13} /> Step
            </button>
            <button type="button" className={buttonClass()} onClick={() => controller.reset()}>
              <RotateCcw size={13} /> Reset
            </button>
            <button type="button" className={buttonClass()} onClick={() => controller.restart()}>
              <SkipForward size={13} /> Restart
            </button>
          </div>
          <label className="flex items-center justify-between gap-2">
            <span className="text-white/55">Quality</span>
            <select value={quality} onChange={(event) => setQuality(event.target.value as CompileQuality)} className="bg-white/5 border border-white/10 rounded px-1 py-0.5">
              {(Object.keys(RUNTIME_QUALITY) as CompileQuality[]).map((id) => <option key={id} value={id}>{RUNTIME_QUALITY[id].label}</option>)}
            </select>
          </label>
          <p className="text-white/35 text-[10px]">Quality sets substeps / iterations live; particle resolution applies on the next Reset.</p>
          <label className="flex items-center gap-2 text-white/70"><input type="checkbox" checked={showBody} onChange={(event) => setShowBody(event.target.checked)} /> Show character</label>
          <label className="flex items-center gap-2 text-white/70"><input type="checkbox" checked={showCollider} onChange={(event) => setShowCollider(event.target.checked)} /> Show collision skin</label>
          <label className="flex items-center gap-2 text-white/70"><input type="checkbox" checked={wireframe} onChange={(event) => setWireframe(event.target.checked)} /> Cloth wireframe</label>
          <label className="flex items-center gap-2 text-white/70" title="Skin vertices push cloth faces: less poke-through on bony skin, but can destabilise fast travelling motion.">
            <input type="checkbox" checked={skinFeatures} onChange={(event) => setSkinFeatures(event.target.checked)} /> Skin-feature contacts (experimental)
          </label>
        </Section>

        <Section title="Diagnostics">
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 font-mono text-[11px]">
            <Stat label="particles / tris" value={`${stats.particles} / ${stats.triangles}`} />
            <Stat label="skin tris" value={stats.bodyTriangles} />
            <Stat label="skin contacts" value={stats.contacts} />
            <Stat label="pre-solve penetrations" value={`${stats.penetrations} (max ${stats.maxPenetrationMm.toFixed(1)} mm)`} />
            <Stat label="deep recoveries" value={stats.recovered} />
            <Stat label="render verts inside skin" value={`${(stats.renderPenetration * 100).toFixed(2)} %`} warn={stats.renderPenetration > 0.01} />
            <Stat label="edge stretch (p99)" value={`${(stats.maxStretch * 100).toFixed(1)} %`} warn={stats.maxStretch > 0.25} />
            <Stat label="waistband bindings" value={stats.attachments} />
            <Stat label="sim time" value={`${stats.elapsed.toFixed(1)} s`} />
          </dl>
          {snapshot.measurements && (
            <p className="text-white/35 text-[10px] font-mono">
              chest {(snapshot.measurements.chest * 100).toFixed(0)} · waist {(snapshot.measurements.waist * 100).toFixed(0)} · hips {(snapshot.measurements.hips * 100).toFixed(0)} cm
            </p>
          )}
        </Section>
        <Section title="Stability matrix">
          <p className="text-white/40 text-[11px]">Steps every clip for 6 s on this character and outfit (deterministic, no rendering) and checks the garment stays on.</p>
          <button type="button" disabled={busy} onClick={() => void runMatrix()} className={buttonClass()}>
            {matrixRunning ? `Running… ${matrixRows.length}/${snapshot.clips.filter((clip) => !clip.native).length}` : 'Run all clips'}
          </button>
          {matrixRows.length > 0 && (
            <table className="w-full font-mono text-[10px]">
              <thead className="text-white/40">
                <tr><th className="text-left font-normal">clip</th><th className="font-normal">on</th><th className="font-normal">p99 str</th><th className="font-normal">pen%</th><th className="font-normal">ms</th></tr>
              </thead>
              <tbody>
                {matrixRows.map((row) => (
                  <tr key={`${row.outfit}-${row.clip}`} className={row.stayedOn ? 'text-white/75' : 'text-red-300'}>
                    <td>{row.clip}</td>
                    <td className="text-center">{row.stayedOn ? '✓' : '✗'}</td>
                    <td className="text-right">{row.maxStretch.toFixed(2)}</td>
                    <td className="text-right">{row.renderPenetration.toFixed(2)}</td>
                    <td className="text-right">{row.clothMs.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </aside>
    </div>
  )
}

function LabScene({ controller, focus }: { controller: ClothLabController; focus: { name: FocusName; nonce: number } }) {
  const { scene, camera } = useThree()
  const controlsRef = useRef<OrbitControlsHandle | null>(null)
  const lightRef = useRef<THREE.DirectionalLight>(null)
  const gridRef = useRef<THREE.GridHelper>(null)
  const lastFollow = useRef(new THREE.Vector3())

  useEffect(() => {
    scene.add(controller.root)
    return () => { scene.remove(controller.root) }
  }, [controller, scene])

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    const target = focus.name === 'body' ? controller.landmark('chest') : controller.landmark(focus.name)
    if (!target) return
    const container = controller.characterContainer
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(container?.quaternion ?? new THREE.Quaternion())
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(container?.quaternion ?? new THREE.Quaternion())
    const distance = focus.name === 'body' ? 3.4 : 1.05
    const offset = facing.multiplyScalar(distance).add(side.multiplyScalar(focus.name === 'body' ? 1.3 : 0.55)).add(new THREE.Vector3(0, focus.name === 'body' ? 0.25 : 0.1, 0))
    if (focus.name === 'body') target.y = 1.0
    controls.target.copy(target)
    camera.position.copy(target).add(offset)
    controls.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when a focus button is pressed.
  }, [focus.nonce])

  // Order: animation → skeleton → body skin → cloth (inside tick), then camera follow.
  useFrame((_, delta) => {
    controller.tick(delta)
    const container = controller.characterContainer
    const controls = controlsRef.current
    if (!container || !controls) return
    const position = container.position
    const moved = position.clone().sub(lastFollow.current)
    if (moved.lengthSq() > 0 && moved.lengthSq() < 4) {
      controls.target.add(moved)
      camera.position.add(moved)
    }
    lastFollow.current.copy(position)
    if (lightRef.current) {
      lightRef.current.position.set(position.x + 2.5, 5, position.z + 3)
      lightRef.current.target.position.copy(position)
      lightRef.current.target.updateMatrixWorld()
    }
    if (gridRef.current) gridRef.current.position.set(Math.round(position.x), 0.001, Math.round(position.z))
  }, -1)

  return (
    <>
      <color attach="background" args={['#1b1d24']} />
      <hemisphereLight args={['#dfe8ff', '#30302c', 1.1]} />
      <directionalLight
        ref={lightRef}
        intensity={2.2}
        position={[2.5, 5, 3]}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-2}
        shadow-camera-right={2}
        shadow-camera-top={2.5}
        shadow-camera-bottom={-1}
        shadow-bias={-0.0004}
      />
      <directionalLight intensity={0.6} position={[-3, 2, -2]} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#2a2c33" roughness={1} />
      </mesh>
      <gridHelper ref={gridRef} args={[30, 30, '#4a4f5c', '#383b44']} />
      <OrbitControls ref={controlsRef as never} makeDefault target={[0, 1, 0]} minDistance={0.3} maxDistance={20} />
    </>
  )
}

function useLabSnapshot(controller: ClothLabController) {
  const [version, setVersion] = useState(0)
  useEffect(() => controller.subscribe(() => setVersion((value) => value + 1)), [controller])
  useEffect(() => {
    const id = window.setInterval(() => setVersion((value) => value + 1), 250)
    return () => window.clearInterval(id)
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the invalidation signal.
  return useMemo<LabSnapshot>(() => controller.snapshot(), [controller, version])
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[10px] font-mono font-bold tracking-[0.14em] text-white/40 uppercase">{title}</h2>
      {children}
    </section>
  )
}

function Stat({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <>
      <dt className="text-white/45">{label}</dt>
      <dd className={cn('text-right', warn ? 'text-amber-300' : 'text-white/80')}>{value}</dd>
    </>
  )
}

function buttonClass() {
  return 'flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-white/12 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-[11px]'
}
