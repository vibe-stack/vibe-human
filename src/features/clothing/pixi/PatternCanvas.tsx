import { useEffect, useRef } from 'react'
import * as PIXI from 'pixi.js'
import { useSnapshot } from 'valtio'
import { clothingStore } from '../state/clothingStore'
import {
  convertEdgeToCurve,
  createRectanglePattern,
  createSeam,
  makeHoleFromPattern,
  movePoint,
  moveHandle,
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

      let dragging:
        | { type: 'point'; patternId: string; pointId: string }
        | { type: 'handle'; patternId: string; pointId: string; handleKind: 'in' | 'out' }
        | null = null
      let pendingSeam: { patternId: string; edgeId: string } | null = null

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

        if (e.button === 2) {
          const pick = pickAt(clothingStore.garment, world, clothingStore.viewport2D.zoom)
          if (pick?.type === 'pattern') {
            const targetId = findContainingPatternId(pick.patternId, world)
            if (targetId) makeHoleFromPattern(targetId, pick.patternId)
          }
          return
        }

        if (isPanTool) {
          isPanning  = true
          panStart   = screen
          panOrigin  = { x: clothingStore.viewport2D.panX, y: clothingStore.viewport2D.panY }
          canvas.setPointerCapture(e.pointerId)
          return
        }

        if (tool === 'draw') {
          const id = createRectanglePattern(world, 160, 120)
          selectPattern(id)
          return
        }

        if (tool === 'seam') {
          const pick = pickAt(clothingStore.garment, world, clothingStore.viewport2D.zoom)
          if (pick?.type === 'edge') {
            if (!pendingSeam) {
              pendingSeam = { patternId: pick.patternId, edgeId: pick.edgeId }
              selectPattern(pick.patternId)
              selectEdge(pick.edgeId)
            } else {
              createSeam(pendingSeam.patternId, pendingSeam.edgeId, pick.patternId, pick.edgeId)
              pendingSeam = null
              selectPattern(pick.patternId)
              selectEdge(pick.edgeId)
            }
          }
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
              dragging = { type: 'point', patternId: pick.patternId, pointId: pick.pointId }
              canvas.setPointerCapture(e.pointerId)
            }
          } else if (pick.type === 'handle') {
            selectPattern(pick.patternId)
            selectPoint(pick.pointId)
            if (tool === 'edit-points') {
              dragging = { type: 'handle', patternId: pick.patternId, pointId: pick.pointId, handleKind: pick.handleKind }
              canvas.setPointerCapture(e.pointerId)
            }
          } else if (pick.type === 'edge') {
            selectPattern(pick.patternId)
            selectEdge(pick.edgeId)
            if (tool === 'edit-points' && e.detail >= 2) {
              convertEdgeToCurve(pick.patternId, pick.edgeId)
            }
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
          if (dragging.type === 'point') {
            movePoint(dragging.patternId, dragging.pointId, worldPt.x, worldPt.y)
          } else {
            moveHandle(dragging.patternId, dragging.pointId, dragging.handleKind, worldPt.x, worldPt.y)
          }
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
        const viewWidth = canvas.clientWidth || app.renderer.width / window.devicePixelRatio
        const viewHeight = canvas.clientHeight || app.renderer.height / window.devicePixelRatio

        world.x     =  -viewport2D.panX * viewport2D.zoom + viewWidth  / 2
        world.y     =  -viewport2D.panY * viewport2D.zoom + viewHeight / 2
        world.scale.set(viewport2D.zoom)

        // Grid: convert screen bounds to world
        const wW = viewWidth  / viewport2D.zoom
        const wH = viewHeight / viewport2D.zoom
        const wL = viewport2D.panX - wW / 2
        const wT = viewport2D.panY - wH / 2
        drawGrid(gridGfx, wL, wT, wL + wW, wT + wH, 50)

        renderer.render(
          garment,
          viewport2D.hoveredEntityId,
          previewOptions.showSeams,
          true,
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
      const canvas = pixiRef.current.app.canvas as HTMLCanvasElement
      const cx = (canvas.clientWidth || pixiRef.current.app.renderer.width / window.devicePixelRatio) / 2
      const cy = (canvas.clientHeight || pixiRef.current.app.renderer.height / window.devicePixelRatio) / 2
      return {
        x: (screen.x - cx) / viewport2D.zoom + viewport2D.panX,
        y: (screen.y - cy) / viewport2D.zoom + viewport2D.panY,
      }
    }

    function findContainingPatternId(excludedPatternId: string, point: { x: number; y: number }) {
      for (const piece of Object.values(clothingStore.garment.patterns)) {
        if (piece.id === excludedPatternId || !piece.closed) continue
        const pick = pickAt(
          {
            ...clothingStore.garment,
            patterns: { [piece.id]: piece },
          },
          point,
          clothingStore.viewport2D.zoom,
        )
        if (pick?.type === 'pattern') return piece.id
      }
      return null
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
