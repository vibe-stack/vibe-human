import {
  type ReactNode,
  useMemo,
  memo,
  useRef,
  useCallback,
} from 'react'

import { useSnapshot } from 'valtio'
import { Button } from '@/components/ui/button'
import { SliderComfortable } from '@/components/ui/slider'
import { Elevated } from '@/lib/elevated'
import {
  appState,
  setModelingMode,
  setModelingSymmetric,
  setModelingValues,
  setSelectedModelingHandleId,
} from './appState'
import {
  clampModelingValue,
  createNeutralModelingValues,
  getModelingControlById,
  getModelingHandleById,
  getModelingHandles,
  MODELING_CONTROLS,
  type ModelingValues,
} from './characterModeling'

const labelStyle: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'rgba(255,255,255,0.36)',
  fontFamily: "'Courier New', monospace",
}

export default function CharacterModelingPanel() {
  const { modelingValues: values, modelingMode: mode, modelingSymmetric: symmetric, selectedModelingHandleId: selectedHandleId } = useSnapshot(appState)
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
  const bodyControls = useMemo(
    () => MODELING_CONTROLS.filter((control) => control.tab === 'Body'),
    [],
  )

  const setControl = (id: string, value: number) => {
    setModelingValues((prev) => ({ ...prev, [id]: clampModelingValue(id, value) }))
  }

  const resetAll = () => setModelingValues(createNeutralModelingValues())

  const resetSelected = () => {
    if (!selectedHandle) return
    setModelingValues((prev) => {
      const next = { ...prev }
      for (const id of selectedHandle.controlIds) next[id] = 0
      return next
    })
  }

  const resetBody = () => {
    setModelingValues((prev) => {
      const next = { ...prev }
      for (const control of bodyControls) next[control.id] = 0
      return next
    })
  }

  const activeCount = MODELING_CONTROLS.filter(
    (control) => Math.abs(values[control.id] ?? 0) > 0.001,
  ).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', userSelect: 'none' }}>

      {/* Header */}
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
        <span style={{ fontSize: 9, color: 'rgba(125,211,252,0.68)', fontFamily: 'monospace' }}>
          {activeCount > 0 ? `${activeCount} ACTIVE` : 'NEUTRAL'}
        </span>
      </div>

      <div
        className="facs-scroll"
        style={{
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
        }}
      >
          <div className="grid grid-cols-2 gap-1.5">
            <Button variant={mode === 'transform' ? 'secondary' : 'ghost'} size="sm" className="w-full text-[10px]" onClick={() => setModelingMode('transform')}>
              Transform
            </Button>
            <Button variant={mode === 'sculpt' ? 'secondary' : 'ghost'} size="sm" className="w-full text-[10px]" onClick={() => setModelingMode('sculpt')}>
              Sculpt
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <Button variant={symmetric ? 'secondary' : 'ghost'} size="sm" className="w-full text-[10px]" onClick={() => setModelingSymmetric(true)}>
              Symmetric
            </Button>
            <Button variant={!symmetric ? 'secondary' : 'ghost'} size="sm" className="w-full text-[10px]" onClick={() => setModelingSymmetric(false)}>
              Single Side
            </Button>
          </div>

          <Elevated offset={1} className="rounded-lg p-2 grid gap-2" style={{ gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
            <div>
              <div style={labelStyle}>{mode.toUpperCase()} DOTS</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 3 }}>
                {handlesInMode.length} visible dots
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={resetAll}>Reset All</Button>
          </Elevated>

          <Elevated offset={1} className={`rounded-lg p-2.5 ${selectedControls.length ? 'ring-1 ring-sky-400/20' : ''}`}>
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
                onClear={() => setSelectedModelingHandleId(null)}
              />
            ) : (
              <div style={{ minHeight: 88, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
                <div style={labelStyle}>NO DOT SELECTED</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.48)', lineHeight: 1.45 }}>
                  Select a face control to edit its exact value here.
                </div>
              </div>
            )}
          </Elevated>

          {bodyControls.length > 0 && (
            <BodyGlobalSliders
              controls={bodyControls}
              values={values}
              onChange={setControl}
              onReset={resetBody}
            />
          )}

          {!symmetric && (
            <div style={{ fontSize: 10, lineHeight: 1.45, color: 'rgba(255,255,255,0.42)' }}>
              Current identity morphs are authored as symmetric keys, so single-side mode changes the selected
              handle workflow but still drives the available paired morph target.
            </div>
          )}
        </div>
    </div>
  )
}

function BodyGlobalSliders({
  controls,
  values,
  onChange,
  onReset,
}: {
  controls: NonNullable<ReturnType<typeof getModelingControlById>>[]
  values: ModelingValues
  onChange: (id: string, value: number) => void
  onReset: () => void
}) {
  const active = controls.some((control) => Math.abs(values[control.id] ?? 0) > 0.001)

  return (
    <Elevated offset={1} className={`rounded-lg p-2.5 ${active ? 'ring-1 ring-sky-400/15' : ''}`}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', marginBottom: 9 }}>
        <div>
          <div style={{ ...labelStyle, color: active ? 'rgba(125,211,252,0.86)' : 'rgba(255,255,255,0.45)' }}>
            BODY GLOBAL
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.46)', marginTop: 3 }}>
            {controls.length} sliders
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onReset}>Reset</Button>
      </div>

      <div className="flex flex-col gap-1.5">
        {controls.map((control) => (
          <AreaSlider
            key={control.id}
            control={control}
            primary={false}
            value={values[control.id] ?? 0}
            onChange={(value) => onChange(control.id, value)}
          />
        ))}
      </div>
    </Elevated>
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
        <Button variant="ghost" size="sm" onClick={onClear}>Close</Button>
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

      <Button variant="secondary" size="sm" className="w-full" onClick={onReset}>Reset Area</Button>
    </div>
  )
}

const AreaSlider = memo(function AreaSlider({
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
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const stableChange = useCallback((v: number) => onChangeRef.current(v), [])
  const positiveOnly = control.min >= 0

  return (
    <Elevated offset={1} className={`rounded-md p-1.5 ${primary ? 'ring-1 ring-sky-400/20' : ''}`}>
      <SliderComfortable
        variant="scrubber"
        label={`${control.label}${primary ? ' ★' : ''}`}
        value={value}
        min={control.min}
        max={control.max}
        step={0.01}
        onChange={stableChange}
        formatValue={(v) => {
          if (!positiveOnly && Math.abs(v) < 0.005) return 'Base'
          if (Math.abs(v - control.min) < 0.005) return control.negativeLabel
          if (Math.abs(v - control.max) < 0.005) return control.positiveLabel
          return v.toFixed(2)
        }}
      />
    </Elevated>
  )
}, (prev, next) =>
  prev.value === next.value &&
  prev.primary === next.primary &&
  prev.control === next.control)

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-[8px] font-bold tracking-wide font-mono bg-foreground/5 text-foreground/50">
      {children}
    </span>
  )
}
