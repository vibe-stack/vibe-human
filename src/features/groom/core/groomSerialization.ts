import {
  GROOM_ASSET_VERSION,
  clampGroomSettings,
  clampHairMaterialSettings,
  createEmptyGroomAsset,
} from './groomAsset'
import type { GroomAsset } from './types'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sanitizeMapRecord(value: unknown) {
  if (!isObject(value)) return undefined
  const result: Record<number, number> = {}
  for (const [key, raw] of Object.entries(value)) {
    const triangleIndex = Number(key)
    if (!Number.isInteger(triangleIndex) || triangleIndex < 0 || typeof raw !== 'number') continue
    result[triangleIndex] = Math.min(1, Math.max(-1, raw))
  }
  return result
}

function sanitizeScalpMaps(value: unknown): GroomAsset['scalpMask']['maps'] {
  if (!isObject(value)) return {}
  return {
    density: sanitizeMapRecord(value.density),
    length: sanitizeMapRecord(value.length),
    flyaway: sanitizeMapRecord(value.flyaway),
    clumpStrength: sanitizeMapRecord(value.clumpStrength),
    clumpRadius: sanitizeMapRecord(value.clumpRadius),
    hairlineSoftness: sanitizeMapRecord(value.hairlineSoftness),
    parting: sanitizeMapRecord(value.parting),
  }
}

function sanitizeFlowMap(value: unknown): GroomAsset['scalpMask']['flowMap'] {
  if (!isObject(value)) return {}
  const result: NonNullable<GroomAsset['scalpMask']['flowMap']> = {}
  for (const [key, raw] of Object.entries(value)) {
    const triangleIndex = Number(key)
    if (!Number.isInteger(triangleIndex) || triangleIndex < 0 || !Array.isArray(raw) || raw.length !== 3) continue
    const vector = raw.map((component) => typeof component === 'number' ? component : 0)
    const len = Math.hypot(vector[0], vector[1], vector[2])
    if (len <= 1e-6) continue
    result[triangleIndex] = [vector[0] / len, vector[1] / len, vector[2] / len]
  }
  return result
}

export function exportGroomAsset(asset: unknown) {
  const groom = JSON.parse(JSON.stringify(asset)) as GroomAsset

  return JSON.stringify(
    {
      version: groom.version,
      id: groom.id,
      name: groom.name,
      targetMeshId: groom.targetMeshId,
      scalpMask: groom.scalpMask,
      guides: groom.guides,
      settings: groom.settings,
      material: groom.material,
    },
    null,
    2,
  )
}

export function importGroomAsset(json: string): GroomAsset {
  const parsed = JSON.parse(json) as unknown
  if (!isObject(parsed)) {
    throw new Error('Invalid groom asset JSON.')
  }

  const fallback = createEmptyGroomAsset()
  const scalpMask = isObject(parsed.scalpMask) ? parsed.scalpMask : fallback.scalpMask
  const guides = Array.isArray(parsed.guides) ? parsed.guides : fallback.guides
  const version = typeof parsed.version === 'number' ? parsed.version : GROOM_ASSET_VERSION

  return {
    id: typeof parsed.id === 'string' ? parsed.id : fallback.id,
    name: typeof parsed.name === 'string' ? parsed.name : fallback.name,
    targetMeshId: typeof parsed.targetMeshId === 'string' ? parsed.targetMeshId : null,
    scalpMask: {
      selectedTriangleIndices: Array.isArray(scalpMask.selectedTriangleIndices)
        ? scalpMask.selectedTriangleIndices.filter((value): value is number => typeof value === 'number')
        : [],
      selectedVertexIndices: Array.isArray(scalpMask.selectedVertexIndices)
        ? scalpMask.selectedVertexIndices.filter((value): value is number => typeof value === 'number')
        : undefined,
      maps: sanitizeScalpMaps(scalpMask.maps),
      flowMap: sanitizeFlowMap(scalpMask.flowMap),
    },
    guides: guides as GroomAsset['guides'],
    settings: clampGroomSettings(
      isObject(parsed.settings)
        ? { ...fallback.settings, ...parsed.settings }
        : fallback.settings,
    ),
    material: clampHairMaterialSettings(
      isObject(parsed.material)
        ? { ...fallback.material, ...parsed.material }
        : fallback.material,
    ),
    version,
  }
}
