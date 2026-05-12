import { Suspense, useEffect, useState } from 'react'
import { Canvas, extend, useThree, type ThreeToJSXElements } from '@react-three/fiber'
import { OrbitControls, Environment } from '@react-three/drei'
import * as THREE from 'three/webgpu'
import { Smile, Box, Layers } from 'lucide-react'

declare module '@react-three/fiber' {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as unknown as Parameters<typeof extend>[0])
import HumanModel, { type BoneDebug } from './HumanModel'
import CharacterModelingPanel from './CharacterModelingPanel'
import ControlPanel from './ControlPanel'
import SkinningPanel from './SkinningPanel'
import { createNeutralModelingValues, type ModelingMode } from './characterModeling'
import { createNeutralEyeLook, createNeutralFacsValues } from './facs'
import { type SkinTextures } from './skinMaterial'

function FovUpdater({ fov }: { fov: number }) {
  const { camera, invalidate } = useThree()
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
  const [facsValues, setFacsValues] = useState(createNeutralFacsValues)
  const [modelingValues, setModelingValues] = useState(createNeutralModelingValues)
  const [modelingMode, setModelingMode] = useState<ModelingMode>('transform')
  const [modelingSymmetric, setModelingSymmetric] = useState(true)
  const [selectedModelingHandleId, setSelectedModelingHandleId] = useState<string | null>(null)
  const [eyeLook2D, setEyeLook2D] = useState(createNeutralEyeLook)
  const [wireframe, setWireframe] = useState(false)
  const [showBones, setShowBones] = useState(false)
  const [eyeLook, setEyeLook] = useState(false)
  const [focusLock, setFocusLock] = useState(false)
  const [isTransforming, setIsTransforming] = useState(false)
  const [boneDebug, setBoneDebug] = useState<BoneDebug | null>(null)
  const [fov, setFov] = useState(45)
  const [skinTextures, setSkinTextures] = useState<SkinTextures>({})

  const [showExpressions, setShowExpressions] = useState(false)
  const [showModeling, setShowModeling] = useState(false)
  const [showSkinning, setShowSkinning] = useState(false)

  const panels = [
    { key: 'expressions', label: 'Expressions', Icon: Smile,  active: showExpressions, toggle: () => setShowExpressions((v) => !v) },
    { key: 'modeling',    label: 'Modeling',    Icon: Box,    active: showModeling,    toggle: () => setShowModeling((v) => !v) },
    { key: 'skinning',    label: 'Skinning',    Icon: Layers, active: showSkinning,    toggle: () => setShowSkinning((v) => !v) },
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
        camera={{ position: [0, 0, 1.2], fov: 45 }}
        gl={async (props) => {
          const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false, ...props } as never)
          await renderer.init()
          return renderer as never
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <FovUpdater fov={fov} />
        <color attach="background" args={['#080810']} />
        <fog attach="fog" args={['#080810', 2, 6]} />

        <ambientLight intensity={0.4} />
        <directionalLight position={[1, 2, 2]} intensity={1.2} castShadow />
        <directionalLight position={[-1, 0, -1]} intensity={0.3} color="#8888ff" />

        <Suspense fallback={null}>
          <Environment files={`${import.meta.env.BASE_URL}potsdamer_platz_1k.hdr`} />
          <HumanModel
            facsValues={facsValues}
            modelingValues={modelingValues}
            modelingMode={modelingMode}
            modelingSymmetric={modelingSymmetric}
            selectedModelingHandleId={selectedModelingHandleId}
            eyeLook2D={eyeLook2D}
            wireframe={wireframe}
            showBones={showBones}
            eyeLook={eyeLook}
            focusLock={focusLock}
            skinTextures={skinTextures}
            showModelingOverlay={showModeling}
            onModelingValues={setModelingValues}
            onSelectedModelingHandleId={setSelectedModelingHandleId}
            onBoneDebug={setBoneDebug}
            onTransformingChange={setIsTransforming}
          />
        </Suspense>

        <OrbitControls
          enabled={!isTransforming}
          mouseButtons={{ LEFT: 0, MIDDLE: 2, RIGHT: 1 }}
          minDistance={0.2}
          maxDistance={5}
          minPolarAngle={Math.PI * 0.2}
          maxPolarAngle={Math.PI * 0.8}
          target={[0, 0, 0]}
        />
      </Canvas>

      {showExpressions && (
        <ControlPanel
          facsValues={facsValues}
          eyeLook2D={eyeLook2D}
          wireframe={wireframe}
          showBones={showBones}
          eyeLook={eyeLook}
          focusLock={focusLock}
          boneDebug={boneDebug}
          fov={fov}
          onFacsValues={setFacsValues}
          onEyeLook2D={setEyeLook2D}
          onWireframe={setWireframe}
          onShowBones={setShowBones}
          onEyeLook={setEyeLook}
          onFocusLock={setFocusLock}
          onFov={setFov}
        />
      )}
      {showModeling && (
        <CharacterModelingPanel
          values={modelingValues}
          mode={modelingMode}
          symmetric={modelingSymmetric}
          selectedHandleId={selectedModelingHandleId}
          onValues={setModelingValues}
          onMode={setModelingMode}
          onSymmetric={setModelingSymmetric}
          onSelectedHandleId={setSelectedModelingHandleId}
        />
      )}
      {showSkinning && (
        <SkinningPanel
          textures={skinTextures}
          onTextures={setSkinTextures}
        />
      )}
    </div>
  )
}
