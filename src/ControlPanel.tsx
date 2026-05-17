import {
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useSnapshot } from 'valtio'
import {
  appState,
  setEyeLook,
  setFacsValues,
  setFocusLock,
  setFov,
  setShowBones,
  setWireframe,
} from './appState'
import FaceOverlay from './FaceOverlay'
import {
  createFacsPresetValues,
  createNeutralFacsValues,
  FACS_CONTROLS,
  FACS_GROUPS,
  FACS_PRESETS,
  FACS_VALUE_MAX,
  type FacsControl,
  type FacsGroup,
  type FacsSide,
} from './facs'

export default function ControlPanel() {
  const { facsValues, wireframe, showBones, eyeLook, focusLock, boneDebug, fov } = useSnapshot(appState)
  const [detailGroup, setDetailGroup] = useState<FacsGroup | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const setControl = (id: string, value: number) => {
    setFacsValues((prev) => ({ ...prev, [id]: value }))
  }

  const resetAll = () => setFacsValues(createNeutralFacsValues())

  const resetGroup = (group: FacsGroup) => {
    setFacsValues((prev) => {
      const next = { ...prev }
      for (const c of FACS_CONTROLS) {
        if (c.group === group) next[c.id] = 0
      }
      return next
    })
  }

  const activeCount = FACS_CONTROLS.filter((c) => (facsValues[c.id] ?? 0) > 0.001).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', userSelect: 'none' }}>

      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
          color: 'rgba(255,255,255,0.45)', fontFamily: "'Courier New', monospace",
        }}>
          FACS RIG
        </span>
        <span style={{ fontSize: 9, color: 'rgba(232,224,32,0.6)', fontFamily: 'monospace' }}>
          {activeCount > 0 ? `${activeCount} ACTIVE` : 'NEUTRAL'}
        </span>
      </div>

      {/* Scrollable body */}
      <div className="facs-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>

        {/* Face overlay */}
        <FaceOverlaySized />

        {/* Preset strip */}
        <div style={{
          display: 'flex',
          gap: 4,
          padding: '8px 12px',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          flexWrap: 'wrap',
        }}>
          <Chip onClick={resetAll} bright>RESET</Chip>
          {FACS_PRESETS.map((p) => (
            <Chip key={p.id} onClick={() => setFacsValues(createFacsPresetValues(p.values))}>
              {p.label.toUpperCase()}
            </Chip>
          ))}
        </div>

        {/* Group chips */}
        <div style={{
          display: 'flex',
          gap: 6,
          padding: '8px 12px',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          flexWrap: 'wrap',
        }}>
          {FACS_GROUPS.map((g) => (
            <Chip
              key={g}
              onClick={() => setDetailGroup(detailGroup === g ? null : g)}
              active={detailGroup === g}
            >
              {g.toUpperCase()}
            </Chip>
          ))}
          <div style={{ flex: 1 }} />
          <Chip onClick={() => setShowSettings((v) => !v)} active={showSettings} ariaLabel="Toggle settings">⚙</Chip>
        </div>

        {/* Group detail sliders — inline */}
        {detailGroup && (
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.05)',
            padding: '0 0 4px',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '7px 12px 6px',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.38)', fontFamily: 'monospace' }}>
                {detailGroup.toUpperCase()}
              </span>
              <div style={{ display: 'flex', gap: 5 }}>
                <button onClick={() => resetGroup(detailGroup)} style={chipStyle(false)}>RESET</button>
                <button onClick={() => setDetailGroup(null)} style={{ ...chipStyle(false), color: 'rgba(255,255,255,0.5)' }}>✕</button>
              </div>
            </div>
            <div style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {FACS_CONTROLS.filter((c) => c.group === detailGroup).map((control) => (
                <FacsSlider
                  key={control.id}
                  control={control}
                  value={facsValues[control.id] ?? 0}
                  onChange={(v) => setControl(control.id, v)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Settings row */}
        {showSettings && (
          <div style={{
            padding: '8px 10px',
            borderTop: '1px solid rgba(255,255,255,0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 4 }}>
              <Toggle active={wireframe} onClick={() => setWireframe(!wireframe)}>WIRE</Toggle>
              <Toggle active={showBones} onClick={() => setShowBones(!showBones)}>BONES</Toggle>
              <Toggle active={eyeLook} onClick={() => setEyeLook(!eyeLook)}>EYE</Toggle>
              <Toggle active={focusLock} onClick={() => setFocusLock(!focusLock)}>LOCK</Toggle>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', minWidth: 42 }}>
                FOV {fov}°
              </span>
              <input
                type="range" min={20} max={90} step={1} value={fov}
                onChange={(e) => setFov(parseInt(e.target.value))}
                className="range-slider"
                style={{ flex: 1 }}
                aria-label="Camera field of view"
              />
            </div>
            {showBones && boneDebug && (
              <div style={{
                fontSize: 9, fontFamily: 'monospace',
                color: 'rgba(255,255,255,0.45)',
                lineHeight: 1.7,
              }}>
                <div style={{ color: 'rgba(232,224,32,0.8)' }}>{boneDebug.name}</div>
                <div>pos [{boneDebug.position.map((n) => n.toFixed(4)).join(', ')}]</div>
                <div>Δ   [{boneDebug.deltaPosition.map((n) => n.toFixed(4)).join(', ')}]</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sized wrapper — fills sidebar width, panels scroll naturally ─────────────
function FaceOverlaySized() {
  return (
    <div style={{ width: '100%', padding: '8px 12px 6px' }}>
      <FaceOverlay />
    </div>
  )
}

// ── Slider ────────────────────────────────────────────────────────────────────
function FacsSlider({
  control,
  value,
  onChange,
}: {
  control: FacsControl
  value: number
  onChange: (v: number) => void
}) {
  const max = control.max ?? FACS_VALUE_MAX
  const active = value > 0.001

  return (
    <div
      style={{
        borderRadius: 6,
        padding: '6px 9px',
        background: active ? 'rgba(232,224,32,0.07)' : 'rgba(255,255,255,0.025)',
        border: active ? '1px solid rgba(232,224,32,0.2)' : '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 22px 34px', gap: 5, alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(232,224,32,0.75)', fontFamily: 'monospace', letterSpacing: '0.05em' }}>
          {control.au}
        </span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {control.label}
        </span>
        <SideBadge side={control.side} />
        <span style={{ fontSize: 8, textAlign: 'right', color: 'rgba(255,255,255,0.38)', fontFamily: 'monospace' }}>
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="range-slider facs-range"
        aria-label={`${control.au} ${control.label}`}
      />
    </div>
  )
}

function SideBadge({ side }: { side: FacsSide }) {
  return (
    <span style={{
      borderRadius: 3, padding: '1px 0', textAlign: 'center',
      fontSize: 8, fontWeight: 700,
      background: 'rgba(255,255,255,0.06)',
      color: 'rgba(255,255,255,0.35)',
      display: 'block',
      fontFamily: 'monospace',
    }}>
      {side}
    </span>
  )
}

function chipStyle(active: boolean): CSSProperties {
  return {
    fontSize: 9, fontWeight: 700, padding: '7px 10px', borderRadius: 4,
    minHeight: 30,
    border: active ? '1px solid rgba(232,224,32,0.4)' : '1px solid rgba(255,255,255,0.08)',
    background: active ? 'rgba(232,224,32,0.12)' : 'rgba(255,255,255,0.04)',
    color: active ? 'rgba(232,224,32,0.88)' : 'rgba(255,255,255,0.38)',
    cursor: 'pointer',
    fontFamily: "'Courier New', monospace",
    letterSpacing: '0.06em',
  }
}

function Chip({ onClick, children, active, bright, ariaLabel }: { onClick: () => void; children: ReactNode; active?: boolean; bright?: boolean; ariaLabel?: string }) {
  return (
    <button onClick={onClick} aria-label={ariaLabel} style={bright ? {
      ...chipStyle(false),
      color: 'rgba(255,255,255,0.65)',
      border: '1px solid rgba(255,255,255,0.14)',
    } : chipStyle(!!active)}>
      {children}
    </button>
  )
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        borderRadius: 4, padding: '4px 0', fontSize: 8, fontWeight: 700, cursor: 'pointer',
        background: active ? 'rgba(232,224,32,0.14)' : 'rgba(255,255,255,0.04)',
        border: active ? '1px solid rgba(232,224,32,0.35)' : '1px solid rgba(255,255,255,0.07)',
        color: active ? 'rgba(232,224,32,0.9)' : 'rgba(255,255,255,0.35)',
        fontFamily: "'Courier New', monospace",
        letterSpacing: '0.08em',
      }}
    >
      {children}
    </button>
  )
}
