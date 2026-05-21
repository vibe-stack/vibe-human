import type { PatternDocument, PatternPanel, PatternSeam } from '../document/types'
import type { GarmentDocument, PatternPiece, Seam, Vec2 } from '../state/clothingTypes'
import { evaluateEdgeAt } from './patternSampling'

// ---------------------------------------------------------------------------
// Sample both endpoints of a seam for visualisation
// ---------------------------------------------------------------------------

export type SeamSampleResult = {
  seam: Seam
  pointsA: Vec2[]
  pointsB: Vec2[]
}

export type ResolvedSeamSamples = {
  pointsA: Vec2[]
  pointsB: Vec2[]
  reversedB: boolean
  forwardCost: number
  reversedCost: number
}

export function sampleSeam(doc: GarmentDocument, seam: Seam, samples = 8): SeamSampleResult | null {
  const resolved = resolveSeamSamples(doc, seam, samples)
  if (!resolved) return null
  return { seam, pointsA: resolved.pointsA, pointsB: resolved.pointsB }
}

export function resolveSeamSamples(
  doc: GarmentDocument | PatternDocument,
  seam: Seam | PatternSeam,
  samples: number,
): ResolvedSeamSamples | null {
  const isGarment = 'patterns' in doc
  const aId = 'patternId' in seam.a ? seam.a.patternId : seam.a.panelId
  const bId = 'patternId' in seam.b ? seam.b.patternId : seam.b.panelId
  const pieceA = isGarment ? doc.patterns[aId] : doc.panels[aId]
  const pieceB = isGarment ? doc.patterns[bId] : doc.panels[bId]
  if (!pieceA || !pieceB) return null

  const pointsA = sampleEdgeById(pieceA, seam.a.edgeId, samples)
  const authoredB = sampleEdgeById(pieceB, seam.b.edgeId, samples)
  if (pointsA.length < 2 || authoredB.length < 2) {
    return { pointsA, pointsB: authoredB, reversedB: false, forwardCost: 0, reversedCost: 0 }
  }

  const explicitA = seam.a.reversed ? [...pointsA].reverse() : pointsA
  const explicitB = seam.b.reversed ? [...authoredB].reverse() : authoredB
  const forwardCost = endpointCost(explicitA, explicitB, false)
  const reversedCost = endpointCost(explicitA, explicitB, true)
  const reverseByCost = reversedCost + 1e-8 < forwardCost
  return {
    pointsA: explicitA,
    pointsB: reverseByCost ? [...explicitB].reverse() : explicitB,
    reversedB: reverseByCost,
    forwardCost,
    reversedCost,
  }
}

function sampleEdgeById(piece: PatternPiece | PatternPanel, edgeId: string, samples: number): Vec2[] {
  const edge = piece.edges.find((e) => e.id === edgeId)
  if (!edge) return []

  const pts: Vec2[] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    pts.push(evaluateEdgeAt(piece, edge, t))
  }

  return pts
}

function endpointCost(pointsA: Vec2[], pointsB: Vec2[], reverseB: boolean) {
  const bStart = reverseB ? pointsB[pointsB.length - 1] : pointsB[0]
  const bEnd = reverseB ? pointsB[0] : pointsB[pointsB.length - 1]
  const aStart = pointsA[0]
  const aEnd = pointsA[pointsA.length - 1]
  return Math.hypot(aStart.x - bStart.x, aStart.y - bStart.y)
    + Math.hypot(aEnd.x - bEnd.x, aEnd.y - bEnd.y)
}

// ---------------------------------------------------------------------------
// Get the midpoint of a seam edge (useful for label placement)
// ---------------------------------------------------------------------------

export function seamEdgeMidpoint(piece: PatternPiece, edgeId: string): Vec2 | null {
  const edge = piece.edges.find((e) => e.id === edgeId)
  if (!edge) return null
  return evaluateEdgeAt(piece, edge, 0.5)
}
