import { useEffect, useRef } from 'react'
import * as PIXI from 'pixi.js'
import { useSnapshot } from 'valtio'
import { clothingStore } from '../state/clothingStore'
import {
  movePoint,
  selectPattern,
  selectPoint,
  selectEdge,
  setHoveredEntity,
} from '../state/clothingActions'
import { PatternRenderer } from './PatternRenderer'
import { pickAt } from './PatternPicker'
import { drawGrid, COLORS } from './pixiUtils'

// ---------------------------------------------------------------------------
// PatternCanvas
// Mounts a Pixi application imperatively, using the ref to hold the app and
// renderer so they survive re-renders without tearing down.
// ---------------------------------------------------------------------------

export default function PatternCanvas() {
  const canvasRef = useRef<HTMLDivElement>(null)
  const pixiRef   = useRef<{
    app: PIXI.Application
    world: PIXI.Container
    gridGfx: PIXI.Graphics
    renderer: PatternRenderer
  } | null>(null)

  // Pixi mount / unmount
  useEffect(() => {
    if (!canvasRef.current) return

    const app = new PIXI.Application()

    let mounted = true

    app.init({
      resizeTo: canvasRef.current,
      background: COLORS.background,
      antialias: true,
      resolution: window.devicePixelRatio,
      autoDensity: true,
    }).then(() => {
      if (!mounted || !canvasRef.current) {
        app.destroy()
        return
      }

      canvasRef.current.appendChild(app.canvas as HTMLCanvasElement)

      // World container — pan & zoom applied here
      const world = new PIXI.Container()
      app.stage.addChild(world)

      // Grid (drawn behind everything)
      const gridGfx = new PIXI.Graphics()
      world.addChild(gridGfx)

      // Pattern renderer
      const renderer = new PatternRenderer(world)

      pixiRef.current = { app, world, gridGfx, renderer }

      // -----------------------------------------------------------------------
      // Interaction: pan + zoom
      // -----------------------------------------------------------------------
      let isPanning = false
      let panStart  = { x: 0, y: 0 }
      let panOrigin = { x: 0, y: 0 }

      // Drag state for point moving
      let dragging: { patternId: string; pointId: string } | null = null

      const canvas = app.canvas as HTMLCanvasElement

      canvas.addEventListener('contextmenu', (e) => e.preventDefault())

      canvas.addEventListener('wheel', (e) => {
        e.preventDefault()
        const factor  = e.deltaY < 0 ? 1.12 : 1 / 1.12
        const newZoom = Math.max(0.05, Math.min(20, clothingStore.viewport2D.zoom * factor))

        // Zoom toward cursor
        const rect   = canvas.getBoundingClientRect()
        const cx     = e.clientX - rect.left
        const cy     = e.clientY - rect.top
        const before = screenToWorld({ x: cx, y: cy })
        clothingStore.viewport2D.zoom = newZoom
        const after  = screenToWorld({ x: cx, y: cy })
        clothingStore.viewport2D.panX += before.x - after.x
        clothingStore.viewport2D.panY += before.y - after.y
      }, { passive: false })

      canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        const rect   = canvas.getBoundingClientRect()
        const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        const world  = screenToWorld(screen)

        const tool = clothingStore.activeClothingTool
        const isPanTool = tool === 'pan' || e.button === 1

        if (isPanTool) {
          isPanning  = true
          panStart   = screen
          panOrigin  = { x: clothingStore.viewport2D.panX, y: clothingStore.viewport2D.panY }
          canvas.setPointerCapture(e.pointerId)
          return
        }

        if (tool === 'select' || tool === 'edit-points') {
          const pick = pickAt(clothingStore.garment, world, clothingStore.viewport2D.zoom)

          if (!pick) {
            selectPattern(undefined)
            selectPoint(undefined)
            return
          }

          if (pick.type === 'point') {
            selectPattern(pick.patternId)
            selectPoint(pick.pointId)
            if (tool === 'edit-points') {
              dragging = { patternId: pick.patternId, pointId: pick.pointId }
              canvas.setPointerCapture(e.pointerId)
            }
          } else if (pick.type === 'edge') {
            selectPattern(pick.patternId)
            selectEdge(pick.edgeId)
          } else if (pick.type === 'pattern') {
            selectPattern(pick.patternId)
          }
        }
      })

      canvas.addEventListener('pointermove', (e) => {
        const rect   = canvas.getBoundingClientRect()
        const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        const worldPt = screenToWorld(screen)

        if (isPanning) {
          const dx = screen.x - panStart.x
          const dy = screen.y - panStart.y
          clothingStore.viewport2D.panX = panOrigin.x - dx / clothingStore.viewport2D.zoom
          clothingStore.viewport2D.panY = panOrigin.y - dy / clothingStore.viewport2D.zoom
          return
        }

        if (dragging) {
          movePoint(dragging.patternId, dragging.pointId, worldPt.x, worldPt.y)
          return
        }

        // Hover
        const pick = pickAt(clothingStore.garment, worldPt, clothingStore.viewport2D.zoom)
        if (!pick) {
          setHoveredEntity(null, null)
        } else if (pick.type === 'point') {
          setHoveredEntity(pick.pointId, 'point')
        } else if (pick.type === 'edge') {
          setHoveredEntity(pick.edgeId, 'edge')
        } else if (pick.type === 'pattern') {
          setHoveredEntity(pick.patternId, 'pattern')
        }
      })

      canvas.addEventListener('pointerup', (e) => {
        isPanning = false
        dragging  = null
        canvas.releasePointerCapture(e.pointerId)
      })

      // -----------------------------------------------------------------------
      // Render loop — read from Valtio snapshot on each frame
      // -----------------------------------------------------------------------
      app.ticker.add(() => {
        const { garment, viewport2D, previewOptions } = clothingStore

        // Apply camera transform
        world.x     =  -viewport2D.panX * viewport2D.zoom + app.renderer.width  / 2
        world.y     =  -viewport2D.panY * viewport2D.zoom + app.renderer.height / 2
        world.scale.set(viewport2D.zoom)

        // Grid: convert screen bounds to world
        const wW = app.renderer.width  / viewport2D.zoom
        const wH = app.renderer.height / viewport2D.zoom
        const wL = viewport2D.panX - wW / 2
        const wT = viewport2D.panY - wH / 2
        drawGrid(gridGfx, wL, wT, wL + wW, wT + wH, 50)

        renderer.render(
          garment,
          viewport2D.hoveredEntityId,
          previewOptions.showSeams,
          clothingStore.activeClothingTool === 'edit-points',
        )
      })
    })

    return () => {
      mounted = false
      if (pixiRef.current) {
        pixiRef.current.app.destroy({ removeView: true })
        pixiRef.current = null
      }
    }

    // screenToWorld needs to be defined in this scope so the canvas callbacks can close over it
    function screenToWorld(screen: { x: number; y: number }) {
      if (!pixiRef.current) return { x: 0, y: 0 }
      const { viewport2D } = clothingStore
      const cx = pixiRef.current.app.renderer.width  / 2
      const cy = pixiRef.current.app.renderer.height / 2
      return {
        x: (screen.x - cx) / viewport2D.zoom + viewport2D.panX,
        y: (screen.y - cy) / viewport2D.zoom + viewport2D.panY,
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Use snapshot just to trigger re-sub if needed; actual rendering is in ticker
  useSnapshot(clothingStore.viewport2D)

  return (
    <div
      ref={canvasRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}
    />
  )
}
