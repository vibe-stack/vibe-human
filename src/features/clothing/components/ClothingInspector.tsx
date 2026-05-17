import { useSnapshot } from 'valtio'
import { clothingStore } from '../state/clothingStore'
import {
  requestCollisionAvatarBuild,
  resetSim,
  setAvatarCollisionMode,
  setAvatarMeshCellSize,
  setAvatarSkinOffset,
  setCollisionGlobalInflate,
  setGarmentCollisionThickness,
  setSimQuality,
  setTransformMode,
  toggleSimRunning,
} from '../state/clothingActions'
import type { AvatarCollisionMode, ClothSimQuality, ClothingTransformMode } from '../state/clothingTypes'

const QUALITY_OPTIONS: Array<{ id: ClothSimQuality; label: string }> = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'ultra', label: 'Ultra' },
]

const TRANSFORM_OPTIONS: Array<{ id: ClothingTransformMode; label: string }> = [
  { id: 'translate', label: 'Move' },
  { id: 'rotate', label: 'Rotate' },
]

const COLLISION_MODE_OPTIONS: Array<{ id: AvatarCollisionMode; label: string }> = [
  { id: 'authoring', label: 'Author' },
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'preview', label: 'Proxy' },
]

// ---------------------------------------------------------------------------
// ClothingInspector — lives in the right sidebar when Clothing is active.
// Shows selected entity info + preview toggles.
// ---------------------------------------------------------------------------

export default function ClothingInspector() {
  const snap = useSnapshot(clothingStore)
  const { garment, previewOptions, activeClothingTool, simRunning, simQuality, transformMode, collisionAvatar } = snap

  const selectedPattern = garment.selectedPatternId
    ? garment.patterns[garment.selectedPatternId]
    : null
  const selectedPoint = selectedPattern && garment.selectedPointId
    ? selectedPattern.points[garment.selectedPointId]
    : null

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '12px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      color: 'rgba(255,255,255,0.75)',
      fontSize: 11,
      fontFamily: "'Courier New', monospace",
    }}>
      {/* Active tool */}
      <Section label="TOOL">
        <Row label="Active" value={activeClothingTool.toUpperCase()} />
      </Section>

      {/* Selection */}
      <Section label="SELECTION">
        {selectedPattern ? (
          <>
            <Row label="Pattern" value={selectedPattern.name} />
            <Row label="Points"  value={String(Object.keys(selectedPattern.points).length)} />
            <Row label="Edges"   value={String(selectedPattern.edges.length)} />
            {selectedPoint && (
              <>
                <Row label="Point X" value={selectedPoint.x.toFixed(1)} />
                <Row label="Point Y" value={selectedPoint.y.toFixed(1)} />
              </>
            )}
          </>
        ) : (
          <span style={{ opacity: 0.35 }}>Nothing selected</span>
        )}
      </Section>

      {/* Particle distance for selected pattern */}
      {selectedPattern && (
        <Section label="RAPIER CLOTH">
          <Row label="Status" value={simRunning ? 'RUNNING' : 'PAUSED'} />
          <Row label="Mode" value="PARTICLE SPRINGS" />
          <Row label="Quality" value={simQuality.toUpperCase()} />
          <Row label="Particle Dist" value={`${selectedPattern.particleDistance} u`} />
          <Slider
            label="Particle Distance"
            value={selectedPattern.particleDistance}
            min={8}
            max={32}
            step={1}
            onChange={(value) => {
              if (!selectedPattern) return
              clothingStore.garment.patterns[selectedPattern.id].particleDistance = value
              clothingStore.dirty.triangulationDirty = true
              clothingStore.dirty.previewDirty = true
              clothingStore.simResetKey += 1
              clothingStore.simRunning = false
            }}
          />
          <Slider
            label="Substeps"
            value={simQuality === 'low' ? 1 : simQuality === 'medium' ? 2 : simQuality === 'high' ? 3 : 4}
            min={1}
            max={4}
            step={1}
            onChange={(value) => setSimQuality(value <= 1 ? 'low' : value === 2 ? 'medium' : value === 3 ? 'high' : 'ultra')}
          />
          <SegmentedControl
            value={simQuality}
            options={QUALITY_OPTIONS}
            onChange={setSimQuality}
          />
          <Row label="Placement" value={transformMode.toUpperCase()} />
          <SegmentedControl
            value={transformMode}
            options={TRANSFORM_OPTIONS}
            onChange={setTransformMode}
          />
          <ButtonRow>
            <SmallButton label={simRunning ? 'PAUSE' : 'RUN'} onClick={toggleSimRunning} />
            <SmallButton label="RESET" onClick={resetSim} />
          </ButtonRow>
        </Section>
      )}

      {/* Preview toggles */}
      <Section label="3D PREVIEW">
        <Toggle
          label="Wireframe"
          value={previewOptions.showWireframe}
          onChange={(v) => { clothingStore.previewOptions.showWireframe = v }}
        />
        <Toggle
          label="Show Seams"
          value={previewOptions.showSeams}
          onChange={(v) => { clothingStore.previewOptions.showSeams = v }}
        />
        <Toggle
          label="Triangulation"
          value={previewOptions.showTriangulation}
          onChange={(v) => { clothingStore.previewOptions.showTriangulation = v }}
        />
        <Toggle
          label="Collision Overlay"
          value={previewOptions.showCollisionProxies}
          onChange={(v) => { clothingStore.previewOptions.showCollisionProxies = v }}
        />
      </Section>

      <Section label="AVATAR COLLISION">
        <Row label="Mode" value={collisionAvatar.mode.toUpperCase()} />
        <SegmentedControl
          value={collisionAvatar.mode}
          options={COLLISION_MODE_OPTIONS}
          onChange={setAvatarCollisionMode}
        />
        <ButtonRow>
          <SmallButton label="BUILD MESH" onClick={() => {
            setAvatarCollisionMode('authoring')
            requestCollisionAvatarBuild()
          }} />
          <SmallButton label="FAST PROXIES" onClick={() => {
            setAvatarCollisionMode('preview')
            requestCollisionAvatarBuild()
          }} />
        </ButtonRow>
        <Row label="Proxies" value={String(collisionAvatar.proxyCount)} />
        <Row label="Mesh Verts" value={String(collisionAvatar.sourceVertexCount)} />
        <Row label="Collider Verts" value={String(collisionAvatar.meshColliderVertexCount)} />
        <Row label="Collider Tris" value={String(collisionAvatar.meshColliderTriangleCount)} />
        <Row label="Hash Cells" value={String(collisionAvatar.spatialHashCellCount)} />
        <Slider label="Avatar Skin Offset" value={collisionAvatar.skinOffset} min={0} max={0.08} step={0.002} onChange={setAvatarSkinOffset} />
        <Slider label="Garment Thickness" value={collisionAvatar.garmentThickness} min={0} max={0.04} step={0.001} onChange={setGarmentCollisionThickness} />
        <Slider label="Proxy Inflate" value={collisionAvatar.globalInflate} min={0} max={0.08} step={0.002} onChange={setCollisionGlobalInflate} />
        <Slider label="Hash Cell Size" value={collisionAvatar.meshCellSize} min={0.04} max={0.2} step={0.005} onChange={setAvatarMeshCellSize} />
        <Toggle
          label="Capsules"
          value={previewOptions.showCollisionCapsules}
          onChange={(v) => { clothingStore.previewOptions.showCollisionCapsules = v }}
        />
        <Toggle
          label="Ellipsoids"
          value={previewOptions.showCollisionEllipsoids}
          onChange={(v) => { clothingStore.previewOptions.showCollisionEllipsoids = v }}
        />
        <Toggle
          label="Low-res Mesh"
          value={previewOptions.showCollisionLowResMesh}
          onChange={(v) => { clothingStore.previewOptions.showCollisionLowResMesh = v }}
        />
        <Toggle
          label="Vertex-Triangle"
          value={collisionAvatar.enableVertexTriangle}
          onChange={(v) => { clothingStore.collisionAvatar.enableVertexTriangle = v }}
        />
        <Toggle
          label="Perf Logs"
          value={collisionAvatar.debugPerf}
          onChange={(v) => { clothingStore.collisionAvatar.debugPerf = v }}
        />
        <Row label="Edge-Edge" value="NOT WIRED" />
      </Section>

      {/* Document info */}
      <Section label="DOCUMENT">
        <Row label="Name"     value={garment.name} />
        <Row label="Patterns" value={String(Object.keys(garment.patterns).length)} />
        <Row label="Seams"    value={String(Object.keys(garment.seams).length)} />
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 8,
        letterSpacing: '0.14em',
        color: 'rgba(255,255,255,0.3)',
        marginBottom: 6,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        paddingBottom: 3,
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {children}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ opacity: 0.45 }}>{label}</span>
      <span style={{ color: 'rgba(255,255,255,0.9)', textAlign: 'right', maxWidth: 120, wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  )
}

function ButtonRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
      {children}
    </div>
  )
}

function SmallButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '4px 6px',
        borderRadius: 4,
        border: '1px solid rgba(255,255,255,0.14)',
        background: 'rgba(255,255,255,0.06)',
        color: 'rgba(255,255,255,0.72)',
        fontSize: 9,
        fontFamily: "'Courier New', monospace",
        fontWeight: 700,
        letterSpacing: '0.08em',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ id: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      gap: 2,
      marginTop: 4,
      padding: 2,
      borderRadius: 5,
      background: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.08)',
    }}>
      {options.map((option) => {
        const active = option.id === value
        return (
          <button
            key={option.id}
            onClick={() => onChange(option.id)}
            style={{
              minWidth: 0,
              padding: '4px 3px',
              borderRadius: 3,
              border: 'none',
              background: active ? 'rgba(68,136,255,0.32)' : 'transparent',
              color: active ? '#9ec2ff' : 'rgba(255,255,255,0.45)',
              fontSize: 8,
              fontFamily: "'Courier New', monospace",
              fontWeight: 700,
              letterSpacing: '0.04em',
              cursor: 'pointer',
            }}
          >
            {option.label.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
      onClick={() => onChange(!value)}
    >
      <span style={{ opacity: 0.7 }}>{label}</span>
      <div style={{
        width: 28,
        height: 14,
        borderRadius: 7,
        background: value ? '#4488ff' : 'rgba(255,255,255,0.15)',
        position: 'relative',
        transition: 'background 0.15s',
        flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute',
          top: 2,
          left: value ? 16 : 2,
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
        }} />
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span style={{ color: 'rgba(255,255,255,0.85)', fontVariantNumeric: 'tabular-nums' }}>{value.toFixed(step >= 1 ? 0 : 3)}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={{ gridColumn: '1 / -1', width: '100%' }}
      />
    </label>
  )
}
