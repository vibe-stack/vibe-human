import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type PointerEvent,
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
  type EyeLookValues,
  type FacsControl,
  type FacsGroup,
  type FacsSide,
  type FacsValues,
} from './facs'

type Props = {
  facsValues: FacsValues
  eyeLook2D: EyeLookValues
  wireframe: boolean
  showBones: boolean
  eyeLook: boolean
  focusLock: boolean
  boneDebug: BoneDebug | null
  fov: number
  onFacsValues: Dispatch<SetStateAction<FacsValues>>
  onEyeLook2D: (v: EyeLookValues) => void
  onWireframe: (v: boolean) => void
  onShowBones: (v: boolean) => void
  onEyeLook: (v: boolean) => void
  onFocusLock: (v: boolean) => void
  onFov: (v: number) => void
}

const panel: CSSProperties = {
  background: 'rgba(14, 14, 18, 0.5)',
  backdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,0.1)',
  boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
  borderRadius: 8,
}

export default function ControlPanel({
  facsValues,
  eyeLook2D,
  wireframe,
  showBones,
  eyeLook,
  focusLock,
  boneDebug,
  fov,
  onFacsValues,
  onEyeLook2D,
  onWireframe,
  onShowBones,
  onEyeLook,
  onFocusLock,
  onFov,
}: Props) {
  const [detailGroup, setDetailGroup] = useState<FacsGroup | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [collapsedWidth, setCollapsedWidth] = useState(980)
  const [pos, setPos] = useState({ x: 16, y: 16 })
  const [size, setSize] = useState({ w: 0, h: 0 })       // 0 = auto (use CSS defaults)

  const dragState = useRef<{ startX: number; startY: number; startPX: number; startPY: number } | null>(null)
  const resizeState = useRef<{ startX: number; startY: number; startW: number; startH: number; panelW: number; panelH: number } | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

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

  // ── global pointermove/up on window so fast drags never escape ────────────
  useEffect(() => {
    const onMove = (e: globalThis.PointerEvent) => {
      if (dragState.current) {
        const { startX, startY, startPX, startPY } = dragState.current
        // write directly to DOM — no React re-render per frame
        if (panelRef.current) {
          panelRef.current.style.left = `${startPX + (e.clientX - startX)}px`
          panelRef.current.style.top = `${startPY + (e.clientY - startY)}px`
          panelRef.current.style.transform = 'none'
          panelRef.current.style.transition = 'none'
        }
      }
      if (resizeState.current) {
        const { startX, startY, startW, startH } = resizeState.current
        const nw = Math.max(720, Math.min(window.innerWidth - 32, startW + (e.clientX - startX)))
        const nh = Math.max(520, Math.min(window.innerHeight - 32, startH + (e.clientY - startY)))
        if (panelRef.current) {
          panelRef.current.style.width = `${nw}px`
          panelRef.current.style.height = `${nh}px`
        }
      }
    }
    const onUp = (e: globalThis.PointerEvent) => {
      if (dragState.current && panelRef.current) {
        // commit final position to React state so subsequent renders are correct
        const { startX, startY, startPX, startPY } = dragState.current
        setPos({ x: startPX + (e.clientX - startX), y: startPY + (e.clientY - startY) })
      }
      if (resizeState.current && panelRef.current) {
        const { startX, startY, startW, startH } = resizeState.current
        const nw = Math.max(720, Math.min(window.innerWidth - 32, startW + (e.clientX - startX)))
        const nh = Math.max(520, Math.min(window.innerHeight - 32, startH + (e.clientY - startY)))
        setSize({ w: nw, h: nh })
        setCollapsedWidth(nw)
      }
      dragState.current = null
      resizeState.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [])

  // ── drag handlers (header) ─────────────────────────────────────────────────
  const onHeaderPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    const rect = panelRef.current?.getBoundingClientRect()
    const currentTop = rect ? rect.top : 0
    const currentLeft = rect ? rect.left : pos.x
    dragState.current = { startX: e.clientX, startY: e.clientY, startPX: currentLeft, startPY: currentTop }
  }

  // ── resize handlers (bottom-right corner) ─────────────────────────────────
  const onResizePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    resizeState.current = {
      startX: e.clientX, startY: e.clientY,
      startW: rect.width, startH: rect.height,
      panelW: rect.width, panelH: rect.height,
    }
  }

  const panelStyle: CSSProperties = {
    position: 'fixed',
    left: collapsed ? -(collapsedWidth + 16) : pos.x,
    top: pos.y < 0 ? '50%' : pos.y,
    transform: pos.y < 0 ? 'translateY(-50%)' : 'none',
    transition: 'left 0.28s cubic-bezier(0.4,0,0.2,1)',
    pointerEvents: 'auto',
    userSelect: 'none',
    display: 'flex',
    flexDirection: 'column',
    width: size.w || 'min(980px, calc(100vw - 32px))',
    height: size.h || 'min(820px, calc(100vh - 32px))',
    minWidth: 'min(720px, calc(100vw - 32px))',
    minHeight: 'min(520px, calc(100vh - 32px))',
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 32px)',
    ...panel,
    overflow: 'hidden',
    zIndex: 11,
  }

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10 }}>

      {/* ── Collapse tab (visible when panel is hidden) ────────────────────── */}
      <div
        onClick={() => setCollapsed(false)}
        role="button"
        tabIndex={collapsed ? 0 : -1}
        aria-label="Open FACS panel"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setCollapsed(false)
          }
        }}
        style={{
          position: 'fixed',
          left: collapsed ? 0 : -48,
          top: '50%',
          transform: 'translateY(-50%)',
          transition: 'left 0.28s cubic-bezier(0.4,0,0.2,1)',
          pointerEvents: collapsed ? 'auto' : 'none',
          ...panel,
          borderRadius: '0 6px 6px 0',
          padding: '12px 8px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          zIndex: 12,
        }}
      >
        <span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.4)', fontFamily: "'Courier New', monospace", writingMode: 'vertical-rl', letterSpacing: '0.1em' }}>FACS</span>
        <span style={{ fontSize: 12, color: 'rgba(240,224,64,0.7)' }}>▶</span>
      </div>

      {/* ── Main face rig panel ─────────────────────────────────────────────── */}
      <div ref={panelRef} style={panelStyle}>
        {/* Header — drag handle */}
        <div
          onPointerDown={onHeaderPointerDown}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 14px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            flexShrink: 0,
            cursor: 'grab',
          }}
        >
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
            color: 'rgba(255,255,255,0.45)', fontFamily: "'Courier New', monospace",
          }}>
            FACS RIG
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, color: 'rgba(232,224,32,0.6)', fontFamily: 'monospace' }}>
              {activeCount > 0 ? `${activeCount} ACTIVE` : 'NEUTRAL'}
            </span>
            <button
              onClick={() => { if (panelRef.current) setCollapsedWidth(panelRef.current.getBoundingClientRect().width); setCollapsed(true) }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'rgba(255,255,255,0.3)', fontSize: 12, padding: '0 2px', lineHeight: 1,
              }}
              aria-label="Collapse FACS panel"
              title="Collapse panel"
            >◀</button>
          </div>
        </div>

          {/* Face overlay — fills available height */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', justifyContent: 'center', padding: '8px 12px 6px', overflow: 'hidden' }}>
            <FaceOverlaySized facsValues={facsValues} eyeLook2D={eyeLook2D} onChange={setControl} onEyeLook2D={onEyeLook2D} />
          </div>

          {/* Preset strip */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              padding: '8px 12px',
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
              gap: 6,
              padding: '8px 12px',
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
            <Chip onClick={() => setShowSettings((v) => !v)} active={showSettings} ariaLabel="Toggle settings">⚙</Chip>
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

        {/* Resize handle — bottom-right corner */}
        <div
          onPointerDown={onResizePointerDown}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 18,
            height: 18,
            cursor: 'nwse-resize',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-end',
            padding: '3px 3px',
          }}
        >
          <svg width={10} height={10} style={{ opacity: 0.3 }}>
            <line x1={10} y1={0} x2={0} y2={10} stroke="white" strokeWidth={1.5} strokeLinecap="round" />
            <line x1={10} y1={4} x2={4} y2={10} stroke="white" strokeWidth={1.5} strokeLinecap="round" />
            <line x1={10} y1={8} x2={8} y2={10} stroke="white" strokeWidth={1.5} strokeLinecap="round" />
          </svg>
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

// ── Sized wrapper — two panels side by side, 920:700 total ratio ─────────────
function FaceOverlaySized({ facsValues, eyeLook2D, onChange, onEyeLook2D }: { facsValues: FacsValues; eyeLook2D: EyeLookValues; onChange: (id: string, v: number) => void; onEyeLook2D: (v: EyeLookValues) => void }) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      aspectRatio: '920 / 700',
      minHeight: 0,
    }}>
      <FaceOverlay facsValues={facsValues} eyeLook2D={eyeLook2D} onChange={onChange} onEyeLook2D={onEyeLook2D} />
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
