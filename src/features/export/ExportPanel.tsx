import { useState } from 'react'
import type { ReactNode } from 'react'
import { Download, FileArchive, Layers, Scissors, Shirt } from 'lucide-react'
import { useSnapshot } from 'valtio'
import { Button } from '@/components/ui/button'
import { appState } from '../../appState'
import { groomStore } from '../groom/store/groomStore'
import { clothingStore } from '../clothing/state/clothingStore'
import { exportCurrentSessionGLB, hasCurrentExportScene } from './exportSession'

const labelStyle = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'rgba(255,255,255,0.36)',
  fontFamily: "'Courier New', monospace",
} as const

function StatRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border/25">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-white/34 shrink-0">{icon}</span>
        <span className="text-[10px] text-white/48 font-mono tracking-[0.08em] truncate">{label}</span>
      </div>
      <span className="text-[10px] text-white/72 font-mono tabular-nums shrink-0">{value}</span>
    </div>
  )
}

export default function ExportPanel() {
  const { skinTextures, modelingValues } = useSnapshot(appState)
  const { generatedStrands } = useSnapshot(groomStore)
  const { garment, simRunning } = useSnapshot(clothingStore)
  const [status, setStatus] = useState('READY')
  const [busy, setBusy] = useState(false)

  const customSkinTextureCount = Object.values(skinTextures).filter(Boolean).length
  const modeledControlCount = Object.values(modelingValues).filter((value) => Math.abs(value) > 0.001).length
  const clothingPieceCount = Object.keys(garment.patterns).length
  const hasScene = hasCurrentExportScene()

  async function handleExport() {
    if (busy || !hasScene) return
    setBusy(true)
    setStatus('EXPORTING')
    try {
      const result = await exportCurrentSessionGLB('human-session.glb')
      setStatus(`${result.meshCount} MESHES / ${result.hairCardCount} CARDS`)
    } catch (error) {
      console.error(error)
      setStatus('FAILED')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden select-none">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 shrink-0">
        <div className="flex items-center gap-2">
          <FileArchive size={13} className="text-emerald-300/85" />
          <span style={labelStyle}>EXPORT</span>
        </div>
        <span className="text-[9px] text-emerald-300/70 font-mono">{status}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-3 py-3 border-b border-border/25">
          <Button
            className="w-full"
            disabled={busy || !hasScene}
            onClick={handleExport}
          >
            <Download size={14} />
            {busy ? 'Exporting GLB' : 'Export GLB'}
          </Button>
        </div>

        <StatRow
          icon={<Layers size={12} />}
          label="DEFORMED MODEL"
          value={`${modeledControlCount} ACTIVE`}
        />
        <StatRow
          icon={<Scissors size={12} />}
          label="HAIR CARDS"
          value={`${generatedStrands.length} STRANDS`}
        />
        <StatRow
          icon={<Shirt size={12} />}
          label="CLOTHING"
          value={`${clothingPieceCount} PIECES${simRunning ? ' / SIM' : ''}`}
        />
        <StatRow
          icon={<Layers size={12} />}
          label="CUSTOM SKIN"
          value={`${customSkinTextureCount} MAPS`}
        />

        <div className="px-3 py-3 text-[10px] leading-5 text-white/40 border-b border-border/20">
          GLB export bakes current mesh deformation, skin texture maps, generated hair cards, and the current cloth mesh state.
        </div>
        <div className="px-3 py-3 text-[10px] leading-5 text-white/30">
          Shape keys and rig controls are flattened out of the exported geometry.
        </div>
      </div>
    </div>
  )
}
