import { useRef, type CSSProperties } from 'react'
import { useSnapshot } from 'valtio'
import { exportGroomAsset, importGroomAsset } from '../core/groomSerialization'
import {
  clearScalpMask,
  generateGuidesFromActiveScalp,
  groomStore,
  regenerateGeneratedStrands,
  replaceActiveGroomAsset,
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

const panelBg: CSSProperties = {
  background: 'rgba(14, 14, 18, 0.54)',
  backdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,0.1)',
  boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
  borderRadius: 8,
}

const labelStyle: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'rgba(255,255,255,0.36)',
  fontFamily: "'Courier New', monospace",
}

const buttonStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 4,
  cursor: 'pointer',
  color: 'rgba(255,255,255,0.65)',
  fontSize: 10,
  padding: '6px 8px',
  fontFamily: 'monospace',
}

const activeButtonStyle: CSSProperties = {
  ...buttonStyle,
  color: 'rgba(255,255,255,0.9)',
  border: '1px solid rgba(244,114,182,0.35)',
  background: 'rgba(244,114,182,0.12)',
}

function ToolButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button onClick={onClick} style={active ? activeButtonStyle : buttonStyle}>
      {children}
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ ...labelStyle, marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}

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
  onChange: (value: number) => void
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.56)' }}>{label}</span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.38)', fontFamily: 'monospace' }}>
          {value.toFixed(step < 1 ? 3 : 0)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="range-slider"
      />
    </div>
  )
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.58)' }}>{label}</span>
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

export default function GroomPanel() {
  const {
    activeGroomAsset,
    activeGroomTool,
    brushSize,
    brushStrength,
    generatedStrands,
    showGeneratedStrands,
    showGuides,
    showScalpMask,
    availableMeshes,
    sceneSelectionMeshId,
  } = useSnapshot(groomStore)
  const importRef = useRef<HTMLInputElement | null>(null)

  const selectedSceneMesh = availableMeshes.find((mesh) => mesh.id === sceneSelectionMeshId) ?? null
  const targetMesh = availableMeshes.find((mesh) => mesh.id === activeGroomAsset.targetMeshId) ?? null

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
      // Clipboard is optional here; the file download is the primary export path.
    }
  }

  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, width: 340, maxHeight: 'calc(100vh - 32px)', overflow: 'hidden', zIndex: 11, userSelect: 'none', ...panelBg }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <span style={{ ...labelStyle, color: 'rgba(255,255,255,0.48)' }}>HAIR GROOM</span>
        <span style={{ fontSize: 9, color: 'rgba(244,114,182,0.78)', fontFamily: 'monospace' }}>
          {generatedStrands.length} STRANDS
        </span>
      </div>

      <div className="facs-scroll" style={{ maxHeight: 'calc(100vh - 76px)', overflowY: 'auto' }}>
        <Section title="TARGET">
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.64)', lineHeight: 1.5 }}>
            <div>Current target: {targetMesh?.name ?? 'None'}</div>
            <div style={{ color: 'rgba(255,255,255,0.42)' }}>Viewport selection: {selectedSceneMesh?.name ?? 'None'}</div>
          </div>
          <button onClick={useSelectedMeshAsGroomTarget} style={buttonStyle}>USE SELECTED MESH</button>
          {!sceneSelectionMeshId && (
            <div style={{ fontSize: 10, color: 'rgba(248,113,113,0.85)', lineHeight: 1.4 }}>
              Click a mesh in the viewport, then use it as the groom target.
            </div>
          )}
        </Section>

        <Section title="SCALP MASK">
          <SliderRow label="Brush Size" value={brushSize} min={0.005} max={0.16} step={0.001} onChange={setBrushSize} />
          <SliderRow label="Brush Strength" value={brushStrength} min={0.05} max={1} step={0.01} onChange={setBrushStrength} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            <ToolButton active={activeGroomTool === 'paint-scalp'} onClick={() => setActiveGroomTool('paint-scalp')}>PAINT SCALP</ToolButton>
            <ToolButton active={activeGroomTool === 'erase-scalp'} onClick={() => setActiveGroomTool('erase-scalp')}>ERASE SCALP</ToolButton>
            <button onClick={clearScalpMask} style={buttonStyle}>CLEAR SCALP</button>
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.48)' }}>
            {activeGroomAsset.scalpMask.selectedTriangleIndices.length} selected triangles
          </div>
        </Section>

        <Section title="GUIDES">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            <ToolButton active={activeGroomTool === 'add-guide'} onClick={() => setActiveGroomTool('add-guide')}>ADD GUIDE</ToolButton>
            <ToolButton active={activeGroomTool === 'comb'} onClick={() => setActiveGroomTool('comb')}>COMB</ToolButton>
            <ToolButton active={activeGroomTool === 'smooth'} onClick={() => setActiveGroomTool('smooth')}>SMOOTH</ToolButton>
            <ToolButton active={activeGroomTool === 'cut'} onClick={() => setActiveGroomTool('cut')}>CUT</ToolButton>
            <ToolButton active={activeGroomTool === 'delete-guide'} onClick={() => setActiveGroomTool('delete-guide')}>DELETE GUIDE</ToolButton>
            <button onClick={generateGuidesFromActiveScalp} style={buttonStyle}>GENERATE FROM SCALP</button>
          </div>
          <SliderRow
            label="Guide Length"
            value={activeGroomAsset.settings.guideLength}
            min={0.02}
            max={0.35}
            step={0.001}
            onChange={(value) => setModifierSetting('guideLength', value)}
          />
          <SliderRow
            label="Guide Radius"
            value={activeGroomAsset.settings.guideRadius}
            min={0.0005}
            max={0.01}
            step={0.0001}
            onChange={(value) => setModifierSetting('guideRadius', value)}
          />
          <SliderRow
            label="Guide Segments"
            value={activeGroomAsset.settings.guideSegments}
            min={3}
            max={12}
            step={1}
            onChange={(value) => setModifierSetting('guideSegments', value)}
          />
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.48)' }}>
            {activeGroomAsset.guides.length} guides
          </div>
        </Section>

        <Section title="DENSITY">
          <SliderRow
            label="Strand Density (strands/cm²)"
            value={activeGroomAsset.settings.strandDensity}
            min={0.1}
            max={20}
            step={0.1}
            onChange={(value) => setModifierSetting('strandDensity', value)}
          />
          <SliderRow
            label="Strand Width Root"
            value={activeGroomAsset.material.strandWidthRoot}
            min={0.0003}
            max={0.008}
            step={0.0001}
            onChange={(value) => setHairMaterialSetting('strandWidthRoot', value)}
          />
          <SliderRow
            label="Strand Width Tip"
            value={activeGroomAsset.material.strandWidthTip}
            min={0.0001}
            max={0.004}
            step={0.0001}
            onChange={(value) => setHairMaterialSetting('strandWidthTip', value)}
          />
          <button onClick={regenerateGeneratedStrands} style={buttonStyle}>REGENERATE STRANDS</button>
        </Section>

        <Section title="SHAPE MODIFIERS">
          <SliderRow label="Clump Strength" value={activeGroomAsset.settings.clumpStrength} min={0} max={1} step={0.01} onChange={(value) => setModifierSetting('clumpStrength', value)} />
          <SliderRow label="Clump Radius" value={activeGroomAsset.settings.clumpRadius} min={0} max={0.03} step={0.0005} onChange={(value) => setModifierSetting('clumpRadius', value)} />
          <SliderRow label="Noise Amplitude" value={activeGroomAsset.settings.noiseAmplitude} min={0} max={0.02} step={0.0002} onChange={(value) => setModifierSetting('noiseAmplitude', value)} />
          <SliderRow label="Noise Frequency" value={activeGroomAsset.settings.noiseFrequency} min={0} max={12} step={0.1} onChange={(value) => setModifierSetting('noiseFrequency', value)} />
          <SliderRow label="Curl Strength" value={activeGroomAsset.settings.curlStrength} min={0} max={0.02} step={0.0002} onChange={(value) => setModifierSetting('curlStrength', value)} />
          <SliderRow label="Curl Frequency" value={activeGroomAsset.settings.curlFrequency} min={0} max={16} step={0.1} onChange={(value) => setModifierSetting('curlFrequency', value)} />
          <SliderRow label="Frizz Strength" value={activeGroomAsset.settings.frizzStrength} min={0} max={0.01} step={0.0001} onChange={(value) => setModifierSetting('frizzStrength', value)} />
          <SliderRow label="Cut Randomness" value={activeGroomAsset.settings.cutRandomness} min={0} max={1} step={0.01} onChange={(value) => setModifierSetting('cutRandomness', value)} />
        </Section>

        <Section title="MELANIN">
          <SliderRow label="Melanin" value={activeGroomAsset.material.melanin} min={0} max={1} step={0.01} onChange={(value) => setHairMaterialSetting('melanin', value)} />
          <SliderRow label="Redness (pheomelanin)" value={activeGroomAsset.material.melaninRedness} min={0} max={1} step={0.01} onChange={(value) => setHairMaterialSetting('melaninRedness', value)} />
          <SliderRow label="Per-strand Variance" value={activeGroomAsset.material.melaninRandomize} min={0} max={0.5} step={0.005} onChange={(value) => setHairMaterialSetting('melaninRandomize', value)} />
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.56)' }}>Tint (multiplicative)</span>
            <input type="color" value={activeGroomAsset.material.tintColor} onChange={(event) => setHairMaterialSetting('tintColor', event.target.value)} />
          </label>
          <SliderRow label="Root Darken" value={activeGroomAsset.material.rootDarken} min={0} max={1} step={0.01} onChange={(value) => setHairMaterialSetting('rootDarken', value)} />
          <SliderRow label="Root Darken Length" value={activeGroomAsset.material.rootDarkenLength} min={0} max={1} step={0.01} onChange={(value) => setHairMaterialSetting('rootDarkenLength', value)} />
        </Section>

        <Section title="HIGHLIGHTS">
          <SliderRow label="Specular Strength" value={activeGroomAsset.material.specularStrength} min={0} max={1.5} step={0.01} onChange={(value) => setHairMaterialSetting('specularStrength', value)} />
          <SliderRow label="Longitudinal Roughness" value={activeGroomAsset.material.roughness} min={0.05} max={1} step={0.01} onChange={(value) => setHairMaterialSetting('roughness', value)} />
          <SliderRow label="Azimuthal Roughness" value={activeGroomAsset.material.roughnessAzimuthal} min={0.05} max={1} step={0.01} onChange={(value) => setHairMaterialSetting('roughnessAzimuthal', value)} />
          <SliderRow label="Primary Shift" value={activeGroomAsset.material.primaryShift} min={-0.15} max={0.15} step={0.005} onChange={(value) => setHairMaterialSetting('primaryShift', value)} />
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.56)' }}>Primary Tint</span>
            <input type="color" value={activeGroomAsset.material.primaryHighlightTint} onChange={(event) => setHairMaterialSetting('primaryHighlightTint', event.target.value)} />
          </label>
          <SliderRow label="Secondary Shift" value={activeGroomAsset.material.secondaryShift} min={-0.15} max={0.15} step={0.005} onChange={(value) => setHairMaterialSetting('secondaryShift', value)} />
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.56)' }}>Secondary Tint</span>
            <input type="color" value={activeGroomAsset.material.secondaryHighlightTint} onChange={(event) => setHairMaterialSetting('secondaryHighlightTint', event.target.value)} />
          </label>
        </Section>

        <Section title="SCATTERING">
          <SliderRow label="Multi-scatter" value={activeGroomAsset.material.scatter} min={0} max={1} step={0.01} onChange={(value) => setHairMaterialSetting('scatter', value)} />
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.56)' }}>Transmission Tint</span>
            <input type="color" value={activeGroomAsset.material.transmissionTint} onChange={(event) => setHairMaterialSetting('transmissionTint', event.target.value)} />
          </label>
          <SliderRow label="Flyaway" value={activeGroomAsset.material.flyaway} min={0} max={1} step={0.01} onChange={(value) => setHairMaterialSetting('flyaway', value)} />
          <SliderRow label="Opacity" value={activeGroomAsset.material.opacity} min={0.05} max={1} step={0.01} onChange={(value) => setHairMaterialSetting('opacity', value)} />
        </Section>

        <Section title="DEBUG / SERIALIZATION">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button onClick={handleExport} style={buttonStyle}>EXPORT GROOM JSON</button>
            <button onClick={() => importRef.current?.click()} style={buttonStyle}>IMPORT GROOM JSON</button>
          </div>
          <ToggleRow label="Show Guides" value={showGuides} onChange={setShowGuides} />
          <ToggleRow label="Show Generated Strands" value={showGeneratedStrands} onChange={setShowGeneratedStrands} />
          <ToggleRow label="Show Scalp Mask" value={showScalpMask} onChange={setShowScalpMask} />
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return

              const text = await file.text()
              replaceActiveGroomAsset(importGroomAsset(text))
              event.target.value = ''
            }}
          />
        </Section>
      </div>
    </div>
  )
}
