export type Vec3Tuple = [number, number, number]
export type Vec2Tuple = [number, number]

export type ScalpBinding = {
  meshId: string
  triangleIndex: number
  barycentric: [number, number, number]
  localNormalOffset: number
}

export type GuideCurve = {
  id: string
  root: ScalpBinding
  points: Vec3Tuple[]
  radius: number
  length: number
  groupId: string
}

export type GroomModifierSettings = {
  guideLength: number
  guideRadius: number
  guideSegments: number
  /** strands per cm² of scalp surface */
  strandDensity: number
  clumpStrength: number
  clumpRadius: number
  noiseAmplitude: number
  noiseFrequency: number
  curlStrength: number
  curlFrequency: number
  frizzStrength: number
  cutRandomness: number
}

export type HairMaterialSettings = {
  rootColor: string
  tipColor: string
  roughness: number
  specularStrength: number
  opacity: number
  strandWidthRoot: number
  strandWidthTip: number
}

export type GroomAsset = {
  id: string
  name: string
  targetMeshId: string | null
  scalpMask: {
    selectedTriangleIndices: number[]
    selectedVertexIndices?: number[]
  }
  guides: GuideCurve[]
  settings: GroomModifierSettings
  material: HairMaterialSettings
  version: number
}

export type GeneratedStrand = {
  id: string
  guideId: string
  points: Vec3Tuple[]
  widthRoot: number
  widthTip: number
  random: number
}

export type GroomTool =
  | 'none'
  | 'paint-scalp'
  | 'erase-scalp'
  | 'add-guide'
  | 'comb'
  | 'smooth'
  | 'cut'
  | 'delete-guide'

export type RegisteredGroomMesh = {
  id: string
  name: string
  triangleCount: number
}
