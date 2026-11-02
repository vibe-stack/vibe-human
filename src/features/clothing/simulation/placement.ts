import type { PatternDocument, PatternPanel } from '../document/types'
import type { ClothSimMesh } from './types'

// Pattern-space -> world placement helpers shared by the editor hook and the
// runtime ClothSimulation. One pattern unit is PATTERN_UNIT_SCALE metres.

export const PATTERN_UNIT_SCALE = 0.004

export function applyDocumentPlacements(runtimeMesh: ClothSimMesh, document: PatternDocument) {
  const { positions, prevPositions, velocities, panelIds, panelLocalPositions, particleCount } = runtimeMesh
  for (let particle = 0; particle < particleCount; particle += 1) {
    const panel = document.panels[panelIds[particle]]
    if (!panel) continue
    const localX = panelLocalPositions[particle * 2]
    const localY = panelLocalPositions[particle * 2 + 1]
    const world = applyPanelPlacement(localX, localY, panel)
    const offset = particle * 3
    positions[offset] = world.x
    positions[offset + 1] = world.y
    positions[offset + 2] = world.z
    prevPositions[offset] = world.x
    prevPositions[offset + 1] = world.y
    prevPositions[offset + 2] = world.z
    velocities[offset] = 0
    velocities[offset + 1] = 0
    velocities[offset + 2] = 0
  }
}

export function refreshSeamPlacementRest(runtimeMesh: ClothSimMesh) {
  const positions = runtimeMesh.positions
  for (const seam of runtimeMesh.seamConstraints) {
    const ia = seam.a * 3
    const ib = seam.b * 3
    seam.rest = Math.hypot(
      positions[ib] - positions[ia],
      positions[ib + 1] - positions[ia + 1],
      positions[ib + 2] - positions[ia + 2],
    )
    seam.targetRest = seam.targetRest ?? 0
  }
}

export function applyPanelPlacement(patternX: number, patternY: number, panel: PatternPanel) {
  const bounds = panelBounds(panel)
  const localX = ((patternX - bounds.minX) / bounds.width - 0.5) * bounds.width * PATTERN_UNIT_SCALE
  const localY = (0.5 - (patternY - bounds.minY) / bounds.height) * bounds.height * PATTERN_UNIT_SCALE
  const q = quatFromEuler(panel.placement.rotation.x, panel.placement.rotation.y, panel.placement.rotation.z)
  const rotated = rotateVec(localX, localY, 0, q.x, q.y, q.z, q.w)
  return {
    x: rotated.x + panel.placement.position.x,
    y: rotated.y + panel.placement.position.y,
    z: rotated.z + panel.placement.position.z,
  }
}

export function panelBounds(panel: PatternPanel) {
  const points = Object.values(panel.points)
  if (!points.length) return { minX: -140, minY: -140, width: 280, height: 280 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return { minX, minY, width: maxX - minX || 1, height: maxY - minY || 1 }
}

export function quatFromEuler(x: number, y: number, z: number) {
  const c1 = Math.cos(x / 2)
  const s1 = Math.sin(x / 2)
  const c2 = Math.cos(y / 2)
  const s2 = Math.sin(y / 2)
  const c3 = Math.cos(z / 2)
  const s3 = Math.sin(z / 2)
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  }
}

export function rotateVec(x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number) {
  const tx = 2 * (qy * z - qz * y)
  const ty = 2 * (qz * x - qx * z)
  const tz = 2 * (qx * y - qy * x)
  return {
    x: x + qw * tx + (qy * tz - qz * ty),
    y: y + qw * ty + (qz * tx - qx * tz),
    z: z + qw * tz + (qx * ty - qy * tx),
  }
}
