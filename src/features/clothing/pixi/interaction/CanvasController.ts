import { clothingStore } from '../../state/clothingStore'
import {
  cancelDraft,
  commitDraft,
  deletePieces,
  deletePoint,
  duplicatePieces,
  redo,
  setActiveClothingTool,
  subtractTopFromSelection,
  undo,
} from '../../state/clothingActions'
import type { ClothingTool, Vec2 } from '../../state/clothingTypes'
import { applyZoomAt, screenToWorld } from './Camera'
import type { ToolCtx, ToolHandler, PointerEvt } from './types'
import { selectTool } from './tools/selectTool'
import { editPointsTool } from './tools/editPointsTool'
import { rectTool, ellipseTool, circleTool, polygonTool, penTool } from './tools/shapeTools'
import { seamTool } from './tools/seamTool'
import { panTool } from './tools/panTool'

const TOOLS: Record<ClothingTool, ToolHandler> = {
  select: selectTool,
  'edit-points': editPointsTool,
  rect: rectTool,
  ellipse: ellipseTool,
  circle: circleTool,
  polygon: polygonTool,
  pen: penTool,
  seam: seamTool,
  pan: panTool,
}

/**
 * CanvasController wires DOM events to the active tool and global behaviors
 * (zoom, right-click boolean, keyboard shortcuts, panning override).
 *
 * It is stateless w.r.t. document data — all state lives in clothingStore.
 */
export class CanvasController {
  private cleanup: Array<() => void> = []
  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.bind()
  }

  destroy() {
    for (const fn of this.cleanup) fn()
    this.cleanup = []
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private bind() {
    const c = this.canvas
    const off = (target: EventTarget, ev: string, fn: EventListenerOrEventListenerObject, opts?: AddEventListenerOptions) => {
      target.addEventListener(ev, fn, opts)
      this.cleanup.push(() => target.removeEventListener(ev, fn, opts))
    }

    off(c, 'contextmenu', (e) => e.preventDefault())

    off(c, 'wheel', (e: Event) => {
      const we = e as WheelEvent
      we.preventDefault()
      const view = this.viewSize()
      applyZoomAt(this.screenOf(we), we.deltaY, view.w, view.h)
    }, { passive: false })

    off(c, 'pointerdown', (e: Event) => this.handlePointer(e as PointerEvent, 'down'))
    off(c, 'pointermove', (e: Event) => this.handlePointer(e as PointerEvent, 'move'))
    off(c, 'pointerup',   (e: Event) => this.handlePointer(e as PointerEvent, 'up'))
    off(c, 'pointercancel', (e: Event) => {
      this.tool().onCancel?.(this.ctxOf(e as PointerEvent))
    })

    off(window, 'keydown', (e: Event) => this.handleKey(e as KeyboardEvent))
    off(window, 'keyup', (e: Event) => this.handleKey(e as KeyboardEvent))
  }

  // -------------------------------------------------------------------------
  // Pointer routing
  // -------------------------------------------------------------------------

  private handlePointer(e: PointerEvent, kind: 'down' | 'move' | 'up') {
    if (this.handleTouchGesture(e, kind)) return
    if (e.pointerType !== 'touch') e.preventDefault()
    const view = this.viewSize()
    const screen = this.screenOf(e)
    const world = screenToWorld(screen, view.w, view.h)
    const evt: PointerEvt = {
      kind,
      screen,
      world,
      button: e.button,
      zoom: clothingStore.viewport2D.zoom,
      native: e,
      detail: e.detail,
    }

    // Right-click is reserved (context menu suppressed elsewhere). Boolean is
    // now an explicit toolbar action — see Subtract button — to avoid the
    // "which one is the cutter?" ambiguity that bit us before.
    if (kind === 'down' && e.button === 2) return

    // Middle-mouse or Space-held: pan override regardless of tool
    if (kind === 'down' && (e.button === 1 || this.isSpaceDown())) {
      panTool.onPointerDown?.(evt, this.ctxOf(e))
      this.panOverride = true
      return
    }
    if (this.panOverride) {
      if (kind === 'move') panTool.onPointerMove?.(evt, this.ctxOf(e))
      if (kind === 'up') {
        panTool.onPointerUp?.(evt, this.ctxOf(e))
        this.panOverride = false
      }
      return
    }

    const handler = this.tool()
    if (kind === 'down') handler.onPointerDown?.(evt, this.ctxOf(e))
    if (kind === 'move') handler.onPointerMove?.(evt, this.ctxOf(e))
    if (kind === 'up')   handler.onPointerUp?.(evt, this.ctxOf(e))
  }

  private activeTouches = new Map<number, Vec2>()
  private touchGestureState: { distance: number; centerWorld: Vec2 } | null = null

  private handleTouchGesture(e: PointerEvent, kind: 'down' | 'move' | 'up') {
    if (e.pointerType !== 'touch') return false

    if (kind === 'down') this.activeTouches.set(e.pointerId, this.screenOf(e))
    if (kind === 'move' && this.activeTouches.has(e.pointerId)) this.activeTouches.set(e.pointerId, this.screenOf(e))
    if (kind === 'up') this.activeTouches.delete(e.pointerId)

    const touches = [...this.activeTouches.values()]
    if (touches.length < 2) {
      this.touchGestureState = null
      return false
    }

    e.preventDefault()
    const [a, b] = touches
    const center = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 }
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
    const view = this.viewSize()

    if (!this.touchGestureState) {
      this.touchGestureState = {
        distance,
        centerWorld: screenToWorld(center, view.w, view.h),
      }
      return true
    }

    const scale = distance / this.touchGestureState.distance
    const current = clothingStore.viewport2D.zoom
    clothingStore.viewport2D.zoom = Math.max(0.05, Math.min(20, current * scale))
    this.touchGestureState.distance = distance

    const after = screenToWorld(center, view.w, view.h)
    clothingStore.viewport2D.panX += this.touchGestureState.centerWorld.x - after.x
    clothingStore.viewport2D.panY += this.touchGestureState.centerWorld.y - after.y
    this.touchGestureState.centerWorld = screenToWorld(center, view.w, view.h)
    return true
  }

  // -------------------------------------------------------------------------
  // Keyboard shortcuts (global to canvas focus)
  // -------------------------------------------------------------------------

  private spaceDown = false
  private panOverride = false

  private isSpaceDown() { return this.spaceDown }

  private handleKey(e: KeyboardEvent) {
    // Ignore when typing in inputs
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

    if (e.code === 'Space') {
      this.spaceDown = e.type === 'keydown'
      if (e.type === 'keydown') return
    }

    if (e.type !== 'keydown') return

    const meta = e.metaKey || e.ctrlKey

    // Undo / Redo
    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
      return
    }
    if (meta && e.key.toLowerCase() === 'y') {
      e.preventDefault(); redo(); return
    }
    if (meta && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      duplicatePieces([...clothingStore.selectedPatternIds])
      return
    }
    if (meta && (e.key === '-' || e.key === '_')) {
      e.preventDefault()
      subtractTopFromSelection()
      return
    }

    // Tool shortcuts
    const tools: Record<string, ClothingTool> = {
      v: 'select',
      a: 'edit-points',
      r: 'rect',
      c: 'circle',
      o: 'ellipse',
      p: 'polygon',
      n: 'pen',
      m: 'seam',
    }
    const t = tools[e.key.toLowerCase()]
    if (t && !meta) {
      e.preventDefault()
      setActiveClothingTool(t)
      return
    }

    // Enter / Escape — commit / cancel draft
    if (e.key === 'Enter') {
      if (clothingStore.draft) commitDraft()
      return
    }
    if (e.key === 'Escape') {
      cancelDraft()
      this.tool().onCancel?.(this.ctxOf(null))
      return
    }

    // Delete
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      const { selectedPatternId, selectedPointId } = clothingStore.garment
      if (selectedPointId && selectedPatternId) {
        deletePoint(selectedPatternId, selectedPointId)
      } else {
        deletePieces([...clothingStore.selectedPatternIds])
      }
      return
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private tool(): ToolHandler {
    return TOOLS[clothingStore.activeClothingTool] ?? selectTool
  }

  private viewSize() {
    return {
      w: this.canvas.clientWidth || this.canvas.width / window.devicePixelRatio,
      h: this.canvas.clientHeight || this.canvas.height / window.devicePixelRatio,
    }
  }

  private screenOf(e: { clientX: number; clientY: number }): Vec2 {
    const rect = this.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private ctxOf(e: PointerEvent | null): ToolCtx {
    const pid = e?.pointerId ?? -1
    return {
      pointerId: pid,
      setPointerCapture: (id) => { try { this.canvas.setPointerCapture(id) } catch {} },
      releasePointerCapture: (id) => { try { this.canvas.releasePointerCapture(id) } catch {} },
    }
  }

}
