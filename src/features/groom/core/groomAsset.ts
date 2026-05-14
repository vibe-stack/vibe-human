import type { GeneratedStrand, GroomAsset, GroomModifierSettings, HairMaterialSettings } from './types'

export const GROOM_ASSET_VERSION = 1
export const MAX_GUIDE_COUNT = 800
export const MAX_STRAND_COUNT = 80_000
export const MAX_GUIDE_SEGMENTS = 12

const DEFAULT_SETTINGS: GroomModifierSettings = {
  guideLength: 0.16,
  guideRadius: 0.003,
  guideSegments: 8,
  strandDensity: 3.5,
  clumpStrength: 0.55,
  clumpRadius: 0.006,
  noiseAmplitude: 0.003,
  noiseFrequency: 3.2,
  curlStrength: 0.0015,
  curlFrequency: 4.8,
  frizzStrength: 0.001,
  cutRandomness: 0.12,
}

const DEFAULT_MATERIAL: HairMaterialSettings = {
  // Default to a natural medium-brown.
  melanin: 0.68,
  melaninRedness: 0.20,
  melaninRandomize: 0.10,
  tintColor: '#ffffff',
  rootDarken: 0.45,
  rootDarkenLength: 0.18,

  // Karis quotes typical hair specular ∈ [0.05, 0.2].  Now that the BSDF
  // lobes are energy-normalized, 0.12 reads as a clean highlight rather than
  // a white blob.
  specularStrength: 0.12,
  primaryShift: -0.06,         // ~ -3.4°, tilts highlight toward the root
  primaryHighlightTint: '#ffffff',
  secondaryShift: 0.045,        // ~ +2.6°, tilts secondary toward the tip
  secondaryHighlightTint: '#ffd9a8',
  roughness: 0.32,
  roughnessAzimuthal: 0.4,

  scatter: 0.35,
  transmissionTint: '#a47352',

  opacity: 0.95,
  strandWidthRoot: 0.0018,
  strandWidthTip: 0.0004,
  flyaway: 0.25,
  shadowStrength: 0.7,
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function clampInteger(value: number, min: number, max: number) {
  return Math.round(clamp(value, min, max))
}

export function createGroomEntityId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

export function createDefaultGroomSettings(): GroomModifierSettings {
  return { ...DEFAULT_SETTINGS }
}

export function createDefaultHairMaterialSettings(): HairMaterialSettings {
  return { ...DEFAULT_MATERIAL }
}

export function clampGroomSettings(settings: GroomModifierSettings): GroomModifierSettings {
  return {
    guideLength: clamp(settings.guideLength, 0.02, 0.4),
    guideRadius: clamp(settings.guideRadius, 0.0005, 0.02),
    guideSegments: clampInteger(settings.guideSegments, 3, 12),
    strandDensity: clamp(settings.strandDensity, 0.1, 20),
    clumpStrength: clamp(settings.clumpStrength, 0, 1),
    clumpRadius: clamp(settings.clumpRadius, 0, 0.03),
    noiseAmplitude: clamp(settings.noiseAmplitude, 0, 0.03),
    noiseFrequency: clamp(settings.noiseFrequency, 0, 16),
    curlStrength: clamp(settings.curlStrength, 0, 0.03),
    curlFrequency: clamp(settings.curlFrequency, 0, 20),
    frizzStrength: clamp(settings.frizzStrength, 0, 0.02),
    cutRandomness: clamp(settings.cutRandomness, 0, 1),
  }
}

export function clampHairMaterialSettings(material: HairMaterialSettings): HairMaterialSettings {
  return {
    melanin:                clamp(material.melanin, 0, 1),
    melaninRedness:         clamp(material.melaninRedness, 0, 1),
    melaninRandomize:       clamp(material.melaninRandomize, 0, 0.5),
    tintColor:              material.tintColor,
    rootDarken:             clamp(material.rootDarken, 0, 1),
    rootDarkenLength:       clamp(material.rootDarkenLength, 0, 1),

    specularStrength:       clamp(material.specularStrength, 0, 0.4),
    primaryShift:           clamp(material.primaryShift, -0.2, 0.2),
    primaryHighlightTint:   material.primaryHighlightTint,
    secondaryShift:         clamp(material.secondaryShift, -0.2, 0.2),
    secondaryHighlightTint: material.secondaryHighlightTint,
    roughness:              clamp(material.roughness, 0, 1),
    roughnessAzimuthal:     clamp(material.roughnessAzimuthal, 0, 1),

    scatter:                clamp(material.scatter, 0, 1),
    transmissionTint:       material.transmissionTint,

    opacity:                clamp(material.opacity, 0.05, 1),
    strandWidthRoot:        clamp(material.strandWidthRoot, 0.0003, 0.01),
    strandWidthTip:         clamp(material.strandWidthTip, 0.0001, 0.006),
    flyaway:                clamp(material.flyaway, 0, 1),
    shadowStrength:         clamp(material.shadowStrength, 0, 1),
  }
}

export function createEmptyGroomAsset(name = 'Hair Groom'): GroomAsset {
  return {
    id: createGroomEntityId('groom'),
    name,
    targetMeshId: null,
    scalpMask: { selectedTriangleIndices: [] },
    guides: [],
    settings: createDefaultGroomSettings(),
    material: createDefaultHairMaterialSettings(),
    version: GROOM_ASSET_VERSION,
  }
}

export function cloneGroomAsset(asset: GroomAsset): GroomAsset {
  return structuredClone(asset)
}

export function sanitizeGeneratedStrands(strands: GeneratedStrand[]) {
  return strands.filter((strand) => strand.points.length >= 2)
}
