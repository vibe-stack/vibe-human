import {
  ChartSpline,
  Circle as CircleIcon,
  Copy,
  GitMerge,
  Hand,
  Hexagon,
  MousePointer2,
  Pause,
  Move3d,
  Pen,
  PenTool,
  Play,
  Redo2,
  RotateCcw,
  Scissors,
  Square,
  Trash2,
  Undo2,
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { clothingStore } from '../state/clothingStore'
import {
  deletePieces,
  duplicatePieces,
  redo,
  resetPatternTransforms,
  resetSim,
  setActiveClothingTool,
  subtractTopFromSelection,
  toggleSimRunning,
  undo,
} from '../state/clothingActions'
import type { ClothingTool } from '../state/clothingTypes'

type LucideIcon = ComponentType<{ size?: number; strokeWidth?: number }>

type ToolDef = {
  id: ClothingTool
  label: string
  Icon: LucideIcon
  shortcut: string
}

const TOOLS: ToolDef[] = [
  { id: 'select',      label: 'Select',  Icon: MousePointer2, shortcut: 'V' },
  { id: 'edit-points', label: 'Edit',    Icon: PenTool,       shortcut: 'A' },
  { id: 'rect',        label: 'Rect',    Icon: Square,        shortcut: 'R' },
  { id: 'circle',      label: 'Circle',  Icon: CircleIcon,    shortcut: 'C' },
  { id: 'ellipse',     label: 'Ellipse', Icon: ChartSpline,   shortcut: 'O' },
  { id: 'polygon',     label: 'Polygon', Icon: Hexagon,       shortcut: 'P' },
  { id: 'pen',         label: 'Pen',     Icon: Pen,           shortcut: 'N' },
  { id: 'seam',        label: 'Seam',    Icon: GitMerge,      shortcut: 'M' },
  { id: 'pan',         label: 'Pan',     Icon: Hand,          shortcut: 'Space' },
]

export default function ClothingToolbar() {
  const { activeClothingTool, simRunning, history, selectedPatternIds } = useSnapshot(clothingStore)
  const canUndoNow = history.past.length > 0
  const canRedoNow = history.future.length > 0
  const hasSelection = selectedPatternIds.length > 0
  const canBoolean = selectedPatternIds.length >= 2

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '6px 8px',
      background: 'rgba(8,8,16,0.95)',
      borderBottom: '1px solid rgba(255,255,255,0.07)',
      flexShrink: 0,
      flexWrap: 'nowrap',
      overflowX: 'auto',
      overflowY: 'hidden',
      WebkitOverflowScrolling: 'touch',
    }}>
      <ToolGroup>
        {TOOLS.map((tool) => (
          <ToolButton
            key={tool.id}
            active={activeClothingTool === tool.id}
            onClick={() => setActiveClothingTool(tool.id)}
            title={`${tool.label} (${tool.shortcut})`}
            Icon={tool.Icon}
            label={tool.label}
          />
        ))}
      </ToolGroup>

      <Divider />

      <ToolGroup>
        <IconButton onClick={undo} disabled={!canUndoNow} title="Undo (⌘Z)">
          <Undo2 size={14} />
        </IconButton>
        <IconButton onClick={redo} disabled={!canRedoNow} title="Redo (⌘⇧Z)">
          <Redo2 size={14} />
        </IconButton>
      </ToolGroup>

      <Divider />

      <ToolGroup>
        <IconButton
          onClick={() => duplicatePieces([...clothingStore.selectedPatternIds])}
          disabled={!hasSelection}
          title="Duplicate (⌘D)"
        >
          <Copy size={14} />
        </IconButton>
        <IconButton
          onClick={() => deletePieces([...clothingStore.selectedPatternIds])}
          disabled={!hasSelection}
          title="Delete (⌫)"
        >
          <Trash2 size={14} />
        </IconButton>
        <IconButton
          onClick={subtractTopFromSelection}
          disabled={!canBoolean}
          title="Subtract topmost from rest (⌘−). Select 2+ pieces; the last selected becomes the cutter."
        >
          <Scissors size={14} />
        </IconButton>
      </ToolGroup>

      <div style={{ flex: 1, minWidth: 8 }} />

      <PrimaryButton
        onClick={toggleSimRunning}
        title={simRunning ? 'Pause cloth sim' : 'Run cloth sim'}
        active={simRunning}
      >
        {simRunning ? <Pause size={12} /> : <Play size={12} />}
        {simRunning ? 'STOP' : 'RUN'}
      </PrimaryButton>
      <IconButton
        onClick={() => resetPatternTransforms()}
        title="Reset 3D transforms for selected pieces (or all if none selected)"
      >
        <Move3d size={14} />
      </IconButton>
      <IconButton onClick={resetSim} title="Reset cloth shape (keeps placement)">
        <RotateCcw size={14} />
      </IconButton>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToolGroup({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 2 }}>{children}</div>
}

function Divider() {
  return <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
}

function ToolButton({
  active, onClick, title, Icon, label,
}: { active: boolean; onClick: () => void; title: string; Icon: LucideIcon; label: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        minWidth: 46,
        padding: '5px 6px',
        fontSize: 8,
        fontFamily: "'Courier New', monospace",
        fontWeight: 700,
        letterSpacing: '0.05em',
        background: active ? 'rgba(68,136,255,0.25)' : 'transparent',
        border: active ? '1px solid rgba(68,136,255,0.6)' : '1px solid rgba(255,255,255,0.08)',
        borderRadius: 4,
        color: active ? '#88bbff' : 'rgba(255,255,255,0.6)',
        cursor: 'pointer',
        transition: 'all 0.12s',
      }}
    >
      <Icon size={16} strokeWidth={1.7} />
      <span>{label.toUpperCase()}</span>
    </button>
  )
}

function IconButton({
  onClick, title, children, disabled,
}: { onClick: () => void; title: string; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 30,
        height: 30,
        padding: '0 8px',
        background: 'transparent',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 4,
        color: disabled ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

function PrimaryButton({
  onClick, title, children, active,
}: { onClick: () => void; title: string; children: ReactNode; active: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '6px 12px',
        fontSize: 10,
        fontFamily: "'Courier New', monospace",
        fontWeight: 700,
        letterSpacing: '0.08em',
        background: active ? 'rgba(255,60,60,0.22)' : 'rgba(60,200,100,0.18)',
        border: active ? '1px solid rgba(255,80,80,0.55)' : '1px solid rgba(60,220,100,0.45)',
        borderRadius: 4,
        color: active ? '#ff7070' : '#60dd80',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}
