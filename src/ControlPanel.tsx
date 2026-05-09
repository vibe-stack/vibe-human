import {
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { type BoneDebug } from './HumanModel'
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
  type FacsValues,
} from './facs'

type Props = {
  facsValues: FacsValues
  wireframe: boolean
  showBones: boolean
  eyeLook: boolean
  focusLock: boolean
  boneDebug: BoneDebug | null
  fov: number
  onFacsValues: Dispatch<SetStateAction<FacsValues>>
  onWireframe: (v: boolean) => void
  onShowBones: (v: boolean) => void
  onEyeLook: (v: boolean) => void
  onFocusLock: (v: boolean) => void
  onFov: (v: number) => void
}

const panel: CSSProperties = {
  background: 'rgba(14, 14, 18, 0.95)',
  backdropFilter: 'blur(20px)',
  border: '1px solid rgba(255,255,255,0.1)',
  boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
  borderRadius: 8,
}

export default function ControlPanel({
  facsValues,
  wireframe,
  showBones,
  eyeLook,
  focusLock,
  boneDebug,
  fov,
  onFacsValues,
  onWireframe,
  onShowBones,
  onEyeLook,
  onFocusLock,
  onFov,
}: Props) {
  const [detailGroup, setDetailGroup] = useState<FacsGroup | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const setControl = (id: string, value: number) => {
    onFacsValues((prev) => ({ ...prev, [id]: value }))
  }

  const resetAll = () => onFacsValues(createNeutralFacsValues())

  const resetGroup = (group: FacsGroup) => {
    onFacsValues((prev) => {
      const next = { ...prev }
      for (const c of FACS_CONTROLS) {
        if (c.group === group) next[c.id] = 0
      }
      return next
    })
  }

  const activeCount = FACS_CONTROLS.filter((c) => (facsValues[c.id] ?? 0) > 0.001).length

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10 }}>

      {/* ── Main face rig panel ─────────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          left: 16,
          top: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          pointerEvents: 'none',
          gap: 8,
        }}
      >
        <div
          style={{
            pointerEvents: 'auto',
            userSelect: 'none',
            display: 'flex',
            flexDirection: 'column',
            ...panel,
            overflow: 'hidden',
            maxHeight: 'calc(100vh - 32px)',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 14px',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
              flexShrink: 0,
            }}
          >
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

          {/* Face overlay — fills available height */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FaceOverlaySized facsValues={facsValues} onChange={setControl} />
          </div>

          {/* Preset strip */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              padding: '7px 10px',
              borderTop: '1px solid rgba(255,255,255,0.07)',
              flexShrink: 0,
              flexWrap: 'wrap',
            }}
          >
            <Chip onClick={resetAll} bright>RESET</Chip>
            {FACS_PRESETS.map((p) => (
              <Chip key={p.id} onClick={() => onFacsValues(createFacsPresetValues(p.values))}>
                {p.label.toUpperCase()}
              </Chip>
            ))}
          </div>

          {/* Group detail strip */}
          <div
            style={{
              display: 'flex',
              gap: 3,
              padding: '5px 10px',
              borderTop: '1px solid rgba(255,255,255,0.05)',
              flexShrink: 0,
            }}
          >
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
            <Chip onClick={() => setShowSettings((v) => !v)} active={showSettings}>⚙</Chip>
          </div>

          {/* Settings row */}
          {showSettings && (
            <div
              style={{
                padding: '8px 10px',
                borderTop: '1px solid rgba(255,255,255,0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 4 }}>
                <Toggle active={wireframe} onClick={() => onWireframe(!wireframe)}>WIRE</Toggle>
                <Toggle active={showBones} onClick={() => onShowBones(!showBones)}>BONES</Toggle>
                <Toggle active={eyeLook} onClick={() => onEyeLook(!eyeLook)}>EYE</Toggle>
                <Toggle active={focusLock} onClick={() => onFocusLock(!focusLock)}>LOCK</Toggle>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', minWidth: 42 }}>
                  FOV {fov}°
                </span>
                <input
                  type="range" min={20} max={90} step={1} value={fov}
                  onChange={(e) => onFov(parseInt(e.target.value))}
                  className="range-slider"
                  style={{ flex: 1 }}
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

      {/* ── Group detail panel (right side) ──────────────────────────────────── */}
      {detailGroup && (
        <div
          style={{
            position: 'absolute',
            right: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 280,
            maxHeight: 'calc(100vh - 32px)',
            overflowY: 'auto',
            pointerEvents: 'auto',
            userSelect: 'none',
            ...panel,
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
          }}
          className="facs-scroll"
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.42)', fontFamily: 'monospace' }}>
              {detailGroup.toUpperCase()}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => resetGroup(detailGroup)}
                style={chipStyle(false)}
              >RESET</button>
              <button
                onClick={() => setDetailGroup(null)}
                style={{ ...chipStyle(false), color: 'rgba(255,255,255,0.5)' }}
              >✕</button>
            </div>
          </div>

          <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
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
    </div>
  )
}

// ── Sized wrapper — SVG aspect ratio 460:580 = ~0.793 ────────────────────────
function FaceOverlaySized({ facsValues, onChange }: { facsValues: FacsValues; onChange: (id: string, v: number) => void }) {
  return (
    <div style={{
      // Height drives layout; width follows via aspect-ratio.
      height: 'min(58vh, 520px)',
      aspectRatio: '460 / 580',
      minHeight: 320,
    }}>
      <FaceOverlay facsValues={facsValues} onChange={onChange} />
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
    fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
    border: active ? '1px solid rgba(232,224,32,0.4)' : '1px solid rgba(255,255,255,0.08)',
    background: active ? 'rgba(232,224,32,0.12)' : 'rgba(255,255,255,0.04)',
    color: active ? 'rgba(232,224,32,0.88)' : 'rgba(255,255,255,0.38)',
    cursor: 'pointer',
    fontFamily: "'Courier New', monospace",
    letterSpacing: '0.06em',
  }
}

function Chip({ onClick, children, active, bright }: { onClick: () => void; children: ReactNode; active?: boolean; bright?: boolean }) {
  return (
    <button onClick={onClick} style={bright ? {
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
