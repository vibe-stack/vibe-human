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
  rootColor: '#322117',
  tipColor: '#8f6a4e',
  roughness: 0.62,
  specularStrength: 0.48,
  opacity: 0.9,
  strandWidthRoot: 0.0022,
  strandWidthTip: 0.00045,
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
    rootColor: material.rootColor,
    tipColor: material.tipColor,
    roughness: clamp(material.roughness, 0, 1),
    specularStrength: clamp(material.specularStrength, 0, 1),
    opacity: clamp(material.opacity, 0.05, 1),
    strandWidthRoot: clamp(material.strandWidthRoot, 0.0003, 0.01),
    strandWidthTip: clamp(material.strandWidthTip, 0.0001, 0.006),
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
