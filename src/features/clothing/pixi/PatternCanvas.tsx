import { useEffect, useRef } from 'react'
import 'pixi.js/browser'
import * as PIXI from 'pixi.js'
import { clothingStore } from '../state/clothingStore'
import { setHoveredEntity } from '../state/clothingActions'
import { PatternRenderer } from './PatternRenderer'
import { OverlayRenderer } from './OverlayRenderer'
import { pickAt } from './PatternPicker'
import { CanvasController } from './interaction/CanvasController'
import { screenToWorld } from './interaction/Camera'
import { drawGrid, COLORS } from './pixiUtils'

// ---------------------------------------------------------------------------
// PatternCanvas
//
// Owns Pixi mounting, the render loop, and instantiates a CanvasController
// that handles all interaction. Reads directly from clothingStore in the
// ticker for max perf — no React re-renders per frame, no prop drilling.
// ---------------------------------------------------------------------------

export default function PatternCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current
    const app = new PIXI.Application()
    let mounted = true
    let controller: CanvasController | null = null
    let resizeObserver: ResizeObserver | null = null

    const resizeRenderer = () => {
      if (!mounted) return
      const width = Math.max(1, Math.floor(container.clientWidth))
      const height = Math.max(1, Math.floor(container.clientHeight))
      app.renderer?.resize(width, height)
    }

    app.init({
      resizeTo: container,
      background: COLORS.background,
      backgroundColor: COLORS.background,
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      manageImports: false,
      antialias: true,
      resolution: window.devicePixelRatio,
      autoDensity: true,
    }).then(() => {
      if (!mounted) { app.destroy(); return }

      container.appendChild(app.canvas as HTMLCanvasElement)
      const canvas = app.canvas as HTMLCanvasElement
      canvas.style.touchAction = 'none'
      canvas.style.display = 'block'
      canvas.style.width = '100%'
      canvas.style.height = '100%'

      resizeObserver = new ResizeObserver(resizeRenderer)
      resizeObserver.observe(container)
      requestAnimationFrame(resizeRenderer)

      // Scene graph
      const world = new PIXI.Container()
      app.stage.addChild(world)

      const gridGfx = new PIXI.Graphics()
      world.addChild(gridGfx)

      const renderer = new PatternRenderer(world)
      const overlay = new OverlayRenderer(world)

      controller = new CanvasController(canvas)

      // ---------------------------------------------------------------------
      // Hover handling (kept here so it can run regardless of active tool)
      // ---------------------------------------------------------------------
      const onHoverMove = (e: PointerEvent) => {
        if (e.pointerType === 'touch') return
        const rect = canvas.getBoundingClientRect()
        const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        const view = { w: canvas.clientWidth, h: canvas.clientHeight }
        const worldPt = screenToWorld(screen, view.w, view.h)
        const pick = pickAt(clothingStore.garment, worldPt, clothingStore.viewport2D.zoom)
        if (!pick) setHoveredEntity(null, null)
        else if (pick.type === 'point') setHoveredEntity(pick.pointId, 'point')
        else if (pick.type === 'edge') setHoveredEntity(pick.edgeId, 'edge')
        else if (pick.type === 'pattern') setHoveredEntity(pick.patternId, 'pattern')
      }
      canvas.addEventListener('pointermove', onHoverMove)

      // ---------------------------------------------------------------------
      // Render loop
      // ---------------------------------------------------------------------
      app.ticker.add(() => {
        const { garment, viewport2D, previewOptions, selectedPatternIds } = clothingStore
        const viewW = canvas.clientWidth || app.renderer.width / window.devicePixelRatio
        const viewH = canvas.clientHeight || app.renderer.height / window.devicePixelRatio
        if (viewW <= 1 || viewH <= 1) return

        world.x = -viewport2D.panX * viewport2D.zoom + viewW / 2
        world.y = -viewport2D.panY * viewport2D.zoom + viewH / 2
        world.scale.set(viewport2D.zoom)

        const wW = viewW / viewport2D.zoom
        const wH = viewH / viewport2D.zoom
        const wL = viewport2D.panX - wW / 2
        const wT = viewport2D.panY - wH / 2
        drawGrid(gridGfx, wL, wT, wL + wW, wT + wH, 50)

        renderer.render(
          garment,
          viewport2D.hoveredEntityId,
          previewOptions.showSeams,
          true,
          selectedPatternIds,
        )
        overlay.render(viewport2D.zoom)
      })

      // Cleanup hook for hover listener
      ;(controller as unknown as { _hoverCleanup?: () => void })._hoverCleanup = () => {
        canvas.removeEventListener('pointermove', onHoverMove)
      }
    }).catch((error: unknown) => {
      if (mounted) console.error('Failed to initialise clothing pattern canvas:', error)
    })

    return () => {
      mounted = false
      if (controller) {
        ;(controller as unknown as { _hoverCleanup?: () => void })._hoverCleanup?.()
        controller.destroy()
        controller = null
      }
      resizeObserver?.disconnect()
      resizeObserver = null
      try { app.destroy(true, { children: true }) } catch {}
    }
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%', height: '100%',
        overflow: 'hidden', position: 'relative',
        touchAction: 'none',
        background: '#141421',
      }}
    />
  )
}
