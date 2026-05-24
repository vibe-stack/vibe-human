import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { computeVertexNormalsFlat } from './useGarmentSimulation'

// Guards the hand-rolled normal routine that replaced THREE's
// computeVertexNormals in the per-frame render hot path. The whole point of the
// replacement was to be faster WITHOUT changing the result, so this test pins it
// to THREE's own output bit-for-bit (within f32 rounding).

function referenceNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3))
  geometry.setIndex(new THREE.BufferAttribute(indices.slice(), 1))
  geometry.computeVertexNormals()
  return (geometry.getAttribute('normal').array as Float32Array).slice()
}

function randomMesh(seed: number, rows: number, cols: number) {
  // deterministic LCG so failures reproduce
  let s = seed >>> 0
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff)

  const vertexCount = rows * cols
  const positions = new Float32Array(vertexCount * 3)
  for (let i = 0; i < vertexCount; i += 1) {
    positions[i * 3] = (rand() - 0.5) * 4
    positions[i * 3 + 1] = (rand() - 0.5) * 4
    positions[i * 3 + 2] = (rand() - 0.5) * 4
  }
  const tris: number[] = []
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const a = r * cols + c
      const b = a + 1
      const d = a + cols
      const e = d + 1
      tris.push(a, d, b, b, d, e)
    }
  }
  return { positions, indices: new Uint32Array(tris), vertexCount }
}

describe('computeVertexNormalsFlat matches THREE.computeVertexNormals', () => {
  for (const seed of [1, 42, 7, 99, 12345]) {
    test(`grid mesh seed=${seed}`, () => {
      const { positions, indices, vertexCount } = randomMesh(seed, 9, 11)
      const expected = referenceNormals(positions, indices)
      const actual = new Float32Array(vertexCount * 3)
      computeVertexNormalsFlat(positions, indices, actual, vertexCount)
      for (let i = 0; i < expected.length; i += 1) {
        assert.ok(
          Math.abs(expected[i] - actual[i]) <= 1e-5,
          `index ${i}: expected ${expected[i]}, got ${actual[i]}`,
        )
      }
    })
  }

  test('isolated vertex with no faces yields zero normal (matches THREE)', () => {
    // one extra vertex referenced by no triangle
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5])
    const indices = new Uint32Array([0, 1, 2])
    const expected = referenceNormals(positions, indices)
    const actual = new Float32Array(4 * 3)
    computeVertexNormalsFlat(positions, indices, actual, 4)
    for (let i = 0; i < expected.length; i += 1) {
      assert.ok(Math.abs(expected[i] - actual[i]) <= 1e-6, `index ${i}`)
    }
  })

  test('reuses the output buffer without leaking previous values', () => {
    const { positions, indices, vertexCount } = randomMesh(3, 6, 6)
    const out = new Float32Array(vertexCount * 3).fill(999)
    computeVertexNormalsFlat(positions, indices, out, vertexCount)
    const expected = referenceNormals(positions, indices)
    for (let i = 0; i < expected.length; i += 1) {
      assert.ok(Math.abs(expected[i] - out[i]) <= 1e-5, `index ${i}`)
    }
  })
})
