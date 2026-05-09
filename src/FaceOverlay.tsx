import { useRef, useState, type PointerEvent as PE } from 'react'
import { FACS_CONTROLS, FACS_VALUE_MAX, type EyeLookValues, type FacsValues } from './facs'

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

type MainControl = DotControl | EyePad | FacsPad

// ── Main panel controls ────────────────────────────────────────────────────────
// Face oval: cx=260, cy=310, rx=148, ry=188
// Brows:  y≈185-195
// Eyes:   y≈225-245  (eye centre: L=190, R=330)
// Nose:   y≈310-340
// Mouth:  y≈370-420
// Jaw:    y≈450-510
const MAIN: MainControl[] = [
  // ── Forehead / Brows ──────────────────────────────────────────────────────
  { kind:'dot', id:'au01_inner_brow_raiser_l', label:'INNER BROW',   ax:237, ay:186, lx:-0.6, ly:-0.8, ll:52 },
  { kind:'dot', id:'au02_outer_brow_raiser_l', label:'OUTER BROW',   ax:192, ay:182, lx:-1,   ly:-0.4, ll:62 },
  { kind:'dot', id:'au04_brow_lowerer_l',      label:'BROW LOWER',   ax:212, ay:198, lx:-1,   ly: 0.2, ll:58 },
  { kind:'dot', id:'brow_compress',            label:'COMPRESS',      ax:260, ay:188, lx: 0,   ly:-1,   ll:42 },
  { kind:'dot', id:'scowl',                    label:'SCOWL',         ax:260, ay:204, lx: 0.8, ly:-0.6, ll:52 },
  // right side
  { kind:'dot', id:'au01_inner_brow_raiser_r', label:'',              ax:283, ay:186, lx: 0.6, ly:-0.8, ll:52 },
  { kind:'dot', id:'au02_outer_brow_raiser_r', label:'',              ax:328, ay:182, lx: 1,   ly:-0.4, ll:62 },
  { kind:'dot', id:'au04_brow_lowerer_r',      label:'',              ax:308, ay:198, lx: 1,   ly: 0.2, ll:58 },

  // ── Eye sockets — XY pads ─────────────────────────────────────────────────
  { kind:'eyepad', eye:'L', label:'EYE L', ax:190, ay:236, w:80, h:56 },
  { kind:'eyepad', eye:'R', label:'EYE R', ax:330, ay:236, w:80, h:56 },

  // ── Eye lid controls ──────────────────────────────────────────────────────
  { kind:'dot', id:'au05_upper_lid_raiser_l', label:'LID RAISE', ax:143, ay:224, lx:-1,  ly:-0.3, ll:56 },
  { kind:'dot', id:'au07_lid_tightener_l',    label:'SQUINT',    ax:140, ay:240, lx:-1,  ly: 0.2, ll:54 },
  { kind:'dot', id:'au43_eye_closure_l',      label:'BLINK',     ax:143, ay:256, lx:-1,  ly: 0.6, ll:50 },
  { kind:'dot', id:'glare_l',                 label:'GLARE',     ax:156, ay:264, lx:-0.8,ly: 0.8, ll:46 },
  { kind:'dot', id:'au05_upper_lid_raiser_r', label:'',          ax:377, ay:224, lx: 1,  ly:-0.3, ll:56 },
  { kind:'dot', id:'au07_lid_tightener_r',    label:'',          ax:380, ay:240, lx: 1,  ly: 0.2, ll:54 },
  { kind:'dot', id:'au43_eye_closure_r',      label:'',          ax:377, ay:256, lx: 1,  ly: 0.6, ll:50 },
  { kind:'dot', id:'glare_r',                 label:'',          ax:364, ay:264, lx: 0.8,ly: 0.8, ll:46 },

  // ── Cheeks ────────────────────────────────────────────────────────────────
  { kind:'dot', id:'au06_cheek_raiser_l', label:'CHEEK',      ax:162, ay:288, lx:-1, ly: 0,   ll:64 },
  { kind:'dot', id:'cheek_puff',          label:'CHEEK PUFF', ax:150, ay:305, lx:-1, ly: 0.4, ll:66 },
  { kind:'dot', id:'au06_cheek_raiser_r', label:'',           ax:358, ay:288, lx: 1, ly: 0,   ll:64 },
  { kind:'dot', id:'cheek_puff',          label:'',           ax:370, ay:305, lx: 1, ly: 0.4, ll:66 },

  // ── Nose (bilateral — one control moves both) ──────────────────────────────
  { kind:'dot', id:'au09_nose_wrinkler',   label:'NOSE WRK', ax:238, ay:318, lx:-0.9, ly: 0.4, ll:48 },
  { kind:'dot', id:'au38_nostril_dilator', label:'NOSTRIL',  ax:238, ay:336, lx:-0.9, ly: 0.8, ll:44 },
  { kind:'dot', id:'au09_nose_wrinkler',   label:'',         ax:282, ay:318, lx: 0.9, ly: 0.4, ll:48 },
  { kind:'dot', id:'au38_nostril_dilator', label:'',         ax:282, ay:336, lx: 0.9, ly: 0.8, ll:44 },

  // ── Mouth corners — XY pads ───────────────────────────────────────────────
  {
    kind:'facspad',
    idX:'au12_lip_corner_puller_l', idXNeg:'au15_lip_corner_depressor_l',
    idY:'au10_upper_lip_raiser_l',  idYNeg:'snarl_l',
    label:'CORNER L',
    ax:185, ay:388, w:62, h:54,
  },
  {
    kind:'facspad',
    idX:'au15_lip_corner_depressor_r', idXNeg:'au12_lip_corner_puller_r',
    idY:'au10_upper_lip_raiser_r',     idYNeg:'snarl_r',
    label:'CORNER R',
    ax:335, ay:388, w:62, h:54,
  },

  // ── Lip centre dots ───────────────────────────────────────────────────────
  { kind:'dot', id:'au25_lips_part',          label:'PART',    ax:260, ay:364, lx:-0.5, ly:-1,   ll:36 },
  { kind:'dot', id:'au18_lip_pucker',         label:'PUCKER',  ax:248, ay:378, lx:-1,   ly:-0.3, ll:46 },
  { kind:'dot', id:'mouth_funnel',            label:'FUNNEL',  ax:272, ay:378, lx: 1,   ly:-0.3, ll:46 },
  { kind:'dot', id:'au23_lip_tightener',      label:'TIGHTEN', ax:248, ay:393, lx:-1,   ly: 0,   ll:46 },
  { kind:'dot', id:'au24_lip_pressor',        label:'PRESS',   ax:272, ay:393, lx: 1,   ly: 0,   ll:46 },
  { kind:'dot', id:'au20_lip_stretcher_l',    label:'STRETCH', ax:248, ay:408, lx:-1,   ly: 0.4, ll:46 },
  { kind:'dot', id:'mouth_suck',              label:'SUCK',    ax:272, ay:408, lx: 1,   ly: 0.4, ll:46 },
  { kind:'dot', id:'au14_dimpler_l',          label:'DIMPLE L',ax:218, ay:398, lx:-1,   ly: 0.3, ll:44 },
  { kind:'dot', id:'au14_dimpler_r',          label:'',        ax:302, ay:398, lx: 1,   ly: 0.3, ll:44 },
  { kind:'dot', id:'lips_bite',               label:'BITE',    ax:260, ay:420, lx: 0,   ly: 1,   ll:32 },
  { kind:'dot', id:'au16_lower_lip_depressor_l', label:'LIP ↓', ax:248, ay:432, lx:-0.7, ly: 1, ll:36 },
  { kind:'dot', id:'au17_chin_raiser',        label:'CHIN',    ax:272, ay:432, lx: 0.7, ly: 1,   ll:36 },
  { kind:'dot', id:'lip_roll_lower',          label:'ROLL ↓',  ax:238, ay:445, lx:-1,   ly: 0.6, ll:40 },
  { kind:'dot', id:'lip_roll_upper',          label:'ROLL ↑',  ax:282, ay:445, lx: 1,   ly: 0.6, ll:40 },
  { kind:'dot', id:'tongue_out',              label:'TONGUE',  ax:260, ay:456, lx: 0,   ly: 1,   ll:30 },

  // ── Jaw pad ───────────────────────────────────────────────────────────────
  {
    kind:'facspad',
    idX:'jaw_left', idXNeg:'jaw_right',
    idY:'au26_jaw_drop', idYNeg:'jaw_forward',
    label:'JAW',
    ax:260, ay:522, w:86, h:70,
  },
  { kind:'dot', id:'au27_mouth_stretch', label:'WIDE', ax:194, ay:508, lx:-1, ly:-0.3, ll:50 },
  { kind:'dot', id:'au27_mouth_stretch', label:'',     ax:326, ay:508, lx: 1, ly:-0.3, ll:50 },
  { kind:'dot', id:'scowl',             label:'',      ax:194, ay:540, lx:-1, ly: 0.4, ll:48 },
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
  // ── Per-eye lid sliders inside socket areas ────────────────────────────────
  // Left eye socket centre ~(130, 210)
  { kind:'teyepad', eye:'L', label:'EYE L', ax:130, ay:210, w:100, h:70 },
  // Right eye socket centre ~(270, 210)
  { kind:'teyepad', eye:'R', label:'EYE R', ax:270, ay:210, w:100, h:70 },

  // Individual lid sliders beside sockets — L side
  { kind:'tslider', id:'au05_upper_lid_raiser_l', label:'LID↑',   ax: 72, ay:194, length:40, axis:'v' },
  { kind:'tslider', id:'au07_lid_tightener_l',    label:'SQUINT',  ax: 72, ay:216, length:40, axis:'v' },
  { kind:'tslider', id:'au43_eye_closure_l',      label:'BLINK',   ax: 72, ay:232, length:40, axis:'v' },
  // R side
  { kind:'tslider', id:'au05_upper_lid_raiser_r', label:'',        ax:328, ay:194, length:40, axis:'v' },
  { kind:'tslider', id:'au07_lid_tightener_r',    label:'',        ax:328, ay:216, length:40, axis:'v' },
  { kind:'tslider', id:'au43_eye_closure_r',      label:'',        ax:328, ay:232, length:40, axis:'v' },

  // ── Brow fine controls ─────────────────────────────────────────────────────
  { kind:'tslider', id:'au01_inner_brow_raiser_l', label:'INNER↑', ax:110, ay:148, length:44, axis:'v' },
  { kind:'tslider', id:'au02_outer_brow_raiser_l', label:'OUTER↑', ax: 88, ay:148, length:44, axis:'v' },
  { kind:'tslider', id:'au04_brow_lowerer_l',      label:'LOWER',  ax: 66, ay:148, length:44, axis:'v' },
  { kind:'tslider', id:'au01_inner_brow_raiser_r', label:'',       ax:290, ay:148, length:44, axis:'v' },
  { kind:'tslider', id:'au02_outer_brow_raiser_r', label:'',       ax:312, ay:148, length:44, axis:'v' },
  { kind:'tslider', id:'au04_brow_lowerer_r',      label:'',       ax:334, ay:148, length:44, axis:'v' },

  // ── Lip push/pull XY pads ─────────────────────────────────────────────────
  {
    kind:'txy',
    idX:'au18_lip_pucker', idXNeg:'au20_lip_stretcher_l',
    idY:'lip_roll_upper',  idYNeg:'au24_lip_pressor',
    label:'UPPER LIP',
    ax:122, ay:380, w:68, h:58,
  },
  {
    kind:'txy',
    idX:'mouth_funnel', idXNeg:'mouth_suck',
    idY:'au25_lips_part', idYNeg:'au23_lip_tightener',
    label:'LIP CTR',
    ax:200, ay:380, w:68, h:58,
  },
  {
    kind:'txy',
    idX:'au16_lower_lip_depressor_l', idXNeg:'au17_chin_raiser',
    idY:'lips_bite',                  idYNeg:'lip_roll_lower',
    label:'LOWER LIP',
    ax:278, ay:380, w:68, h:58,
  },

  // ── Nose tweakers ─────────────────────────────────────────────────────────
  { kind:'tslider', id:'au09_nose_wrinkler',   label:'WRINKLE', ax:170, ay:295, length:52, axis:'h' },
  { kind:'tslider', id:'au38_nostril_dilator', label:'NOSTRIL', ax:170, ay:312, length:52, axis:'h' },
  { kind:'tslider', id:'cheek_puff',           label:'PUFF',    ax:170, ay:328, length:52, axis:'h' },

  // ── Performance sliders ────────────────────────────────────────────────────
  { kind:'tslider', id:'scowl',                label:'SCOWL',   ax: 86, ay:472, length:56, axis:'v' },
  { kind:'tslider', id:'snarl_l',              label:'SNARL L', ax:110, ay:472, length:56, axis:'v' },
  { kind:'tslider', id:'snarl_r',              label:'SNARL R', ax:134, ay:472, length:56, axis:'v' },
  { kind:'tslider', id:'glare_l',              label:'GLARE L', ax:158, ay:472, length:56, axis:'v' },
  { kind:'tslider', id:'tongue_out',           label:'TONGUE',  ax:182, ay:472, length:56, axis:'v' },
  { kind:'tslider', id:'lips_bite',            label:'BITE',    ax:206, ay:472, length:56, axis:'v' },
  { kind:'tslider', id:'mouth_suck',           label:'SUCK',    ax:230, ay:472, length:56, axis:'v' },
  { kind:'tslider', id:'au14_dimpler_l',       label:'DIMPLE',  ax:254, ay:472, length:56, axis:'v' },
]

// ── Drag state ────────────────────────────────────────────────────────────────
type DotDrag    = { kind:'dot';    id:string; startY:number; startVal:number; maxVal:number }
type EyeDrag    = { kind:'eye';    eye:'L'|'R'; startX:number; startY:number; startVX:number; startVY:number }
type PadDrag    = { kind:'pad';    idX:string; idXNeg?:string; idY:string; idYNeg?:string; w:number; h:number; startX:number; startY:number; startVals:Record<string,number> }
type SliderDrag = { kind:'slider'; id:string; axis:'v'|'h'; startX:number; startY:number; startVal:number; maxVal:number; length:number }
type AnyDrag    = DotDrag | EyeDrag | PadDrag | SliderDrag

// ── Helpers ───────────────────────────────────────────────────────────────────
const getMax = (id: string) => FACS_CONTROLS.find(c => c.id === id)?.max ?? FACS_VALUE_MAX

// ── Props ─────────────────────────────────────────────────────────────────────
type Props = {
  facsValues: FacsValues
  eyeLook2D: EyeLookValues
  onChange: (id: string, value: number) => void
  onEyeLook2D: (v: EyeLookValues) => void
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function FaceOverlay({ facsValues, eyeLook2D, onChange, onEyeLook2D }: Props) {
  return (
    <div style={{ display:'flex', gap:0, alignItems:'stretch', width:'100%', height:'100%' }}>
      <div style={{ flex:'0 0 56.5%', minWidth:0, height:'100%' }}>
        <MainPanel facsValues={facsValues} eyeLook2D={eyeLook2D} onChange={onChange} onEyeLook2D={onEyeLook2D} />
      </div>
      <div style={{ flex:'0 0 43.5%', minWidth:0, height:'100%' }}>
        <TweakersPanel facsValues={facsValues} eyeLook2D={eyeLook2D} onChange={onChange} onEyeLook2D={onEyeLook2D} />
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
function MainPanel({ facsValues, eyeLook2D, onChange, onEyeLook2D }: Props) {
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
      onChange(d.id, nv)
    } else if (d.kind === 'eye') {
      const dx = (e.clientX - d.startX) / (40 * s)
      const dy = -(e.clientY - d.startY) / (30 * s)
      const nx = Math.max(-1, Math.min(1, d.startVX + dx))
      const ny = Math.max(-1, Math.min(1, d.startVY + dy))
      onEyeLook2D(d.eye === 'L'
        ? { ...eyeLook2D, leftX: nx, leftY: ny }
        : { ...eyeLook2D, rightX: nx, rightY: ny })
    } else if (d.kind === 'pad') {
      const dx = (e.clientX - d.startX) / (d.w * 0.45 * s)
      const dy = -(e.clientY - d.startY) / (d.h * 0.45 * s)
      applyPad(d, dx, dy, onChange)
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
            <DotNode key={i} ctrl={ctrl} t={t} isActive={isActive}
              onPointerDown={e => {
                e.currentTarget.setPointerCapture(e.pointerId)
                dragRef.current = { kind:'dot', id:ctrl.id, startY:e.clientY, startVal:val, maxVal:mx }
                setActiveKey(`dot:${ctrl.id}:${i}`)
              }}
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
            />
          )
        } else {
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
            />
          )
        }
      })}
    </svg>
  )
}

// ── Tweakers panel ─────────────────────────────────────────────────────────────
function TweakersPanel({ facsValues, eyeLook2D, onChange, onEyeLook2D }: Props) {
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
      onChange(d.id, nv)
    } else if (d.kind === 'pad') {
      const dx = (e.clientX - d.startX) / (d.w * 0.45 * s)
      const dy = -(e.clientY - d.startY) / (d.h * 0.45 * s)
      applyPad(d, dx, dy, onChange)
    } else if (d.kind === 'eye') {
      const dx = (e.clientX - d.startX) / (40 * s)
      const dy = -(e.clientY - d.startY) / (30 * s)
      const nx = Math.max(-1, Math.min(1, d.startVX + dx))
      const ny = Math.max(-1, Math.min(1, d.startVY + dy))
      onEyeLook2D(d.eye === 'L'
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
          const ly = vert ? ctrl.ay + half + 13 : ctrl.ay + 14
          return (
            <g key={i} onPointerDown={e => {
              e.currentTarget.setPointerCapture(e.pointerId)
              dragRef.current = { kind:'slider', id:ctrl.id, axis:ctrl.axis,
                startX:e.clientX, startY:e.clientY, startVal:val, maxVal:mx, length:ctrl.length }
              setActiveKey(`ts:${ctrl.id}:${i}`)
            }} style={{ cursor: vert ? 'ns-resize' : 'ew-resize' }}>
              <rect x={vert?ctrl.ax-10:ctrl.ax-half-6} y={vert?ctrl.ay-half-6:ctrl.ay-10}
                width={vert?20:ctrl.length+12} height={vert?ctrl.length+12:20} fill="transparent" />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={FEATURE} strokeWidth={2} strokeLinecap="round" />
              <line x1={vert?ctrl.ax:ctrl.ax-half} y1={vert?ctrl.ay+half:ctrl.ay}
                x2={tx} y2={ty}
                stroke={isActive||val>0.01?DOT:FEATURE} strokeWidth={3} strokeLinecap="round" opacity={isActive?1:0.8} />
              <circle cx={tx} cy={ty} r={isActive?7:5} fill={isActive?DOT_ACTIVE:DOT} opacity={isActive?1:val>0.01?0.9:0.45} />
              {isActive && <circle cx={tx} cy={ty} r={11} fill={DOT_GLOW} />}
              {ctrl.label && (
                <text x={lx} y={ly} textAnchor="middle" fontSize={7} fontFamily={FONT} fontWeight="bold"
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
            }} style={{ cursor:'crosshair' }}>
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

// ── DotNode ───────────────────────────────────────────────────────────────────
function DotNode({ ctrl, t, isActive, onPointerDown }: {
  ctrl: DotControl; t: number; isActive: boolean; onPointerDown: (e:PE<SVGCircleElement>)=>void
}) {
  const r = isActive ? 9 : t > 0.01 ? 7 : 6
  const hasLabel = ctrl.label.length > 0
  const lx = ctrl.ax + ctrl.lx * ctrl.ll
  const ly = ctrl.ay + ctrl.ly * ctrl.ll
  const anchor = ctrl.lx > 0.1 ? 'start' : ctrl.lx < -0.1 ? 'end' : 'middle'

  return (
    <g>
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
function EyePadNode({ ctrl, ex, ey, isActive, onPointerDown }: {
  ctrl: EyePad; ex:number; ey:number; isActive:boolean; onPointerDown:(e:PE<SVGRectElement>)=>void
}) {
  const hw = ctrl.w/2, hh = ctrl.h/2
  const dotX = ctrl.ax + ex * hw
  const dotY = ctrl.ay - ey * hh
  const active = Math.abs(ex)>0.02 || Math.abs(ey)>0.02
  return (
    <g>
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
function FacsPadNode({ ctrl, vals, isActive, onPointerDown }: {
  ctrl: FacsPad; vals:FacsValues; isActive:boolean; onPointerDown:(e:PE<SVGRectElement>)=>void
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
    <g>
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
function TweakerXYNode({ ctrl, vals, isActive, onPointerDown }: {
  ctrl:TweakerXY; vals:FacsValues; isActive:boolean; onPointerDown:(e:PE<SVGRectElement>)=>void
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
    <g>
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
      <path d={`M ${TCX-32} 332 Q ${MCX-20} 344 ${TCX} 340 Q ${TCX+20} 344 ${TCX+32} 332`} stroke={FEATURE} strokeWidth={1.5} />
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
