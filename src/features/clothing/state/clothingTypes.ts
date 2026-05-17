// ---------------------------------------------------------------------------
// Garment document model
// Pixi and Three MUST NOT own this data — they read from these types only.
// ---------------------------------------------------------------------------

export type Vec2 = { x: number; y: number }
export type Vec3 = { x: number; y: number; z: number }

/** A point on a pattern outline.  in/out are bezier handle offsets from (x,y). */
export type PatternPoint = {
  id: string
  x: number
  y: number
  /** Incoming bezier handle, offset from (x,y).  Absent for corners. */
  in?: Vec2
  /** Outgoing bezier handle, offset from (x,y).  Absent for corners. */
  out?: Vec2
  kind: 'corner' | 'smooth' | 'symmetric'
}

/** An edge between two PatternPoints. */
export type PatternEdge = {
  id: string
  from: string // PatternPoint id
  to: string   // PatternPoint id
  curve: 'line' | 'cubic'
}

/** A single flat fabric panel. */
export type PatternPiece = {
  id: string
  name: string
  points: Record<string, PatternPoint>
  edges: PatternEdge[]
  holes?: PatternEdge[][]
  closed: boolean
  fabricId?: string
  /** Target triangle size for simulation grid (mm-scale in pattern space). */
  particleDistance: number
}

/** One end of a seam — references an edge in a PatternPiece. */
export type SeamEndpoint = {
  patternId: string
  edgeId: string
  reversed?: boolean
}

/** Sewing seam connecting two pattern edges. */
export type Seam = {
  id: string
  name: string
  a: SeamEndpoint
  b: SeamEndpoint
  /** 0..1 stiffness multiplier, ready for simulation. */
  strength: number
}

/** The top-level garment document.  Everything else derives from this. */
export type GarmentDocument = {
  id: string
  name: string
  patterns: Record<string, PatternPiece>
  seams: Record<string, Seam>
  selectedPatternId?: string
  selectedPointId?: string
  selectedEdgeId?: string
  selectedSeamId?: string
}

// ---------------------------------------------------------------------------
// Sub-tool identifiers
// ---------------------------------------------------------------------------

export type ClothingTool =
  | 'select'
  | 'edit-points'
  | 'rect'
  | 'ellipse'
  | 'circle'
  | 'polygon'
  | 'pen'
  | 'seam'
  | 'pan'

export type BBox = { minX: number; minY: number; maxX: number; maxY: number }

export type GizmoHandle =
  | 'move'
  | 'rotate'
  | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export type ClothSimQuality = 'low' | 'medium' | 'high' | 'ultra'

export type ClothingTransformMode = 'translate' | 'rotate'

export type PatternPlacement = {
  position: Vec3
  rotation: Vec3
}
