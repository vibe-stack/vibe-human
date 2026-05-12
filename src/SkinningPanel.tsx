import { useRef, type CSSProperties } from 'react'
import {
  SKIN_TEXTURE_LABELS,
  SKIN_TEXTURE_SLOTS,
  type SkinTextureSlot,
  type SkinTextures,
} from './skinMaterial'

type Props = {
  textures: SkinTextures
  onTextures: (textures: SkinTextures) => void
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

export default function SkinningPanel({ textures, onTextures }: Props) {
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
    onTextures({})
  }

  const customCount = SKIN_TEXTURE_SLOTS.filter((s) => textures[s] !== undefined).length

  return (
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

      <div style={{ padding: '4px 0', maxHeight: 400, overflowY: 'auto' }}>
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
  )
}
