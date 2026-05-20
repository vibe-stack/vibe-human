import { nanoid } from '../../../utils/nanoid'
import type { GarmentDocument, PatternEdge, PatternPiece, PatternPoint, Seam } from '../state/clothingTypes'

function uid() {
  return nanoid(8)
}

function makePoint(id: string, x: number, y: number, handles?: Pick<PatternPoint, 'in' | 'out'>): PatternPoint {
  return { id, x, y, kind: handles ? 'smooth' : 'corner', ...handles }
}

function makeEdge(id: string, from: string, to: string, curve: PatternEdge['curve'] = 'line'): PatternEdge {
  return { id, from, to, curve }
}

function createTShirtPanel(id: string, name: string, neckDepth: number): PatternPiece {
  const neckLeft = makePoint(`${id}-neck-left`, -44, -182, { out: { x: 22, y: neckDepth } })
  const neckRight = makePoint(`${id}-neck-right`, 44, -182, { in: { x: -22, y: neckDepth } })
  const rightShoulder = makePoint(`${id}-right-shoulder`, 96, -168)
  const rightSleeveTop = makePoint(`${id}-right-sleeve-top`, 196, -120)
  const rightSleeveBottom = makePoint(`${id}-right-sleeve-bottom`, 172, -44)
  const rightUnderarm = makePoint(`${id}-right-underarm`, 104, -64)
  const rightHem = makePoint(`${id}-right-hem`, 96, 196)
  const leftHem = makePoint(`${id}-left-hem`, -96, 196)
  const leftUnderarm = makePoint(`${id}-left-underarm`, -104, -64)
  const leftSleeveBottom = makePoint(`${id}-left-sleeve-bottom`, -172, -44)
  const leftSleeveTop = makePoint(`${id}-left-sleeve-top`, -196, -120)
  const leftShoulder = makePoint(`${id}-left-shoulder`, -96, -168)

  return {
    id,
    name,
    points: {
      [neckLeft.id]: neckLeft,
      [neckRight.id]: neckRight,
      [rightShoulder.id]: rightShoulder,
      [rightSleeveTop.id]: rightSleeveTop,
      [rightSleeveBottom.id]: rightSleeveBottom,
      [rightUnderarm.id]: rightUnderarm,
      [rightHem.id]: rightHem,
      [leftHem.id]: leftHem,
      [leftUnderarm.id]: leftUnderarm,
      [leftSleeveBottom.id]: leftSleeveBottom,
      [leftSleeveTop.id]: leftSleeveTop,
      [leftShoulder.id]: leftShoulder,
    },
    edges: [
      makeEdge('neck', neckLeft.id, neckRight.id, 'cubic'),
      makeEdge('right-shoulder', neckRight.id, rightShoulder.id),
      makeEdge('right-sleeve-top', rightShoulder.id, rightSleeveTop.id),
      makeEdge('right-sleeve-opening', rightSleeveTop.id, rightSleeveBottom.id),
      makeEdge('right-sleeve-underarm', rightSleeveBottom.id, rightUnderarm.id),
      makeEdge('right-side', rightUnderarm.id, rightHem.id),
      makeEdge('hem', rightHem.id, leftHem.id),
      makeEdge('left-side', leftHem.id, leftUnderarm.id),
      makeEdge('left-sleeve-underarm', leftUnderarm.id, leftSleeveBottom.id),
      makeEdge('left-sleeve-opening', leftSleeveBottom.id, leftSleeveTop.id),
      makeEdge('left-sleeve-top', leftSleeveTop.id, leftShoulder.id),
      makeEdge('left-shoulder', leftShoulder.id, neckLeft.id),
    ],
    closed: true,
    fabricId: 'cotton-demo',
    particleDistance: 16,
  }
}

export function createDemoGarment(): GarmentDocument {
  const front = createTShirtPanel('torso-front', 'T-Shirt Front', 34)
  const back = createTShirtPanel('torso-back', 'T-Shirt Back', 12)

  const seams: Record<string, Seam> = {
    'right-shoulder': stitch('right-shoulder', 'Right Shoulder', front, 'right-shoulder', back, 'right-shoulder'),
    'left-shoulder': stitch('left-shoulder', 'Left Shoulder', front, 'left-shoulder', back, 'left-shoulder'),
    'right-sleeve-top': stitch('right-sleeve-top', 'Right Sleeve Top', front, 'right-sleeve-top', back, 'right-sleeve-top'),
    'left-sleeve-top': stitch('left-sleeve-top', 'Left Sleeve Top', front, 'left-sleeve-top', back, 'left-sleeve-top'),
    'right-sleeve-underarm': stitch('right-sleeve-underarm', 'Right Sleeve Underarm', front, 'right-sleeve-underarm', back, 'right-sleeve-underarm'),
    'left-sleeve-underarm': stitch('left-sleeve-underarm', 'Left Sleeve Underarm', front, 'left-sleeve-underarm', back, 'left-sleeve-underarm'),
    'right-side': stitch('right-side', 'Right Side Seam', front, 'right-side', back, 'right-side'),
    'left-side': stitch('left-side', 'Left Side Seam', front, 'left-side', back, 'left-side'),
  }

  return {
    id: uid(),
    name: 'Two Panel T-Shirt Demo',
    patterns: {
      [front.id]: front,
      [back.id]: back,
    },
    seams,
    selectedPatternId: front.id,
  }
}

function stitch(
  id: string,
  name: string,
  aPanel: PatternPiece,
  aEdgeId: string,
  bPanel: PatternPiece,
  bEdgeId: string,
  bReversed = false,
): Seam {
  return {
    id,
    name,
    a: { patternId: aPanel.id, edgeId: aEdgeId },
    b: { patternId: bPanel.id, edgeId: bEdgeId, reversed: bReversed },
    strength: 1,
  }
}
