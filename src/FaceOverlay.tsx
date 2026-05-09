/**
 * MetaHuman-style facial rig control overlay.
 *
 * Layout: large SVG face silhouette with controls embedded at anatomical positions.
 * - XY pads for bilateral eye/brow controls (left pad = left side, right = right)
 * - Vertical sliders for single-axis controls
 * - 2D pads for jaw direction
 * Drag interactions: pointer capture on each control element.
 */

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { FACS_CONTROLS, FACS_VALUE_MAX, type FacsValues } from './facs'

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  face:       '#1a1a1a',
  outline:    '#555',
  feature:    '#333',
  featureHi:  '#444',
  dot:        '#e8e020',
  dotActive:  '#fff176',
  dotGlow:    'rgba(232,224,32,0.35)',
  track:      '#2a2a2a',
  trackBdr:   '#3a3a3a',
  label:      'rgba(255,255,255,0.55)',
  labelHi:    'rgba(255,255,255,0.9)',
  value:      'rgba(232,224,32,0.9)',
}

// ── Canvas dimensions ────────────────────────────────────────────────────────
const W = 460
const H = 580
const CX = W / 2

// ── Types ────────────────────────────────────────────────────────────────────
type Vec2 = { x: number; y: number }

type SliderDef = {
  kind: 'slider'
  id: string           // facs control id
  label: string
  x: number            // centre x in SVG coords (offset from CX)
  y: number            // centre y
  length: number       // track length in px
  axis: 'v' | 'h'     // vertical or horizontal
}

type XYPadDef = {
  kind: 'xypad'
  idX: string          // horizontal facs id (positive = right)
  idY: string          // vertical facs id (positive = up)
  idXNeg?: string      // if horizontal has a separate negative control
  idYNeg?: string
  label: string
  x: number
  y: number
  w: number
  h: number
}

type ControlDef = SliderDef | XYPadDef

// ── Control layout ────────────────────────────────────────────────────────────
// All positions are relative to (CX, 0). x=0 → face centre.
const CONTROLS: ControlDef[] = [
  // ── Brows ─────────────────────────────────────────────────────────────────
  // Both brows share bilateral controls — XY pad:
  // Y+ = raise (inner or outer depending on side), Y- = lower, X = compress
  {
    kind: 'xypad',
    idX: 'au02_outer_brow_raiser',   // X+ = outer arch up
    idXNeg: 'brow_compress',          // X- = compress/furrow
    idY: 'au01_inner_brow_raiser',    // Y+ = inner up
    idYNeg: 'au04_brow_lowerer',      // Y- = lower
    label: 'BROW RAISE',
    x: 0, y: 108, w: 96, h: 52,
  },

  // ── Eyes ──────────────────────────────────────────────────────────────────
  // Left eye: Y = open/wide vs close, X = tighten vs wide
  {
    kind: 'xypad',
    idX: 'au05_upper_lid_raiser',    // X+ = wide open
    idXNeg: 'au07_lid_tightener',    // X- = squint
    idY: 'au05_upper_lid_raiser',    // Y+ = wide
    idYNeg: 'au43_eye_closure',      // Y- = close
    label: 'EYE L',
    x: 72, y: 178, w: 56, h: 44,
  },
  // Right eye — same bilateral controls (both eyes move together)
  {
    kind: 'xypad',
    idX: 'au07_lid_tightener',       // X+ = squint
    idXNeg: 'au05_upper_lid_raiser', // X- = wide
    idY: 'au05_upper_lid_raiser',
    idYNeg: 'au43_eye_closure',
    label: 'EYE R',
    x: -72, y: 178, w: 56, h: 44,
  },

  // ── Cheek / Midface ───────────────────────────────────────────────────────
  {
    kind: 'slider',
    id: 'au06_cheek_raiser',
    label: 'CHEEK',
    x: 118, y: 220, length: 52, axis: 'v',
  },
  {
    kind: 'slider',
    id: 'au09_nose_wrinkler',
    label: 'NOSE WRK',
    x: 14, y: 252, length: 44, axis: 'h',
  },
  {
    kind: 'slider',
    id: 'au38_nostril_dilator',
    label: 'NOSTRIL',
    x: -14, y: 268, length: 44, axis: 'h',
  },

  // ── Mouth corners ─────────────────────────────────────────────────────────
  // Left corner: XY — X = puller(smile)/depressor, Y = upper-lip-raiser
  {
    kind: 'xypad',
    idX: 'au12_lip_corner_puller_l',
    idXNeg: 'au15_lip_corner_depressor_l',
    idY: 'au10_upper_lip_raiser_l',
    idYNeg: 'snarl_l',
    label: 'CORNER L',
    x: 90, y: 330, w: 60, h: 52,
  },
  // Right corner
  {
    kind: 'xypad',
    idX: 'au15_lip_corner_depressor_r',
    idXNeg: 'au12_lip_corner_puller_r',
    idY: 'au10_upper_lip_raiser_r',
    idYNeg: 'snarl_r',
    label: 'CORNER R',
    x: -90, y: 330, w: 60, h: 52,
  },

  // ── Lips centre column ────────────────────────────────────────────────────
  // Pucker / Stretch: horizontal slider
  {
    kind: 'slider',
    id: 'au18_lip_pucker',
    label: 'PUCKER',
    x: 0, y: 302, length: 56, axis: 'h',
  },
  {
    kind: 'slider',
    id: 'au20_lip_stretcher',
    label: 'STRETCH',
    x: 0, y: 318, length: 56, axis: 'h',
  },
  {
    kind: 'slider',
    id: 'au23_lip_tightener',
    label: 'TIGHTEN',
    x: 0, y: 334, length: 56, axis: 'h',
  },
  {
    kind: 'slider',
    id: 'au24_lip_pressor',
    label: 'PRESS',
    x: 0, y: 350, length: 56, axis: 'h',
  },
  {
    kind: 'slider',
    id: 'au25_lips_part',
    label: 'PART',
    x: 0, y: 366, length: 56, axis: 'h',
  },
  {
    kind: 'slider',
    id: 'au14_dimpler',
    label: 'DIMPLE',
    x: 0, y: 382, length: 56, axis: 'h',
  },
  {
    kind: 'slider',
    id: 'au16_lower_lip_depressor',
    label: 'LIP DOWN',
    x: 0, y: 398, length: 56, axis: 'h',
  },
  {
    kind: 'slider',
    id: 'au17_chin_raiser',
    label: 'CHIN',
    x: 0, y: 414, length: 56, axis: 'h',
  },

  // ── Jaw ───────────────────────────────────────────────────────────────────
  // 2D pad: X = left/right, Y = open/forward
  {
    kind: 'xypad',
    idX: 'jaw_left',
    idXNeg: 'jaw_right',
    idY: 'au26_jaw_drop',
    idYNeg: 'jaw_forward',
    label: 'JAW',
    x: 0, y: 476, w: 72, h: 60,
  },
  {
    kind: 'slider',
    id: 'au27_mouth_stretch',
    label: 'MOUTH WIDE',
    x: 90, y: 480, length: 52, axis: 'v',
  },
  {
    kind: 'slider',
    id: 'glare',
    label: 'GLARE',
    x: -90, y: 480, length: 52, axis: 'v',
  },

  // ── Performance ───────────────────────────────────────────────────────────
  {
    kind: 'slider',
    id: 'scowl',
    label: 'SCOWL',
    x: 130, y: 152, length: 44, axis: 'v',
  },
]

// ── Drag state ───────────────────────────────────────────────────────────────
type SliderDrag = {
  type: 'slider'
  id: string
  axis: 'v' | 'h'
  start: Vec2
  startVal: number
  max: number
  length: number
}

type XYDrag = {
  type: 'xypad'
  idX: string; idXNeg?: string
  idY: string; idYNeg?: string
  start: Vec2
  startVals: Record<string, number>
  w: number; h: number
}

type DragState = SliderDrag | XYDrag

// ── Main component ────────────────────────────────────────────────────────────
type Props = {
  facsValues: FacsValues
  onChange: (id: string, value: number) => void
}

export default function FaceOverlay({ facsValues, onChange }: Props) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const val = (id: string) => facsValues[id] ?? 0
  const max = (id: string) => FACS_CONTROLS.find((c) => c.id === id)?.max ?? FACS_VALUE_MAX

  // ── Pointer handlers ────────────────────────────────────────────────────────
  const startSlider = (
    e: ReactPointerEvent,
    def: SliderDef,
  ) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      type: 'slider',
      id: def.id,
      axis: def.axis,
      start: { x: e.clientX, y: e.clientY },
      startVal: val(def.id),
      max: max(def.id),
      length: def.length,
    }
    setActiveKey(def.id)
  }

  const startXYPad = (
    e: ReactPointerEvent,
    def: XYPadDef,
  ) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      type: 'xypad',
      idX: def.idX, idXNeg: def.idXNeg,
      idY: def.idY, idYNeg: def.idYNeg,
      start: { x: e.clientX, y: e.clientY },
      startVals: {
        [def.idX]: val(def.idX),
        ...(def.idXNeg ? { [def.idXNeg]: val(def.idXNeg) } : {}),
        [def.idY]: val(def.idY),
        ...(def.idYNeg ? { [def.idYNeg]: val(def.idYNeg) } : {}),
      },
      w: def.w,
      h: def.h,
    }
    setActiveKey(`${def.idX}:${def.idY}`)
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current
    if (!d) return

    if (d.type === 'slider') {
      const travel = d.axis === 'v'
        ? (d.start.y - e.clientY)   // up = positive
        : (e.clientX - d.start.x)   // right = positive
      const norm = travel / d.length
      const newVal = Math.max(0, Math.min(d.max, d.startVal + norm * d.max))
      onChange(d.id, newVal)

    } else {
      const dx = e.clientX - d.start.x
      const dy = e.clientY - d.start.y // down = positive in screen space
      // Scale: full pad width/height = full value range
      const nx =  dx / (d.w * 0.5)  // -1..1
      const ny = -dy / (d.h * 0.5)  // -1..1, up = positive

      // X axis: positive drives idX, negative drives idXNeg
      const mx = max(d.idX)
      if (nx >= 0) {
        onChange(d.idX, Math.max(0, Math.min(mx, d.startVals[d.idX] + nx * mx)))
        if (d.idXNeg) onChange(d.idXNeg, 0)
      } else if (d.idXNeg) {
        const mxn = max(d.idXNeg)
        onChange(d.idXNeg, Math.max(0, Math.min(mxn, d.startVals[d.idXNeg] + (-nx) * mxn)))
        onChange(d.idX, 0)
      }

      // Y axis
      const my = max(d.idY)
      if (ny >= 0) {
        onChange(d.idY, Math.max(0, Math.min(my, d.startVals[d.idY] + ny * my)))
        if (d.idYNeg) onChange(d.idYNeg, 0)
      } else if (d.idYNeg) {
        const myn = max(d.idYNeg)
        onChange(d.idYNeg, Math.max(0, Math.min(myn, d.startVals[d.idYNeg] + (-ny) * myn)))
        onChange(d.idY, 0)
      }
    }
  }

  const onPointerUp = () => {
    dragRef.current = null
    setActiveKey(null)
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{ display: 'block', touchAction: 'none', cursor: activeKey ? 'crosshair' : 'default' }}
    >
      <FaceSilhouette />

      {CONTROLS.map((def) => {
        if (def.kind === 'slider') {
          const isActive = activeKey === def.id
          const v = val(def.id)
          const m = max(def.id)
          return (
            <SliderControl
              key={def.id}
              def={def}
              value={v}
              maxVal={m}
              isActive={isActive}
              onPointerDown={(e) => startSlider(e, def)}
            />
          )
        } else {
          const isActive = activeKey === `${def.idX}:${def.idY}`
          return (
            <XYPadControl
              key={`${def.idX}:${def.idY}:${def.label}`}
              def={def}
              vals={facsValues}
              isActive={isActive}
              onPointerDown={(e) => startXYPad(e, def)}
            />
          )
        }
      })}
    </svg>
  )
}

// ── Slider control ────────────────────────────────────────────────────────────
function SliderControl({
  def, value, maxVal, isActive, onPointerDown,
}: {
  def: SliderDef
  value: number
  maxVal: number
  isActive: boolean
  onPointerDown: (e: ReactPointerEvent) => void
}) {
  const cx = CX + def.x
  const cy = def.y
  const t = maxVal > 0 ? value / maxVal : 0
  const vert = def.axis === 'v'
  const half = def.length / 2

  // Track line endpoints
  const x1 = vert ? cx : cx - half
  const y1 = vert ? cy + half : cy
  const x2 = vert ? cx : cx + half
  const y2 = vert ? cy - half : cy

  // Thumb position
  const tx = vert ? cx : cx - half + t * def.length
  const ty = vert ? cy + half - t * def.length : cy

  const labelX = vert ? cx : cx
  const labelY = vert ? cy + half + 14 : cy + 14

  return (
    <g
      onPointerDown={onPointerDown}
      style={{ cursor: vert ? 'ns-resize' : 'ew-resize' }}
    >
      {/* Hit area */}
      <rect
        x={vert ? cx - 12 : cx - half - 8}
        y={vert ? cy - half - 8 : cy - 12}
        width={vert ? 24 : def.length + 16}
        height={vert ? def.length + 16 : 24}
        fill="transparent"
      />
      {/* Track */}
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.trackBdr} strokeWidth={2} strokeLinecap="round" />
      {/* Fill */}
      <line
        x1={vert ? cx : cx - half}
        y1={vert ? cy + half : cy}
        x2={tx} y2={ty}
        stroke={isActive || value > 0.01 ? C.dot : C.feature}
        strokeWidth={3}
        strokeLinecap="round"
        opacity={isActive ? 1 : 0.7}
      />
      {/* Thumb dot */}
      <circle
        cx={tx} cy={ty}
        r={isActive ? 7 : 5}
        fill={isActive ? C.dotActive : C.dot}
        opacity={isActive ? 1 : value > 0.01 ? 0.9 : 0.5}
      />
      {isActive && <circle cx={tx} cy={ty} r={11} fill={C.dotGlow} />}
      {/* Label */}
      <text
        x={labelX} y={labelY}
        textAnchor="middle"
        fontSize={8}
        fontFamily="'Courier New', monospace"
        fontWeight="bold"
        letterSpacing={0.8}
        fill={isActive ? C.labelHi : C.label}
      >
        {def.label}
      </text>
      {/* Value readout when active */}
      {isActive && (
        <text
          x={labelX} y={labelY + 10}
          textAnchor="middle"
          fontSize={7}
          fontFamily="'Courier New', monospace"
          fill={C.value}
        >
          {value.toFixed(2)}
        </text>
      )}
    </g>
  )
}

// ── XY Pad control ────────────────────────────────────────────────────────────
function XYPadControl({
  def, vals, isActive, onPointerDown,
}: {
  def: XYPadDef
  vals: FacsValues
  isActive: boolean
  onPointerDown: (e: ReactPointerEvent) => void
}) {
  const cx = CX + def.x
  const cy = def.y
  const hw = def.w / 2
  const hh = def.h / 2

  const getVal = (id: string) => vals[id] ?? 0
  const getMax = (id: string) => FACS_CONTROLS.find((c) => c.id === id)?.max ?? FACS_VALUE_MAX

  // Compute dot position from current values
  const vX = getVal(def.idX)
  const vXn = def.idXNeg ? getVal(def.idXNeg) : 0
  const vY = getVal(def.idY)
  const vYn = def.idYNeg ? getVal(def.idYNeg) : 0
  const mX = getMax(def.idX)
  const mY = getMax(def.idY)

  const normX = (vX / mX) - (vXn / mX)   // -1..1
  const normY = (vY / mY) - (vYn / mY)   // -1..1

  const dotX = cx + normX * hw
  const dotY = cy - normY * hh            // screen Y inverted

  return (
    <g onPointerDown={onPointerDown} style={{ cursor: 'crosshair' }}>
      {/* Pad background */}
      <rect
        x={cx - hw} y={cy - hh}
        width={def.w} height={def.h}
        fill={isActive ? 'rgba(232,224,32,0.07)' : C.track}
        stroke={isActive ? C.dot : C.trackBdr}
        strokeWidth={isActive ? 1.5 : 1}
        rx={3}
      />
      {/* Centre crosshair */}
      <line x1={cx - hw + 4} y1={cy} x2={cx + hw - 4} y2={cy} stroke={C.featureHi} strokeWidth={0.5} />
      <line x1={cx} y1={cy - hh + 4} x2={cx} y2={cy + hh - 4} stroke={C.featureHi} strokeWidth={0.5} />

      {/* Glow ring */}
      {(isActive || Math.abs(normX) > 0.02 || Math.abs(normY) > 0.02) && (
        <circle cx={dotX} cy={dotY} r={10} fill={C.dotGlow} />
      )}
      {/* Dot */}
      <circle
        cx={dotX} cy={dotY}
        r={isActive ? 7 : 5}
        fill={isActive ? C.dotActive : C.dot}
        opacity={isActive ? 1 : (Math.abs(normX) > 0.02 || Math.abs(normY) > 0.02) ? 0.9 : 0.45}
      />
      {/* Lines from dot to edges when active */}
      {isActive && (
        <>
          <line x1={dotX} y1={cy - hh} x2={dotX} y2={dotY} stroke={C.dot} strokeWidth={0.8} opacity={0.4} />
          <line x1={dotX} y1={cy + hh} x2={dotX} y2={dotY} stroke={C.dot} strokeWidth={0.8} opacity={0.4} />
          <line x1={cx - hw} y1={dotY} x2={dotX} y2={dotY} stroke={C.dot} strokeWidth={0.8} opacity={0.4} />
          <line x1={cx + hw} y1={dotY} x2={dotX} y2={dotY} stroke={C.dot} strokeWidth={0.8} opacity={0.4} />
        </>
      )}
      {/* Label */}
      <text
        x={cx} y={cy + hh + 13}
        textAnchor="middle"
        fontSize={8}
        fontFamily="'Courier New', monospace"
        fontWeight="bold"
        letterSpacing={0.8}
        fill={isActive ? C.labelHi : C.label}
      >
        {def.label}
      </text>
      {/* Value readout when active */}
      {isActive && (
        <text
          x={cx} y={cy + hh + 23}
          textAnchor="middle"
          fontSize={7}
          fontFamily="'Courier New', monospace"
          fill={C.value}
        >
          {normX.toFixed(2)}, {normY.toFixed(2)}
        </text>
      )}
    </g>
  )
}

// ── Face silhouette ───────────────────────────────────────────────────────────
function FaceSilhouette() {
  return (
    <g>
      {/* Head shape */}
      <ellipse cx={CX} cy={260} rx={155} ry={195}
        fill={C.face} stroke={C.outline} strokeWidth={2} />

      {/* Neck */}
      <rect x={CX - 48} y={440} width={96} height={80}
        fill={C.face} />
      <line x1={CX - 48} y1={440} x2={CX - 60} y2={520}
        stroke={C.outline} strokeWidth={2} />
      <line x1={CX + 48} y1={440} x2={CX + 60} y2={520}
        stroke={C.outline} strokeWidth={2} />

      {/* Ears */}
      <ellipse cx={CX - 158} cy={238} rx={14} ry={28}
        fill={C.face} stroke={C.outline} strokeWidth={1.5} />
      <ellipse cx={CX + 158} cy={238} rx={14} ry={28}
        fill={C.face} stroke={C.outline} strokeWidth={1.5} />

      {/* Brow ridges */}
      <path d={`M ${CX+30} 118 Q ${CX+62} 106 ${CX+96} 118`}
        fill="none" stroke={C.featureHi} strokeWidth={1.5} />
      <path d={`M ${CX-30} 118 Q ${CX-62} 106 ${CX-96} 118`}
        fill="none" stroke={C.featureHi} strokeWidth={1.5} />

      {/* Eye sockets */}
      <ellipse cx={CX + 70} cy={168} rx={44} ry={28}
        fill="rgba(0,0,0,0.25)" stroke={C.featureHi} strokeWidth={1} />
      <ellipse cx={CX - 70} cy={168} rx={44} ry={28}
        fill="rgba(0,0,0,0.25)" stroke={C.featureHi} strokeWidth={1} />

      {/* Nose bridge lines */}
      <path d={`M ${CX+12} 130 L ${CX+10} 220`}
        fill="none" stroke={C.feature} strokeWidth={1} />
      <path d={`M ${CX-12} 130 L ${CX-10} 220`}
        fill="none" stroke={C.feature} strokeWidth={1} />

      {/* Nose base */}
      <path d={`M ${CX-30} 248 Q ${CX-18} 258 ${CX} 255 Q ${CX+18} 258 ${CX+30} 248`}
        fill="none" stroke={C.featureHi} strokeWidth={1.5} />
      {/* Nostrils */}
      <ellipse cx={CX - 18} cy={252} rx={9} ry={6}
        fill="rgba(0,0,0,0.4)" stroke={C.feature} strokeWidth={1} />
      <ellipse cx={CX + 18} cy={252} rx={9} ry={6}
        fill="rgba(0,0,0,0.4)" stroke={C.feature} strokeWidth={1} />

      {/* Philtrum */}
      <path d={`M ${CX-8} 258 L ${CX-4} 272 L ${CX+4} 272 L ${CX+8} 258`}
        fill="none" stroke={C.feature} strokeWidth={1} />

      {/* Lip outline */}
      <path d={`
        M ${CX-52} 288
        Q ${CX-30} 278 ${CX-10} 282
        Q ${CX} 284 ${CX+10} 282
        Q ${CX+30} 278 ${CX+52} 288
        Q ${CX+30} 300 ${CX} 306
        Q ${CX-30} 300 ${CX-52} 288 Z
      `} fill="rgba(0,0,0,0.3)" stroke={C.featureHi} strokeWidth={1.5} />
      {/* Lip centre line */}
      <path d={`M ${CX-52} 288 Q ${CX} 292 ${CX+52} 288`}
        fill="none" stroke={C.feature} strokeWidth={0.8} />

      {/* Chin crease */}
      <path d={`M ${CX-28} 360 Q ${CX} 368 ${CX+28} 360`}
        fill="none" stroke={C.feature} strokeWidth={1} />

      {/* Cheekbone lines */}
      <path d={`M ${CX+52} 200 Q ${CX+90} 210 ${CX+118} 240`}
        fill="none" stroke={C.feature} strokeWidth={0.8} opacity={0.6} />
      <path d={`M ${CX-52} 200 Q ${CX-90} 210 ${CX-118} 240`}
        fill="none" stroke={C.feature} strokeWidth={0.8} opacity={0.6} />
    </g>
  )
}
