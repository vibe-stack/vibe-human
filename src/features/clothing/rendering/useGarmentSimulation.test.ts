import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { PatternDocument } from '../document/types'
import { buildTopologyKey } from './useGarmentSimulation'

describe('useGarmentSimulation topology key', () => {
  test('panel placement changes invalidate the topology key', () => {
    const document = buildDocument()
    const originalKey = buildTopologyKey(document, 'medium', 0)

    document.panels.back.placement.rotation.y = Math.PI
    const rotatedKey = buildTopologyKey(document, 'medium', 0)

    assert.notEqual(rotatedKey, originalKey)
  })
})

function buildDocument(): PatternDocument {
  return {
    id: 'placement-key-doc',
    name: 'Placement Key Doc',
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
