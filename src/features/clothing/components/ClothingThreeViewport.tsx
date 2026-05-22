import { Suspense, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import * as THREE from 'three/webgpu'
import GarmentPreviewMesh from '../three/GarmentPreviewMesh'

// ---------------------------------------------------------------------------
// Shared orbit-controls lock: when > 0 orbit is disabled (garment is being
// dragged). Exported so ClothScene can increment/decrement.
// ---------------------------------------------------------------------------
let _orbitLockCount = 0
let _orbitRef: { current: unknown } | null = null
export function lockOrbit() {
  _orbitLockCount += 1
  updateOrbitEnabled()
}
export function unlockOrbit() {
  _orbitLockCount = Math.max(0, _orbitLockCount - 1)
  updateOrbitEnabled()
}
function updateOrbitEnabled() {
  const controls = _orbitRef?.current as { enabled?: boolean } | null
  if (controls) controls.enabled = _orbitLockCount === 0
}

// ---------------------------------------------------------------------------
// ClothingThreeViewport
// Standalone R3F Canvas for the garment 3D preview.
// ---------------------------------------------------------------------------

export default function ClothingThreeViewport() {
  const orbitRef = useRef(null)
  _orbitRef = orbitRef as { current: unknown }

  return (
    <div style={{ width: '100%', height: '100%', background: '#0a0a14' }}>
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
    </div>
  )
}
