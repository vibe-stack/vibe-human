import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { PatternDocument } from '../document/types'
import {
  buildGeometryKey,
  buildLiveParamsKey,
  buildPlacementKey,
} from './useGarmentSimulation'

describe('useGarmentSimulation rebuild keys', () => {
  test('panel placement does NOT change the geometry key', () => {
    const document = buildDocument()
    const before = buildGeometryKey(document, 'medium')

    document.panels.back.placement.rotation.y = Math.PI

    // Placement is handled live by the gizmo — it must not trigger a rebuild.
    assert.equal(buildGeometryKey(document, 'medium'), before)
  })

  test('placement changes are captured by the placement key', () => {
    const document = buildDocument()
    const before = buildPlacementKey(document)

    document.panels.back.placement.rotation.y = Math.PI

    assert.notEqual(buildPlacementKey(document), before)
  })

  test('quality changes the geometry key (resolution)', () => {
    const document = buildDocument()

    assert.notEqual(
      buildGeometryKey(document, 'low'),
      buildGeometryKey(document, 'medium'),
    )
  })

  test('editing a pattern point changes the geometry key', () => {
    const document = buildDocument()
    const before = buildGeometryKey(document, 'medium')

    document.panels.back.points.tr.x = 80

    assert.notEqual(buildGeometryKey(document, 'medium'), before)
  })

  test('adding a pattern point changes the geometry key', () => {
    const document = buildDocument()
    const before = buildGeometryKey(document, 'medium')

    document.panels.back.points.mid = { id: 'mid', x: 0, y: 0, kind: 'corner' }

    assert.notEqual(buildGeometryKey(document, 'medium'), before)
  })

  test('particleDistance changes the geometry key', () => {
    const document = buildDocument()
    const before = buildGeometryKey(document, 'medium')

    document.panels.back.particleDistance = 32

    assert.notEqual(buildGeometryKey(document, 'medium'), before)
  })

  test('glue pins change the geometry key', () => {
    const document = buildDocument()
    const before = buildGeometryKey(document, 'medium')

    document.panels.back.pins = [{ id: 'back-left-5', u: 0.1, v: 0.5, weight: 1 }]

    assert.notEqual(buildGeometryKey(document, 'medium'), before)
  })

  test('compliance/damping changes only the live-params key, not the geometry key', () => {
    const document = buildDocument()
    const geometryBefore = buildGeometryKey(document, 'medium')
    const liveBefore = buildLiveParamsKey(document, 'medium')

    document.panels.back.stretchCompliance = 0.001
    document.panels.back.damping = 0.12

    assert.equal(buildGeometryKey(document, 'medium'), geometryBefore)
    assert.notEqual(buildLiveParamsKey(document, 'medium'), liveBefore)
  })
})

function buildDocument(): PatternDocument {
  return {
    id: 'rebuild-key-doc',
    name: 'Rebuild Key Doc',
    panels: {
      front: createPanel('front', { x: 0, y: -0.56, z: 0.26 }, { x: 0, y: 0, z: 0 }),
      back: createPanel('back', { x: 0, y: -0.56, z: -0.26 }, { x: 0, y: 0, z: 0 }),
    },
    seams: {},
  }
}

function createPanel(
  id: string,
  position: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number },
): PatternDocument['panels'][string] {
  return {
    id,
    name: id,
    points: {
      tl: { id: 'tl', x: -50, y: -50, kind: 'corner' },
      tr: { id: 'tr', x: 50, y: -50, kind: 'corner' },
      br: { id: 'br', x: 50, y: 50, kind: 'corner' },
      bl: { id: 'bl', x: -50, y: 50, kind: 'corner' },
    },
    edges: [
      { id: 'top', from: 'tl', to: 'tr', curve: 'line' },
      { id: 'right', from: 'tr', to: 'br', curve: 'line' },
      { id: 'bottom', from: 'br', to: 'bl', curve: 'line' },
      { id: 'left', from: 'bl', to: 'tl', curve: 'line' },
    ],
    closed: true,
    particleDistance: 16,
    placement: { position, rotation },
  }
}
