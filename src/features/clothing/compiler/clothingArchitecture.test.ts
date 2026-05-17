import { describe, expect, test } from 'bun:test'
import { createDemoGarment } from '../demo/createDemoGarment'
import { toPatternDocument } from '../document/legacyAdapter'
import type { PatternPlacement } from '../document/types'
import { XPBDClothSolver } from '../simulation/solver'
import { samplePanelEdge } from './buildPanelSimMesh'
import { compileGarmentRuntime } from './compileGarmentRuntime'
import { validatePatternDocument } from './validatePatternDocument'

describe('clothing compiler architecture', () => {
  test('invalid seam references are rejected', () => {
    const document = buildDocument()
    const seam = Object.values(document.seams)[0]
    seam.a.edgeId = 'missing-edge'
    const issues = validatePatternDocument(document)
    expect(issues.some((issue) => issue.code === 'invalid-seam-edge-a')).toBe(true)
  })

  test('seam sample counts match', () => {
    const document = buildDocument()
    const seam = Object.values(document.seams)[0]
    const pointsA = samplePanelEdge(document.panels[seam.a.panelId], seam.a.edgeId, 12, seam.a.reversed)
    const pointsB = samplePanelEdge(document.panels[seam.b.panelId], seam.b.edgeId, 12, seam.b.reversed)
    expect(pointsA.length).toBe(pointsB.length)
  })

  test('panel discretization outputs particles with panel ids and panel uvs', () => {
    const runtime = compileGarmentRuntime(buildDocument(), { quality: 'medium', seamSamples: 12 }).value
    expect(runtime.simMesh.particleCount).toBeGreaterThan(0)
    expect(runtime.simMesh.panelIds.length).toBe(runtime.simMesh.particleCount)
    expect(runtime.simMesh.panelUvs.length).toBe(runtime.simMesh.particleCount * 2)
    expect(new Set(runtime.simMesh.panelIds)).toEqual(new Set(['torso-front', 'torso-back']))
  })

  test('render embedding references valid sim triangles', () => {
    const runtime = compileGarmentRuntime(buildDocument(), { quality: 'medium', seamSamples: 12 }).value
    for (const panel of runtime.renderPanels) {
      const triangles = runtime.panelInfo[panel.panelId].triangleIndices
      const validKeys = new Set<string>()
      for (let index = 0; index < triangles.length; index += 3) {
        validKeys.add(`${triangles[index]}:${triangles[index + 1]}:${triangles[index + 2]}`)
      }
      for (let vertex = 0; vertex < panel.panelUvs.length / 2; vertex += 1) {
        const key = `${panel.embedding.simTriangles[vertex * 3]}:${panel.embedding.simTriangles[vertex * 3 + 1]}:${panel.embedding.simTriangles[vertex * 3 + 2]}`
        expect(validKeys.has(key)).toBe(true)
      }
    }
  })

  test('solver can step without NaNs', () => {
    const runtime = compileGarmentRuntime(buildDocument(), { quality: 'medium', seamSamples: 12 }).value
    const solver = new XPBDClothSolver(cloneMesh(runtime.simMesh), {
      gravity: -9.81,
      damping: 0.07,
      substeps: 2,
      iterations: 4,
      dt: 1 / 60,
      groundY: -1.6,
      maxVelocity: 6,
    })

    for (let step = 0; step < 5; step += 1) solver.step({ version: 1, proxies: [] })

    for (const value of solver.mesh.positions) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })
})

function buildDocument() {
  const garment = createDemoGarment()
  const placements: Record<string, PatternPlacement> = {
    'torso-front': {
      position: { x: 0, y: 0.34, z: 0.16 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    'torso-back': {
      position: { x: 0, y: 0.34, z: -0.16 },
      rotation: { x: 0, y: Math.PI, z: 0 },
    },
  }
  return toPatternDocument(garment, placements)
}

function cloneMesh(mesh: ReturnType<typeof compileGarmentRuntime>['value']['simMesh']) {
  return {
    ...mesh,
    positions: new Float32Array(mesh.positions),
    prevPositions: new Float32Array(mesh.prevPositions),
    velocities: new Float32Array(mesh.velocities),
    invMass: new Float32Array(mesh.invMass),
    panelIds: [...mesh.panelIds],
    panelUvs: new Float32Array(mesh.panelUvs),
    panelLocalPositions: new Float32Array(mesh.panelLocalPositions),
    triangles: new Uint32Array(mesh.triangles),
    stretchConstraints: mesh.stretchConstraints.map((constraint) => ({ ...constraint })),
    shearConstraints: mesh.shearConstraints.map((constraint) => ({ ...constraint })),
    bendConstraints: mesh.bendConstraints.map((constraint) => ({ ...constraint })),
    seamConstraints: mesh.seamConstraints.map((constraint) => ({ ...constraint })),
    pinConstraints: mesh.pinConstraints.map((constraint) => ({ ...constraint })),
  }
}