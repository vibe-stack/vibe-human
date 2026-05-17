/// <reference types="node" />

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { solveCollisionConstraints } from './solveCollisionConstraints'
import type { ClothSimMesh, ColliderSnapshot } from '../types'

describe('solveCollisionConstraints', () => {
  test('pushes particles out of low-res mesh patches', () => {
    const mesh: ClothSimMesh = {
      particleCount: 1,
      positions: new Float32Array([0, 0.02, 0]),
      prevPositions: new Float32Array([0, 0.02, 0]),
      velocities: new Float32Array(3),
      invMass: new Float32Array([1]),
      panelIds: ['panel'],
      panelUvs: new Float32Array([0, 0]),
      panelLocalPositions: new Float32Array([0, 0, 0]),
      triangles: new Uint32Array(),
      stretchConstraints: [],
      shearConstraints: [],
      bendConstraints: [],
      seamConstraints: [],
      pinConstraints: [],
    }
    const snapshot: ColliderSnapshot = {
      version: 1,
      proxies: [],
      lowResMeshPatches: [
        {
          id: 'torso.lowRes',
          region: 'chest',
          vertices: new Float32Array([
            -1, 0, -1,
            1, 0, -1,
            0, 0, 1,
          ]),
          indices: new Uint32Array([0, 1, 2]),
          skin: 0.04,
          thickness: 0.01,
          friction: 0.5,
        },
      ],
    }

    solveCollisionConstraints(mesh, snapshot)

    assert.equal(Math.abs(mesh.positions[1] - 0.05) < 1e-4, true)
  })
})