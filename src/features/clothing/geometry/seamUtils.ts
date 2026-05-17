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

export function sampleSeam(doc: GarmentDocument, seam: Seam, samples = 8): SeamSampleResult | null {
  const pieceA = doc.patterns[seam.a.patternId]
  const pieceB = doc.patterns[seam.b.patternId]
  if (!pieceA || !pieceB) return null

  const edgeA = pieceA.edges.find((e) => e.id === seam.a.edgeId)
  const edgeB = pieceB.edges.find((e) => e.id === seam.b.edgeId)
  if (!edgeA || !edgeB) return null

  const ptsA = sampleEdgeById(pieceA, edgeA.id, samples, seam.a.reversed)
  const ptsB = sampleEdgeById(pieceB, edgeB.id, samples, seam.b.reversed)

  return { seam, pointsA: ptsA, pointsB: ptsB }
}

function sampleEdgeById(piece: PatternPiece, edgeId: string, samples: number, reversed?: boolean): Vec2[] {
  const edge = piece.edges.find((e) => e.id === edgeId)
  if (!edge) return []

  const pts: Vec2[] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    pts.push(evaluateEdgeAt(piece, edge, t))
  }

  return reversed ? pts.reverse() : pts
}

// ---------------------------------------------------------------------------
// Get the midpoint of a seam edge (useful for label placement)
// ---------------------------------------------------------------------------

export function seamEdgeMidpoint(piece: PatternPiece, edgeId: string): Vec2 | null {
  const edge = piece.edges.find((e) => e.id === edgeId)
  if (!edge) return null
  return evaluateEdgeAt(piece, edge, 0.5)
}
