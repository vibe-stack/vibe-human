import { useRef, memo, useCallback } from 'react'
import { useSnapshot } from 'valtio'
import { clothingStore } from '../state/clothingStore'
import {
  exportGarment,
  importGarment,
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
import { Button } from '@/components/ui/button'
import { SliderComfortable } from '@/components/ui/slider'
import { ColorPicker } from '@/components/ui/color-picker'
import { Elevated } from '@/lib/elevated'

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
  { id: 'authoring', label: 'Live' },
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
  const selectedEdge = selectedPattern && garment.selectedEdgeId
    ? selectedPattern.edges.find((edge) => edge.id === garment.selectedEdgeId) ?? null
    : null

  return (
    <div className="flex flex-col flex-1 overflow-y-auto gap-4 p-3 text-[11px] text-foreground/75">
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
            <ColorRow
              label="Color"
              value={selectedPattern.color ?? '#5f8cff'}
              onChange={(value) => {
                clothingStore.garment.patterns[selectedPattern.id].color = value
              }}
            />
            
            {selectedEdge && (
              <>
                <Row label="Edge" value={selectedEdge.id} />
                <Row label="Glued" value={selectedPattern.gluedEdgeIds?.includes(selectedEdge.id) ? 'YES' : 'NO'} />
                <ButtonRow>
                  <SmallButton label={selectedPattern.gluedEdgeIds?.includes(selectedEdge.id) ? 'UNGLUE EDGE' : 'GLUE EDGE'} onClick={() => {
                    const next = new Set(selectedPattern.gluedEdgeIds ?? [])
                    if (next.has(selectedEdge.id)) next.delete(selectedEdge.id)
                    else next.add(selectedEdge.id)
                    clothingStore.garment.patterns[selectedPattern.id].gluedEdgeIds = [...next]
                    clothingStore.dirty.previewDirty = true
                    // Gluing reprojects the live drape rather than resetting it.
                  }} />
                </ButtonRow>
              </>
            )}
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
          <InspectorSlider
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
              // Resolution change rebuilds the grid but keeps the draped shape.
            }}
          />
          <InspectorSlider
            label="Stretch Compliance"
            value={selectedPattern.stretchCompliance ?? 0.0002}
            min={0}
            max={0.05}
            step={0.0001}
            onChange={(value) => {
              clothingStore.garment.patterns[selectedPattern.id].stretchCompliance = value
              clothingStore.dirty.previewDirty = true
            }}
          />
          <InspectorSlider
            label="Shear Compliance"
            value={selectedPattern.shearCompliance ?? 0.00028}
            min={0}
            max={0.05}
            step={0.0001}
            onChange={(value) => {
              clothingStore.garment.patterns[selectedPattern.id].shearCompliance = value
              clothingStore.dirty.previewDirty = true
            }}
          />
          <InspectorSlider
            label="Bend Compliance"
            value={selectedPattern.bendCompliance ?? 0.25}
            min={0.025}
            max={5}
            step={0.005}
            onChange={(value) => {
              clothingStore.garment.patterns[selectedPattern.id].bendCompliance = value
              clothingStore.dirty.previewDirty = true
            }}
          />
          <InspectorSlider
            label="Damping"
            value={selectedPattern.damping ?? 0.07}
            min={0}
            max={0.2}
            step={0.001}
            onChange={(value) => {
              clothingStore.garment.patterns[selectedPattern.id].damping = value
              clothingStore.dirty.previewDirty = true
            }}
          />
          <InspectorSlider
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
          <SmallButton label="LIVE" onClick={() => {
            setAvatarCollisionMode('authoring')
            requestCollisionAvatarBuild()
          }} />
          <SmallButton label="TORSO MESH" onClick={() => {
            setAvatarCollisionMode('hybrid')
            requestCollisionAvatarBuild()
          }} />
        </ButtonRow>
        <Row label="Proxies" value={String(collisionAvatar.proxyCount)} />
        <Row label="Mesh Verts" value={String(collisionAvatar.sourceVertexCount)} />
        <Row label="Collider Verts" value={String(collisionAvatar.meshColliderVertexCount)} />
        <Row label="Collider Tris" value={String(collisionAvatar.meshColliderTriangleCount)} />
        <Row label="Hash Cells" value={String(collisionAvatar.spatialHashCellCount)} />
        <InspectorSlider label="Avatar Skin Offset" value={collisionAvatar.skinOffset} min={0} max={0.08} step={0.002} onChange={setAvatarSkinOffset} />
        <InspectorSlider label="Garment Thickness" value={collisionAvatar.garmentThickness} min={0} max={0.04} step={0.001} onChange={setGarmentCollisionThickness} />
        <InspectorSlider label="Proxy Inflate" value={collisionAvatar.globalInflate} min={0} max={0.08} step={0.002} onChange={setCollisionGlobalInflate} />
        <InspectorSlider label="Hash Cell Size" value={collisionAvatar.meshCellSize} min={0.04} max={0.2} step={0.005} onChange={setAvatarMeshCellSize} />
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
          label="Vertex-Triangle"
          value={collisionAvatar.enableVertexTriangle}
          onChange={(v) => { clothingStore.collisionAvatar.enableVertexTriangle = v }}
        />
        <Toggle
          label="Perf Logs"
          value={collisionAvatar.debugPerf}
          onChange={(v) => { clothingStore.collisionAvatar.debugPerf = v }}
        />
        <Row label="Low-res Patches" value="0" />
      </Section>

      {/* Document info + save/load */}
      <Section label="DOCUMENT">
        <Row label="Name"     value={garment.name} />
        <Row label="Patterns" value={String(Object.keys(garment.patterns).length)} />
        <Row label="Seams"    value={String(Object.keys(garment.seams).length)} />
        <GarmentFileButtons />
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Elevated offset={1} className="rounded-lg p-2.5 flex flex-col gap-1">
      <div className="text-[8px] tracking-[0.14em] text-foreground/30 mb-1 border-b border-border/30 pb-1">
        {label}
      </div>
      <div className="flex flex-col gap-1">
        {children}
      </div>
    </Elevated>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="opacity-45">{label}</span>
      <span className="text-foreground/90 text-right max-w-30 break-all">{value}</span>
    </div>
  )
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="opacity-45">{label}</span>
      <ColorPicker value={value} onValueChange={onChange} />
    </div>
  )
}

function ButtonRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5 mt-1">
      {children}
    </div>
  )
}

function SmallButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button onClick={onClick} variant="secondary" size="sm" className="flex-1">
      {label}
    </Button>
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
    <Elevated offset={1} className="grid gap-0.5 mt-1 p-0.5 rounded-md" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <Button
          key={option.id}
          variant={option.id === value ? 'secondary' : 'ghost'}
          size="sm"
          className="text-[8px] px-1 h-6 tracking-wide"
          onClick={() => onChange(option.id)}
        >
          {option.label.toUpperCase()}
        </Button>
      ))}
    </Elevated>
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
      className="flex justify-between items-center cursor-pointer py-0.5"
      onClick={() => onChange(!value)}
    >
      <span className="opacity-70">{label}</span>
      <div className={`w-7 h-3.5 rounded-full relative transition-colors shrink-0 ${value ? 'bg-blue-500' : 'bg-foreground/15'}`}>
        <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-[left] ${value ? 'left-3.5' : 'left-0.5'}`} />
      </div>
    </div>
  )
}

const InspectorSlider = memo(function InspectorSlider({
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
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const stableChange = useCallback((v: number) => onChangeRef.current(v), [])
  return (
    <SliderComfortable
      variant="scrubber"
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={stableChange}
      formatValue={(v) => formatSliderValue(v, step)}
    />
  )
}, (prev, next) =>
  prev.value === next.value &&
  prev.label === next.label &&
  prev.min === next.min &&
  prev.max === next.max &&
  prev.step === next.step)

function formatSliderValue(value: number, step: number) {
  if (step >= 1) return value.toFixed(0)
  if (step >= 0.01) return value.toFixed(2)
  if (step >= 0.001) return value.toFixed(3)
  return value.toFixed(4)
}

function GarmentFileButtons() {
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string)
        importGarment(parsed)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[clothing] Failed to import garment:', err)
      }
    }
    reader.readAsText(file)
    // Reset so the same file can be re-imported
    event.target.value = ''
  }

  return (
    <ButtonRow>
      <SmallButton label="EXPORT" onClick={exportGarment} />
      <SmallButton label="IMPORT" onClick={() => fileInputRef.current?.click()} />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleImport}
      />
    </ButtonRow>
  )
}
