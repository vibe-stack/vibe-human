import * as THREE from 'three/webgpu'
import { BODY_PARTS, currentLimbJoints, type BodyPart, type PreparedCharacter } from './characterRig'

// Tailor's measurements taken from the character's collision skin in its bind
// pose (character space: feet on y=0, facing +Z, character left = +X). Garments
// are cut from these, so the same template fits a slim, a broad or an armoured
// character without per-model tuning.

export type TorsoSection = {
  y: number
  halfWidth: number
  halfDepth: number
  centerX: number
  centerZ: number
  circumference: number
}

export type BodyMeasurements = {
  height: number
  neckBase: THREE.Vector3
  neckRadius: number
  shoulderTopY: number
  shoulder: { L: THREE.Vector3; R: THREE.Vector3 }
  elbow: { L: THREE.Vector3; R: THREE.Vector3 }
  wrist: { L: THREE.Vector3; R: THREE.Vector3 }
  hip: { L: THREE.Vector3; R: THREE.Vector3 }
  knee: { L: THREE.Vector3; R: THREE.Vector3 }
  ankle: { L: THREE.Vector3; R: THREE.Vector3 }
  /** root: at the armpit / shoulder cap, where a sleeve joins the body. */
  armRadius: { root: number; upper: number; elbow: number; wrist: number }
  legRadius: { thigh: number; knee: number; ankle: number }
  chest: TorsoSection
  waist: TorsoSection
  hips: TorsoSection
  crotchY: number
}

export function measureBody(vertices: Float32Array, vertexPart: Uint8Array, character: PreparedCharacter): BodyMeasurements {
  const rig = character.rig
  if (!rig) throw new Error('measureBody needs an analysed humanoid rig')
  // Joints in the pose being dressed (may differ from the rest pose).
  const joints = {
    armL: currentLimbJoints(character, rig.arms.L),
    armR: currentLimbJoints(character, rig.arms.R),
    legL: currentLimbJoints(character, rig.legs.L),
    legR: currentLimbJoints(character, rig.legs.R),
  }
  const partIndex = (part: BodyPart) => BODY_PARTS.indexOf(part)
  const torso = partIndex('torso')
  const head = partIndex('head')
  const legL = partIndex('legL')
  const legR = partIndex('legR')
  const height = rig.height
  const band = 0.012 * height

  // A tailor's tape: the convex-hull perimeter of the skin slice, which bridges
  // concavities (between pecs, the spine groove) exactly like a tape measure.
  const section = (y: number, parts: number[]): TorsoSection | null => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    const points: Array<[number, number]> = []
    for (let v = 0; v < vertexPart.length; v += 1) {
      if (!parts.includes(vertexPart[v])) continue
      const vy = vertices[v * 3 + 1]
      if (Math.abs(vy - y) > band) continue
      const x = vertices[v * 3]
      const z = vertices[v * 3 + 2]
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
      points.push([x, z])
    }
    if (points.length < 4) return null
    const halfWidth = (maxX - minX) / 2
    const halfDepth = (maxZ - minZ) / 2
    const circumference = Math.max(convexHullPerimeter(points), ellipseCircumference(halfWidth, halfDepth) * 0.9)
    return { y, halfWidth, halfDepth, centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2, circumference }
  }

  const shoulderL = joints.armL.root
  const shoulderR = joints.armR.root
  const hipJointY = (joints.legL.root.y + joints.legR.root.y) / 2
  const shoulderY = (shoulderL.y + shoulderR.y) / 2
  const fallback = (y: number): TorsoSection => ({ y, halfWidth: 0.16 * height / 1.75, halfDepth: 0.11 * height / 1.75, centerX: 0, centerZ: 0, circumference: ellipseCircumference(0.16, 0.11) })

  // Chest: the largest girth of the upper torso, wherever it is (pecs, armour
  // plates and shoulder blades sit at different heights on different bodies).
  // Arms are excluded by part, so an A-pose arm next to the ribs does not count.
  let chest: TorsoSection | null = null
  for (let i = 0; i <= 12; i += 1) {
    const y = hipJointY + (shoulderY - 0.02 * height - hipJointY) * (0.45 + 0.55 * (i / 12))
    const s = section(y, [torso])
    if (s && (!chest || s.circumference > chest.circumference)) chest = s
  }
  const chestY = chest?.y ?? shoulderY - 0.33 * (shoulderY - hipJointY)
  chest ??= fallback(chestY)

  let waist: TorsoSection | null = null
  for (let i = 0; i <= 10; i += 1) {
    const y = hipJointY + (chestY - hipJointY) * (0.25 + 0.6 * (i / 10))
    const s = section(y, [torso])
    if (s && (!waist || s.circumference < waist.circumference)) waist = s
  }
  waist ??= fallback((hipJointY + chestY) / 2)

  let hips: TorsoSection | null = null
  for (let i = 0; i <= 8; i += 1) {
    const y = hipJointY - 0.07 * height + 0.1 * height * (i / 8)
    const s = section(y, [torso, legL, legR])
    if (s && (!hips || s.circumference > hips.circumference)) hips = s
  }
  hips ??= fallback(hipJointY)

  // Crotch: the highest level below the hip joints where the inner surfaces of
  // the two legs are clearly apart and no torso skin bridges the gap. (A
  // "nothing on the midline" test alone is fooled by gaps in a coarse skin.)
  let crotchY = hipJointY - 0.06 * height
  const minGap = 0.008 * height
  for (let y = hipJointY - 0.02 * height; y > hipJointY - 0.25 * height; y -= 0.004 * height) {
    let leftInner = Infinity
    let rightInner = -Infinity
    for (let v = 0; v < vertexPart.length; v += 1) {
      const p = vertexPart[v]
      if (p !== legL && p !== legR) continue
      if (Math.abs(vertices[v * 3 + 1] - y) > band) continue
      const x = vertices[v * 3]
      if (p === legL) leftInner = Math.min(leftInner, x)
      else rightInner = Math.max(rightInner, x)
    }
    if (!Number.isFinite(leftInner) || !Number.isFinite(rightInner) || leftInner - rightInner < minGap) continue
    let bridged = false
    for (let v = 0; v < vertexPart.length && !bridged; v += 1) {
      if (vertexPart[v] !== torso || Math.abs(vertices[v * 3 + 1] - y) > band) continue
      const x = vertices[v * 3]
      if (x > rightInner + minGap * 0.25 && x < leftInner - minGap * 0.25) bridged = true
    }
    if (!bridged) { crotchY = y; break }
  }

  // Neck: radius of head-part skin just above the neck base.
  const neckSlice = collectRadial(vertices, vertexPart, [head, torso], (x, y) => Math.abs(y - (rig.neckBase.y + 0.03 * height)) < band && Math.abs(x - rig.neckBase.x) < 0.1 * height, rig.neckBase.x, rig.neckBase.z)
  const neckRadius = clamp(median(neckSlice) || 0.06 * height / 1.75, 0.035 * height / 1.75, 0.11 * height / 1.75)

  // Shoulder top: highest skin over each shoulder joint.
  let shoulderTopY = shoulderY
  for (let v = 0; v < vertexPart.length; v += 1) {
    const x = vertices[v * 3], y = vertices[v * 3 + 1], z = vertices[v * 3 + 2]
    for (const s of [shoulderL, shoulderR]) {
      if (Math.abs(x - s.x) < 0.03 * height && Math.abs(z - s.z) < 0.06 * height && y > shoulderTopY && y < s.y + 0.08 * height) shoulderTopY = y
    }
  }

  const limbRadius = (part: BodyPart, from: THREE.Vector3, to: THREE.Vector3, t: number) =>
    radiusAlong(vertices, vertexPart, partIndex(part), from, to, t, 0.06)
  const avg = (a: number, b: number, fallbackValue: number) => {
    const values = [a, b].filter((value) => value > 0)
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallbackValue
  }
  const s = height / 1.75
  const armRadius = {
    root: avg(limbRadius('armL', joints.armL.root, joints.armL.mid, 0.12), limbRadius('armR', joints.armR.root, joints.armR.mid, 0.12), 0.055 * s),
    upper: avg(limbRadius('armL', joints.armL.root, joints.armL.mid, 0.35), limbRadius('armR', joints.armR.root, joints.armR.mid, 0.35), 0.045 * s),
    elbow: avg(limbRadius('armL', joints.armL.root, joints.armL.mid, 0.95), limbRadius('armR', joints.armR.root, joints.armR.mid, 0.95), 0.038 * s),
    wrist: avg(limbRadius('armL', joints.armL.mid, joints.armL.end, 0.92), limbRadius('armR', joints.armR.mid, joints.armR.end, 0.92), 0.03 * s),
  }
  const legRadius = {
    thigh: avg(limbRadius('legL', joints.legL.root, joints.legL.mid, 0.3), limbRadius('legR', joints.legR.root, joints.legR.mid, 0.3), 0.08 * s),
    knee: avg(limbRadius('legL', joints.legL.root, joints.legL.mid, 0.95), limbRadius('legR', joints.legR.root, joints.legR.mid, 0.95), 0.055 * s),
    ankle: avg(limbRadius('legL', joints.legL.mid, joints.legL.end, 0.85), limbRadius('legR', joints.legR.mid, joints.legR.end, 0.85), 0.04 * s),
  }

  return {
    height,
    neckBase: rig.neckBase.clone(),
    neckRadius,
    shoulderTopY,
    shoulder: { L: shoulderL.clone(), R: shoulderR.clone() },
    elbow: { L: joints.armL.mid.clone(), R: joints.armR.mid.clone() },
    wrist: { L: joints.armL.end.clone(), R: joints.armR.end.clone() },
    hip: { L: joints.legL.root.clone(), R: joints.legR.root.clone() },
    knee: { L: joints.legL.mid.clone(), R: joints.legR.mid.clone() },
    ankle: { L: joints.legL.end.clone(), R: joints.legR.end.clone() },
    armRadius,
    legRadius,
    chest,
    waist,
    hips,
    crotchY,
  }
}

/** Median distance of a limb's skin from its axis, around fraction `t` of the segment. */
function radiusAlong(vertices: Float32Array, vertexPart: Uint8Array, part: number, from: THREE.Vector3, to: THREE.Vector3, t: number, window: number) {
  const ax = to.x - from.x, ay = to.y - from.y, az = to.z - from.z
  const lengthSq = ax * ax + ay * ay + az * az
  if (lengthSq < 1e-8) return 0
  const distances: number[] = []
  for (let v = 0; v < vertexPart.length; v += 1) {
    if (vertexPart[v] !== part) continue
    const px = vertices[v * 3] - from.x, py = vertices[v * 3 + 1] - from.y, pz = vertices[v * 3 + 2] - from.z
    const s = (px * ax + py * ay + pz * az) / lengthSq
    if (Math.abs(s - t) > window) continue
    const qx = px - ax * s, qy = py - ay * s, qz = pz - az * s
    distances.push(Math.sqrt(qx * qx + qy * qy + qz * qz))
  }
  return quantile(distances, 0.6)
}

function collectRadial(vertices: Float32Array, vertexPart: Uint8Array, parts: number[], accept: (x: number, y: number) => boolean, cx: number, cz: number) {
  const out: number[] = []
  for (let v = 0; v < vertexPart.length; v += 1) {
    if (!parts.includes(vertexPart[v])) continue
    const x = vertices[v * 3], y = vertices[v * 3 + 1], z = vertices[v * 3 + 2]
    if (!accept(x, y)) continue
    out.push(Math.hypot(x - cx, z - cz))
  }
  return out
}

function convexHullPerimeter(points: Array<[number, number]>) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Array<[number, number]> = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Array<[number, number]> = []
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)]
  let perimeter = 0
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    perimeter += Math.hypot(a[0] - b[0], a[1] - b[1])
  }
  return perimeter
}

export function ellipseCircumference(a: number, b: number) {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
}

function median(values: number[]) {
  return quantile(values, 0.5)
}

function quantile(values: number[], q: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
