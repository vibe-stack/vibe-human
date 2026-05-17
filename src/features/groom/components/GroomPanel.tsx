import { useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import {
  Paintbrush,
  Eraser,
  Plus,
  Scissors,
  Trash2,
  Wind,
  Spline,
  Power,
  CircleDot,
  Gauge,
  Crosshair,
  GitBranch,
  Layers,
  Wand2,
  Palette,
  Sparkles,
  Waves,
  Terminal,
  RefreshCw,
  Download,
  Upload,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Brush,
  X,
} from 'lucide-react'
import { exportGroomAsset, importGroomAsset } from '../core/groomSerialization'
import {
  clearScalpPaintMaps,
  clearScalpMask,
  generateGuidesFromActiveScalp,
  groomStore,
  regenerateGeneratedStrands,
  replaceActiveGroomAsset,
  setActiveScalpPaintChannel,
  setActiveGroomTool,
  setBrushSize,
  setBrushStrength,
  setHairMaterialSetting,
  setModifierSetting,
  setShowGeneratedStrands,
  setShowGuides,
  setShowScalpMask,
  useSelectedMeshAsGroomTarget,
} from '../store/groomStore'
import type { GroomTool, ScalpPaintChannel } from '../core/types'

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const glassBg = {
  background: 'rgba(12, 12, 16, 0.72)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
} as const

const monoLabel = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'rgba(255,255,255,0.32)',
  fontFamily: "'Courier New', monospace",
} as const

const btn = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 5,
  cursor: 'pointer',
  color: 'rgba(255,255,255,0.55)',
  fontSize: 10,
  padding: '5px 9px',
  fontFamily: 'monospace',
  letterSpacing: '0.06em',
  transition: 'background 0.12s, color 0.12s',
  width: '100%',
} as const

const pink = 'rgba(244,114,182,0.9)'
const pinkDim = 'rgba(244,114,182,0.5)'

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function SliderRow({
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
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{label}</span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
          {value.toFixed(step < 1 ? 3 : 0)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range-slider"
      />
    </div>
  )
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer' }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 28, height: 20, borderRadius: 3, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', padding: 1 }}
      />
    </label>
  )
}

function ToggleIconRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          color: value ? pink : 'rgba(255,255,255,0.25)',
        }}
      >
        {value ? <Eye size={13} /> : <EyeOff size={13} />}
      </button>
    </div>
  )
}

function Section({
  icon,
  title,
  badge,
  children,
  defaultOpen = true,
}: {
  icon: React.ReactNode
  title: string
  badge?: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', width: '100%', gap: 7,
          padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer',
        }}
      >
        <span style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>{icon}</span>
        <span style={{ ...monoLabel, flex: 1, textAlign: 'left', color: 'rgba(255,255,255,0.42)' }}>{title}</span>
        {badge && (
          <span style={{ fontSize: 9, color: pinkDim, fontFamily: 'monospace', marginRight: 4 }}>{badge}</span>
        )}
        <span style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      {open && (
        <div style={{ padding: '2px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Floating Brush Toolbar (exported — rendered bottom-center by App)
// ---------------------------------------------------------------------------

type BrushToolDef = { tool: GroomTool; icon: React.ReactNode; label: string }

const BRUSH_TOOL_DEFS: BrushToolDef[] = [
  { tool: 'paint-scalp',   icon: <Brush size={13} />,    label: 'Paint Scalp' },
  { tool: 'erase-scalp',  icon: <Eraser size={13} />,   label: 'Erase Scalp' },
  { tool: 'add-guide',    icon: <Plus size={13} />,      label: 'Add Guide' },
  { tool: 'comb',         icon: <Wind size={13} />,      label: 'Comb' },
  { tool: 'smooth',       icon: <Spline size={13} />,    label: 'Smooth' },
  { tool: 'cut',          icon: <Scissors size={13} />,  label: 'Cut' },
  { tool: 'delete-guide', icon: <Trash2 size={13} />,    label: 'Delete Guide' },
]

const SCALP_PAINT_CHANNELS: { channel: ScalpPaintChannel; label: string }[] = [
  { channel: 'mask', label: 'Mask' },
  { channel: 'density', label: 'Density' },
  { channel: 'length', label: 'Length' },
  { channel: 'flyaway', label: 'Flyaway' },
  { channel: 'clumpStrength', label: 'Clump Str' },
  { channel: 'clumpRadius', label: 'Clump Size' },
  { channel: 'hairlineSoftness', label: 'Hairline' },
  { channel: 'flow', label: 'Flow' },
  { channel: 'parting', label: 'Parting' },
]

export function BrushToolbar() {
  const { activeGroomTool, brushSize, brushStrength } = useSnapshot(groomStore)
  const [lastTool, setLastTool] = useState<GroomTool>('comb')

  const brushActive = activeGroomTool !== 'none'

  const handleToggle = () => {
    if (brushActive) {
      setLastTool(activeGroomTool)
      setActiveGroomTool('none')
    } else {
      setActiveGroomTool(lastTool)
    }
  }

  const handleSelectTool = (tool: GroomTool) => {
    setLastTool(tool)
    setActiveGroomTool(tool)
  }

  const sep = (
    <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.08)', margin: '4px 2px' }} />
  )

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        padding: '6px 10px',
        borderRadius: 12,
        userSelect: 'none',
        ...glassBg,
      }}
    >
      {/* Power toggle */}
      <button
        onClick={handleToggle}
        title={brushActive ? 'Disable brush (B)' : 'Enable brush (B)'}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, borderRadius: 7, cursor: 'pointer',
          background: brushActive ? 'rgba(244,114,182,0.16)' : 'rgba(255,255,255,0.04)',
          border: brushActive ? '1px solid rgba(244,114,182,0.35)' : '1px solid rgba(255,255,255,0.09)',
          color: brushActive ? pink : 'rgba(255,255,255,0.3)',
          transition: 'all 0.15s',
        }}
      >
        <Power size={13} />
      </button>

      {sep}

      {/* Tool buttons */}
      {BRUSH_TOOL_DEFS.map(({ tool, icon, label }) => {
        const isActive = activeGroomTool === tool
        return (
          <button
            key={tool}
            onClick={() => handleSelectTool(tool)}
            title={label}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
              width: 44, height: 40, borderRadius: 7, cursor: 'pointer',
              background: isActive ? 'rgba(244,114,182,0.14)' : 'rgba(255,255,255,0.04)',
              border: isActive ? '1px solid rgba(244,114,182,0.32)' : '1px solid transparent',
              color: isActive ? pink : brushActive ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)',
              transition: 'all 0.12s',
              padding: '4px 2px',
            }}
          >
            {icon}
            <span style={{ fontSize: 7, fontFamily: "'Courier New', monospace", letterSpacing: '0.04em', lineHeight: 1 }}>
              {label.toUpperCase()}
            </span>
          </button>
        )
      })}

      {sep}

      {/* Brush size */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <CircleDot size={11} style={{ color: 'rgba(255,255,255,0.28)', flexShrink: 0 }} />
        <div>
          <div style={{ ...monoLabel, marginBottom: 2, color: 'rgba(255,255,255,0.22)' }}>SIZE</div>
          <input
            type="range"
            min={0.005}
            max={0.16}
            step={0.001}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="range-slider"
            style={{ width: 72 }}
          />
        </div>
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.22)', width: 32 }}>
          {brushSize.toFixed(3)}
        </span>
      </div>

      {sep}

      {/* Brush strength */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Gauge size={11} style={{ color: 'rgba(255,255,255,0.28)', flexShrink: 0 }} />
        <div>
          <div style={{ ...monoLabel, marginBottom: 2, color: 'rgba(255,255,255,0.22)' }}>STR</div>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.01}
            value={brushStrength}
            onChange={(e) => setBrushStrength(Number(e.target.value))}
            className="range-slider"
            style={{ width: 72 }}
          />
        </div>
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.22)', width: 22 }}>
          {brushStrength.toFixed(2)}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Groom Panel
// ---------------------------------------------------------------------------

export default function GroomPanel() {
  const {
    activeGroomAsset,
    generatedStrands,
    showGeneratedStrands,
    showGuides,
    showScalpMask,
    activeScalpPaintChannel,
    availableMeshes,
    sceneSelectionMeshId,
  } = useSnapshot(groomStore)
  const importRef = useRef<HTMLInputElement | null>(null)

  const selectedSceneMesh = availableMeshes.find((m) => m.id === sceneSelectionMeshId) ?? null
  const targetMesh = availableMeshes.find((m) => m.id === activeGroomAsset.targetMeshId) ?? null

  const handleExport = async () => {
    const json = exportGroomAsset(structuredClone(activeGroomAsset))
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${activeGroomAsset.name.replace(/\s+/g, '-').toLowerCase() || 'groom'}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    try {
      await navigator.clipboard.writeText(json)
    } catch {
      // Clipboard is optional; file download is the primary export path.
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Paintbrush size={13} style={{ color: pink }} />
          <span style={{ ...monoLabel, color: 'rgba(255,255,255,0.5)', fontSize: 10 }}>HAIR GROOM</span>
        </div>
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: pinkDim }}>
          {generatedStrands.length} STRANDS
        </span>
      </div>

      {/* Scrollable body */}
      <div className="facs-scroll" style={{ overflowY: 'auto', flex: 1 }}>

        {/* TARGET */}
        <Section icon={<Crosshair size={12} />} title="TARGET">
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
            <span style={{ color: 'rgba(255,255,255,0.28)' }}>Active: </span>
            {targetMesh?.name ?? <span style={{ color: 'rgba(248,113,113,0.7)' }}>None</span>}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6 }}>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>Selection: </span>
            {selectedSceneMesh?.name ?? 'None'}
          </div>
          <button onClick={useSelectedMeshAsGroomTarget} style={btn}>USE SELECTED MESH</button>
          {!sceneSelectionMeshId && (
            <div style={{ fontSize: 9, color: 'rgba(248,113,113,0.7)', lineHeight: 1.5 }}>
              Click a mesh in the viewport first.
            </div>
          )}
        </Section>

        {/* SCALP MASK */}
        <Section
          icon={<Brush size={12} />}
          title="SCALP MASK"
          badge={`${activeGroomAsset.scalpMask.selectedTriangleIndices.length} TRI`}
        >
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
            {activeGroomAsset.scalpMask.selectedTriangleIndices.length} selected triangles
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
            {SCALP_PAINT_CHANNELS.map(({ channel, label }) => {
              const active = activeScalpPaintChannel === channel
              const count = channel === 'mask'
                ? activeGroomAsset.scalpMask.selectedTriangleIndices.length
                : channel === 'flow'
                  ? Object.keys(activeGroomAsset.scalpMask.flowMap ?? {}).length
                  : Object.keys(activeGroomAsset.scalpMask.maps?.[channel] ?? {}).length
              return (
                <button
                  key={channel}
                  onClick={() => setActiveScalpPaintChannel(channel)}
                  style={{
                    ...btn,
                    padding: '5px 6px',
                    color: active ? pink : 'rgba(255,255,255,0.48)',
                    borderColor: active ? 'rgba(244,114,182,0.36)' : 'rgba(255,255,255,0.09)',
                    background: active ? 'rgba(244,114,182,0.12)' : 'rgba(255,255,255,0.04)',
                  }}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                    <span>{label}</span>
                    <span style={{ color: 'rgba(255,255,255,0.26)' }}>{count}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <button
            onClick={clearScalpMask}
            style={{ ...btn, color: 'rgba(248,113,113,0.7)', borderColor: 'rgba(248,113,113,0.2)' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
              <X size={10} /> CLEAR SCALP
            </span>
          </button>
          <button
            onClick={clearScalpPaintMaps}
            style={{ ...btn, color: 'rgba(248,113,113,0.62)', borderColor: 'rgba(248,113,113,0.16)' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
              <X size={10} /> CLEAR MAPS
            </span>
          </button>
        </Section>

        {/* GUIDES */}
        <Section
          icon={<GitBranch size={12} />}
          title="GUIDES"
          badge={`${activeGroomAsset.guides.length} GD`}
        >
          <SliderRow label="Length"   value={activeGroomAsset.settings.guideLength}   min={0.02}   max={0.35} step={0.001}  onChange={(v) => setModifierSetting('guideLength', v)} />
          <SliderRow label="Radius"   value={activeGroomAsset.settings.guideRadius}   min={0.0005} max={0.01} step={0.0001} onChange={(v) => setModifierSetting('guideRadius', v)} />
          <SliderRow label="Segments" value={activeGroomAsset.settings.guideSegments} min={3}      max={12}   step={1}      onChange={(v) => setModifierSetting('guideSegments', v)} />
          <button onClick={generateGuidesFromActiveScalp} style={btn}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
              <RefreshCw size={10} /> GENERATE FROM SCALP
            </span>
          </button>
        </Section>

        {/* DENSITY */}
        <Section icon={<Layers size={12} />} title="DENSITY">
          <SliderRow label="Strands / cm²" value={activeGroomAsset.settings.strandDensity}   min={0.1}   max={20}    step={0.1}   onChange={(v) => setModifierSetting('strandDensity', v)} />
          <SliderRow label="Width Root"     value={activeGroomAsset.material.strandWidthRoot} min={0.0003} max={0.008} step={0.0001} onChange={(v) => setHairMaterialSetting('strandWidthRoot', v)} />
          <SliderRow label="Width Tip"      value={activeGroomAsset.material.strandWidthTip}  min={0.0001} max={0.004} step={0.0001} onChange={(v) => setHairMaterialSetting('strandWidthTip', v)} />
          <button onClick={regenerateGeneratedStrands} style={btn}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
              <RefreshCw size={10} /> REGENERATE STRANDS
            </span>
          </button>
        </Section>

        {/* SHAPE MODIFIERS */}
        <Section icon={<Wand2 size={12} />} title="SHAPE MODIFIERS" defaultOpen={false}>
          <SliderRow label="Clump Strength"  value={activeGroomAsset.settings.clumpStrength}  min={0} max={1}    step={0.01}   onChange={(v) => setModifierSetting('clumpStrength', v)} />
          <SliderRow label="Clump Radius"    value={activeGroomAsset.settings.clumpRadius}    min={0} max={0.03} step={0.0005} onChange={(v) => setModifierSetting('clumpRadius', v)} />
          <SliderRow label="Noise Amplitude" value={activeGroomAsset.settings.noiseAmplitude} min={0} max={0.02} step={0.0002} onChange={(v) => setModifierSetting('noiseAmplitude', v)} />
          <SliderRow label="Noise Frequency" value={activeGroomAsset.settings.noiseFrequency} min={0} max={12}   step={0.1}    onChange={(v) => setModifierSetting('noiseFrequency', v)} />
          <SliderRow label="Curl Strength"   value={activeGroomAsset.settings.curlStrength}   min={0} max={0.02} step={0.0002} onChange={(v) => setModifierSetting('curlStrength', v)} />
          <SliderRow label="Curl Frequency"  value={activeGroomAsset.settings.curlFrequency}  min={0} max={16}   step={0.1}    onChange={(v) => setModifierSetting('curlFrequency', v)} />
          <SliderRow label="Frizz Strength"  value={activeGroomAsset.settings.frizzStrength}  min={0} max={0.01} step={0.0001} onChange={(v) => setModifierSetting('frizzStrength', v)} />
          <SliderRow label="Cut Randomness"  value={activeGroomAsset.settings.cutRandomness}  min={0} max={1}    step={0.01}   onChange={(v) => setModifierSetting('cutRandomness', v)} />
        </Section>

        {/* MELANIN */}
        <Section icon={<Palette size={12} />} title="MELANIN" defaultOpen={false}>
          <SliderRow label="Melanin"         value={activeGroomAsset.material.melanin}          min={0} max={1}   step={0.01}  onChange={(v) => setHairMaterialSetting('melanin', v)} />
          <SliderRow label="Redness"         value={activeGroomAsset.material.melaninRedness}   min={0} max={1}   step={0.01}  onChange={(v) => setHairMaterialSetting('melaninRedness', v)} />
          <SliderRow label="Per-strand Var." value={activeGroomAsset.material.melaninRandomize} min={0} max={0.5} step={0.005} onChange={(v) => setHairMaterialSetting('melaninRandomize', v)} />
          <ColorRow  label="Tint"            value={activeGroomAsset.material.tintColor}        onChange={(v) => setHairMaterialSetting('tintColor', v)} />
          <SliderRow label="Root Darken"     value={activeGroomAsset.material.rootDarken}       min={0} max={1}   step={0.01}  onChange={(v) => setHairMaterialSetting('rootDarken', v)} />
          <SliderRow label="Root Length"     value={activeGroomAsset.material.rootDarkenLength} min={0} max={1}   step={0.01}  onChange={(v) => setHairMaterialSetting('rootDarkenLength', v)} />
        </Section>

        {/* HIGHLIGHTS */}
        <Section icon={<Sparkles size={12} />} title="HIGHLIGHTS" defaultOpen={false}>
          <SliderRow label="Specular"        value={activeGroomAsset.material.specularStrength}      min={0}     max={1.5} step={0.01}  onChange={(v) => setHairMaterialSetting('specularStrength', v)} />
          <SliderRow label="Roughness Long." value={activeGroomAsset.material.roughness}             min={0.05}  max={1}   step={0.01}  onChange={(v) => setHairMaterialSetting('roughness', v)} />
          <SliderRow label="Roughness Azim." value={activeGroomAsset.material.roughnessAzimuthal}    min={0.05}  max={1}   step={0.01}  onChange={(v) => setHairMaterialSetting('roughnessAzimuthal', v)} />
          <SliderRow label="Primary Shift"   value={activeGroomAsset.material.primaryShift}          min={-0.15} max={0.15} step={0.005} onChange={(v) => setHairMaterialSetting('primaryShift', v)} />
          <ColorRow  label="Primary Tint"    value={activeGroomAsset.material.primaryHighlightTint}  onChange={(v) => setHairMaterialSetting('primaryHighlightTint', v)} />
          <SliderRow label="Secondary Shift" value={activeGroomAsset.material.secondaryShift}        min={-0.15} max={0.15} step={0.005} onChange={(v) => setHairMaterialSetting('secondaryShift', v)} />
          <ColorRow  label="Secondary Tint"  value={activeGroomAsset.material.secondaryHighlightTint} onChange={(v) => setHairMaterialSetting('secondaryHighlightTint', v)} />
        </Section>

        {/* SCATTERING */}
        <Section icon={<Waves size={12} />} title="SCATTERING" defaultOpen={false}>
          <SliderRow label="Multi-scatter" value={activeGroomAsset.material.scatter}          min={0}    max={1} step={0.01} onChange={(v) => setHairMaterialSetting('scatter', v)} />
          <ColorRow  label="Transmission"  value={activeGroomAsset.material.transmissionTint} onChange={(v) => setHairMaterialSetting('transmissionTint', v)} />
          <SliderRow label="Flyaway"       value={activeGroomAsset.material.flyaway}           min={0}    max={1} step={0.01} onChange={(v) => setHairMaterialSetting('flyaway', v)} />
          <SliderRow label="Self Shadow"   value={activeGroomAsset.material.shadowStrength}    min={0}    max={1} step={0.01} onChange={(v) => setHairMaterialSetting('shadowStrength', v)} />
          <SliderRow label="Opacity"       value={activeGroomAsset.material.opacity}           min={0.05} max={1} step={0.01} onChange={(v) => setHairMaterialSetting('opacity', v)} />
        </Section>

        {/* DEBUG / SERIALIZATION */}
        <Section icon={<Terminal size={12} />} title="DEBUG" defaultOpen={false}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button onClick={handleExport} style={btn}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                <Download size={10} /> EXPORT
              </span>
            </button>
            <button onClick={() => importRef.current?.click()} style={btn}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                <Upload size={10} /> IMPORT
              </span>
            </button>
          </div>
          <ToggleIconRow label="Show Guides"  value={showGuides}           onChange={setShowGuides} />
          <ToggleIconRow label="Show Strands" value={showGeneratedStrands} onChange={setShowGeneratedStrands} />
          <ToggleIconRow label="Show Scalp"   value={showScalpMask}        onChange={setShowScalpMask} />
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const text = await file.text()
              replaceActiveGroomAsset(importGroomAsset(text))
              e.target.value = ''
            }}
          />
        </Section>

      </div>
    </div>
  )
}
