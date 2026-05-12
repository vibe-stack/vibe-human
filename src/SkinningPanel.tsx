import { useRef, type CSSProperties } from 'react'
import {
  DEFAULT_FLIP_NORMAL_Y,
  DEFAULT_OILINESS,
  DEFAULT_PORE_NORMAL_STRENGTH,
  DEFAULT_PORE_SCALE,
  DEFAULT_SUBSURFACE_STRENGTH,
  DEFAULT_SURFACE_ROUGHNESS,
  DEFAULT_TONE_DEPTH,
  DEFAULT_WRINKLE_NORMAL_STRENGTH,
  SKIN_TEXTURE_LABELS,
  SKIN_TEXTURE_SLOTS,
  type SkinTextureSlot,
  type SkinTextures,
} from './skinMaterial'

type Props = {
  textures: SkinTextures
  poreScale: number
  poreNormalStrength: number
  wrinkleNormalStrength: number
  flipNormalY: boolean
  oiliness: number
  surfaceRoughness: number
  toneDepth: number
  subsurfaceStrength: number
  onTextures: (textures: SkinTextures) => void
  onPoreScale: (scale: number) => void
  onPoreNormalStrength: (strength: number) => void
  onWrinkleNormalStrength: (strength: number) => void
  onFlipNormalY: (flip: boolean) => void
  onOiliness: (v: number) => void
  onSurfaceRoughness: (v: number) => void
  onToneDepth: (v: number) => void
  onSubsurfaceStrength: (v: number) => void
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

const scrollbarStyle = `
  .skin-scroll::-webkit-scrollbar { width: 4px; }
  .skin-scroll::-webkit-scrollbar-track { background: transparent; }
  .skin-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
  .skin-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
`

export default function SkinningPanel({
  textures,
  poreScale,
  poreNormalStrength,
  wrinkleNormalStrength,
  flipNormalY,
  oiliness,
  surfaceRoughness,
  toneDepth,
  subsurfaceStrength,
  onTextures,
  onPoreScale,
  onPoreNormalStrength,
  onWrinkleNormalStrength,
  onFlipNormalY,
  onOiliness,
  onSurfaceRoughness,
  onToneDepth,
  onSubsurfaceStrength,
}: Props) {
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const handleUpload = (slot: SkinTextureSlot, file: File) => {
    const prev = textures[slot]
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
    onTextures({ ...textures, [slot]: URL.createObjectURL(file) })
  }

  const handleReset = (slot: SkinTextureSlot) => {
    const prev = textures[slot]
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
    const next = { ...textures }
    delete next[slot]
    onTextures(next)
  }

  const resetAll = () => {
    for (const slot of SKIN_TEXTURE_SLOTS) {
      const prev = textures[slot]
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
    }
    onPoreScale(DEFAULT_PORE_SCALE)
    onPoreNormalStrength(DEFAULT_PORE_NORMAL_STRENGTH)
    onWrinkleNormalStrength(DEFAULT_WRINKLE_NORMAL_STRENGTH)
    onFlipNormalY(DEFAULT_FLIP_NORMAL_Y)
    onOiliness(DEFAULT_OILINESS)
    onSurfaceRoughness(DEFAULT_SURFACE_ROUGHNESS)
    onToneDepth(DEFAULT_TONE_DEPTH)
    onSubsurfaceStrength(DEFAULT_SUBSURFACE_STRENGTH)
    onTextures({})
  }

  const customCount =
    SKIN_TEXTURE_SLOTS.filter((s) => textures[s] !== undefined).length +
    (poreScale !== DEFAULT_PORE_SCALE ? 1 : 0) +
    (poreNormalStrength !== DEFAULT_PORE_NORMAL_STRENGTH ? 1 : 0) +
    (wrinkleNormalStrength !== DEFAULT_WRINKLE_NORMAL_STRENGTH ? 1 : 0) +
    (flipNormalY !== DEFAULT_FLIP_NORMAL_Y ? 1 : 0) +
    (oiliness !== DEFAULT_OILINESS ? 1 : 0) +
    (surfaceRoughness !== DEFAULT_SURFACE_ROUGHNESS ? 1 : 0) +
    (toneDepth !== DEFAULT_TONE_DEPTH ? 1 : 0) +
    (subsurfaceStrength !== DEFAULT_SUBSURFACE_STRENGTH ? 1 : 0)

  const sliderRow = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    defaultValue: number,
    onChange: (value: number) => void,
  ) => (
    <div style={{ padding: '9px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
        <span style={{ ...labelStyle, color: 'rgba(255,255,255,0.48)' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => {
              const next = Number(e.target.value)
              if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)))
            }}
            style={{
              width: 48,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 3,
              color: 'rgba(255,255,255,0.66)',
              fontSize: 10,
              fontFamily: 'monospace',
              padding: '2px 4px',
            }}
          />
          {value !== defaultValue && (
            <button
              onClick={() => onChange(defaultValue)}
              title={`Reset ${label.toLowerCase()}`}
              style={{
                background: 'none',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 3,
                cursor: 'pointer',
                color: 'rgba(255,255,255,0.35)',
                fontSize: 11,
                padding: '1px 5px',
                lineHeight: 1.4,
              }}
            >
              ↺
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#7dd3fc' }}
      />
    </div>
  )

  const sectionLabel = (text: string) => (
    <div style={{
      padding: '8px 12px 4px',
      fontSize: 8,
      fontWeight: 700,
      letterSpacing: '0.16em',
      color: 'rgba(255,255,255,0.2)',
      fontFamily: 'monospace',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      {text}
    </div>
  )

  return (
    <>
      <style>{scrollbarStyle}</style>
      <div style={{ position: 'fixed', left: 16, bottom: 16, width: 300, zIndex: 11, userSelect: 'none', ...panelBg }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          <span style={labelStyle}>SKIN TEXTURES</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {customCount > 0 && (
              <span style={{ fontSize: 9, color: 'rgba(125,211,252,0.68)', fontFamily: 'monospace' }}>
                {customCount} CUSTOM
              </span>
            )}
            {customCount > 0 && (
              <button
                onClick={resetAll}
                style={{
                  background: 'none',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 3,
                  cursor: 'pointer',
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: 9,
                  padding: '2px 6px',
                  fontFamily: 'monospace',
                }}
              >
                RESET ALL
              </button>
            )}
          </div>
        </div>

        <div className="skin-scroll" style={{ padding: '4px 0', maxHeight: 480, overflowY: 'auto' }}>

          {sectionLabel('APPEARANCE')}
          {sliderRow('OILINESS', oiliness, 0, 1, 0.01, DEFAULT_OILINESS, onOiliness)}
          {sliderRow('SURFACE ROUGHNESS', surfaceRoughness, 0.1, 1, 0.01, DEFAULT_SURFACE_ROUGHNESS, onSurfaceRoughness)}
          {sliderRow('TONE DEPTH', toneDepth, 0, 1, 0.01, DEFAULT_TONE_DEPTH, onToneDepth)}
          {sliderRow('SUBSURFACE', subsurfaceStrength, 0, 1, 0.01, DEFAULT_SUBSURFACE_STRENGTH, onSubsurfaceStrength)}

          {sectionLabel('DETAIL')}
          {sliderRow('PORE SCALE', poreScale, 4, 90, 1, DEFAULT_PORE_SCALE, onPoreScale)}
          {sliderRow('PORE NORMAL', poreNormalStrength, 0, 2, 0.05, DEFAULT_PORE_NORMAL_STRENGTH, onPoreNormalStrength)}
          {sliderRow('WRINKLE NORMAL', wrinkleNormalStrength, 0, 2, 0.05, DEFAULT_WRINKLE_NORMAL_STRENGTH, onWrinkleNormalStrength)}

          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '9px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            <span style={{ ...labelStyle, color: 'rgba(255,255,255,0.48)' }}>FLIP NORMAL Y</span>
            <input
              type="checkbox"
              checked={flipNormalY}
              onChange={(e) => onFlipNormalY(e.target.checked)}
              style={{ accentColor: '#7dd3fc' }}
            />
          </div>

          {sectionLabel('TEXTURES')}
          {SKIN_TEXTURE_SLOTS.map((slot) => {
            const isCustom = textures[slot] !== undefined
            return (
              <div
                key={slot}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '6px 12px',
                  gap: 8,
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
              >
                <span style={{
                  flex: 1,
                  fontSize: 10,
                  color: isCustom ? 'rgba(125,211,252,0.9)' : 'rgba(255,255,255,0.55)',
                  fontFamily: 'monospace',
                }}>
                  {SKIN_TEXTURE_LABELS[slot]}
                </span>

                <span style={{
                  fontSize: 8,
                  color: isCustom ? 'rgba(125,211,252,0.5)' : 'rgba(255,255,255,0.18)',
                  fontFamily: 'monospace',
                  minWidth: 42,
                  textAlign: 'right',
                }}>
                  {isCustom ? 'CUSTOM' : 'DEFAULT'}
                </span>

                {isCustom && (
                  <button
                    onClick={() => handleReset(slot)}
                    title="Reset to default"
                    style={{
                      background: 'none',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 3,
                      cursor: 'pointer',
                      color: 'rgba(255,255,255,0.35)',
                      fontSize: 11,
                      padding: '1px 5px',
                      lineHeight: 1.4,
                    }}
                  >
                    ↺
                  </button>
                )}

                <button
                  onClick={() => inputRefs.current[slot]?.click()}
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 3,
                    cursor: 'pointer',
                    color: 'rgba(255,255,255,0.55)',
                    fontSize: 9,
                    padding: '3px 7px',
                    fontFamily: 'monospace',
                    flexShrink: 0,
                  }}
                >
                  UPLOAD
                </button>

                <input
                  ref={(el) => { inputRefs.current[slot] = el }}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleUpload(slot, file)
                    e.target.value = ''
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
