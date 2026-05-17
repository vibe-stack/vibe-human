import { nanoid } from '../../../utils/nanoid'
import type { GarmentDocument, PatternEdge, PatternPiece, PatternPoint } from '../state/clothingTypes'

function uid() {
  return nanoid(8)
}

function makePoint(id: string, x: number, y: number): PatternPoint {
  return { id, x, y, kind: 'corner' }
}

function makeEdge(from: string, to: string): PatternEdge {
  return { id: uid(), from, to, curve: 'line' }
}

function createHeadClothPanel(): PatternPiece {
  const topLeft = makePoint('cloth-top-left', -140, -140)
  const topRight = makePoint('cloth-top-right', 140, -140)
  const bottomRight = makePoint('cloth-bottom-right', 140, 140)
  const bottomLeft = makePoint('cloth-bottom-left', -140, 140)

  return {
    id: 'head-cloth-panel',
    name: 'Head Cloth',
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
    particleDistance: 22,
  }
}

export function createDemoGarment(): GarmentDocument {
  const cloth = createHeadClothPanel()

  return {
    id: uid(),
    name: 'Rapier Head Cloth Demo',
    patterns: {
      [cloth.id]: cloth,
    },
    seams: {},
    selectedPatternId: cloth.id,
  }
}
