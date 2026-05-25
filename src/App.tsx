import { Suspense, useEffect, useState } from 'react'
import { Canvas, extend, useThree, type ThreeToJSXElements } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three/webgpu'
import { Activity, Smile, Box, Layers, Scissors, Shirt, Orbit, FileArchive } from 'lucide-react'
import { useSnapshot } from 'valtio'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { cn } from './lib/utils'

declare module '@react-three/fiber' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Module augmentation extends Three Fiber's intrinsic JSX map.
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as unknown as Parameters<typeof extend>[0])
import HumanModel from './HumanModel'
import CharacterModelingPanel from './CharacterModelingPanel'
import ControlPanel from './ControlPanel'
import SkinningPanel from './SkinningPanel'
import TestPanel from './TestPanel'
import GroomPanel, { BrushToolbar } from './features/groom/components/GroomPanel'
import GarmentPreviewMesh from './features/clothing/three/GarmentPreviewMesh'
import ClothingPatternEditor2D from './features/clothing/components/ClothingPatternEditor2D'
import ClothingToolbar from './features/clothing/components/ClothingToolbar'
import { ClothingInspector } from './features/clothing/index'
import ExportPanel from './features/export/ExportPanel'
import { setCurrentExportScene } from './features/export/exportSession'
import { clothingStore } from './features/clothing/state/clothingStore'
import { loadDemoGarment, requestCollisionAvatarBuild } from './features/clothing/state/clothingActions'
import { createDemoGarment } from './features/clothing/demo/createDemoGarment'
import { appState, setCharacterRenderMode, toggleShowExpressions, toggleShowHair, toggleShowModeling, toggleShowSkinning, toggleShowTest, toggleShowClothing, toggleShowExport, type CharacterRenderMode } from './appState'

function FovUpdater() {
  const { camera, invalidate } = useThree()
  const { fov } = useSnapshot(appState)

  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      // eslint-disable-next-line react-hooks/immutability -- Three.js cameras are mutable scene objects.
      camera.fov = fov
      camera.updateProjectionMatrix()
      invalidate()
    }
  }, [fov, camera, invalidate])
  return null
}

function CanvasResizeUpdater({ watch }: { watch: boolean }) {
  const { camera, gl, invalidate } = useThree()

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const canvas = gl.domElement
      const parent = canvas.parentElement
      if (!parent) return

      const rect = parent.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return

      gl.setSize(rect.width, rect.height, false)
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = rect.width / rect.height
        camera.updateProjectionMatrix()
      }
      invalidate()
    })

    return () => cancelAnimationFrame(frame)
  }, [camera, gl, invalidate, watch])

  return null
}

function ExportSceneRegistration() {
  const { scene } = useThree()

  useEffect(() => {
    setCurrentExportScene(scene)
    return () => setCurrentExportScene(null)
  }, [scene])

  return null
}

let demoGarmentBootstrapped = false

/** Loads the demo garment once when clothing mode is first activated. */
function ClothingBootstrapper() {
  useEffect(() => {
    if (demoGarmentBootstrapped) return
    demoGarmentBootstrapped = true
    if (Object.keys(clothingStore.garment.patterns).length > 0) return
    loadDemoGarment(createDemoGarment())
  }, [])
  return null
}

const CHARACTER_RENDER_MODES: Array<{ id: CharacterRenderMode; label: string }> = [
  { id: 'solid', label: 'Character Solid' },
  { id: 'full', label: 'Character Full' },
]

function CharacterRenderModeTabs() {
  const { characterRenderMode } = useSnapshot(appState)

  return (
    <div className="absolute left-3 bottom-3 z-12 flex gap-0.5 p-0.5 bg-[rgba(8,8,16,0.72)] border border-white/10 rounded-[7px] backdrop-blur-md">
      {CHARACTER_RENDER_MODES.map((mode) => {
        const active = characterRenderMode === mode.id
        return (
          <button
            key={mode.id}
            onClick={() => setCharacterRenderMode(mode.id)}
            className={cn(
              'px-2.25 py-1.25 border-0 rounded-[5px] font-mono text-[9px] font-bold tracking-[0.08em] cursor-pointer',
              active ? 'bg-white/[0.14] text-white/92' : 'bg-transparent text-white/42',
            )}
          >
            {mode.label.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}

function ClothingOrbitToggle() {
  const { previewOptions } = useSnapshot(clothingStore)

  return (
    <button
      type="button"
      onClick={() => { clothingStore.previewOptions.orbitControlsEnabled = !clothingStore.previewOptions.orbitControlsEnabled }}
      title={previewOptions.orbitControlsEnabled ? 'Disable orbit controls' : 'Enable orbit controls'}
      aria-label={previewOptions.orbitControlsEnabled ? 'Disable orbit controls' : 'Enable orbit controls'}
      className={cn(
        'absolute right-3 bottom-3 z-12 flex items-center justify-center w-8.5 h-8.5',
        'border border-white/12 rounded-[8px] backdrop-blur-md cursor-pointer',
        previewOptions.orbitControlsEnabled
          ? 'bg-[rgba(68,136,255,0.24)] text-[#9fc1ff]'
          : 'bg-[rgba(8,8,16,0.78)] text-white/55',
      )}
    >
      <Orbit size={16} strokeWidth={1.9} />
    </button>
  )
}

export default function App() {
  const { fov, isTransforming, showExpressions, showHair, showModeling, showSkinning, showTest, showClothing, showExport, modelingValues } = useSnapshot(appState)
  const { previewOptions } = useSnapshot(clothingStore)
  const [isMobile, setIsMobile] = useState(false)
  const [clothingRuntimeEnabled, setClothingRuntimeEnabled] = useState(false)

  const anyPanelActive = showExpressions || showHair || showModeling || showSkinning || showTest || showClothing || showExport

  const panels = [
    { key: 'test', label: 'Test', Icon: Activity, active: showTest, toggle: toggleShowTest },
    { key: 'expressions', label: 'Expressions', Icon: Smile, active: showExpressions, toggle: toggleShowExpressions },
    { key: 'modeling', label: 'Modeling', Icon: Box, active: showModeling, toggle: toggleShowModeling },
    { key: 'skinning', label: 'Skinning', Icon: Layers, active: showSkinning, toggle: toggleShowSkinning },
    { key: 'hair', label: 'Hair', Icon: Scissors, active: showHair, toggle: toggleShowHair },
    { key: 'clothing', label: 'Clothing', Icon: Shirt, active: showClothing, toggle: toggleShowClothing },
    { key: 'export', label: 'Export', Icon: FileArchive, active: showExport, toggle: toggleShowExport },
  ]

  useEffect(() => {
    if (!showClothing) return
    setClothingRuntimeEnabled(true)
    const frame = requestAnimationFrame(() => requestCollisionAvatarBuild())
    return () => cancelAnimationFrame(frame)
  }, [showClothing, modelingValues])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)')
    const update = () => setIsMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return (
    <div className="dark w-screen h-screen bg-[#080810] flex flex-col">
      <nav
        className={cn(
          'fixed flex gap-0.5 bg-[rgba(8,8,16,0.84)] backdrop-blur-[14px] z-30',
          isMobile
            ? 'bottom-0 left-0 right-0 justify-around px-2.5 pt-1.75 border-y border-white/8 rounded-none'
            : 'top-0 left-0 justify-start px-2 py-1.5 border-b border-r border-white/8 rounded-br-[10px]',
        )}
        style={isMobile ? { paddingBottom: 'calc(7px + env(safe-area-inset-bottom, 0px))' } : undefined}
      >
        {panels.map(({ key, label, Icon, active, toggle }) => (
          <button
            key={key}
            onClick={toggle}
            className={cn(
              'flex flex-col items-center gap-0.75 border-0 rounded-[6px] cursor-pointer transition-[background,color] duration-150',
              isMobile ? 'px-1.5 py-1 flex-1' : 'px-3.5 py-1.25',
              active ? 'bg-white/9 text-white/88' : 'bg-transparent text-white/32',
            )}
          >
            <Icon size={15} strokeWidth={1.6} />
            <span className="text-[8px] font-mono tracking-widest font-bold">
              {label.toUpperCase()}
            </span>
          </button>
        ))}
      </nav>

      {isMobile ? (
        <div className="flex-1 flex flex-col pb-18.5 min-h-0">
          <div className="relative flex-[0_0_42vh] min-h-60">
            <Canvas
              camera={{ position: [0, 0, 2.0], fov }}
              gl={async (props) => {
                const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false, ...props } as never)
                await renderer.init()
                renderer.outputColorSpace = THREE.SRGBColorSpace
                renderer.toneMapping = THREE.ACESFilmicToneMapping
                renderer.toneMappingExposure = 1.05
                return renderer as never
              }}
              className="w-full h-full"
            >
              <ExportSceneRegistration />
              <FovUpdater />
              <CanvasResizeUpdater watch={showClothing} />
              <color attach="background" args={['#565656']} />
              <spotLight position={[-0.6, 0.8, 9.0]} target-position={[0, 0, 0]} intensity={16.0} color="#fff5e8" angle={0.45} penumbra={0.4} distance={12} decay={1} castShadow />
              <spotLight position={[0.8, 0.2, 0.9]} target-position={[0, 0, 0]} intensity={2.0} color="#ccd8ff" angle={0.5} penumbra={0.6} distance={5} decay={2} />
              <directionalLight position={[-0.3, 0.2, -1]} intensity={1.5} color="#ffd9b0" />
              <directionalLight position={[0.3, 0.2, -1]} intensity={1.5} color="#ffd9b0" />
              <Suspense fallback={null}>
                <HumanModel />
              </Suspense>
              {clothingRuntimeEnabled && (
                <Suspense fallback={null}>
                  <GarmentPreviewMesh controlsEnabled={showClothing} />
                </Suspense>
              )}
              <OrbitControls
                enabled={!isTransforming && (!showClothing || previewOptions.orbitControlsEnabled)}
                mouseButtons={{ MIDDLE: 0, RIGHT: 2 }}
                minDistance={0.2}
                maxDistance={25}
                minPolarAngle={Math.PI * 0.2}
                maxPolarAngle={Math.PI * 0.9}
                target={[0, 0, 0]}
              />
            </Canvas>
            {clothingRuntimeEnabled && <ClothingBootstrapper />}
            <CharacterRenderModeTabs />
            {showClothing && <ClothingOrbitToggle />}
            {showHair && <BrushToolbar />}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto bg-[rgba(10,10,16,0.97)] border-t border-white/[0.07]">
            {showClothing && (
              <>
                <div className="sticky top-0 z-21">
                  <ClothingToolbar />
                </div>
                <div className="h-75 border-b border-white/8">
                  <ClothingPatternEditor2D hideToolbar />
                </div>
              </>
            )}
            {showExpressions && <ControlPanel />}
            {showTest && <TestPanel />}
            {showModeling && <CharacterModelingPanel />}
            {showSkinning && <SkinningPanel />}
            {showHair && <GroomPanel />}
            {showClothing && <ClothingInspector />}
            {showExport && <ExportPanel />}
            {!anyPanelActive && (
              <div className="min-h-full flex flex-col items-center justify-center gap-2 opacity-20 select-none">
                <span className="text-[18px]">◧</span>
                <span className="text-[9px] font-mono tracking-[0.12em] font-bold">SELECT A PANEL</span>
              </div>
            )}
          </div>
        </div>
      ) : (
      <Group orientation="horizontal" className="flex-1">
        {/* Canvas panel — always the same R3F canvas; clothing 2D editor sits alongside it */}
        <Panel defaultSize="70%" minSize="30%" className="relative flex">
          {/* 3D viewport — always rendered */}
          <div className="flex-1 relative min-w-0">
            <Canvas
              camera={{ position: [0, 0, 2.0], fov }}
              gl={async (props) => {
                const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false, ...props } as never)
                await renderer.init()
                renderer.outputColorSpace = THREE.SRGBColorSpace
                renderer.toneMapping = THREE.ACESFilmicToneMapping
                renderer.toneMappingExposure = 1.05
                return renderer as never
              }}
              className="w-full h-full"
            >
              <ExportSceneRegistration />
              <FovUpdater />
              <CanvasResizeUpdater watch={showClothing} />
              <color attach="background" args={['#565656']} />

              {/* Key light – front-left, warm, main illumination */}
              <spotLight position={[-0.6, 0.8, 9.0]} target-position={[0, 0, 0]} intensity={16.0} color="#fff5e8" angle={0.45} penumbra={0.4} distance={12} decay={1} castShadow />
              {/* Fill light – front-right, cool, soft — opposite side from key, still in front */}
              <spotLight position={[0.8, 0.2, 0.9]} target-position={[0, 0, 0]} intensity={2.0} color="#ccd8ff" angle={0.5} penumbra={0.6} distance={5} decay={2} />
              {/* Rim lights – directional from behind */}
              <directionalLight position={[-0.3, 0.2, -1]} intensity={1.5} color="#ffd9b0" />
              <directionalLight position={[ 0.3, 0.2, -1]} intensity={1.5} color="#ffd9b0" />

              <Suspense fallback={null}>
                <HumanModel />
              </Suspense>

              {/* Garment panels — added to this canvas, not a separate one */}
              {clothingRuntimeEnabled && (
                <Suspense fallback={null}>
                  <GarmentPreviewMesh controlsEnabled={showClothing} />
                </Suspense>
              )}

              <OrbitControls
                enabled={!isTransforming && (!showClothing || previewOptions.orbitControlsEnabled)}
                mouseButtons={{ MIDDLE: 0, RIGHT: 2 }}
                minDistance={0.2}
                maxDistance={25}
                minPolarAngle={Math.PI * 0.2}
                maxPolarAngle={Math.PI * 0.9}
                target={[0, 0, 0]}
              />
            </Canvas>
            {clothingRuntimeEnabled && <ClothingBootstrapper />}
            <CharacterRenderModeTabs />
            {showClothing && <ClothingOrbitToggle />}
            {showHair && <BrushToolbar />}
          </div>

          {/* 2D pattern editor — injected to the right of the 3D canvas when clothing is active */}
          {showClothing && (
            <div className="w-[42%] min-w-95 max-w-175 shrink-0 border-l border-white/8 flex flex-col overflow-hidden">
              <ClothingPatternEditor2D />
            </div>
          )}
        </Panel>

        {/* Resize handle */}
        <Separator className="w-1 bg-white/[0.07] cursor-col-resize shrink-0 flex items-center justify-center">
          <div className="w-px h-8 rounded-[1px] bg-white/18" />
        </Separator>

        {/* Sidebar panel */}
        <Panel
          defaultSize="15%"
          minSize="15%"
          maxSize="55%"
          className="overflow-hidden"
        >
          <div className="h-full flex flex-col bg-[rgba(10,10,16,0.97)] border-l border-white/[0.07] overflow-hidden">
            {showExpressions && <ControlPanel />}
            {showTest && <TestPanel />}
            {showModeling && <CharacterModelingPanel />}
            {showSkinning && <SkinningPanel />}
            {showHair && <GroomPanel />}
            {showClothing && <ClothingInspector />}
            {showExport && <ExportPanel />}
            {!anyPanelActive && (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 opacity-20 select-none">
                <span className="text-[18px]">◧</span>
                <span className="text-[9px] font-mono tracking-[0.12em] font-bold">SELECT A PANEL</span>
              </div>
            )}
          </div>
        </Panel>
      </Group>
      )}
    </div>
  )
}
