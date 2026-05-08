import {
  useMemo,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { type BoneDebug } from './HumanModel'
import {
  createFacsPresetValues,
  createNeutralFacsValues,
  FACS_CONTROLS,
  FACS_GROUPS,
  FACS_PRESETS,
  FACS_VALUE_MAX,
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

const panelStyle = {
  background: 'rgba(9, 10, 13, 0.82)',
  backdropFilter: 'blur(22px)',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 18px 54px rgba(0,0,0,0.48)',
  width: 392,
  maxWidth: 'calc(100vw - 32px)',
} satisfies CSSProperties

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
  const [collapsed, setCollapsed] = useState(false)
  const activeCount = useMemo(
    () => FACS_CONTROLS.filter((control) => (facsValues[control.id] ?? 0) > 0.001).length,
    [facsValues],
  )

  const setControlValue = (id: string, value: number) => {
    onFacsValues((current) => ({ ...current, [id]: value }))
  }

  const resetGroup = (group: FacsGroup) => {
    onFacsValues((current) => {
      const next = { ...current }
      for (const control of FACS_CONTROLS) {
        if (control.group === group) next[control.id] = 0
      }
      return next
    })
  }

  return (
    <div className="fixed bottom-4 right-4 z-10 sm:bottom-6 sm:right-6" style={{ userSelect: 'none' }}>
      <div className="overflow-hidden rounded-lg" style={panelStyle}>
        <button
          className="flex w-full cursor-pointer items-center justify-between px-4 py-3"
          onClick={() => setCollapsed((value) => !value)}
          style={{ background: 'transparent', border: 'none', color: 'inherit' }}
        >
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.52)' }}>
              FACS Rig
            </span>
            <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.28)' }}>
              {activeCount} active
            </span>
          </div>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            style={{
              opacity: 0.42,
              transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          >
            <path d="M2 4l4 4 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {!collapsed && (
          <div className="flex max-h-[calc(100vh-112px)] min-h-0 flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-y border-white/[0.06] px-4 py-3">
              <button
                onClick={() => onFacsValues(createNeutralFacsValues())}
                className="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                }}
              >
                Reset All
              </button>
              <SliderReadout label="FOV" value={`${fov}°`} />
              <input
                type="range"
                min={20}
                max={90}
                step={1}
                value={fov}
                onChange={(event) => onFov(parseInt(event.target.value))}
                className="range-slider"
                aria-label="Field of View"
              />
            </div>

            <div className="facs-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
              {FACS_GROUPS.map((group) => (
                <section key={group} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label>{group}</Label>
                    <button
                      onClick={() => resetGroup(group)}
                      className="rounded-md px-2 py-1 text-[11px] font-medium"
                      style={{
                        background: 'rgba(255,255,255,0.045)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        color: 'rgba(255,255,255,0.38)',
                        cursor: 'pointer',
                      }}
                    >
                      Reset
                    </button>
                  </div>

                  <div className="flex flex-col gap-2">
                    {FACS_CONTROLS.filter((control) => control.group === group).map((control) => (
                      <FacsSlider
                        key={control.id}
                        au={control.au}
                        label={control.label}
                        max={control.max ?? FACS_VALUE_MAX}
                        side={control.side}
                        value={facsValues[control.id] ?? 0}
                        onChange={(value) => setControlValue(control.id, value)}
                      />
                    ))}
                  </div>
                </section>
              ))}

              <section className="flex flex-col gap-2">
                <Label>Viewport</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Toggle active={wireframe} onClick={() => onWireframe(!wireframe)}>
                    Wireframe
                  </Toggle>
                  <Toggle active={showBones} onClick={() => onShowBones(!showBones)}>
                    Bones
                  </Toggle>
                  <Toggle active={eyeLook} onClick={() => onEyeLook(!eyeLook)}>
                    Eye Look
                  </Toggle>
                  <Toggle active={focusLock} onClick={() => onFocusLock(!focusLock)}>
                    Focus Lock
                  </Toggle>
                </div>
              </section>

              {showBones && (
                <section
                  className="rounded-lg p-3 text-xs"
                  style={{
                    background: 'rgba(255,255,255,0.045)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    color: 'rgba(255,255,255,0.55)',
                  }}
                >
                  <Label>Selected Bone</Label>
                  {boneDebug ? (
                    <div className="mt-2 flex flex-col gap-1 font-mono leading-relaxed">
                      <span style={{ color: 'rgba(255,255,255,0.85)' }}>{boneDebug.name}</span>
                      <DebugLine label="pos" value={boneDebug.position} />
                      <DebugLine label="rest" value={boneDebug.restPosition} />
                      <DebugLine label="delta" value={boneDebug.deltaPosition} />
                      <DebugLine label="rot" value={boneDebug.rotation} />
                      <DebugLine label="drot" value={boneDebug.deltaRotation} />
                    </div>
                  ) : (
                    <div className="mt-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      Click a bone handle
                    </div>
                  )}
                </section>
              )}
            </div>

            <div className="border-t border-white/[0.06] px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <Label>Presets</Label>
                <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  editable starting points
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {FACS_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => onFacsValues(createFacsPresetValues(preset.values))}
                    className="rounded-md px-2 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      background: 'rgba(255,255,255,0.055)',
                      border: '1px solid rgba(255,255,255,0.07)',
                      color: 'rgba(255,255,255,0.58)',
                      cursor: 'pointer',
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FacsSlider({
  au,
  label,
  max,
  side,
  value,
  onChange,
}: {
  au: string
  label: string
  max: number
  side: FacsSide
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div
      className="rounded-lg px-3 py-2"
      style={{
        background: value > 0 ? 'rgba(71, 132, 152, 0.18)' : 'rgba(255,255,255,0.035)',
        border: value > 0 ? '1px solid rgba(104, 190, 210, 0.28)' : '1px solid rgba(255,255,255,0.055)',
      }}
    >
      <div className="mb-1.5 grid grid-cols-[44px_1fr_32px_42px] items-center gap-2">
        <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'rgba(126, 213, 226, 0.88)' }}>
          {au}
        </span>
        <span className="truncate text-xs font-medium" style={{ color: 'rgba(255,255,255,0.74)' }}>
          {label}
        </span>
        <SideBadge side={side} />
        <span className="text-right text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.42)' }}>
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={0.01}
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        className="range-slider facs-range"
        aria-label={`${au} ${label}`}
      />
    </div>
  )
}

function SideBadge({ side }: { side: FacsSide }) {
  return (
    <span
      className="rounded-sm py-0.5 text-center text-[10px] font-semibold"
      style={{
        background: 'rgba(255,255,255,0.07)',
        color: 'rgba(255,255,255,0.42)',
      }}
    >
      {side}
    </span>
  )
}

function SliderReadout({ label, value }: { label: string; value: string }) {
  return (
    <div className="ml-auto flex min-w-16 items-baseline justify-end gap-1">
      <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.32)' }}>
        {label}
      </span>
      <span className="text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.54)' }}>
        {value}
      </span>
    </div>
  )
}

function DebugLine({ label, value }: { label: string; value: [number, number, number] }) {
  return (
    <span>
      <span style={{ color: 'rgba(255,255,255,0.35)' }}>{label}</span>{' '}
      [{value.map((n) => n.toFixed(5)).join(', ')}]
    </span>
  )
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.38)' }}>
      {children}
    </span>
  )
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md py-2 text-xs font-medium transition-colors"
      style={{
        background: active ? 'rgba(71, 132, 152, 0.26)' : 'rgba(255,255,255,0.045)',
        border: active ? '1px solid rgba(104, 190, 210, 0.45)' : '1px solid rgba(255,255,255,0.06)',
        color: active ? 'rgba(184, 244, 250, 0.92)' : 'rgba(255,255,255,0.44)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}
