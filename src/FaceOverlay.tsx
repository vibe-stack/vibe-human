import { useRef, useState, type KeyboardEvent as KE, type PointerEvent as PE } from 'react'
import { useSnapshot } from 'valtio'
import { appState, setEyeLook2D, setFacsValues } from './appState'
import { FACS_CONTROLS, FACS_VALUE_MAX, type FacsValues } from './facs'

// ── Palette ───────────────────────────────────────────────────────────────────
const DOT        = '#f0e040'
const DOT_ACTIVE = '#ffffff'
const DOT_GLOW   = 'rgba(240,224,64,0.3)'
const LINE       = 'rgba(240,224,64,0.38)'
const OUTLINE    = '#606060'
const FEATURE    = '#383838'
const FACE_FILL  = '#0d0d0d'
const LABEL      = 'rgba(255,255,255,0.62)'
const LABEL_HI   = '#ffffff'
const VAL_COLOR  = 'rgba(240,224,64,0.95)'
const FONT       = "'Courier New', monospace"

// ── SVG dimensions ─────────────────────────────────────────────────────────
// Main panel
const MW = 520
const MH = 700
const MCX = MW / 2

// Tweakers panel (same height, narrower)
const TW = 400
const TH = 700
const TCX = TW / 2

// ── Types ─────────────────────────────────────────────────────────────────────
type DotControl = {
  kind: 'dot'
  id: string
  label: string
  ax: number   // absolute SVG x
  ay: number   // absolute SVG y
  lx: number   // label direction unit x (-1..1)
  ly: number   // label direction unit y (-1..1)
  ll: number   // connector line length
}

type EyePad = {
  kind: 'eyepad'
  eye: 'L' | 'R'
  label: string
  ax: number
  ay: number
  w: number
  h: number
}

type FacsPad = {
  kind: 'facspad'
  idX: string; idXNeg?: string
  idY: string; idYNeg?: string
  label: string
  ax: number; ay: number
  w: number; h: number
}

type RigSlider = {
  kind: 'slider'
  id: string
  label: string
  ax: number
  ay: number
  length: number
  angle: number
  labelDx?: number
  labelDy?: number
  labelAnchor?: 'start' | 'middle' | 'end'
  fontSize?: number
}

type MainControl = DotControl | EyePad | FacsPad | RigSlider

// ── Main panel controls ────────────────────────────────────────────────────────
// This is intentionally an animator-facing control board rather than a literal
// ARKit list. Several controls are placed as semantic rig handles over the same
// underlying FACS channels.
const MAIN: MainControl[] = [
  // ── Forehead / brow board ─────────────────────────────────────────────────
  { kind:'slider', id:'au02_outer_brow_raiser_l', label:'OUTER', ax:178, ay:145, length:52, angle:-118, labelDx:-8, labelDy:-8, labelAnchor:'end' },
  { kind:'slider', id:'au01_inner_brow_raiser_l', label:'INNER', ax:226, ay:142, length:54, angle:-102, labelDx:-2, labelDy:-10, labelAnchor:'end' },
  { kind:'slider', id:'au01_inner_brow_raiser_r', label:'INNER', ax:294, ay:142, length:54, angle:-78, labelDx:2, labelDy:-10, labelAnchor:'start' },
  { kind:'slider', id:'au02_outer_brow_raiser_r', label:'OUTER', ax:342, ay:145, length:52, angle:-62, labelDx:8, labelDy:-8, labelAnchor:'start' },
  { kind:'slider', id:'brow_compress', label:'COMPRESS', ax:260, ay:154, length:42, angle:-90, labelDx:0, labelDy:-10 },
  { kind:'slider', id:'scowl', label:'SCOWL', ax:260, ay:190, length:38, angle:-90, labelDx:38, labelDy:-10, labelAnchor:'start' },

  { kind:'slider', id:'au04_brow_lowerer_l', label:'BROW DOWN', ax:206, ay:206, length:38, angle:-82, labelDx:-38, labelDy:-2, labelAnchor:'end' },
  { kind:'slider', id:'au04_brow_lowerer_r', label:'BROW DOWN', ax:314, ay:206, length:38, angle:-98, labelDx:38, labelDy:-2, labelAnchor:'start' },

  // ── Eye sockets — XY pads ─────────────────────────────────────────────────
  { kind:'eyepad', eye:'L', label:'EYE L', ax:184, ay:252, w:74, h:58 },
  { kind:'eyepad', eye:'R', label:'EYE R', ax:336, ay:252, w:74, h:58 },
  {
    kind:'facspad',
    idX:'brow_compress', idXNeg:'scowl',
    idY:'au09_nose_wrinkler', idYNeg:'au04_brow_lowerer_l',
    label:'NOSE ROOT',
    ax:260, ay:252, w:56, h:56,
  },

  // ── Eye lid controls ──────────────────────────────────────────────────────
  { kind:'slider', id:'au05_upper_lid_raiser_l', label:'LID', ax:124, ay:225, length:40, angle:-90, labelDx:-22, labelDy:-4, labelAnchor:'end' },
  { kind:'slider', id:'au07_lid_tightener_l', label:'SQUINT', ax:112, ay:260, length:38, angle:-90, labelDx:-18, labelDy:0, labelAnchor:'end' },
  { kind:'slider', id:'au43_eye_closure_l', label:'BLINK', ax:124, ay:294, length:40, angle:-90, labelDx:-20, labelDy:5, labelAnchor:'end' },
  { kind:'slider', id:'glare_l', label:'GLARE', ax:154, ay:316, length:34, angle:-135, labelDx:-22, labelDy:16, labelAnchor:'end' },
  { kind:'slider', id:'au05_upper_lid_raiser_r', label:'LID', ax:396, ay:225, length:40, angle:-90, labelDx:22, labelDy:-4, labelAnchor:'start' },
  { kind:'slider', id:'au07_lid_tightener_r', label:'SQUINT', ax:408, ay:260, length:38, angle:-90, labelDx:18, labelDy:0, labelAnchor:'start' },
  { kind:'slider', id:'au43_eye_closure_r', label:'BLINK', ax:396, ay:294, length:40, angle:-90, labelDx:20, labelDy:5, labelAnchor:'start' },
  { kind:'slider', id:'glare_r', label:'GLARE', ax:366, ay:316, length:34, angle:-45, labelDx:22, labelDy:16, labelAnchor:'start' },

  // ── Cheeks ────────────────────────────────────────────────────────────────
  { kind:'slider', id:'au06_cheek_raiser_l', label:'CHEEK', ax:142, ay:348, length:46, angle:-132, labelDx:-28, labelDy:10, labelAnchor:'end' },
  { kind:'slider', id:'cheek_puff', label:'PUFF', ax:126, ay:386, length:42, angle:-155, labelDx:-24, labelDy:12, labelAnchor:'end' },
  { kind:'slider', id:'au06_cheek_raiser_r', label:'CHEEK', ax:378, ay:348, length:46, angle:-48, labelDx:28, labelDy:10, labelAnchor:'start' },
  { kind:'slider', id:'cheek_puff', label:'PUFF', ax:394, ay:386, length:42, angle:-25, labelDx:24, labelDy:12, labelAnchor:'start' },

  // ── Nose (bilateral — one control moves both) ──────────────────────────────
  { kind:'slider', id:'au09_nose_wrinkler', label:'WRINKLE', ax:238, ay:338, length:34, angle:-112, labelDx:-34, labelDy:2, labelAnchor:'end' },
  { kind:'slider', id:'au38_nostril_dilator', label:'NOSTRIL', ax:282, ay:338, length:34, angle:-68, labelDx:34, labelDy:2, labelAnchor:'start' },

  // ── Mouth corners — XY pads ───────────────────────────────────────────────
  {
    kind:'facspad',
    idX:'au12_lip_corner_puller_l', idXNeg:'au15_lip_corner_depressor_l',
    idY:'au10_upper_lip_raiser_l',  idYNeg:'snarl_l',
    label:'CORNER L',
    ax:172, ay:420, w:68, h:58,
  },
  {
    kind:'facspad',
    idX:'au15_lip_corner_depressor_r', idXNeg:'au12_lip_corner_puller_r',
    idY:'au10_upper_lip_raiser_r',     idYNeg:'snarl_r',
    label:'CORNER R',
    ax:348, ay:420, w:68, h:58,
  },
  {
    kind:'facspad',
    idX:'au18_lip_pucker', idXNeg:'au20_lip_stretcher_l',
    idY:'au25_lips_part', idYNeg:'au23_lip_tightener',
    label:'MOUTH CTR',
    ax:260, ay:414, w:74, h:64,
  },

  // ── Mouth radial handles ──────────────────────────────────────────────────
  { kind:'slider', id:'au10_upper_lip_raiser_l', label:'UPPER L', ax:222, ay:378, length:34, angle:-98, labelDx:-18, labelDy:-8, labelAnchor:'end', fontSize:7 },
  { kind:'slider', id:'au10_upper_lip_raiser_r', label:'UPPER R', ax:298, ay:378, length:34, angle:-82, labelDx:18, labelDy:-8, labelAnchor:'start', fontSize:7 },
  { kind:'slider', id:'au16_lower_lip_depressor_l', label:'LOWER L', ax:226, ay:458, length:34, angle:106, labelDx:-26, labelDy:14, labelAnchor:'end', fontSize:7 },
  { kind:'slider', id:'au16_lower_lip_depressor_r', label:'LOWER R', ax:294, ay:458, length:34, angle:74, labelDx:26, labelDy:14, labelAnchor:'start', fontSize:7 },
  { kind:'slider', id:'au14_dimpler_l', label:'DIMPLE L', ax:202, ay:450, length:38, angle:145, labelDx:-24, labelDy:14, labelAnchor:'end', fontSize:7 },
  { kind:'slider', id:'au14_dimpler_r', label:'DIMPLE R', ax:318, ay:450, length:38, angle:35, labelDx:24, labelDy:14, labelAnchor:'start', fontSize:7 },
  { kind:'slider', id:'au20_lip_stretcher_l', label:'STRETCH', ax:188, ay:392, length:38, angle:180, labelDx:-26, labelDy:-8, labelAnchor:'end', fontSize:7 },
  { kind:'slider', id:'au20_lip_stretcher_r', label:'STRETCH', ax:332, ay:392, length:38, angle:0, labelDx:26, labelDy:-8, labelAnchor:'start', fontSize:7 },
  { kind:'slider', id:'au15_lip_corner_depressor_l', label:'DOWN', ax:180, ay:452, length:34, angle:112, labelDx:-16, labelDy:18, labelAnchor:'end', fontSize:7 },
  { kind:'slider', id:'au15_lip_corner_depressor_r', label:'DOWN', ax:340, ay:452, length:34, angle:68, labelDx:16, labelDy:18, labelAnchor:'start', fontSize:7 },

  // ── Jaw pad ───────────────────────────────────────────────────────────────
  {
    kind:'facspad',
    idX:'jaw_left', idXNeg:'jaw_right',
    idY:'au26_jaw_drop', idYNeg:'jaw_forward',
    label:'JAW',
    ax:260, ay:542, w:78, h:66,
  },
  { kind:'slider', id:'au27_mouth_stretch', label:'WIDE', ax:176, ay:526, length:42, angle:180, labelDx:-18, labelDy:-8, labelAnchor:'end' },
  { kind:'slider', id:'au27_mouth_stretch', label:'WIDE', ax:344, ay:526, length:42, angle:0, labelDx:18, labelDy:-8, labelAnchor:'start' },

  // ── Lower specialty modules ───────────────────────────────────────────────
  { kind:'slider', id:'cheek_puff', label:'MOUTH STICKY', ax:80, ay:580, length:46, angle:-90, labelDx:0, labelDy:-12, fontSize:7 },
  { kind:'slider', id:'au25_lips_part', label:'OH', ax:126, ay:602, length:44, angle:-90, labelDx:0, labelDy:26 },
  { kind:'slider', id:'au18_lip_pucker', label:'LIPS BLOW', ax:172, ay:602, length:44, angle:-55, labelDx:10, labelDy:26, fontSize:7 },
  { kind:'slider', id:'lip_roll_upper', label:'TOGETHER', ax:334, ay:588, length:38, angle:-112, labelDx:-2, labelDy:-14, fontSize:7 },
  { kind:'slider', id:'au24_lip_pressor', label:'PRESS', ax:366, ay:588, length:38, angle:-68, labelDx:2, labelDy:-14, fontSize:7 },
  { kind:'slider', id:'mouth_suck', label:'SUCK', ax:402, ay:602, length:44, angle:-90, labelDx:0, labelDy:26 },
  { kind:'slider', id:'tongue_out', label:'TONGUE', ax:448, ay:582, length:44, angle:0, labelDx:0, labelDy:-14, fontSize:7 },
  { kind:'slider', id:'lips_bite', label:'BITE', ax:96, ay:654, length:34, angle:-90, labelDx:0, labelDy:22 },
  { kind:'slider', id:'au23_lip_tightener', label:'TIGHTEN', ax:142, ay:654, length:34, angle:-90, labelDx:0, labelDy:22, fontSize:7 },
  { kind:'slider', id:'jaw_forward', label:'NECK STRETCH', ax:382, ay:654, length:42, angle:-90, labelDx:0, labelDy:22, fontSize:7 },
  { kind:'slider', id:'au17_chin_raiser', label:'CHIN', ax:426, ay:654, length:42, angle:-90, labelDx:0, labelDy:22 },
]

// ── Tweakers panel controls ─────────────────────────────────────────────────
// Separate fine-tuning panel — eye lids individually, lip tweakers, performance

type TweakerSlider = {
  kind: 'tslider'
  id: string
  label: string
  ax: number; ay: number
  length: number
  axis: 'v' | 'h'
}

type TweakerXY = {
  kind: 'txy'
  idX: string; idXNeg?: string
  idY: string; idYNeg?: string
  label: string
  ax: number; ay: number
  w: number; h: number
}

type TweakerEyePad = {
  kind: 'teyepad'
  eye: 'L' | 'R'
  label: string
  ax: number; ay: number
  w: number; h: number
}

type TweakerControl = TweakerSlider | TweakerXY | TweakerEyePad

const TWEAKERS: TweakerControl[] = [
  // ── Brow and forehead micro controls ──────────────────────────────────────
  { kind:'tslider', id:'au04_brow_lowerer_l',      label:'L DOWN', ax: 90, ay:142, length:42, axis:'v' },
  { kind:'tslider', id:'au02_outer_brow_raiser_l', label:'L OUT',  ax:118, ay:142, length:42, axis:'v' },
  { kind:'tslider', id:'au01_inner_brow_raiser_l', label:'L IN',   ax:146, ay:142, length:42, axis:'v' },
  { kind:'tslider', id:'brow_compress',            label:'PINCH',  ax:200, ay:142, length:42, axis:'v' },
  { kind:'tslider', id:'au01_inner_brow_raiser_r', label:'R IN',   ax:254, ay:142, length:42, axis:'v' },
  { kind:'tslider', id:'au02_outer_brow_raiser_r', label:'R OUT',  ax:282, ay:142, length:42, axis:'v' },
  { kind:'tslider', id:'au04_brow_lowerer_r',      label:'R DOWN', ax:310, ay:142, length:42, axis:'v' },

  // ── Eye aim plus local lid columns ─────────────────────────────────────────
  { kind:'teyepad', eye:'L', label:'EYE L', ax:130, ay:232, w:98, h:64 },
  { kind:'teyepad', eye:'R', label:'EYE R', ax:270, ay:232, w:98, h:64 },
  { kind:'tslider', id:'au05_upper_lid_raiser_l', label:'LID',    ax: 98, ay:232, length:30, axis:'v' },
  { kind:'tslider', id:'au07_lid_tightener_l',    label:'TIGHT',  ax:130, ay:232, length:30, axis:'v' },
  { kind:'tslider', id:'au43_eye_closure_l',      label:'CLOSE',  ax:162, ay:232, length:30, axis:'v' },
  { kind:'tslider', id:'au05_upper_lid_raiser_r', label:'LID',    ax:238, ay:232, length:30, axis:'v' },
  { kind:'tslider', id:'au07_lid_tightener_r',    label:'TIGHT',  ax:270, ay:232, length:30, axis:'v' },
  { kind:'tslider', id:'au43_eye_closure_r',      label:'CLOSE',  ax:302, ay:232, length:30, axis:'v' },

  // ── Lip push/pull XY pads ─────────────────────────────────────────────────
  {
    kind:'txy',
    idX:'au18_lip_pucker', idXNeg:'au20_lip_stretcher_l',
    idY:'lip_roll_upper',  idYNeg:'au24_lip_pressor',
    label:'UPPER LIP',
    ax:92, ay:410, w:58, h:52,
  },
  {
    kind:'txy',
    idX:'mouth_funnel', idXNeg:'mouth_suck',
    idY:'au25_lips_part', idYNeg:'au23_lip_tightener',
    label:'LIP CTR',
    ax:160, ay:410, w:58, h:52,
  },
  {
    kind:'txy',
    idX:'au16_lower_lip_depressor_l', idXNeg:'au17_chin_raiser',
    idY:'lips_bite',                  idYNeg:'lip_roll_lower',
    label:'LOWER LIP',
    ax:228, ay:410, w:58, h:52,
  },
  {
    kind:'txy',
    idX:'au12_lip_corner_puller_l', idXNeg:'au15_lip_corner_depressor_l',
    idY:'au10_upper_lip_raiser_l', idYNeg:'snarl_l',
    label:'CORNER L',
    ax:92, ay:486, w:58, h:52,
  },
  {
    kind:'txy',
    idX:'au12_lip_corner_puller_r', idXNeg:'au15_lip_corner_depressor_r',
    idY:'au10_upper_lip_raiser_r', idYNeg:'snarl_r',
    label:'CORNER R',
    ax:228, ay:486, w:58, h:52,
  },

  // ── Nose tweakers ─────────────────────────────────────────────────────────
  { kind:'tslider', id:'au09_nose_wrinkler',   label:'WRINKLE', ax:144, ay:320, length:60, axis:'h' },
  { kind:'tslider', id:'au38_nostril_dilator', label:'NOSTRIL', ax:144, ay:342, length:60, axis:'h' },
  { kind:'tslider', id:'cheek_puff',           label:'PUFF',    ax:144, ay:364, length:60, axis:'h' },

  // ── Lower special-purpose modules ─────────────────────────────────────────
  { kind:'tslider', id:'lips_bite',            label:'BITE',    ax:302, ay:392, length:42, axis:'v' },
  { kind:'tslider', id:'au24_lip_pressor',     label:'PRESS',   ax:326, ay:392, length:42, axis:'v' },
  { kind:'tslider', id:'mouth_suck',           label:'SUCK',    ax:350, ay:392, length:42, axis:'v' },
  { kind:'tslider', id:'lip_roll_upper',       label:'ROLL U',  ax:302, ay:486, length:42, axis:'v' },
  { kind:'tslider', id:'lip_roll_lower',       label:'ROLL L',  ax:326, ay:486, length:42, axis:'v' },
  { kind:'tslider', id:'tongue_out',           label:'TONGUE',  ax:350, ay:486, length:42, axis:'v' },
]

// ── Drag state ────────────────────────────────────────────────────────────────
type DotDrag    = { kind:'dot';    id:string; startY:number; startVal:number; maxVal:number }
type EyeDrag    = { kind:'eye';    eye:'L'|'R'; startX:number; startY:number; startVX:number; startVY:number }
type PadDrag    = { kind:'pad';    idX:string; idXNeg?:string; idY:string; idYNeg?:string; w:number; h:number; startX:number; startY:number; startVals:Record<string,number> }
type SliderDrag = {
  kind:'slider'
  id:string
  axis?:'v'|'h'
  dirX?:number
  dirY?:number
  startX:number
  startY:number
  startVal:number
  maxVal:number
  length:number
}
type AnyDrag    = DotDrag | EyeDrag | PadDrag | SliderDrag

// ── Helpers ───────────────────────────────────────────────────────────────────
const getMax = (id: string) => FACS_CONTROLS.find(c => c.id === id)?.max ?? FACS_VALUE_MAX
const getControlName = (id: string) => {
  const c = FACS_CONTROLS.find(item => item.id === id)
  return c ? `${c.au} ${c.label}` : id
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function sliderKeyValue(e: KE, value: number, max: number) {
  const small = max / 20
  const large = max / 5
  switch (e.key) {
    case 'ArrowUp':
    case 'ArrowRight':
      e.preventDefault()
      return clamp(value + small, 0, max)
    case 'ArrowDown':
    case 'ArrowLeft':
      e.preventDefault()
      return clamp(value - small, 0, max)
    case 'PageUp':
      e.preventDefault()
      return clamp(value + large, 0, max)
    case 'PageDown':
      e.preventDefault()
      return clamp(value - large, 0, max)
    case 'Home':
      e.preventDefault()
      return 0
    case 'End':
      e.preventDefault()
      return max
    default:
      return null
  }
}

function getEyeKeyValues(e: KE, x: number, y: number) {
  const step = e.shiftKey ? 0.2 : 0.08
  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault()
      return { x: clamp(x + step, -1, 1), y }
    case 'ArrowLeft':
      e.preventDefault()
      return { x: clamp(x - step, -1, 1), y }
    case 'ArrowUp':
      e.preventDefault()
      return { x, y: clamp(y + step, -1, 1) }
    case 'ArrowDown':
      e.preventDefault()
      return { x, y: clamp(y - step, -1, 1) }
    case 'Home':
      e.preventDefault()
      return { x: 0, y: 0 }
    default:
      return null
  }
}

function normalizedPadValue(ctrl: FacsPad | TweakerXY, vals: FacsValues) {
  const vX = (vals[ctrl.idX] ?? 0) / getMax(ctrl.idX)
  const vXn = ctrl.idXNeg ? (vals[ctrl.idXNeg] ?? 0) / getMax(ctrl.idXNeg) : 0
  const vY = (vals[ctrl.idY] ?? 0) / getMax(ctrl.idY)
  const vYn = ctrl.idYNeg ? (vals[ctrl.idYNeg] ?? 0) / getMax(ctrl.idYNeg) : 0
  return { x: vX - vXn, y: vY - vYn }
}

function setPadFromNormalized(
  ctrl: FacsPad | TweakerXY,
  x: number,
  y: number,
  onChange: (id: string, value: number) => void,
) {
  const nx = clamp(x, -1, 1)
  const ny = clamp(y, -1, 1)

  if (nx >= 0) {
    onChange(ctrl.idX, nx * getMax(ctrl.idX))
    if (ctrl.idXNeg) onChange(ctrl.idXNeg, 0)
  } else if (ctrl.idXNeg) {
    onChange(ctrl.idX, 0)
    onChange(ctrl.idXNeg, -nx * getMax(ctrl.idXNeg))
  }

  if (ny >= 0) {
    onChange(ctrl.idY, ny * getMax(ctrl.idY))
    if (ctrl.idYNeg) onChange(ctrl.idYNeg, 0)
  } else if (ctrl.idYNeg) {
    onChange(ctrl.idY, 0)
    onChange(ctrl.idYNeg, -ny * getMax(ctrl.idYNeg))
  }
}

function padKeyValue(e: KE, ctrl: FacsPad | TweakerXY, vals: FacsValues) {
  const current = normalizedPadValue(ctrl, vals)
  const next = getEyeKeyValues(e, current.x, current.y)
  return next
}

function updateFacsControl(id: string, value: number) {
  setFacsValues((previous) => ({ ...previous, [id]: value }))
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function FaceOverlay() {
  return (
    <div style={{ display:'flex', flexDirection:'column', width:'100%' }}>
      <div style={{ width:'100%', aspectRatio:`${MW} / ${MH}` }}>
        <MainPanel />
      </div>
      <div style={{ width:'100%', aspectRatio:`${TW} / ${TH}` }}>
        <TweakersPanel />
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
function MainPanel() {
  const { facsValues, eyeLook2D } = useSnapshot(appState)
  const dragRef = useRef<AnyDrag | null>(null)
  const svgRef  = useRef<SVGSVGElement | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)

  const v = (id: string) => facsValues[id] ?? 0
  const scale = () => svgRef.current ? svgRef.current.getBoundingClientRect().height / MH : 1

  const onPointerMove = (e: PE<SVGSVGElement>) => {
    const d = dragRef.current
    if (!d) return
    const s = scale()
    if (d.kind === 'dot') {
      const dy = (d.startY - e.clientY) / s
      const nv = Math.max(0, Math.min(d.maxVal, d.startVal + (dy / 80) * d.maxVal))
      updateFacsControl(d.id, nv)
    } else if (d.kind === 'eye') {
      const dx = (e.clientX - d.startX) / (40 * s)
      const dy = -(e.clientY - d.startY) / (30 * s)
      const nx = Math.max(-1, Math.min(1, d.startVX + dx))
      const ny = Math.max(-1, Math.min(1, d.startVY + dy))
      setEyeLook2D(d.eye === 'L'
        ? { ...eyeLook2D, leftX: nx, leftY: ny }
        : { ...eyeLook2D, rightX: nx, rightY: ny })
    } else if (d.kind === 'pad') {
      const dx = (e.clientX - d.startX) / (d.w * 0.45 * s)
      const dy = -(e.clientY - d.startY) / (d.h * 0.45 * s)
      applyPad(d, dx, dy, updateFacsControl)
    } else if (d.kind === 'slider') {
      const dx = (e.clientX - d.startX) / s
      const dy = (e.clientY - d.startY) / s
      const travel = d.dirX !== undefined && d.dirY !== undefined
        ? dx * d.dirX + dy * d.dirY
        : d.axis === 'v' ? -dy : dx
      const nv = Math.max(0, Math.min(d.maxVal, d.startVal + (travel / d.length) * d.maxVal))
      updateFacsControl(d.id, nv)
    }
  }

  const onPointerUp = () => { dragRef.current = null; setActiveKey(null) }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${MW} ${MH}`} width="100%" height="100%"
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
      style={{ display:'block', touchAction:'none', cursor: activeKey ? 'crosshair' : 'default' }}
    >
      <MainFaceSilhouette />

      {MAIN.map((ctrl, i) => {
        if (ctrl.kind === 'dot') {
          const val = v(ctrl.id)
          const mx = getMax(ctrl.id)
          const t = val / mx
          const isActive = activeKey === `dot:${ctrl.id}:${i}`
          return (
            <DotNode key={i} ctrl={ctrl} t={t} value={val} max={mx} isActive={isActive}
              onPointerDown={e => {
                e.currentTarget.setPointerCapture(e.pointerId)
                dragRef.current = { kind:'dot', id:ctrl.id, startY:e.clientY, startVal:val, maxVal:mx }
                setActiveKey(`dot:${ctrl.id}:${i}`)
              }}
              onKeyDown={e => {
                const next = sliderKeyValue(e, val, mx)
                if (next !== null) updateFacsControl(ctrl.id, next)
              }}
              onFocus={() => setActiveKey(`dot:${ctrl.id}:${i}`)}
              onBlur={() => setActiveKey(null)}
            />
          )
        } else if (ctrl.kind === 'eyepad') {
          const ex = ctrl.eye === 'L' ? eyeLook2D.leftX : eyeLook2D.rightX
          const ey = ctrl.eye === 'L' ? eyeLook2D.leftY : eyeLook2D.rightY
          const isActive = activeKey === `eye:${ctrl.eye}`
          return (
            <EyePadNode key={i} ctrl={ctrl} ex={ex} ey={ey} isActive={isActive}
              onPointerDown={e => {
                e.currentTarget.setPointerCapture(e.pointerId)
                dragRef.current = { kind:'eye', eye:ctrl.eye, startX:e.clientX, startY:e.clientY,
                  startVX: ctrl.eye==='L' ? eyeLook2D.leftX : eyeLook2D.rightX,
                  startVY: ctrl.eye==='L' ? eyeLook2D.leftY : eyeLook2D.rightY }
                setActiveKey(`eye:${ctrl.eye}`)
              }}
              onFocus={() => setActiveKey(`eye:${ctrl.eye}`)}
              onBlur={() => setActiveKey(null)}
              onKeyDown={e => {
                const next = getEyeKeyValues(e, ex, ey)
                if (!next) return
                setEyeLook2D(ctrl.eye === 'L'
                  ? { ...eyeLook2D, leftX: next.x, leftY: next.y }
                  : { ...eyeLook2D, rightX: next.x, rightY: next.y })
              }}
            />
          )
        } else if (ctrl.kind === 'facspad') {
          const isActive = activeKey === `pad:${ctrl.label}`
          return (
            <FacsPadNode key={i} ctrl={ctrl} vals={facsValues} isActive={isActive}
              onPointerDown={e => {
                e.currentTarget.setPointerCapture(e.pointerId)
                const sv: Record<string,number> = {}
                ;[ctrl.idX, ctrl.idXNeg, ctrl.idY, ctrl.idYNeg].forEach(id => { if(id) sv[id] = facsValues[id]??0 })
                dragRef.current = { kind:'pad', idX:ctrl.idX, idXNeg:ctrl.idXNeg, idY:ctrl.idY, idYNeg:ctrl.idYNeg,
                  w:ctrl.w, h:ctrl.h, startX:e.clientX, startY:e.clientY, startVals:sv }
                setActiveKey(`pad:${ctrl.label}`)
              }}
              onFocus={() => setActiveKey(`pad:${ctrl.label}`)}
              onBlur={() => setActiveKey(null)}
              onKeyDown={e => {
                const next = padKeyValue(e, ctrl, facsValues)
                if (next) setPadFromNormalized(ctrl, next.x, next.y, updateFacsControl)
              }}
            />
          )
        } else {
          const val = v(ctrl.id)
          const mx = getMax(ctrl.id)
          const isActive = activeKey === `slider:${ctrl.id}:${i}`
          return (
            <RigSliderNode
              key={i}
              ctrl={ctrl}
              value={val}
              max={mx}
              isActive={isActive}
              onPointerDown={e => {
                e.currentTarget.setPointerCapture(e.pointerId)
                const rad = ((ctrl.angle - 90) * Math.PI) / 180
                dragRef.current = {
                  kind:'slider',
                  id:ctrl.id,
                  dirX:Math.cos(rad),
                  dirY:Math.sin(rad),
                  startX:e.clientX,
                  startY:e.clientY,
                  startVal:val,
                  maxVal:mx,
                  length:ctrl.length,
                }
                setActiveKey(`slider:${ctrl.id}:${i}`)
              }}
              onFocus={() => setActiveKey(`slider:${ctrl.id}:${i}`)}
              onBlur={() => setActiveKey(null)}
              onKeyDown={e => {
                const next = sliderKeyValue(e, val, mx)
                if (next !== null) updateFacsControl(ctrl.id, next)
              }}
            />
          )
        }
      })}
    </svg>
  )
}

// ── Tweakers panel ─────────────────────────────────────────────────────────────
function TweakersPanel() {
  const { facsValues, eyeLook2D } = useSnapshot(appState)
  const dragRef = useRef<AnyDrag | null>(null)
  const svgRef  = useRef<SVGSVGElement | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)

  const v = (id: string) => facsValues[id] ?? 0
  const scale = () => svgRef.current ? svgRef.current.getBoundingClientRect().height / TH : 1

  const onPointerMove = (e: PE<SVGSVGElement>) => {
    const d = dragRef.current
    if (!d) return
    const s = scale()
    if (d.kind === 'slider') {
      const travel = d.axis === 'v' ? (d.startY - e.clientY) / s : (e.clientX - d.startX) / s
      const nv = Math.max(0, Math.min(d.maxVal, d.startVal + (travel / d.length) * d.maxVal))
      updateFacsControl(d.id, nv)
    } else if (d.kind === 'pad') {
      const dx = (e.clientX - d.startX) / (d.w * 0.45 * s)
      const dy = -(e.clientY - d.startY) / (d.h * 0.45 * s)
      applyPad(d, dx, dy, updateFacsControl)
    } else if (d.kind === 'eye') {
      const dx = (e.clientX - d.startX) / (40 * s)
      const dy = -(e.clientY - d.startY) / (30 * s)
      const nx = Math.max(-1, Math.min(1, d.startVX + dx))
      const ny = Math.max(-1, Math.min(1, d.startVY + dy))
      setEyeLook2D(d.eye === 'L'
        ? { ...eyeLook2D, leftX: nx, leftY: ny }
        : { ...eyeLook2D, rightX: nx, rightY: ny })
    }
  }

  const onPointerUp = () => { dragRef.current = null; setActiveKey(null) }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${TW} ${TH}`} width="100%" height="100%"
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
      style={{ display:'block', touchAction:'none', cursor: activeKey ? 'crosshair' : 'default' }}
    >
      <TweakerFaceSilhouette />

      {/* Title */}
      <text x={TCX} y={82} textAnchor="middle" fontSize={18} fontFamily={FONT} fontWeight="bold"
        fill="rgba(255,255,255,0.22)" letterSpacing={4}>TWEAKERS</text>

      {TWEAKERS.map((ctrl, i) => {
        if (ctrl.kind === 'tslider') {
          const val = v(ctrl.id)
          const mx = getMax(ctrl.id)
          const t = mx > 0 ? val / mx : 0
          const isActive = activeKey === `ts:${ctrl.id}:${i}`
          const vert = ctrl.axis === 'v'
          const half = ctrl.length / 2
          const x1 = vert ? ctrl.ax : ctrl.ax - half
          const y1 = vert ? ctrl.ay + half : ctrl.ay
          const x2 = vert ? ctrl.ax : ctrl.ax + half
          const y2 = vert ? ctrl.ay - half : ctrl.ay
          const tx = vert ? ctrl.ax : ctrl.ax - half + t * ctrl.length
          const ty = vert ? ctrl.ay + half - t * ctrl.length : ctrl.ay
          const lx = vert ? ctrl.ax : ctrl.ax
          const isPerformance = vert && ctrl.ay >= 450
          const isBrow = vert && ctrl.ay < 170
          const ly = vert
            ? ctrl.ay + half + 12 + (isPerformance ? (i % 2) * 10 : isBrow ? (i % 3) * 8 : 0)
            : ctrl.ay + 14
          const labelSize = isPerformance || isBrow ? 6 : 7
          return (
            <g key={i}
              role="slider"
              tabIndex={0}
              aria-label={getControlName(ctrl.id)}
              aria-valuemin={0}
              aria-valuemax={mx}
              aria-valuenow={Number(val.toFixed(2))}
              onKeyDown={e => {
                const next = sliderKeyValue(e, val, mx)
                if (next !== null) updateFacsControl(ctrl.id, next)
              }}
              onFocus={() => setActiveKey(`ts:${ctrl.id}:${i}`)}
              onBlur={() => setActiveKey(null)}
              onPointerDown={e => {
              e.currentTarget.setPointerCapture(e.pointerId)
              dragRef.current = { kind:'slider', id:ctrl.id, axis:ctrl.axis,
                startX:e.clientX, startY:e.clientY, startVal:val, maxVal:mx, length:ctrl.length }
              setActiveKey(`ts:${ctrl.id}:${i}`)
            }} style={{ cursor: vert ? 'ns-resize' : 'ew-resize', outline: 'none' }}>
              <title>{getControlName(ctrl.id)}</title>
              <rect x={vert?ctrl.ax-10:ctrl.ax-half-6} y={vert?ctrl.ay-half-6:ctrl.ay-10}
                width={vert?20:ctrl.length+12} height={vert?ctrl.length+12:20} fill="transparent" />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={FEATURE} strokeWidth={2} strokeLinecap="round" />
              <line x1={vert?ctrl.ax:ctrl.ax-half} y1={vert?ctrl.ay+half:ctrl.ay}
                x2={tx} y2={ty}
                stroke={isActive||val>0.01?DOT:FEATURE} strokeWidth={3} strokeLinecap="round" opacity={isActive?1:0.8} />
              <circle cx={tx} cy={ty} r={isActive?7:5} fill={isActive?DOT_ACTIVE:DOT} opacity={isActive?1:val>0.01?0.9:0.45} />
              {isActive && <circle cx={tx} cy={ty} r={11} fill={DOT_GLOW} />}
              {ctrl.label && (
                <text x={lx} y={ly} textAnchor="middle" fontSize={labelSize} fontFamily={FONT} fontWeight="bold"
                  fill={isActive?LABEL_HI:LABEL}>{ctrl.label}</text>
              )}
              {isActive && (
                <text x={lx} y={ly+9} textAnchor="middle" fontSize={7} fontFamily={FONT} fill={VAL_COLOR}>
                  {val.toFixed(2)}
                </text>
              )}
            </g>
          )
        } else if (ctrl.kind === 'txy') {
          const isActive = activeKey === `txy:${i}`
          return (
            <TweakerXYNode key={i} ctrl={ctrl} vals={facsValues} isActive={isActive}
              onPointerDown={e => {
                e.currentTarget.setPointerCapture(e.pointerId)
                const sv: Record<string,number> = {}
                ;[ctrl.idX, ctrl.idXNeg, ctrl.idY, ctrl.idYNeg].forEach(id => { if(id) sv[id]=facsValues[id]??0 })
                dragRef.current = { kind:'pad', idX:ctrl.idX, idXNeg:ctrl.idXNeg, idY:ctrl.idY, idYNeg:ctrl.idYNeg,
                  w:ctrl.w, h:ctrl.h, startX:e.clientX, startY:e.clientY, startVals:sv }
                setActiveKey(`txy:${i}`)
              }}
              onFocus={() => setActiveKey(`txy:${i}`)}
              onBlur={() => setActiveKey(null)}
              onKeyDown={e => {
                const next = padKeyValue(e, ctrl, facsValues)
                if (next) setPadFromNormalized(ctrl, next.x, next.y, updateFacsControl)
              }}
            />
          )
        } else {
          // teyepad
          const ex = ctrl.eye === 'L' ? eyeLook2D.leftX : eyeLook2D.rightX
          const ey = ctrl.eye === 'L' ? eyeLook2D.leftY : eyeLook2D.rightY
          const isActive = activeKey === `teye:${ctrl.eye}`
          const hw = ctrl.w/2, hh = ctrl.h/2
          const dotX = ctrl.ax + ex * hw
          const dotY = ctrl.ay - ey * hh
          return (
            <g key={i} onPointerDown={e => {
              e.currentTarget.setPointerCapture(e.pointerId)
              dragRef.current = { kind:'eye', eye:ctrl.eye, startX:e.clientX, startY:e.clientY,
                startVX: ctrl.eye==='L'?eyeLook2D.leftX:eyeLook2D.rightX,
                startVY: ctrl.eye==='L'?eyeLook2D.leftY:eyeLook2D.rightY }
              setActiveKey(`teye:${ctrl.eye}`)
            }}
              role="group"
              tabIndex={0}
              aria-label={`${ctrl.label} eye look`}
              onFocus={() => setActiveKey(`teye:${ctrl.eye}`)}
              onBlur={() => setActiveKey(null)}
              onKeyDown={e => {
                const next = getEyeKeyValues(e, ex, ey)
                if (!next) return
                setEyeLook2D(ctrl.eye === 'L'
                  ? { ...eyeLook2D, leftX: next.x, leftY: next.y }
                  : { ...eyeLook2D, rightX: next.x, rightY: next.y })
              }}
              style={{ cursor:'crosshair', outline:'none' }}>
              <title>{`${ctrl.label} eye look`}</title>
              <rect x={ctrl.ax-hw} y={ctrl.ay-hh} width={ctrl.w} height={ctrl.h}
                fill={isActive?'rgba(240,224,64,0.06)':'rgba(255,255,255,0.04)'}
                stroke={isActive?DOT:FEATURE} strokeWidth={isActive?1.5:1} rx={4} />
              <line x1={ctrl.ax-hw+4} y1={ctrl.ay} x2={ctrl.ax+hw-4} y2={ctrl.ay} stroke={FEATURE} strokeWidth={0.6} />
              <line x1={ctrl.ax} y1={ctrl.ay-hh+4} x2={ctrl.ax} y2={ctrl.ay+hh-4} stroke={FEATURE} strokeWidth={0.6} />
              {(isActive||Math.abs(ex)>0.02||Math.abs(ey)>0.02) && (
                <circle cx={dotX} cy={dotY} r={10} fill={DOT_GLOW} />
              )}
              <circle cx={dotX} cy={dotY} r={isActive?7:5}
                fill={isActive?DOT_ACTIVE:DOT}
                opacity={isActive?1:(Math.abs(ex)>0.02||Math.abs(ey)>0.02)?0.9:0.45} />
              <text x={ctrl.ax} y={ctrl.ay+hh+12} textAnchor="middle" fontSize={8}
                fontFamily={FONT} fontWeight="bold" fill={isActive?LABEL_HI:LABEL}>{ctrl.label}</text>
              {isActive && (
                <text x={ctrl.ax} y={ctrl.ay+hh+21} textAnchor="middle" fontSize={7} fontFamily={FONT} fill={VAL_COLOR}>
                  {ex.toFixed(2)}, {ey.toFixed(2)}
                </text>
              )}
            </g>
          )
        }
      })}
    </svg>
  )
}

// ── Shared pad logic ──────────────────────────────────────────────────────────
function applyPad(d: PadDrag, dx: number, dy: number, onChange: (id:string,v:number)=>void) {
  const mx = getMax(d.idX)
  if (dx >= 0) {
    onChange(d.idX, Math.max(0, Math.min(mx, d.startVals[d.idX] + dx * mx)))
    if (d.idXNeg) onChange(d.idXNeg, 0)
  } else if (d.idXNeg) {
    const mn = getMax(d.idXNeg)
    onChange(d.idXNeg, Math.max(0, Math.min(mn, d.startVals[d.idXNeg] + (-dx) * mn)))
    onChange(d.idX, 0)
  }
  const my = getMax(d.idY)
  if (dy >= 0) {
    onChange(d.idY, Math.max(0, Math.min(my, d.startVals[d.idY] + dy * my)))
    if (d.idYNeg) onChange(d.idYNeg, 0)
  } else if (d.idYNeg) {
    const mn = getMax(d.idYNeg)
    onChange(d.idYNeg, Math.max(0, Math.min(mn, d.startVals[d.idYNeg] + (-dy) * mn)))
    onChange(d.idY, 0)
  }
}

// ── RigSliderNode ────────────────────────────────────────────────────────────
function RigSliderNode({ ctrl, value, max, isActive, onPointerDown, onFocus, onBlur, onKeyDown }: {
  ctrl: RigSlider
  value: number
  max: number
  isActive: boolean
  onPointerDown: (e:PE<SVGGElement>)=>void
  onFocus: () => void
  onBlur: () => void
  onKeyDown: (e:KE<SVGGElement>)=>void
}) {
  const t = max > 0 ? value / max : 0
  const half = ctrl.length / 2
  const handleY = half - t * ctrl.length
  const active = isActive || value > 0.01
  const labelX = ctrl.ax + (ctrl.labelDx ?? 0)
  const labelY = ctrl.ay + (ctrl.labelDy ?? half + 13)
  const anchor = ctrl.labelAnchor ?? 'middle'

  return (
    <g
      role="slider"
      tabIndex={0}
      aria-label={getControlName(ctrl.id)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(2))}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      style={{ cursor:'ns-resize', outline:'none' }}
    >
      <title>{getControlName(ctrl.id)}</title>
      <g transform={`translate(${ctrl.ax} ${ctrl.ay}) rotate(${ctrl.angle})`}>
        <rect x={-10} y={-half-7} width={20} height={ctrl.length+14} fill="transparent" />
        <line x1={0} y1={half} x2={0} y2={-half} stroke={FEATURE} strokeWidth={2.1} strokeLinecap="round" />
        <line x1={0} y1={half} x2={0} y2={handleY} stroke={active?DOT:FEATURE} strokeWidth={3} strokeLinecap="round" opacity={active?0.9:0.55} />
        <circle cx={0} cy={handleY} r={isActive?7:5.4} fill={isActive?DOT_ACTIVE:DOT} opacity={active?1:0.42} />
        {isActive && <circle cx={0} cy={handleY} r={11} fill={DOT_GLOW} />}
      </g>
      <text
        x={labelX}
        y={labelY}
        textAnchor={anchor}
        fontSize={ctrl.fontSize ?? 8}
        fontFamily={FONT}
        fontWeight="bold"
        fill={isActive ? LABEL_HI : active ? 'rgba(255,255,255,0.76)' : LABEL}
        style={{ pointerEvents:'none' }}
      >
        {ctrl.label}
      </text>
      {isActive && (
        <text x={ctrl.ax} y={ctrl.ay - half - 8} textAnchor="middle" fontSize={7} fontFamily={FONT} fill={VAL_COLOR} style={{ pointerEvents:'none' }}>
          {value.toFixed(2)}
        </text>
      )}
    </g>
  )
}

// ── DotNode ───────────────────────────────────────────────────────────────────
function DotNode({ ctrl, t, value, max, isActive, onPointerDown, onKeyDown, onFocus, onBlur }: {
  ctrl: DotControl
  t: number
  value: number
  max: number
  isActive: boolean
  onPointerDown: (e:PE<SVGCircleElement>)=>void
  onKeyDown: (e:KE<SVGGElement>)=>void
  onFocus: () => void
  onBlur: () => void
}) {
  const r = isActive ? 9 : t > 0.01 ? 7 : 6
  const hasLabel = ctrl.label.length > 0
  const lx = ctrl.ax + ctrl.lx * ctrl.ll
  const ly = ctrl.ay + ctrl.ly * ctrl.ll
  const anchor = ctrl.lx > 0.1 ? 'start' : ctrl.lx < -0.1 ? 'end' : 'middle'

  return (
    <g
      role="slider"
      tabIndex={0}
      aria-label={getControlName(ctrl.id)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(2))}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      style={{ outline: 'none' }}
    >
      <title>{getControlName(ctrl.id)}</title>
      {/* Connector line */}
      {hasLabel && (
        <line x1={ctrl.ax} y1={ctrl.ay} x2={lx} y2={ly}
          stroke={LINE} strokeWidth={isActive || t > 0.01 ? 1 : 0.7}
          opacity={isActive ? 0.8 : t > 0.01 ? 0.55 : 0.3} />
      )}
      {/* Glow */}
      {(isActive || t > 0.08) && <circle cx={ctrl.ax} cy={ctrl.ay} r={r+5} fill={DOT_GLOW} />}
      {/* Dot */}
      <circle cx={ctrl.ax} cy={ctrl.ay} r={r}
        fill={isActive ? DOT_ACTIVE : t > 0.01 ? DOT : 'transparent'}
        stroke={t > 0.01 || isActive ? DOT : 'rgba(240,224,64,0.35)'}
        strokeWidth={isActive ? 2 : 1.5}
        style={{ cursor:'ns-resize' }}
        onPointerDown={onPointerDown}
      />
      {/* Fill level indicator — inner ring */}
      {t > 0.01 && !isActive && (
        <circle cx={ctrl.ax} cy={ctrl.ay} r={Math.max(2, r * t)} fill={DOT} opacity={0.6} style={{pointerEvents:'none'}} />
      )}
      {/* Label */}
      {hasLabel && (
        <text x={lx + ctrl.lx * 3} y={ly + 4}
          textAnchor={anchor} fontSize={9} fontFamily={FONT} fontWeight="bold"
          fill={isActive ? LABEL_HI : t > 0.01 ? 'rgba(255,255,255,0.78)' : LABEL}
          style={{ pointerEvents:'none' }}>
          {ctrl.label}
        </text>
      )}
      {/* Value when active */}
      {isActive && (
        <text x={ctrl.ax} y={ctrl.ay - r - 5}
          textAnchor="middle" fontSize={8} fontFamily={FONT} fill={VAL_COLOR}
          style={{ pointerEvents:'none' }}>
          {(t * (FACS_CONTROLS.find(c=>c.id===ctrl.id)?.max ?? FACS_VALUE_MAX)).toFixed(2)}
        </text>
      )}
    </g>
  )
}

// ── EyePadNode ────────────────────────────────────────────────────────────────
function EyePadNode({ ctrl, ex, ey, isActive, onPointerDown, onFocus, onBlur, onKeyDown }: {
  ctrl: EyePad
  ex:number
  ey:number
  isActive:boolean
  onPointerDown:(e:PE<SVGRectElement>)=>void
  onFocus: () => void
  onBlur: () => void
  onKeyDown: (e:KE<SVGGElement>) => void
}) {
  const hw = ctrl.w/2, hh = ctrl.h/2
  const dotX = ctrl.ax + ex * hw
  const dotY = ctrl.ay - ey * hh
  const active = Math.abs(ex)>0.02 || Math.abs(ey)>0.02
  return (
    <g
      role="group"
      tabIndex={0}
      aria-label={`${ctrl.label} eye look`}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      style={{ outline: 'none' }}
    >
      <title>{`${ctrl.label} eye look`}</title>
      <rect x={ctrl.ax-hw} y={ctrl.ay-hh} width={ctrl.w} height={ctrl.h}
        fill={isActive?'rgba(240,224,64,0.06)':'rgba(255,255,255,0.03)'}
        stroke={isActive?DOT:active?'rgba(240,224,64,0.5)':'rgba(255,255,255,0.18)'}
        strokeWidth={isActive?1.5:1} rx={4} style={{cursor:'crosshair'}}
        onPointerDown={onPointerDown} />
      <line x1={ctrl.ax-hw+6} y1={ctrl.ay} x2={ctrl.ax+hw-6} y2={ctrl.ay} stroke={FEATURE} strokeWidth={0.6} />
      <line x1={ctrl.ax} y1={ctrl.ay-hh+6} x2={ctrl.ax} y2={ctrl.ay+hh-6} stroke={FEATURE} strokeWidth={0.6} />
      {(isActive||active) && <circle cx={dotX} cy={dotY} r={10} fill={DOT_GLOW} />}
      <circle cx={dotX} cy={dotY} r={isActive?8:6}
        fill={isActive?DOT_ACTIVE:DOT} opacity={isActive?1:active?0.9:0.4}
        style={{pointerEvents:'none'}} />
      {isActive && (
        <>
          <line x1={ctrl.ax} y1={ctrl.ay-hh} x2={ctrl.ax} y2={dotY} stroke={DOT} strokeWidth={0.7} opacity={0.35} />
          <line x1={ctrl.ax} y1={dotY} x2={ctrl.ax} y2={ctrl.ay+hh} stroke={DOT} strokeWidth={0.7} opacity={0.35} />
          <line x1={ctrl.ax-hw} y1={dotY} x2={dotX} y2={dotY} stroke={DOT} strokeWidth={0.7} opacity={0.35} />
          <line x1={dotX} y1={dotY} x2={ctrl.ax+hw} y2={dotY} stroke={DOT} strokeWidth={0.7} opacity={0.35} />
        </>
      )}
      <text x={ctrl.ax} y={ctrl.ay+hh+12} textAnchor="middle" fontSize={8}
        fontFamily={FONT} fontWeight="bold"
        fill={isActive?LABEL_HI:active?'rgba(255,255,255,0.7)':LABEL}
        style={{pointerEvents:'none'}}>{ctrl.label}</text>
      {isActive && (
        <text x={ctrl.ax} y={ctrl.ay+hh+21} textAnchor="middle" fontSize={7} fontFamily={FONT}
          fill={VAL_COLOR} style={{pointerEvents:'none'}}>
          {ex.toFixed(2)}, {ey.toFixed(2)}
        </text>
      )}
    </g>
  )
}

// ── FacsPadNode ───────────────────────────────────────────────────────────────
function FacsPadNode({ ctrl, vals, isActive, onPointerDown, onFocus, onBlur, onKeyDown }: {
  ctrl: FacsPad
  vals:FacsValues
  isActive:boolean
  onPointerDown:(e:PE<SVGRectElement>)=>void
  onFocus: () => void
  onBlur: () => void
  onKeyDown: (e:KE<SVGGElement>) => void
}) {
  const hw = ctrl.w/2, hh = ctrl.h/2
  const vX = (vals[ctrl.idX]??0) / getMax(ctrl.idX)
  const vXn = ctrl.idXNeg ? (vals[ctrl.idXNeg]??0) / getMax(ctrl.idXNeg) : 0
  const vY = (vals[ctrl.idY]??0) / getMax(ctrl.idY)
  const vYn = ctrl.idYNeg ? (vals[ctrl.idYNeg]??0) / getMax(ctrl.idYNeg) : 0
  const normX = vX - vXn
  const normY = vY - vYn
  const dotX = ctrl.ax + normX * hw
  const dotY = ctrl.ay - normY * hh
  const active = Math.abs(normX)>0.02 || Math.abs(normY)>0.02
  return (
    <g
      role="group"
      tabIndex={0}
      aria-label={ctrl.label}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      style={{ outline: 'none' }}
    >
      <title>{ctrl.label}</title>
      <rect x={ctrl.ax-hw} y={ctrl.ay-hh} width={ctrl.w} height={ctrl.h}
        fill={isActive?'rgba(240,224,64,0.07)':'rgba(255,255,255,0.03)'}
        stroke={isActive?DOT:active?'rgba(240,224,64,0.45)':'rgba(255,255,255,0.15)'}
        strokeWidth={isActive?1.5:1} rx={3} style={{cursor:'crosshair'}}
        onPointerDown={onPointerDown} />
      <line x1={ctrl.ax-hw+5} y1={ctrl.ay} x2={ctrl.ax+hw-5} y2={ctrl.ay} stroke={FEATURE} strokeWidth={0.6} />
      <line x1={ctrl.ax} y1={ctrl.ay-hh+5} x2={ctrl.ax} y2={ctrl.ay+hh-5} stroke={FEATURE} strokeWidth={0.6} />
      {(isActive||active) && <circle cx={dotX} cy={dotY} r={11} fill={DOT_GLOW} />}
      <circle cx={dotX} cy={dotY} r={isActive?8:6}
        fill={isActive?DOT_ACTIVE:DOT} opacity={isActive?1:active?0.9:0.4}
        style={{pointerEvents:'none'}} />
      {isActive && (
        <>
          <line x1={ctrl.ax-hw} y1={dotY} x2={dotX} y2={dotY} stroke={DOT} strokeWidth={0.8} opacity={0.4} />
          <line x1={dotX} y1={dotY} x2={ctrl.ax+hw} y2={dotY} stroke={DOT} strokeWidth={0.8} opacity={0.4} />
          <line x1={dotX} y1={ctrl.ay-hh} x2={dotX} y2={dotY} stroke={DOT} strokeWidth={0.8} opacity={0.4} />
          <line x1={dotX} y1={dotY} x2={dotX} y2={ctrl.ay+hh} stroke={DOT} strokeWidth={0.8} opacity={0.4} />
        </>
      )}
      <text x={ctrl.ax} y={ctrl.ay+hh+12} textAnchor="middle" fontSize={8}
        fontFamily={FONT} fontWeight="bold"
        fill={isActive?LABEL_HI:active?'rgba(255,255,255,0.7)':LABEL}
        style={{pointerEvents:'none'}}>{ctrl.label}</text>
      {isActive && (
        <text x={ctrl.ax} y={ctrl.ay+hh+21} textAnchor="middle" fontSize={7} fontFamily={FONT}
          fill={VAL_COLOR} style={{pointerEvents:'none'}}>
          {normX.toFixed(2)}, {normY.toFixed(2)}
        </text>
      )}
    </g>
  )
}

// ── TweakerXYNode ─────────────────────────────────────────────────────────────
function TweakerXYNode({ ctrl, vals, isActive, onPointerDown, onFocus, onBlur, onKeyDown }: {
  ctrl:TweakerXY
  vals:FacsValues
  isActive:boolean
  onPointerDown:(e:PE<SVGRectElement>)=>void
  onFocus: () => void
  onBlur: () => void
  onKeyDown: (e:KE<SVGGElement>) => void
}) {
  const hw = ctrl.w/2, hh = ctrl.h/2
  const vX = (vals[ctrl.idX]??0)/getMax(ctrl.idX)
  const vXn = ctrl.idXNeg ? (vals[ctrl.idXNeg]??0)/getMax(ctrl.idXNeg) : 0
  const vY = (vals[ctrl.idY]??0)/getMax(ctrl.idY)
  const vYn = ctrl.idYNeg ? (vals[ctrl.idYNeg]??0)/getMax(ctrl.idYNeg) : 0
  const nx = vX-vXn, ny = vY-vYn
  const dotX = ctrl.ax + nx*hw, dotY = ctrl.ay - ny*hh
  const active = Math.abs(nx)>0.02||Math.abs(ny)>0.02
  return (
    <g
      role="group"
      tabIndex={0}
      aria-label={ctrl.label}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      style={{ outline: 'none' }}
    >
      <title>{ctrl.label}</title>
      <rect x={ctrl.ax-hw} y={ctrl.ay-hh} width={ctrl.w} height={ctrl.h}
        fill={isActive?'rgba(240,224,64,0.07)':'rgba(255,255,255,0.03)'}
        stroke={isActive?DOT:active?'rgba(240,224,64,0.45)':FEATURE}
        strokeWidth={isActive?1.5:1} rx={3} style={{cursor:'crosshair'}}
        onPointerDown={onPointerDown} />
      <line x1={ctrl.ax-hw+4} y1={ctrl.ay} x2={ctrl.ax+hw-4} y2={ctrl.ay} stroke={FEATURE} strokeWidth={0.5} />
      <line x1={ctrl.ax} y1={ctrl.ay-hh+4} x2={ctrl.ax} y2={ctrl.ay+hh-4} stroke={FEATURE} strokeWidth={0.5} />
      {active && <circle cx={dotX} cy={dotY} r={9} fill={DOT_GLOW} />}
      <circle cx={dotX} cy={dotY} r={isActive?7:5} fill={isActive?DOT_ACTIVE:DOT}
        opacity={isActive?1:active?0.9:0.4} style={{pointerEvents:'none'}} />
      <text x={ctrl.ax} y={ctrl.ay+hh+11} textAnchor="middle" fontSize={7}
        fontFamily={FONT} fontWeight="bold"
        fill={isActive?LABEL_HI:LABEL} style={{pointerEvents:'none'}}>{ctrl.label}</text>
    </g>
  )
}

// ── Face silhouettes ──────────────────────────────────────────────────────────
function MainFaceSilhouette() {
  // Face oval: cx=260, cy=330, rx=148, ry=200
  return (
    <g fill="none">
      {/* Head */}
      <ellipse cx={MCX} cy={330} rx={150} ry={202} fill={FACE_FILL} stroke={OUTLINE} strokeWidth={2.5} />
      {/* Neck */}
      <rect x={MCX-46} y={510} width={92} height={100} fill={FACE_FILL} />
      <line x1={MCX-46} y1={510} x2={MCX-58} y2={610} stroke={OUTLINE} strokeWidth={2} />
      <line x1={MCX+46} y1={510} x2={MCX+58} y2={610} stroke={OUTLINE} strokeWidth={2} />
      {/* Ears */}
      <ellipse cx={MCX-153} cy={318} rx={13} ry={26} fill={FACE_FILL} stroke={OUTLINE} strokeWidth={2} />
      <ellipse cx={MCX+153} cy={318} rx={13} ry={26} fill={FACE_FILL} stroke={OUTLINE} strokeWidth={2} />
      {/* Brow ridges */}
      <path d={`M ${MCX-32} 192 Q ${MCX-64} 178 ${MCX-100} 194`} stroke={FEATURE} strokeWidth={2} />
      <path d={`M ${MCX+32} 192 Q ${MCX+64} 178 ${MCX+100} 194`} stroke={FEATURE} strokeWidth={2} />
      {/* Eye sockets */}
      <ellipse cx={MCX-72} cy={235} rx={46} ry={28} fill="rgba(0,0,0,0.35)" stroke={FEATURE} strokeWidth={1.5} />
      <ellipse cx={MCX+72} cy={235} rx={46} ry={28} fill="rgba(0,0,0,0.35)" stroke={FEATURE} strokeWidth={1.5} />
      {/* Iris circles */}
      <circle cx={MCX-72} cy={235} r={12} fill="rgba(0,0,0,0.5)" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      <circle cx={MCX+72} cy={235} r={12} fill="rgba(0,0,0,0.5)" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      {/* Nose bridge */}
      <path d={`M ${MCX-10} 200 C ${MCX-14} 270 ${MCX-22} 300 ${MCX-26} 330`} stroke={FEATURE} strokeWidth={1} />
      <path d={`M ${MCX+10} 200 C ${MCX+14} 270 ${MCX+22} 300 ${MCX+26} 330`} stroke={FEATURE} strokeWidth={1} />
      {/* Nose base */}
      <path d={`M ${MCX-34} 336 Q ${MCX-20} 348 ${MCX} 344 Q ${MCX+20} 348 ${MCX+34} 336`} stroke={FEATURE} strokeWidth={1.5} />
      {/* Nostrils */}
      <ellipse cx={MCX-18} cy={340} rx={9} ry={6} fill="rgba(0,0,0,0.5)" stroke={FEATURE} strokeWidth={1} />
      <ellipse cx={MCX+18} cy={340} rx={9} ry={6} fill="rgba(0,0,0,0.5)" stroke={FEATURE} strokeWidth={1} />
      {/* Philtrum */}
      <path d={`M ${MCX-9} 350 L ${MCX-5} 364 L ${MCX+5} 364 L ${MCX+9} 350`} stroke={FEATURE} strokeWidth={1} />
      {/* Lips */}
      <path d={`M ${MCX-54} 378 Q ${MCX-30} 366 ${MCX-10} 370 Q ${MCX} 372 ${MCX+10} 370 Q ${MCX+30} 366 ${MCX+54} 378`}
        stroke={FEATURE} strokeWidth={1.8} />
      <path d={`M ${MCX-54} 378 Q ${MCX-28} 393 ${MCX} 398 Q ${MCX+28} 393 ${MCX+54} 378`}
        fill="rgba(0,0,0,0.3)" stroke={FEATURE} strokeWidth={1.5} />
      <path d={`M ${MCX-54} 378 Q ${MCX} 382 ${MCX+54} 378`} stroke={FEATURE} strokeWidth={0.8} />
      {/* Chin */}
      <path d={`M ${MCX-30} 456 Q ${MCX} 468 ${MCX+30} 456`} stroke={FEATURE} strokeWidth={1} />
      {/* Cheekbones */}
      <path d={`M ${MCX+56} 272 Q ${MCX+95} 285 ${MCX+126} 318`} stroke={FEATURE} strokeWidth={0.8} opacity={0.5} />
      <path d={`M ${MCX-56} 272 Q ${MCX-95} 285 ${MCX-126} 318`} stroke={FEATURE} strokeWidth={0.8} opacity={0.5} />
    </g>
  )
}

function TweakerFaceSilhouette() {
  return (
    <g fill="none">
      <ellipse cx={TCX} cy={330} rx={148} ry={200} fill={FACE_FILL} stroke={OUTLINE} strokeWidth={2.5} />
      <rect x={TCX-44} y={508} width={88} height={90} fill={FACE_FILL} />
      <line x1={TCX-44} y1={508} x2={TCX-56} y2={598} stroke={OUTLINE} strokeWidth={2} />
      <line x1={TCX+44} y1={508} x2={TCX+56} y2={598} stroke={OUTLINE} strokeWidth={2} />
      <ellipse cx={TCX-151} cy={316} rx={12} ry={24} fill={FACE_FILL} stroke={OUTLINE} strokeWidth={2} />
      <ellipse cx={TCX+151} cy={316} rx={12} ry={24} fill={FACE_FILL} stroke={OUTLINE} strokeWidth={2} />
      {/* Brow ridges */}
      <path d={`M ${TCX-30} 188 Q ${TCX-62} 175 ${TCX-98} 190`} stroke={FEATURE} strokeWidth={2} />
      <path d={`M ${TCX+30} 188 Q ${TCX+62} 175 ${TCX+98} 190`} stroke={FEATURE} strokeWidth={2} />
      {/* Eye sockets */}
      <ellipse cx={TCX-70} cy={230} rx={44} ry={27} fill="rgba(0,0,0,0.35)" stroke={FEATURE} strokeWidth={1.5} />
      <ellipse cx={TCX+70} cy={230} rx={44} ry={27} fill="rgba(0,0,0,0.35)" stroke={FEATURE} strokeWidth={1.5} />
      {/* Iris */}
      <circle cx={TCX-70} cy={230} r={11} fill="rgba(0,0,0,0.5)" stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
      <circle cx={TCX+70} cy={230} r={11} fill="rgba(0,0,0,0.5)" stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
      {/* Nose */}
      <path d={`M ${TCX-32} 332 Q ${TCX-20} 344 ${TCX} 340 Q ${TCX+20} 344 ${TCX+32} 332`} stroke={FEATURE} strokeWidth={1.5} />
      <ellipse cx={TCX-17} cy={336} rx={8} ry={5} fill="rgba(0,0,0,0.5)" stroke={FEATURE} strokeWidth={1} />
      <ellipse cx={TCX+17} cy={336} rx={8} ry={5} fill="rgba(0,0,0,0.5)" stroke={FEATURE} strokeWidth={1} />
      {/* Lips */}
      <path d={`M ${TCX-52} 374 Q ${TCX-28} 363 ${TCX} 367 Q ${TCX+28} 363 ${TCX+52} 374`} stroke={FEATURE} strokeWidth={1.8} />
      <path d={`M ${TCX-52} 374 Q ${TCX} 392 ${TCX+52} 374`} fill="rgba(0,0,0,0.3)" stroke={FEATURE} strokeWidth={1.5} />
      {/* Chin */}
      <path d={`M ${TCX-28} 452 Q ${TCX} 464 ${TCX+28} 452`} stroke={FEATURE} strokeWidth={1} />
    </g>
  )
}
