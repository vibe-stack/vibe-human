import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment } from '@react-three/drei'
import HumanModel, { type BoneDebug } from './HumanModel'
import ControlPanel from './ControlPanel'
import { createNeutralEyeLook, createNeutralFacsValues } from './facs'

export default function App() {
  const [facsValues, setFacsValues] = useState(createNeutralFacsValues)
  const [eyeLook2D, setEyeLook2D] = useState(createNeutralEyeLook)
  const [wireframe, setWireframe] = useState(false)
  const [showBones, setShowBones] = useState(false)
  const [eyeLook, setEyeLook] = useState(false)
  const [focusLock, setFocusLock] = useState(false)
  const [isTransforming, setIsTransforming] = useState(false)
  const [boneDebug, setBoneDebug] = useState<BoneDebug | null>(null)
  const [fov, setFov] = useState(45)

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#080810' }}>
      <Canvas
        camera={{ position: [0, 0, 1.2], fov }}
        gl={{ antialias: true, alpha: false }}
        style={{ width: '100%', height: '100%' }}
      >
        <color attach="background" args={['#080810']} />
        <fog attach="fog" args={['#080810', 2, 6]} />

        <ambientLight intensity={0.4} />
        <directionalLight position={[1, 2, 2]} intensity={1.2} castShadow />
        <directionalLight position={[-1, 0, -1]} intensity={0.3} color="#8888ff" />

        <Suspense fallback={null}>
          <Environment files={`${import.meta.env.BASE_URL}potsdamer_platz_1k.hdr`} />
          <HumanModel
            facsValues={facsValues}
            eyeLook2D={eyeLook2D}
            wireframe={wireframe}
            showBones={showBones}
            eyeLook={eyeLook}
            focusLock={focusLock}
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
    </div>
  )
}
