import { nanoid } from '../../../utils/nanoid'
import type { GarmentDocument, PatternEdge, PatternPiece, PatternPoint, Seam } from '../state/clothingTypes'

function uid() { return nanoid(8) }
const makePoint = (id: string, x: number, y: number, handles?: Pick<PatternPoint, 'in' | 'out'>): PatternPoint => ({ id, x, y, kind: handles ? 'smooth' : 'corner', ...handles })
const makeEdge = (id: string, from: string, to: string, curve: PatternEdge['curve'] = 'line'): PatternEdge => ({ id, from, to, curve })

function createTShirtPanel(id: string, name: string, neckDepth: number): PatternPiece { /* unchanged */
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
  return { id, name, points: { [neckLeft.id]: neckLeft,[neckRight.id]: neckRight,[rightShoulder.id]: rightShoulder,[rightSleeveTop.id]: rightSleeveTop,[rightSleeveBottom.id]: rightSleeveBottom,[rightUnderarm.id]: rightUnderarm,[rightHem.id]: rightHem,[leftHem.id]: leftHem,[leftUnderarm.id]: leftUnderarm,[leftSleeveBottom.id]: leftSleeveBottom,[leftSleeveTop.id]: leftSleeveTop,[leftShoulder.id]: leftShoulder }, edges: [makeEdge('neck', neckLeft.id, neckRight.id, 'cubic'),makeEdge('right-shoulder', neckRight.id, rightShoulder.id),makeEdge('right-sleeve-top', rightShoulder.id, rightSleeveTop.id),makeEdge('right-sleeve-opening', rightSleeveTop.id, rightSleeveBottom.id),makeEdge('right-sleeve-underarm', rightSleeveBottom.id, rightUnderarm.id),makeEdge('right-side', rightUnderarm.id, rightHem.id),makeEdge('hem', rightHem.id, leftHem.id),makeEdge('left-side', leftHem.id, leftUnderarm.id),makeEdge('left-sleeve-underarm', leftUnderarm.id, leftSleeveBottom.id),makeEdge('left-sleeve-opening', leftSleeveBottom.id, leftSleeveTop.id),makeEdge('left-sleeve-top', leftSleeveTop.id, leftShoulder.id),makeEdge('left-shoulder', leftShoulder.id, neckLeft.id)], closed: true, fabricId: 'cotton-demo', particleDistance: 16 }
}

function createPantsLegPanel(id: string, name: string, side: 'left' | 'right', half: 'front' | 'back'): PatternPiece {
  const isLeft = side === 'left'
  const isBack = half === 'back'
  const xOuter = isLeft ? -108 : 108
  const xHemOuter = isLeft ? -98 : 98
  const xHemInner = isLeft ? -38 : 38
  const yWaistOuter = -92
  const yWaistInner = -98
  const yHip = -40
  const yKnee = 86
  const yHem = 220
  const crotchX = isLeft ? 18 : -18
  const pts = {
    waistOuter: makePoint(`${id}-waist-outer`, xOuter, yWaistOuter),
    waistInner: makePoint(`${id}-waist-inner`, crotchX, yWaistInner, { in: { x: isBack ? 0 : 6, y: -10 }, out: { x: isBack ? -8 : 0, y: 18 } }),
    crotch: makePoint(`${id}-crotch`, crotchX + (isBack ? (isLeft ? 14 : -14) : 0), yHip, { in: { x: isBack ? (isLeft ? -18 : 18) : (isLeft ? -12 : 12), y: -2 }, out: { x: isLeft ? -8 : 8, y: 30 } }),
    inseamKnee: makePoint(`${id}-inseam-knee`, isLeft ? -44 : 44, yKnee),
    hemInner: makePoint(`${id}-hem-inner`, xHemInner, yHem),
    hemOuter: makePoint(`${id}-hem-outer`, xHemOuter, yHem),
    outerKnee: makePoint(`${id}-outer-knee`, isLeft ? -112 : 112, yKnee),
  }
  return { id, name, points: Object.fromEntries(Object.values(pts).map((p) => [p.id, p])), edges: [
    makeEdge('waist', pts.waistOuter.id, pts.waistInner.id),
    makeEdge('crotch', pts.waistInner.id, pts.crotch.id, 'cubic'),
    makeEdge('inseam', pts.crotch.id, pts.inseamKnee.id),
    makeEdge('inseam-lower', pts.inseamKnee.id, pts.hemInner.id),
    makeEdge('hem', pts.hemInner.id, pts.hemOuter.id),
    makeEdge('outer-lower', pts.hemOuter.id, pts.outerKnee.id),
    makeEdge('outer-side', pts.outerKnee.id, pts.waistOuter.id),
  ], closed: true, fabricId: 'cotton-demo', particleDistance: 16, gluedEdgeIds: ['waist'] }
}

export function createDemoGarment(): GarmentDocument {
  const front = createTShirtPanel('torso-front', 'T-Shirt Front', 34)
  const back = createTShirtPanel('torso-back', 'T-Shirt Back', 12)
  const pantsLeftFront = createPantsLegPanel('pants-left-front', 'Pants Left Front', 'left', 'front')
  const pantsLeftBack = createPantsLegPanel('pants-left-back', 'Pants Left Back', 'left', 'back')
  const pantsRightFront = createPantsLegPanel('pants-right-front', 'Pants Right Front', 'right', 'front')
  const pantsRightBack = createPantsLegPanel('pants-right-back', 'Pants Right Back', 'right', 'back')
  const seams: Record<string, Seam> = {
    'right-shoulder': stitch('right-shoulder', 'Right Shoulder', front, 'right-shoulder', back, 'right-shoulder'),
    'left-shoulder': stitch('left-shoulder', 'Left Shoulder', front, 'left-shoulder', back, 'left-shoulder'),
    'right-sleeve-top': stitch('right-sleeve-top', 'Right Sleeve Top', front, 'right-sleeve-top', back, 'right-sleeve-top'),
    'left-sleeve-top': stitch('left-sleeve-top', 'Left Sleeve Top', front, 'left-sleeve-top', back, 'left-sleeve-top'),
    'right-sleeve-underarm': stitch('right-sleeve-underarm', 'Right Sleeve Underarm', front, 'right-sleeve-underarm', back, 'right-sleeve-underarm'),
    'left-sleeve-underarm': stitch('left-sleeve-underarm', 'Left Sleeve Underarm', front, 'left-sleeve-underarm', back, 'left-sleeve-underarm'),
    'right-side': stitch('right-side', 'Right Side Seam', front, 'right-side', back, 'right-side'),
    'left-side': stitch('left-side', 'Left Side Seam', front, 'left-side', back, 'left-side'),
    'pants-left-outer': stitch('pants-left-outer', 'Pants Left Outer', pantsLeftFront, 'outer-side', pantsLeftBack, 'outer-side'),
    'pants-right-outer': stitch('pants-right-outer', 'Pants Right Outer', pantsRightFront, 'outer-side', pantsRightBack, 'outer-side'),
    'pants-left-inseam': stitch('pants-left-inseam', 'Pants Left Inseam', pantsLeftFront, 'inseam', pantsLeftBack, 'inseam'),
    'pants-left-inseam-lower': stitch('pants-left-inseam-lower', 'Pants Left Inseam Lower', pantsLeftFront, 'inseam-lower', pantsLeftBack, 'inseam-lower'),
    'pants-right-inseam': stitch('pants-right-inseam', 'Pants Right Inseam', pantsRightFront, 'inseam', pantsRightBack, 'inseam'),
    'pants-right-inseam-lower': stitch('pants-right-inseam-lower', 'Pants Right Inseam Lower', pantsRightFront, 'inseam-lower', pantsRightBack, 'inseam-lower'),
    'pants-center-front': stitch('pants-center-front', 'Pants Center Front', pantsLeftFront, 'crotch', pantsRightFront, 'crotch'),
    'pants-center-back': stitch('pants-center-back', 'Pants Center Back', pantsLeftBack, 'crotch', pantsRightBack, 'crotch'),
  }
  return { id: uid(), name: 'Shirt + Pants Demo', patterns: { [front.id]: front, [back.id]: back, [pantsLeftFront.id]: pantsLeftFront, [pantsLeftBack.id]: pantsLeftBack, [pantsRightFront.id]: pantsRightFront, [pantsRightBack.id]: pantsRightBack }, seams, selectedPatternId: front.id }
}

function stitch(id: string, name: string, aPanel: PatternPiece, aEdgeId: string, bPanel: PatternPiece, bEdgeId: string): Seam {
  return { id, name, a: { patternId: aPanel.id, edgeId: aEdgeId }, b: { patternId: bPanel.id, edgeId: bEdgeId }, strength: 1 }
}
