import { nanoid } from '../../../utils/nanoid'
import type { GarmentDocument, PatternEdge, PatternPiece, PatternPoint, Seam } from '../state/clothingTypes'

function uid() {
  return nanoid(8)
}

function makePoint(id: string, x: number, y: number): PatternPoint {
  return { id, x, y, kind: 'corner' }
}

function makeEdge(from: string, to: string): PatternEdge {
  return { id: uid(), from, to, curve: 'line' }
}

function createTorsoPanel(id: string, name: string, halfWidth = 90, halfHeight = 150): PatternPiece {
  const topLeft = makePoint(`${id}-top-left`, -halfWidth, -halfHeight)
  const topRight = makePoint(`${id}-top-right`, halfWidth, -halfHeight)
  const bottomRight = makePoint(`${id}-bottom-right`, halfWidth, halfHeight)
  const bottomLeft = makePoint(`${id}-bottom-left`, -halfWidth, halfHeight)

  return {
    id,
    name,
    points: {
      [topLeft.id]: topLeft,
      [topRight.id]: topRight,
      [bottomRight.id]: bottomRight,
      [bottomLeft.id]: bottomLeft,
    },
    edges: [
      makeEdge(topLeft.id, topRight.id),
      makeEdge(topRight.id, bottomRight.id),
      makeEdge(bottomRight.id, bottomLeft.id),
      makeEdge(bottomLeft.id, topLeft.id),
    ],
    closed: true,
    fabricId: 'cotton-demo',
    particleDistance: 18,
  }
}

export function createDemoGarment(): GarmentDocument {
  const front = createTorsoPanel('torso-front', 'Torso Front')
  const back = createTorsoPanel('torso-back', 'Torso Back')

  const frontRight = front.edges[1]
  const frontLeft = front.edges[3]
  const backRight = back.edges[1]
  const backLeft = back.edges[3]

  const seams: Record<string, Seam> = {
    'side-left': {
      id: 'side-left',
      name: 'Left Side Seam',
      a: { patternId: front.id, edgeId: frontLeft.id },
      b: { patternId: back.id, edgeId: backRight.id, reversed: true },
      strength: 1,
    },
    'side-right': {
      id: 'side-right',
      name: 'Right Side Seam',
      a: { patternId: front.id, edgeId: frontRight.id },
      b: { patternId: back.id, edgeId: backLeft.id, reversed: true },
      strength: 1,
    },
  }

  return {
    id: uid(),
    name: 'Two Panel Torso Demo',
    patterns: {
      [front.id]: front,
      [back.id]: back,
    },
    seams,
    selectedPatternId: front.id,
  }
}
