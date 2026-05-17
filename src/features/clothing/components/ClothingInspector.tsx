import { useSnapshot } from 'valtio'
import { clothingStore } from '../state/clothingStore'
import { resetSim, toggleSimRunning } from '../state/clothingActions'

// ---------------------------------------------------------------------------
// ClothingInspector — lives in the right sidebar when Clothing is active.
// Shows selected entity info + preview toggles.
// ---------------------------------------------------------------------------

export default function ClothingInspector() {
  const snap = useSnapshot(clothingStore)
  const { garment, previewOptions, activeClothingTool, simRunning } = snap

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
          <Row label="Particle Dist" value={`${selectedPattern.particleDistance} u`} />
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
