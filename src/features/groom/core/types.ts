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

/**
 * Production-grade hair material settings, modelled after MetaHuman / XGen /
 * Karis (UE) / Disney Chiang.
 *
 * The base hair color is derived from absorption coefficients computed from
 * `melanin` and `melaninRedness` (eumelanin/pheomelanin ratio) rather than a
 * direct color pick — this is what real hair shaders do.  `melaninRandomize`
 * scatters per-strand melanin so a head of "brown" hair has the natural
 * highlight/shadow variance you see in reality.  `tintColor` is an artistic
 * tint applied on top for non-realistic looks (white, pastel, etc).
 *
 * Highlight model: two specular lobes (primary R + secondary TRT) each with
 * their own shift (cuticle tilt) and width (roughness).  This is Karis's
 * "dual specular" approximation of Marschner.
 *
 * Diffuse: a fake-SSS multi-scatter approximation (`scatter`) brightens the
 * shadow side.
 */
export type HairMaterialSettings = {
  // --- Color (melanin model) ---
  melanin: number          // 0..1   0 = platinum blonde, 1 = jet black
  melaninRedness: number   // 0..1   0 = ash/cool, 1 = warm red (pheomelanin)
  melaninRandomize: number // 0..0.5 per-strand variance for natural variation
  tintColor: string        // multiplicative tint (hex), defaults to white
  rootDarken: number       // 0..1   how much darker the root area is (AO)
  rootDarkenLength: number // 0..1   fraction of strand length that's root-dark

  // --- Specular (dual lobe, Karis-style) ---
  specularStrength: number      // 0..1 master specular gain
  primaryShift: number          // radians, -0.15..0.15  cuticle tilt for R lobe
  primaryHighlightTint: string  // tint for R lobe (white-ish for realism)
  secondaryShift: number        // radians, -0.15..0.15  cuticle tilt for TRT
  secondaryHighlightTint: string// tint for TRT lobe (warm, hair-color-ish)
  roughness: number             // 0..1 longitudinal roughness (highlight width)
  roughnessAzimuthal: number    // 0..1 azimuthal roughness (anisotropy)

  // --- Multi-scatter / scatter ---
  scatter: number               // 0..1 wrap diffuse strength
  transmissionTint: string      // light passing through the fiber

  // --- Strand shape (geometric, not shading) ---
  opacity: number
  strandWidthRoot: number
  strandWidthTip: number
  flyaway: number               // 0..1 randomized per-strand spec/width boost
  // Strand self-shadow strength.  Approximates the volumetric occlusion
  // that roots receive from neighbouring strands above them; without it
  // hair reads as a flat sheet under direct light.
  shadowStrength: number        // 0..1
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
  rootDensity: number
  rootOcclusion: number
  edgeDistance: number
  lengthScale: number
  flyawayMask: number
  clumpId: number
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
