import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment } from '@react-three/drei'
import HumanModel, { type BoneDebug } from './HumanModel'
import ControlPanel from './ControlPanel'

export default function App() {
  const [emotion, setEmotion] = useState('neutral')
  const [intensity, setIntensity] = useState(1)
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
            emotion={emotion}
            intensity={intensity}
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
          enablePan={false}
          minDistance={0.2}
          maxDistance={5}
          minPolarAngle={Math.PI * 0.2}
          maxPolarAngle={Math.PI * 0.8}
          target={[0, 0, 0]}
        />
      </Canvas>

      <ControlPanel
        emotion={emotion}
        intensity={intensity}
        wireframe={wireframe}
        showBones={showBones}
        eyeLook={eyeLook}
        focusLock={focusLock}
        boneDebug={boneDebug}
        fov={fov}
        onEmotion={setEmotion}
        onIntensity={setIntensity}
        onWireframe={setWireframe}
        onShowBones={setShowBones}
        onEyeLook={setEyeLook}
        onFocusLock={setFocusLock}
        onFov={setFov}
      />
    </div>
  )
}
