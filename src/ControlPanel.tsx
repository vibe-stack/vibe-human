import { useState } from 'react'
import { EMOTION_KEYS, EMOTIONS } from './emotions'

type Props = {
  emotion: string
  intensity: number
  wireframe: boolean
  fov: number
  onEmotion: (e: string) => void
  onIntensity: (v: number) => void
  onWireframe: (v: boolean) => void
  onFov: (v: number) => void
}

export default function ControlPanel({
  emotion,
  intensity,
  wireframe,
  fov,
  onEmotion,
  onIntensity,
  onWireframe,
  onFov,
}: Props) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div
      className="fixed bottom-6 right-6 z-10"
      style={{ userSelect: 'none' }}
    >
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(10, 10, 14, 0.72)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
          width: 280,
        }}
      >
        {/* Header */}
        <button
          className="flex items-center justify-between w-full px-4 py-3 cursor-pointer"
          onClick={() => setCollapsed((c) => !c)}
          style={{ background: 'transparent', border: 'none', color: 'inherit' }}
        >
          <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Face Controls
          </span>
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            style={{
              opacity: 0.3,
              transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          >
            <path d="M2 4l4 4 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {!collapsed && (
          <div className="px-4 pb-4 flex flex-col gap-4">
            {/* Emotion grid */}
            <div>
              <Label>Emotion</Label>
              <div className="grid grid-cols-3 gap-1.5 mt-2">
                {EMOTION_KEYS.map((key) => (
                  <button
                    key={key}
                    onClick={() => onEmotion(key)}
                    className="rounded-xl py-2 px-1 text-xs font-medium transition-all duration-150"
                    style={{
                      background: emotion === key
                        ? 'rgba(139, 92, 246, 0.35)'
                        : 'rgba(255,255,255,0.04)',
                      border: emotion === key
                        ? '1px solid rgba(139, 92, 246, 0.6)'
                        : '1px solid rgba(255,255,255,0.06)',
                      color: emotion === key ? 'rgba(200,180,255,1)' : 'rgba(255,255,255,0.45)',
                      cursor: 'pointer',
                    }}
                  >
                    {EMOTIONS[key].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Intensity */}
            <div>
              <div className="flex justify-between items-center">
                <Label>Intensity</Label>
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {Math.round(intensity * 100)}%
                </span>
              </div>
              <input
                type="range" min={0} max={1} step={0.01}
                value={intensity}
                onChange={(e) => onIntensity(parseFloat(e.target.value))}
                className="range-slider mt-1.5"
              />
            </div>

            {/* FOV */}
            <div>
              <div className="flex justify-between items-center">
                <Label>Field of View</Label>
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {fov}°
                </span>
              </div>
              <input
                type="range" min={20} max={90} step={1}
                value={fov}
                onChange={(e) => onFov(parseInt(e.target.value))}
                className="range-slider mt-1.5"
              />
            </div>

            {/* Toggles */}
            <div className="flex gap-2">
              <Toggle active={wireframe} onClick={() => onWireframe(!wireframe)}>
                Wireframe
              </Toggle>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>
      {children}
    </span>
  )
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 rounded-xl py-2 text-xs font-medium transition-all duration-150"
      style={{
        background: active ? 'rgba(139, 92, 246, 0.25)' : 'rgba(255,255,255,0.04)',
        border: active ? '1px solid rgba(139, 92, 246, 0.5)' : '1px solid rgba(255,255,255,0.06)',
        color: active ? 'rgba(200,180,255,1)' : 'rgba(255,255,255,0.4)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}
