import { type CSSProperties, type Dispatch, type SetStateAction, useState } from 'react'
import {
  createNeutralModelingValues,
  MODELING_CONTROLS,
  MODELING_GROUPS,
  type ModelingControl,
  type ModelingValues,
} from './characterModeling'

type Props = {
  values: ModelingValues
  onValues: Dispatch<SetStateAction<ModelingValues>>
}

const panel: CSSProperties = {
  background: 'rgba(14, 14, 18, 0.54)',
  backdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,0.1)',
  boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
  borderRadius: 8,
}

console.log("MOUNTED")

export default function CharacterModelingPanel({ values, onValues }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  const setControl = (id: string, value: number) => {
    onValues((prev) => ({ ...prev, [id]: value }))
  }

  const resetAll = () => onValues(createNeutralModelingValues())
  const activeCount = MODELING_CONTROLS.filter((control) => Math.abs(values[control.id] ?? 0) > 0.001).length

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
      <div
        onClick={() => setCollapsed(false)}
        style={{
          position: 'fixed',
          right: collapsed ? 0 : -48,
          top: 16,
          pointerEvents: collapsed ? 'auto' : 'none',
          ...panel,
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
          right: collapsed ? -352 : 16,
          top: 16,
          width: 336,
          maxHeight: 'calc(100vh - 32px)',
          pointerEvents: 'auto',
          userSelect: 'none',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'right 0.28s cubic-bezier(0.4,0,0.2,1)',
          zIndex: 11,
          ...panel,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.45)', fontFamily: "'Courier New', monospace" }}>
            CHARACTER MODEL
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, color: 'rgba(125,211,252,0.68)', fontFamily: 'monospace' }}>
              {activeCount > 0 ? `${activeCount} ACTIVE` : 'NEUTRAL'}
            </span>
            <button
              onClick={() => setCollapsed(true)}
              title="Collapse panel"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'rgba(255,255,255,0.3)',
                fontSize: 12,
                padding: '0 2px',
                lineHeight: 1,
              }}
            >
              ▶
            </button>
          </div>
        </div>

        <div className="facs-scroll" style={{ overflowY: 'auto', minHeight: 0, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {MODELING_GROUPS.map((group) => (
            <div key={group} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.34)', fontFamily: 'monospace', letterSpacing: '0.12em', padding: '0 2px' }}>
                {group.toUpperCase()}
              </div>
              {MODELING_CONTROLS.filter((control) => control.group === group).map((control) => (
                <ModelingSlider
                  key={control.id}
                  control={control}
                  value={values[control.id] ?? 0}
                  onChange={(value) => setControl(control.id, value)}
                />
              ))}
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '8px 10px',
            borderTop: '1px solid rgba(255,255,255,0.07)',
            flexShrink: 0,
          }}
        >
          <button onClick={resetAll} style={buttonStyle}>
            RESET IDENTITY
          </button>
        </div>
      </div>
    </div>
  )
}

function ModelingSlider({
  control,
  value,
  onChange,
}: {
  control: ModelingControl
  value: number
  onChange: (value: number) => void
}) {
  const active = Math.abs(value) > 0.001

  return (
    <div
      style={{
        borderRadius: 6,
        padding: '7px 9px',
        background: active ? 'rgba(125,211,252,0.08)' : 'rgba(255,255,255,0.025)',
        border: active ? '1px solid rgba(125,211,252,0.22)' : '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 42px', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.72)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {control.label}
        </span>
        <span style={{ fontSize: 9, textAlign: 'right', color: active ? 'rgba(125,211,252,0.85)' : 'rgba(255,255,255,0.38)', fontFamily: 'monospace' }}>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 8, color: 'rgba(255,255,255,0.34)', fontFamily: 'monospace' }}>
        <span>{control.negativeLabel.toUpperCase()}</span>
        <span>BASE</span>
        <span>{control.positiveLabel.toUpperCase()}</span>
      </div>
    </div>
  )
}

const buttonStyle: CSSProperties = {
  flex: 1,
  borderRadius: 4,
  padding: '5px 8px',
  fontSize: 9,
  fontWeight: 700,
  cursor: 'pointer',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: 'rgba(255,255,255,0.55)',
  fontFamily: "'Courier New', monospace",
  letterSpacing: '0.08em',
}
