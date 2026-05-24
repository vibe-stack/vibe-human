import { clothingStore } from '../../../state/clothingStore'
import { createTack, selectPattern, selectPoint } from '../../../state/clothingActions'
import { pickAt } from '../../PatternPicker'
import type { ToolHandler } from '../types'

// ---------------------------------------------------------------------------
// Tack tool
// Two-click workflow:
//   1st click on a point → stores pending point A (highlighted)
//   2nd click on a different point → creates a tack constraint
// Escape / tool-switch cancels.
// ---------------------------------------------------------------------------

let pending: { patternId: string; pointId: string } | null = null

export const tackTool: ToolHandler = {
  onPointerDown(e) {
    if (e.button !== 0) return
    const pick = pickAt(clothingStore.garment, e.world, e.zoom)
    if (pick?.type !== 'point') return

    if (!pending) {
      pending = { patternId: pick.patternId, pointId: pick.pointId }
      selectPattern(pick.patternId)
      selectPoint(pick.pointId)
    } else {
      // Same point clicked twice — cancel
      if (pending.patternId === pick.patternId && pending.pointId === pick.pointId) {
        pending = null
        selectPoint(undefined)
        return true
      }
      createTack(pending.patternId, pending.pointId, pick.patternId, pick.pointId)
      pending = null
      selectPattern(pick.patternId)
      selectPoint(pick.pointId)
    }
    return true
  },

  onCancel() {
    pending = null
  },
}

/** Expose pending state so the renderer can highlight it. */
export function getTackPending() { return pending }
