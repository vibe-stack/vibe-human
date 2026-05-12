import * as THREE from 'three/webgpu'
import { texture, uv, mix, normalMap, float, clamp, vec2, vec3, normalView, positionViewDirection, dot, smoothstep } from 'three/tsl'

export const DEFAULT_PORE_SCALE = 30
export const DEFAULT_PORE_NORMAL_STRENGTH = 1
export const DEFAULT_WRINKLE_NORMAL_STRENGTH = 1
export const DEFAULT_FLIP_NORMAL_Y = false
export const DEFAULT_OILINESS = 0.15
export const DEFAULT_SURFACE_ROUGHNESS = 0.55
export const DEFAULT_TONE_DEPTH = 0.571
const EYE_TEXTURE_DEFAULT = 'textures/eyes.png'

export const SKIN_TEXTURE_SLOTS = [
  'colorFinal',
  'subdermal',
  'epidermal',
  'roughness',
  'specular',
  'wrinkleNormal',
  'poresNormal',
] as const

export type SkinTextureSlot = (typeof SKIN_TEXTURE_SLOTS)[number]

export const SKIN_TEXTURE_LABELS: Record<SkinTextureSlot, string> = {
  colorFinal:   'Color (Albedo)',
  subdermal:    'Subdermal',
  epidermal:    'Epidermal',
  roughness:    'Roughness',
  specular:     'Specular',
  wrinkleNormal:'Wrinkle Normal',
  poresNormal:  'Pore Normal',
}

export const SKIN_TEXTURE_DEFAULTS: Record<SkinTextureSlot, string> = {
  colorFinal:   'textures/colorfinal4k.jpg',
  subdermal:    'textures/subdermal.png',
  epidermal:    'textures/epidermal_bad.png',
  roughness:    'textures/roughnessv5.png',
  specular:     'textures/specular.png',
  wrinkleNormal:'textures/wrinklenormalhd.webp',
  poresNormal:  'textures/poremap2k.webp',
}

export type SkinTextures = Partial<Record<SkinTextureSlot, string>>

export type SkinMaterialSettings = {
  poreScale: number
  poreNormalStrength: number
  wrinkleNormalStrength: number
  flipNormalY: boolean
  oiliness: number
  surfaceRoughness: number
  toneDepth: number
}

export async function createSkinMaterial(
  overrides: SkinTextures = {},
  settings: SkinMaterialSettings = {
    poreScale: DEFAULT_PORE_SCALE,
    poreNormalStrength: DEFAULT_PORE_NORMAL_STRENGTH,
    wrinkleNormalStrength: DEFAULT_WRINKLE_NORMAL_STRENGTH,
    flipNormalY: DEFAULT_FLIP_NORMAL_Y,
    oiliness: DEFAULT_OILINESS,
    surfaceRoughness: DEFAULT_SURFACE_ROUGHNESS,
    toneDepth: DEFAULT_TONE_DEPTH,
  },
): Promise<THREE.MeshPhysicalNodeMaterial> {
  const loader = new THREE.TextureLoader()

  async function loadTex(slot: SkinTextureSlot, colorSpace: THREE.ColorSpace, repeat = 1, clamp = false): Promise<THREE.Texture> {
    const url = overrides[slot] ?? `${import.meta.env.BASE_URL}${SKIN_TEXTURE_DEFAULTS[slot]}`
    const tex = await loader.loadAsync(url)
    tex.colorSpace = colorSpace
    tex.wrapS = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping
    tex.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping
    tex.repeat.set(repeat, repeat)
    tex.anisotropy = 8
    tex.flipY = false
    tex.needsUpdate = true
    return tex
  }

  const [
    colorFinalMap,
    subdermalMap,
    epidermalMap,
    roughnessMap,
    specularMap,
    wrinkleNormalMap,
    poresNormalMap,
  ] = await Promise.all([
    loadTex('colorFinal',    THREE.SRGBColorSpace, 1, true),
    loadTex('subdermal',     THREE.SRGBColorSpace, 1, true),
    loadTex('epidermal',     THREE.SRGBColorSpace, 1, true),
    loadTex('roughness',     THREE.NoColorSpace,   1, true),
    loadTex('specular',      THREE.NoColorSpace,   1, true),
    loadTex('wrinkleNormal', THREE.NoColorSpace,   1, true),
    loadTex('poresNormal',   THREE.NoColorSpace),
  ])

  const baseUv      = uv()
  const tiledPoreUv = baseUv.mul(settings.poreScale)

  const colorFinal  = texture(colorFinalMap,  baseUv).rgb
  const subdermal   = texture(subdermalMap,   baseUv).rgb
  const epidermal   = texture(epidermalMap,   baseUv).rgb
  const skinLayer   = mix(subdermal, epidermal, float(0.488))
  const baseColor   = mix(colorFinal, skinLayer, float(settings.toneDepth))

  const roughness     = clamp(texture(roughnessMap, baseUv).r, float(0.34), float(0.78))
  const specular      = texture(specularMap, baseUv).r
  const specIntensity = clamp(specular.mul(0.45).add(0.24), float(0.22), float(0.58))

  const neutralNormal    = vec3(0.5, 0.5, 1.0)
  const poreNormalTex    = mix(
    neutralNormal,
    texture(poresNormalMap, tiledPoreUv).rgb,
    float(settings.poreNormalStrength),
  )
  const wrinkleNormalTex = mix(
    neutralNormal,
    texture(wrinkleNormalMap, baseUv).rgb,
    float(settings.wrinkleNormalStrength),
  )

  const blendedNormalTex = mix(poreNormalTex, wrinkleNormalTex, float(0.5))

  // Fade normal map to neutral at grazing angles to prevent silhouette artifacts.
  const NdotV        = clamp(dot(normalView, positionViewDirection), float(0.0), float(1.0))
  const grazingFade  = smoothstep(float(0.0), float(0.5), NdotV)
  const fadedNormal  = mix(neutralNormal, blendedNormalTex, grazingFade)

  const combinedN    = normalMap(fadedNormal, vec2(1.0, settings.flipNormalY ? -1.0 : 1.0))

  const mat = new THREE.MeshPhysicalNodeMaterial()
  mat.name                  = 'TSL_Skin'
  mat.colorNode             = baseColor
  mat.roughnessNode         = roughness
  mat.normalNode            = combinedN
  mat.specularIntensityNode = specIntensity

  mat.metalness         = 0.0
  mat.roughness         = settings.surfaceRoughness
  mat.ior               = 1.45
  mat.specularIntensity = 0.85
  mat.specularColor     = new THREE.Color(1.0, 0.92, 0.86)
  mat.side              = THREE.DoubleSide
  mat.transparent       = false
  mat.opacity           = 1.0
  mat.transmission      = 0.0
  mat.thickness         = 0.0
  mat.sheen             = 0.08
  mat.sheenRoughness    = 0.78
  mat.sheenColor        = new THREE.Color(1.0, 0.78, 0.68)
  mat.clearcoat          = settings.oiliness
  mat.clearcoatRoughness = 0.12 + (1.0 - settings.oiliness) * 0.5
  mat.needsUpdate       = true

  return mat
}

export async function createEyeMaterial(): Promise<THREE.MeshPhysicalNodeMaterial> {
  const loader = new THREE.TextureLoader()
  const eyeMap = await loader.loadAsync(`${import.meta.env.BASE_URL}${EYE_TEXTURE_DEFAULT}`)
  eyeMap.colorSpace = THREE.SRGBColorSpace
  eyeMap.wrapS = THREE.ClampToEdgeWrapping
  eyeMap.wrapT = THREE.ClampToEdgeWrapping
  eyeMap.anisotropy = 8
  eyeMap.flipY = false
  eyeMap.needsUpdate = true

  const eyeColor = texture(eyeMap, uv()).rgb
  const mat = new THREE.MeshPhysicalNodeMaterial()
  mat.name = 'TSL_Eye'
  mat.colorNode = eyeColor
  mat.roughnessNode = float(0.018)
  mat.specularIntensityNode = float(1.0)
  mat.clearcoatNode = float(1.0)
  mat.clearcoatRoughnessNode = float(0.015)
  mat.iorNode = float(1.376)

  mat.metalness = 0.0
  mat.roughness = 0.018
  mat.ior = 1.376
  mat.specularIntensity = 1.0
  mat.specularColor = new THREE.Color(1, 1, 1)
  mat.clearcoat = 1.0
  mat.clearcoatRoughness = 0.015
  mat.transmission = 0.08
  mat.thickness = 0.06
  mat.envMapIntensity = 1.8
  mat.needsUpdate = true

  return mat
}
