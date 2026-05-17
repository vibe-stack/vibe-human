import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import type { PatternDocument } from '../document/types'
import { compileGarmentRuntime } from '../compiler/compileGarmentRuntime'
import type { CompilerIssue, CompileQuality } from '../compiler/types'
import { XPBDClothSolver } from '../simulation/solver'
import type { ClothFrame, GarmentRuntime, SolverParams } from '../simulation/types'
import { getBodyProxySnapshot, subscribeBodyProxy } from '../simulation/collision/bodyProxyRegistry'

const FIXED_DT = 1 / 60
const MAX_SUBSTEPS = 4

const SOLVER_PRESETS: Record<CompileQuality, SolverParams> = {
  low: { gravity: -9.81, damping: 0.08, substeps: 1, iterations: 3, dt: FIXED_DT, groundY: -1.6, maxVelocity: 6 },
  medium: { gravity: -9.81, damping: 0.07, substeps: 2, iterations: 4, dt: FIXED_DT, groundY: -1.6, maxVelocity: 6 },
  high: { gravity: -9.81, damping: 0.06, substeps: 3, iterations: 5, dt: FIXED_DT, groundY: -1.6, maxVelocity: 7 },
  ultra: { gravity: -9.81, damping: 0.05, substeps: 4, iterations: 6, dt: FIXED_DT, groundY: -1.6, maxVelocity: 8 },
}

type RenderPanelEntry = {
  panelId: string
  geometry: THREE.BufferGeometry
}

export function useGarmentSimulation(args: {
  document: PatternDocument
  quality: CompileQuality
  resetKey: number
  running: boolean
}) {
  const { document, quality, resetKey, running } = args
  const compileResult = useMemo(
    () => compileGarmentRuntime(document, { quality, seamSamples: 12 }),
    [document, quality, resetKey],
  )
  const [colliderVersion, setColliderVersion] = useState(0)
  const runtimeRef = useRef<GarmentRuntime | null>(null)
  const solverRef = useRef<XPBDClothSolver | null>(null)
  const renderPanelsRef = useRef<RenderPanelEntry[]>([])
  const frameRef = useRef<ClothFrame | null>(null)
  const accumRef = useRef(0)

  useEffect(() => subscribeBodyProxy(() => setColliderVersion((value) => value + 1)), [])

  useEffect(() => {
    runtimeRef.current = compileResult.value
    solverRef.current = new XPBDClothSolver(compileResult.value.simMesh, SOLVER_PRESETS[quality])
    frameRef.current = { positions: compileResult.value.simMesh.positions }
    renderPanelsRef.current.forEach((entry) => entry.geometry.dispose())
    renderPanelsRef.current = compileResult.value.renderPanels.map((panel) => createRenderPanelEntry(panel))
    updateRenderPanels(compileResult.value, renderPanelsRef.current, compileResult.value.simMesh.positions)
    accumRef.current = 0
    return () => {
      renderPanelsRef.current.forEach((entry) => entry.geometry.dispose())
    }
  }, [compileResult, quality])

  useFrame((_, delta) => {
    const runtime = runtimeRef.current
    const solver = solverRef.current
    if (!runtime || !solver) return
    if (running) {
      accumRef.current += Math.min(delta, 1 / 20)
      let steps = 0
      while (accumRef.current >= FIXED_DT && steps < MAX_SUBSTEPS) {
        frameRef.current = solver.step(getBodyProxySnapshot())
        accumRef.current -= FIXED_DT
        steps += 1
      }
    }
    updateRenderPanels(runtime, renderPanelsRef.current, frameRef.current?.positions ?? runtime.simMesh.positions)
  })

  return {
    runtime: compileResult.value,
    issues: compileResult.issues,
    renderPanels: renderPanelsRef.current,
    colliderSnapshot: getBodyProxySnapshot(),
    colliderVersion,
  }
}

function createRenderPanelEntry(panel: GarmentRuntime['renderPanels'][number]): RenderPanelEntry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((panel.panelUvs.length / 2) * 3), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(panel.panelUvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(panel.indices, 1))
  return { panelId: panel.panelId, geometry }
}

function updateRenderPanels(runtime: GarmentRuntime, entries: RenderPanelEntry[], positions: Float32Array) {
  for (const entry of entries) {
    const panel = runtime.renderPanels.find((item) => item.panelId === entry.panelId)
    if (!panel) continue
    const attr = entry.geometry.getAttribute('position') as THREE.BufferAttribute
    const array = attr.array as Float32Array
    for (let vertex = 0; vertex < panel.panelUvs.length / 2; vertex += 1) {
      const ia = panel.embedding.simTriangles[vertex * 3] * 3
      const ib = panel.embedding.simTriangles[vertex * 3 + 1] * 3
      const ic = panel.embedding.simTriangles[vertex * 3 + 2] * 3
      const wa = panel.embedding.barycentrics[vertex * 3]
      const wb = panel.embedding.barycentrics[vertex * 3 + 1]
      const wc = panel.embedding.barycentrics[vertex * 3 + 2]
      array[vertex * 3] = positions[ia] * wa + positions[ib] * wb + positions[ic] * wc
      array[vertex * 3 + 1] = positions[ia + 1] * wa + positions[ib + 1] * wb + positions[ic + 1] * wc
      array[vertex * 3 + 2] = positions[ia + 2] * wa + positions[ib + 2] * wb + positions[ic + 2] * wc
    }
    attr.needsUpdate = true
    entry.geometry.computeVertexNormals()
  }
}