import { Suspense, useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import { Orbit } from 'lucide-react'
import { useSnapshot } from 'valtio'
import * as THREE from 'three/webgpu'
import GarmentPreviewMesh from '../three/GarmentPreviewMesh'
import { clothingStore } from '../state/clothingStore'
import { setOrbitController, setOrbitUserEnabled } from './orbitControlsState'

// ---------------------------------------------------------------------------
// ClothingThreeViewport
// Standalone R3F Canvas for the garment 3D preview.
// ---------------------------------------------------------------------------

export default function ClothingThreeViewport() {
  const orbitRef = useRef<{ enabled: boolean } | null>(null)
  const { previewOptions } = useSnapshot(clothingStore)

  useEffect(() => {
    setOrbitController(orbitRef.current)
    return () => setOrbitController(null)
  }, [])

  useEffect(() => {
    setOrbitUserEnabled(previewOptions.orbitControlsEnabled)
  }, [previewOptions.orbitControlsEnabled])

  return (
    <div style={{ width: '100%', height: '100%', background: '#0a0a14', position: 'relative' }}>
      <Canvas
        camera={{ position: [0, 0.4, 1.4], fov: 28 }}
        gl={async (props) => {
          const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false, ...props } as never)
          await renderer.init()
          renderer.outputColorSpace = THREE.SRGBColorSpace
          renderer.toneMapping = THREE.ACESFilmicToneMapping
          renderer.toneMappingExposure = 1.0
          return renderer as never
        }}
        style={{ width: '100%', height: '100%' }}
      >
        {/* Lighting */}
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 4, 3]} intensity={1.8} color="#fff8f0" castShadow />
        <directionalLight position={[-2, 1, -2]} intensity={0.5} color="#c0d8ff" />

        {/* Floor grid */}
        <Grid
          position={[0, -0.62, 0]}
          args={[10, 10]}
          cellSize={0.1}
          cellThickness={0.4}
          cellColor="#2a2a3a"
          sectionSize={0.5}
          sectionThickness={1}
          sectionColor="#3a3a55"
          fadeDistance={8}
          fadeStrength={1}
          infiniteGrid
        />

        {/* Garment panels */}
        <Suspense fallback={null}>
          <GarmentPreviewMesh />
        </Suspense>

        <OrbitControls
          ref={orbitRef}
          mouseButtons={{ LEFT: 1, MIDDLE: 0, RIGHT: 2 }}
          minDistance={0.3}
          maxDistance={12}
          target={[0, 0.1, 0]}
        />
      </Canvas>
      <button
        type="button"
        onClick={() => { clothingStore.previewOptions.orbitControlsEnabled = !previewOptions.orbitControlsEnabled }}
        title={previewOptions.orbitControlsEnabled ? 'Disable orbit controls' : 'Enable orbit controls'}
        aria-label={previewOptions.orbitControlsEnabled ? 'Disable orbit controls' : 'Enable orbit controls'}
        style={{
          position: 'absolute',
          right: 12,
          bottom: 12,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 34,
          height: 34,
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8,
          background: previewOptions.orbitControlsEnabled ? 'rgba(68,136,255,0.24)' : 'rgba(8,8,16,0.78)',
          color: previewOptions.orbitControlsEnabled ? '#9fc1ff' : 'rgba(255,255,255,0.55)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          cursor: 'pointer',
        }}
      >
        <Orbit size={16} strokeWidth={1.9} />
      </button>
    </div>
  )
}
