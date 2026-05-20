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

function createPantsPanel(id: string, name: string): PatternPiece {
  const w = 92
  const c = 28
  const yTop = -70
  const yCrotch = 28
  const yHem = 220
  const pts = {
    lt: makePoint(`${id}-lt`, -w, yTop),
    rt: makePoint(`${id}-rt`, w, yTop),
    roh: makePoint(`${id}-roh`, w, yCrotch),
    roi: makePoint(`${id}-roi`, c, yCrotch),
    rih: makePoint(`${id}-rih`, c, yHem),
    lih: makePoint(`${id}-lih`, -c, yHem),
    loi: makePoint(`${id}-loi`, -c, yCrotch),
    loh: makePoint(`${id}-loh`, -w, yCrotch),
  }
  return { id, name, points: Object.fromEntries(Object.values(pts).map((p) => [p.id, p])), edges: [
    makeEdge('waist', pts.lt.id, pts.rt.id),
    makeEdge('right-outer', pts.rt.id, pts.roh.id),
    makeEdge('right-crotch', pts.roh.id, pts.roi.id),
    makeEdge('right-inseam', pts.roi.id, pts.rih.id),
    makeEdge('hem', pts.rih.id, pts.lih.id),
    makeEdge('left-inseam', pts.lih.id, pts.loi.id),
    makeEdge('left-crotch', pts.loi.id, pts.loh.id),
    makeEdge('left-outer', pts.loh.id, pts.lt.id),
  ], closed: true, fabricId: 'cotton-demo', particleDistance: 16, gluedEdgeIds: ['waist'] }
}

export function createDemoGarment(): GarmentDocument {
  const front = createTShirtPanel('torso-front', 'T-Shirt Front', 34)
  const back = createTShirtPanel('torso-back', 'T-Shirt Back', 12)
  const pantsFront = createPantsPanel('pants-front', 'Pants Front')
  const pantsBack = createPantsPanel('pants-back', 'Pants Back')
  const seams: Record<string, Seam> = {
    'right-shoulder': stitch('right-shoulder', 'Right Shoulder', front, 'right-shoulder', back, 'right-shoulder', true),
    'left-shoulder': stitch('left-shoulder', 'Left Shoulder', front, 'left-shoulder', back, 'left-shoulder', true),
    'right-sleeve-top': stitch('right-sleeve-top', 'Right Sleeve Top', front, 'right-sleeve-top', back, 'right-sleeve-top', true),
    'left-sleeve-top': stitch('left-sleeve-top', 'Left Sleeve Top', front, 'left-sleeve-top', back, 'left-sleeve-top', true),
    'right-sleeve-underarm': stitch('right-sleeve-underarm', 'Right Sleeve Underarm', front, 'right-sleeve-underarm', back, 'right-sleeve-underarm', true),
    'left-sleeve-underarm': stitch('left-sleeve-underarm', 'Left Sleeve Underarm', front, 'left-sleeve-underarm', back, 'left-sleeve-underarm', true),
    'right-side': stitch('right-side', 'Right Side Seam', front, 'right-side', back, 'right-side', true),
    'left-side': stitch('left-side', 'Left Side Seam', front, 'left-side', back, 'left-side', true),
    'pants-right-outer': stitch('pants-right-outer', 'Pants Right Outer', pantsFront, 'right-outer', pantsBack, 'right-outer', true),
    'pants-left-outer': stitch('pants-left-outer', 'Pants Left Outer', pantsFront, 'left-outer', pantsBack, 'left-outer', true),
    'pants-right-inseam': stitch('pants-right-inseam', 'Pants Right Inseam', pantsFront, 'right-inseam', pantsBack, 'right-inseam', true),
    'pants-left-inseam': stitch('pants-left-inseam', 'Pants Left Inseam', pantsFront, 'left-inseam', pantsBack, 'left-inseam', true),
    'pants-crotch-right': stitch('pants-crotch-right', 'Pants Right Crotch', pantsFront, 'right-crotch', pantsBack, 'right-crotch', true),
    'pants-crotch-left': stitch('pants-crotch-left', 'Pants Left Crotch', pantsFront, 'left-crotch', pantsBack, 'left-crotch', true),
  }
  return { id: uid(), name: 'Shirt + Pants Demo', patterns: { [front.id]: front, [back.id]: back, [pantsFront.id]: pantsFront, [pantsBack.id]: pantsBack }, seams, selectedPatternId: front.id }
}

function stitch(id: string, name: string, aPanel: PatternPiece, aEdgeId: string, bPanel: PatternPiece, bEdgeId: string, bReversed = false): Seam {
  return { id, name, a: { patternId: aPanel.id, edgeId: aEdgeId }, b: { patternId: bPanel.id, edgeId: bEdgeId, reversed: bReversed }, strength: 1 }
}
