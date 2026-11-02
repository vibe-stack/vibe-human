import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { KinematicBodyCollider } from './kinematicBodyCollider'
import { XPBDClothSolver } from '../solver'
import type { ClothSimMesh, SolverParams } from '../types'

// A closed, outward-wound cube of half-size `h` centred at (cx, cy, cz).
function cube(h: number, cx = 0, cy = 0, cz = 0) {
  const vertices = new Float32Array([
    -h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h,
    -h, -h, h, h, -h, h, h, h, h, -h, h, h,
  ])
  for (let i = 0; i < vertices.length; i += 3) {
    vertices[i] += cx
    vertices[i + 1] += cy
    vertices[i + 2] += cz
  }
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, // -z
    4, 5, 6, 4, 6, 7, // +z
    0, 1, 5, 0, 5, 4, // -y
    3, 7, 6, 3, 6, 2, // +y
    0, 4, 7, 0, 7, 3, // -x
    1, 2, 6, 1, 6, 5, // +x
  ])
  return { vertices, indices }
}

function translated(vertices: Float32Array, dx: number, dy: number, dz: number) {
  const out = new Float32Array(vertices)
  for (let i = 0; i < out.length; i += 3) {
    out[i] += dx
    out[i + 1] += dy
    out[i + 2] += dz
  }
  return out
}

describe('KinematicBodyCollider', () => {
  test('signs distances with smooth normals: positive outside, negative inside', () => {
    const { vertices, indices } = cube(0.1)
    const collider = new KinematicBodyCollider(indices, 8, { thickness: 0.01, friction: 0.5 })
    collider.pushPose(vertices, true)
    const out = new Float32Array(14)

    // Smooth (vertex) normals are tilted on a coarse cube, so the signed distance
    // is the true distance times cos(tilt): within a millimetre here.
    assert.ok(collider.closest(0, 0.13, 0, 0.1, out))
    assert.ok(Math.abs(out[6] - 0.03) < 1e-3, `outside distance ${out[6]}`)
    assert.ok(out[4] > 0.5, 'normal points out of the top face')

    assert.ok(collider.closest(0, 0.08, 0, 0.1, out))
    assert.ok(Math.abs(out[6] + 0.02) < 1e-3, `inside distance ${out[6]}`)
  })

  test('interpolates the pose across substeps and reports skin motion', () => {
    const { vertices, indices } = cube(0.1)
    const collider = new KinematicBodyCollider(indices, 8, { thickness: 0.01, friction: 0.5 })
    collider.pushPose(vertices, true)
    collider.pushPose(translated(vertices, 0, 0.1, 0))
    assert.ok(Math.abs(collider.maxStepDisplacement - 0.1) < 1e-6)

    const out = new Float32Array(14)
    collider.setSubstep(0, 0.5)
    assert.ok(collider.closest(0, 0.3, 0, 0.5, out))
    // Top face is at 0.1 + 0.05 halfway through the step.
    assert.ok(Math.abs(out[1] - 0.15) < 1e-4, `top face at ${out[1]}`)
    // Skin moved 5 cm up during this half step.
    assert.ok(Math.abs(out[8] - 0.05) < 1e-4, `skin motion ${out[8]}`)
  })

  test('a teleport implies no skin velocity', () => {
    const { vertices, indices } = cube(0.1)
    const collider = new KinematicBodyCollider(indices, 8, { thickness: 0.01, friction: 0.5 })
    collider.pushPose(vertices, true)
    collider.pushPose(translated(vertices, 3, 0, 0), true)
    assert.equal(collider.maxStepDisplacement, 0)
  })
})

describe('XPBD solver against an animated body', () => {
  // One free particle resting on top of a box that slides sideways: with
  // body-relative friction the particle is carried; it must also never end up
  // inside the box.
  function restingParticle(friction: number, stepMove: number) {
    const { vertices, indices } = cube(0.1)
    const collider = new KinematicBodyCollider(indices, 8, { thickness: 0.01, friction })
    collider.pushPose(vertices, true)
    const mesh: ClothSimMesh = {
      particleCount: 1,
      positions: new Float32Array([0, 0.11, 0]),
      prevPositions: new Float32Array([0, 0.11, 0]),
      velocities: new Float32Array(3),
      invMass: new Float32Array([1]),
      panelIds: ['p'],
      particleFrictions: new Float32Array([1]),
      panelUvs: new Float32Array(2),
      panelLocalPositions: new Float32Array(2),
      triangles: new Uint32Array(0),
      stretchConstraints: [],
      shearConstraints: [],
      bendDistanceConstraints: [],
      bendConstraints: [],
      seamConstraints: [],
      pinConstraints: [],
    }
    const params: SolverParams = { gravity: -9.81, damping: 0, substeps: 4, iterations: 2, dt: 1 / 60, groundY: -10, sewingTime: 0, gravityRampTime: 0, gravityDelayTime: 0 }
    const solver = new XPBDClothSolver(mesh, params)
    let offset = 0
    for (let step = 0; step < 60; step += 1) {
      offset += stepMove
      collider.pushPose(translated(vertices, offset, 0, 0))
      solver.step({ version: 0, proxies: [], kinematicColliders: [collider] })
      if (Math.abs(mesh.positions[0] - offset) < 0.09) {
        assert.ok(mesh.positions[1] > 0.1, `particle sank into the box: y=${mesh.positions[1]}`)
      }
    }
    return { x: mesh.positions[0], boxX: offset }
  }

  test('static friction carries cloth with the moving skin', () => {
    const { x, boxX } = restingParticle(1, 0.01)
    assert.ok(Math.abs(x - boxX) < 0.02, `particle at x=${x}, box moved to ${boxX}`)
  })

  test('without friction the skin slides underneath', () => {
    // Box slides 6 cm, still under the particle, which should barely move.
    const { x } = restingParticle(0, 0.001)
    assert.ok(Math.abs(x) < 0.01, `frictionless particle drifted to x=${x}`)
  })
})
