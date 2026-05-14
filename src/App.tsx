import { Suspense, useEffect } from 'react'
import { Canvas, extend, useThree, type ThreeToJSXElements } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three/webgpu'
import { Smile, Box, Layers, Scissors } from 'lucide-react'
import { useSnapshot } from 'valtio'

declare module '@react-three/fiber' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Module augmentation extends Three Fiber's intrinsic JSX map.
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as unknown as Parameters<typeof extend>[0])
import HumanModel from './HumanModel'
import CharacterModelingPanel from './CharacterModelingPanel'
import ControlPanel from './ControlPanel'
import SkinningPanel from './SkinningPanel'
import GroomPanel from './features/groom/components/GroomPanel'
import { appState, toggleShowExpressions, toggleShowHair, toggleShowModeling, toggleShowSkinning } from './appState'

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
  const { fov, isTransforming, showExpressions, showHair, showModeling, showSkinning } = useSnapshot(appState)

  const panels = [
    { key: 'expressions', label: 'Expressions', Icon: Smile, active: showExpressions, toggle: toggleShowExpressions },
    { key: 'modeling', label: 'Modeling', Icon: Box, active: showModeling, toggle: toggleShowModeling },
    { key: 'skinning', label: 'Skinning', Icon: Layers, active: showSkinning, toggle: toggleShowSkinning },
    { key: 'hair', label: 'Hair', Icon: Scissors, active: showHair, toggle: toggleShowHair },
  ]

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#080810' }}>
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
        <color attach="background" args={['#252525']} />
        <fog attach="fog" args={['#080810', 2, 6]} />

        {/* Key light – front-left, warm, main illumination */}
        <spotLight position={[-0.6, 0.8, 1.0]} target-position={[0, 0, 0]} intensity={6.0} color="#fff5e8" angle={0.45} penumbra={0.4} distance={5} decay={2} castShadow />
        {/* Fill light – front-right, cool, soft — opposite side from key, still in front */}
        <spotLight position={[0.8, 0.2, 0.9]} target-position={[0, 0, 0]} intensity={2.0} color="#ccd8ff" angle={0.5} penumbra={0.6} distance={5} decay={2} />
        {/* Rim lights – directional from behind, parallel rays only hit back-facing normals (silhouette), never the nose */}
        <directionalLight position={[-0.6, 0.2, -1]} intensity={3.5} color="#ffd9b0" />
        <directionalLight position={[ 0.6, 0.2, -1]} intensity={3.5} color="#ffd9b0" />

        <Suspense fallback={null}>
          {/* <Environment files={`${import.meta.env.BASE_URL}potsdamer_platz_1k.hdr`} /> */}
          <HumanModel />
        </Suspense>

        <OrbitControls
          enabled={!isTransforming}
          mouseButtons={{ LEFT: 1, MIDDLE: 0, RIGHT: 2 }}
          minDistance={0.2}
          maxDistance={5}
          minPolarAngle={Math.PI * 0.2}
          maxPolarAngle={Math.PI * 0.8}
          target={[0, 0, 0]}
        />
      </Canvas>

      {showExpressions && <ControlPanel />}
      {showModeling && <CharacterModelingPanel />}
      {showSkinning && <SkinningPanel />}
      {showHair && <GroomPanel />}
    </div>
  )
}
