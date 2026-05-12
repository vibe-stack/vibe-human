import {
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useMemo,
  useState,
} from 'react'
import {
  createNeutralModelingValues,
  getModelingControlById,
  getModelingHandleById,
  getModelingHandles,
  MODELING_CONTROLS,
  type ModelingMode,
  type ModelingValues,
} from './characterModeling'

type Props = {
  values: ModelingValues
  mode: ModelingMode
  symmetric: boolean
  selectedHandleId: string | null
  onValues: Dispatch<SetStateAction<ModelingValues>>
  onMode: (mode: ModelingMode) => void
  onSymmetric: (symmetric: boolean) => void
  onSelectedHandleId: (id: string | null) => void
}

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

export default function CharacterModelingPanel({
  values,
  mode,
  symmetric,
  selectedHandleId,
  onValues,
  onMode,
  onSymmetric,
  onSelectedHandleId,
}: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const selectedHandle = useMemo(
    () => {
      const handle = getModelingHandleById(selectedHandleId, symmetric)
      return handle?.mode === mode ? handle : null
    },
    [mode, selectedHandleId, symmetric],
  )
  const selectedControl = getModelingControlById(selectedHandle?.controlId)
  const selectedControls = selectedHandle?.controlIds
    .map((id) => getModelingControlById(id))
    .filter((control): control is NonNullable<ReturnType<typeof getModelingControlById>> => control !== null) ?? []
  const handlesInMode = useMemo(() => getModelingHandles(mode, symmetric), [mode, symmetric])

  const setControl = (id: string, value: number) => {
    onValues((prev) => ({ ...prev, [id]: Math.max(-1, Math.min(1, value)) }))
  }

  const resetAll = () => onValues(createNeutralModelingValues())

  const resetSelected = () => {
    if (!selectedHandle) return
    onValues((prev) => {
      const next = { ...prev }
      for (const id of selectedHandle.controlIds) next[id] = 0
      return next
    })
  }

  const activeCount = MODELING_CONTROLS.filter(
    (control) => Math.abs(values[control.id] ?? 0) > 0.001,
  ).length

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
      <div
        onClick={() => setCollapsed(false)}
        style={{
          position: 'fixed',
          right: collapsed ? 0 : -48,
          top: 16,
          pointerEvents: collapsed ? 'auto' : 'none',
          ...panelBg,
          borderRadius: '6px 0 0 6px',
          padding: '12px 8px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          transition: 'right 0.28s cubic-bezier(0.4,0,0.2,1)',
          zIndex: 12,
        }}
      >
        <span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.4)', fontFamily: "'Courier New', monospace", writingMode: 'vertical-rl', letterSpacing: '0.1em' }}>MODEL</span>
        <span style={{ fontSize: 12, color: 'rgba(125,211,252,0.82)' }}>◀</span>
      </div>

      <div
        style={{
          position: 'fixed',
          right: collapsed ? -348 : 16,
          top: 16,
          width: 332,
          pointerEvents: 'auto',
          userSelect: 'none',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'right 0.28s cubic-bezier(0.4,0,0.2,1)',
          zIndex: 11,
          ...panelBg,
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          flexShrink: 0,
        }}>
          <span style={{ ...labelStyle, color: 'rgba(255,255,255,0.45)' }}>
            CHARACTER MODEL
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, color: 'rgba(125,211,252,0.68)', fontFamily: 'monospace' }}>
              {activeCount > 0 ? `${activeCount} ACTIVE` : 'NEUTRAL'}
            </span>
            <button
              onClick={() => setCollapsed(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', fontSize: 12, padding: '0 2px', lineHeight: 1 }}
              aria-label="Collapse character modeling panel"
            >▶</button>
          </div>
        </div>

        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <SegmentButton active={mode === 'transform'} onClick={() => onMode('transform')}>
              TRANSFORM
            </SegmentButton>
            <SegmentButton active={mode === 'sculpt'} onClick={() => onMode('sculpt')}>
              SCULPT
            </SegmentButton>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <SegmentButton active={symmetric} onClick={() => onSymmetric(true)}>
              SYMMETRIC
            </SegmentButton>
            <SegmentButton active={!symmetric} onClick={() => onSymmetric(false)}>
              SINGLE SIDE
            </SegmentButton>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 8,
            alignItems: 'center',
            padding: '7px 8px',
            borderRadius: 6,
            background: 'rgba(255,255,255,0.035)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div>
              <div style={labelStyle}>{mode.toUpperCase()} DOTS</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 3 }}>
                {handlesInMode.length} visible dots
              </div>
            </div>
            <button onClick={resetAll} style={smallButtonStyle}>RESET ALL</button>
          </div>

          <div style={{
            borderRadius: 6,
            padding: 10,
            background: selectedControls.length ? 'rgba(125,211,252,0.07)' : 'rgba(255,255,255,0.025)',
            border: selectedControls.length ? '1px solid rgba(125,211,252,0.2)' : '1px solid rgba(255,255,255,0.05)',
          }}>
            {selectedControl && selectedHandle && selectedControls.length ? (
              <SelectedInspector
                label={selectedHandle.label}
                side={selectedHandle.side}
                axis={selectedHandle.axis}
                primaryControlId={selectedControl.id}
                controls={selectedControls}
                values={values}
                onChange={setControl}
                onReset={resetSelected}
                onClear={() => onSelectedHandleId(null)}
              />
            ) : (
              <div style={{ minHeight: 88, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
                <div style={labelStyle}>NO DOT SELECTED</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.48)', lineHeight: 1.45 }}>
                  Select a face control to edit its exact value here.
                </div>
              </div>
            )}
          </div>

          {!symmetric && (
            <div style={{ fontSize: 10, lineHeight: 1.45, color: 'rgba(255,255,255,0.42)' }}>
              Current identity morphs are authored as symmetric keys, so single-side mode changes the selected
              handle workflow but still drives the available paired morph target.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SelectedInspector({
  label,
  side,
  axis,
  primaryControlId,
  controls,
  values,
  onChange,
  onReset,
  onClear,
}: {
  label: string
  side: string
  axis: string
  primaryControlId: string
  controls: NonNullable<ReturnType<typeof getModelingControlById>>[]
  values: ModelingValues
  onChange: (id: string, value: number) => void
  onReset: () => void
  onClear: () => void
}) {
  const active = controls.some((control) => Math.abs(values[control.id] ?? 0) > 0.001)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'start', marginBottom: 10 }}>
        <div>
          <div style={{ ...labelStyle, color: active ? 'rgba(125,211,252,0.9)' : 'rgba(255,255,255,0.45)' }}>
            SELECTED
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.82)', marginTop: 4 }}>
            {label}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
            <MetaPill>{side.toUpperCase()}</MetaPill>
            <MetaPill>{axis.toUpperCase()} AXIS</MetaPill>
            {controls.length > 1 && <MetaPill>{controls.length} KEYS</MetaPill>}
          </div>
        </div>
        <button onClick={onClear} style={smallButtonStyle}>CLOSE</button>
      </div>

      <div
        className="facs-scroll"
        style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 340, overflowY: 'auto', paddingRight: 2, marginBottom: 10 }}
      >
        {controls.map((control) => (
          <AreaSlider
            key={control.id}
            control={control}
            primary={control.id === primaryControlId}
            value={values[control.id] ?? 0}
            onChange={(value) => onChange(control.id, value)}
          />
        ))}
      </div>

      <button onClick={onReset} style={{ ...smallButtonStyle, width: '100%' }}>
        RESET AREA
      </button>
    </div>
  )
}

function AreaSlider({
  control,
  primary,
  value,
  onChange,
}: {
  control: NonNullable<ReturnType<typeof getModelingControlById>>
  primary: boolean
  value: number
  onChange: (value: number) => void
}) {
  const active = Math.abs(value) > 0.001

  return (
    <div style={{
      borderRadius: 5,
      padding: '6px 7px',
      background: primary ? 'rgba(125,211,252,0.08)' : 'rgba(255,255,255,0.025)',
      border: primary ? '1px solid rgba(125,211,252,0.18)' : '1px solid rgba(255,255,255,0.045)',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px', gap: 6, alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 10, color: primary ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.62)' }}>
          {control.label}{primary ? ' *' : ''}
        </span>
        <span style={{
          fontSize: 9,
          color: active ? 'rgba(125,211,252,0.9)' : 'rgba(255,255,255,0.36)',
          fontFamily: 'monospace',
          textAlign: 'right',
        }}>
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        className="range-slider modeling-range"
        aria-label={control.label}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 8, color: 'rgba(255,255,255,0.31)', fontFamily: 'monospace' }}>
        <span>{control.negativeLabel.toUpperCase()}</span>
        <span>BASE</span>
        <span>{control.positiveLabel.toUpperCase()}</span>
      </div>
    </div>
  )
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        borderRadius: 5,
        padding: '7px 8px',
        fontSize: 9,
        fontWeight: 700,
        fontFamily: "'Courier New', monospace",
        letterSpacing: '0.1em',
        cursor: 'pointer',
        border: active ? '1px solid rgba(125,211,252,0.38)' : '1px solid rgba(255,255,255,0.065)',
        background: active ? 'rgba(125,211,252,0.13)' : 'rgba(255,255,255,0.035)',
        color: active ? 'rgba(125,211,252,0.96)' : 'rgba(255,255,255,0.46)',
      }}
    >
      {children}
    </button>
  )
}

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span style={{
      borderRadius: 4,
      padding: '3px 5px',
      fontSize: 8,
      fontWeight: 700,
      letterSpacing: '0.08em',
      fontFamily: 'monospace',
      background: 'rgba(255,255,255,0.055)',
      color: 'rgba(255,255,255,0.5)',
    }}>
      {children}
    </span>
  )
}

const smallButtonStyle: CSSProperties = {
  borderRadius: 4,
  padding: '5px 7px',
  fontSize: 8,
  fontWeight: 700,
  fontFamily: "'Courier New', monospace",
  letterSpacing: '0.08em',
  cursor: 'pointer',
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.52)',
  border: '1px solid rgba(255,255,255,0.08)',
}
