import { Suspense, useEffect } from 'react'
import { Canvas, extend, useThree, type ThreeToJSXElements } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three/webgpu'
import { Activity, Smile, Box, Layers, Scissors } from 'lucide-react'
import { useSnapshot } from 'valtio'
import { Group, Panel, Separator } from 'react-resizable-panels'

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
import { appState, toggleShowExpressions, toggleShowHair, toggleShowModeling, toggleShowSkinning, toggleShowTest } from './appState'

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

export default function App() {
  const { fov, isTransforming, showExpressions, showHair, showModeling, showSkinning, showTest } = useSnapshot(appState)

  const anyPanelActive = showExpressions || showHair || showModeling || showSkinning || showTest

  const panels = [
    { key: 'test', label: 'Test', Icon: Activity, active: showTest, toggle: toggleShowTest },
    { key: 'expressions', label: 'Expressions', Icon: Smile, active: showExpressions, toggle: toggleShowExpressions },
    { key: 'modeling', label: 'Modeling', Icon: Box, active: showModeling, toggle: toggleShowModeling },
    { key: 'skinning', label: 'Skinning', Icon: Layers, active: showSkinning, toggle: toggleShowSkinning },
    { key: 'hair', label: 'Hair', Icon: Scissors, active: showHair, toggle: toggleShowHair },
  ]

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#080810', display: 'flex', flexDirection: 'column' }}>
      {/* Top navbar */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 2,
        padding: '6px 8px',
        background: 'rgba(8, 8, 16, 0.72)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderTop: 'none',
        borderRadius: '0 0 10px 10px',
        zIndex: 30,
      }}>
        {panels.map(({ key, label, Icon, active, toggle }) => (
          <button
            key={key}
            onClick={toggle}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              padding: '5px 14px',
              background: active ? 'rgba(255,255,255,0.09)' : 'transparent',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              color: active ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.32)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <Icon size={15} strokeWidth={1.6} />
            <span style={{
              fontSize: 8,
              fontFamily: "'Courier New', monospace",
              letterSpacing: '0.1em',
              fontWeight: 700,
            }}>
              {label.toUpperCase()}
            </span>
          </button>
        ))}
      </nav>

      {/* Main content — canvas + sidebar */}
      <Group orientation="horizontal" style={{ flex: 1 }}>
        {/* Canvas panel */}
        <Panel defaultSize="70%" minSize="30%" style={{ position: 'relative' }}>
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
            style={{ width: '100%', height: '100%' }}
          >
            <FovUpdater />
            <color attach="background" args={['#565656']} />

            {/* Key light – front-left, warm, main illumination */}
            <spotLight position={[-0.6, 0.8, 9.0]} target-position={[0, 0, 0]} intensity={16.0} color="#fff5e8" angle={0.45} penumbra={0.4} distance={12} decay={1} castShadow />
            {/* Fill light – front-right, cool, soft — opposite side from key, still in front */}
            <spotLight position={[0.8, 0.2, 0.9]} target-position={[0, 0, 0]} intensity={2.0} color="#ccd8ff" angle={0.5} penumbra={0.6} distance={5} decay={2} />
            {/* Rim lights – directional from behind, parallel rays only hit back-facing normals (silhouette), never the nose */}
            <directionalLight position={[-0.3, 0.2, -1]} intensity={1.5} color="#ffd9b0" />
            <directionalLight position={[ 0.3, 0.2, -1]} intensity={1.5} color="#ffd9b0" />

            <Suspense fallback={null}>
              <HumanModel />
            </Suspense>

            <OrbitControls
              enabled={!isTransforming}
              mouseButtons={{ LEFT: 1, MIDDLE: 0, RIGHT: 2 }}
              minDistance={0.2}
              maxDistance={25}
              minPolarAngle={Math.PI * 0.2}
              maxPolarAngle={Math.PI * 0.9}
              target={[0, 0, 0]}
            />
          </Canvas>
          {showHair && <BrushToolbar />}
        </Panel>

        {/* Resize handle */}
        <Separator
          style={{
            width: 4,
            background: 'rgba(255,255,255,0.07)',
            cursor: 'col-resize',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{
            width: 1,
            height: 32,
            borderRadius: 1,
            background: 'rgba(255,255,255,0.18)',
          }} />
        </Separator>

        {/* Sidebar panel */}
        <Panel
          defaultSize="30%"
          minSize="15%"
          maxSize="55%"
          style={{ overflow: 'hidden' }}
        >
          <div style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(10, 10, 16, 0.97)',
            borderLeft: '1px solid rgba(255,255,255,0.07)',
            overflow: 'hidden',
          }}>
            {showExpressions && <ControlPanel />}
            {showTest && <TestPanel />}
            {showModeling && <CharacterModelingPanel />}
            {showSkinning && <SkinningPanel />}
            {showHair && <GroomPanel />}
            {!anyPanelActive && (
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                opacity: 0.2,
                userSelect: 'none',
              }}>
                <span style={{ fontSize: 18 }}>◧</span>
                <span style={{ fontSize: 9, fontFamily: "'Courier New', monospace", letterSpacing: '0.12em', fontWeight: 700 }}>
                  SELECT A PANEL
                </span>
              </div>
            )}
          </div>
        </Panel>
      </Group>
    </div>
  )
}
