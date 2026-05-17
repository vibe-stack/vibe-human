import type { PatternDocument, PatternPanel, PatternPlacement } from './types'
import type { GarmentDocument } from '../state/clothingTypes'

export function toPatternDocument(
  garment: GarmentDocument,
  placements: Record<string, PatternPlacement>,
): PatternDocument {
  const panels: Record<string, PatternPanel> = {}
  const pieces = Object.values(garment.patterns)

  for (const [index, piece] of pieces.entries()) {
    panels[piece.id] = {
      ...JSON.parse(JSON.stringify(piece)),
      placement: clonePlacement(placements[piece.id] ?? defaultPlacement(index, pieces.length)),
      metadata: undefined,
    }
  }

  const seams = Object.fromEntries(
    Object.values(garment.seams).map((seam) => [
      seam.id,
      {
        ...JSON.parse(JSON.stringify(seam)),
        a: { panelId: seam.a.patternId, edgeId: seam.a.edgeId, reversed: seam.a.reversed },
        b: { panelId: seam.b.patternId, edgeId: seam.b.edgeId, reversed: seam.b.reversed },
      },
    ]),
  )

  return {
    id: garment.id,
    name: garment.name,
    panels,
    seams,
  }
}

function clonePlacement(placement: PatternPlacement): PatternPlacement {
  return {
    position: { ...placement.position },
    rotation: { ...placement.rotation },
  }
}

function defaultPlacement(index: number, count: number): PatternPlacement {
  const spread = index - (count - 1) / 2
  return {
    position: { x: spread * 0.18, y: 0.38, z: spread * -0.12 },
    rotation: { x: 0, y: spread * 0.22, z: 0 },
  }
}