import { useSnapshot } from 'valtio'
import { clothingStore } from '../state/clothingStore'
import { resetSim, setActiveClothingTool, toggleSimRunning } from '../state/clothingActions'
import type { ClothingTool } from '../state/clothingTypes'

type ToolDef = {
  id: ClothingTool
  label: string
  shortcut: string
}

const TOOLS: ToolDef[] = [
  { id: 'select',      label: 'Select',      shortcut: 'S' },
  { id: 'edit-points', label: 'Edit Points', shortcut: 'E' },
  { id: 'draw',        label: 'Draw',        shortcut: 'D' },
  { id: 'seam',        label: 'Seam',        shortcut: 'M' },
  { id: 'pan',         label: 'Pan',         shortcut: 'Space' },
]

export default function ClothingToolbar() {
  const { activeClothingTool, simRunning } = useSnapshot(clothingStore)

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      padding: '4px 8px',
      background: 'rgba(8,8,16,0.9)',
      borderBottom: '1px solid rgba(255,255,255,0.07)',
      flexShrink: 0,
    }}>
      {TOOLS.map((tool) => {
        const active = activeClothingTool === tool.id
        return (
          <button
            key={tool.id}
            onClick={() => setActiveClothingTool(tool.id)}
            title={`${tool.label} (${tool.shortcut})`}
            style={{
              padding: '3px 10px',
              fontSize: 10,
              fontFamily: "'Courier New', monospace",
              fontWeight: 700,
              letterSpacing: '0.08em',
              background: active ? 'rgba(68,136,255,0.25)' : 'transparent',
              border: active ? '1px solid rgba(68,136,255,0.6)' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: 4,
              color: active ? '#88bbff' : 'rgba(255,255,255,0.45)',
              cursor: 'pointer',
              transition: 'all 0.12s',
            }}
          >
            {tool.label.toUpperCase()}
          </button>
        )
      })}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Sim play/stop button */}
      <button
        onClick={toggleSimRunning}
        title={simRunning ? 'Pause Rapier cloth simulation' : 'Run Rapier cloth simulation'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 12px',
          fontSize: 10,
          fontFamily: "'Courier New', monospace",
          fontWeight: 700,
          letterSpacing: '0.08em',
          background: simRunning ? 'rgba(255,60,60,0.22)' : 'rgba(60,200,100,0.18)',
          border: simRunning ? '1px solid rgba(255,80,80,0.55)' : '1px solid rgba(60,220,100,0.45)',
          borderRadius: 4,
          color: simRunning ? '#ff7070' : '#60dd80',
          cursor: 'pointer',
          transition: 'all 0.12s',
        }}
      >
        {simRunning ? (
          <>
            <span style={{ fontSize: 9 }}>■</span>
            STOP SIM
          </>
        ) : (
          <>
            <span style={{ fontSize: 9 }}>▶</span>
            RUN SIM
          </>
        )}
      </button>
      <button
        onClick={resetSim}
        title="Reset cloth on top of the head"
        style={{
          padding: '3px 10px',
          fontSize: 10,
          fontFamily: "'Courier New', monospace",
          fontWeight: 700,
          letterSpacing: '0.08em',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.16)',
          borderRadius: 4,
          color: 'rgba(255,255,255,0.62)',
          cursor: 'pointer',
          transition: 'all 0.12s',
        }}
      >
        RESET
      </button>
    </div>
  )
}
