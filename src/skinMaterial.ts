import * as THREE from 'three/webgpu'
import { texture, uv, mix, normalMap, float, clamp, vec2, vec3, normalView, positionViewDirection, dot, smoothstep, normalize, pow } from 'three/tsl'

export const DEFAULT_PORE_SCALE = 30
export const DEFAULT_PORE_NORMAL_STRENGTH = 1
export const DEFAULT_WRINKLE_NORMAL_STRENGTH = 1
export const DEFAULT_FLIP_NORMAL_Y = false
export const DEFAULT_OILINESS = 0.15
export const DEFAULT_SURFACE_ROUGHNESS = 0.55
export const DEFAULT_TONE_DEPTH = 0.571
export const DEFAULT_SUBSURFACE_STRENGTH = 0.42
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
  subsurfaceStrength: number
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
    subsurfaceStrength: DEFAULT_SUBSURFACE_STRENGTH,
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

  const specular      = texture(specularMap, baseUv).r
  const baseColor     = mix(colorFinal, skinLayer, float(settings.toneDepth))
  const bloodTint     = subdermal.mul(vec3(1.18, 0.46, 0.34))

  const roughnessTex  = texture(roughnessMap, baseUv).r
  const roughness     = clamp(
    roughnessTex
      .mul(0.64)
      .add(float(settings.surfaceRoughness).mul(0.36))
      .sub(specular.mul(0.06 + settings.oiliness * 0.1)),
    float(0.24),
    float(0.86),
  )
  const specIntensity = clamp(
    specular.mul(0.62).add(0.36 + settings.oiliness * 0.18),
    float(0.32),
    float(0.96),
  )
  const specTint      = mix(
    vec3(1.0, 0.78, 0.62),
    vec3(1.0, 0.96, 0.9),
    clamp(specular.mul(1.4), float(0.0), float(1.0)),
  )

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

  const poreTangentNormal    = poreNormalTex.mul(2.0).sub(1.0)
  const wrinkleTangentNormal = wrinkleNormalTex.mul(2.0).sub(1.0)
  const layeredTangentNormal = normalize(vec3(
    poreTangentNormal.xy.mul(0.6).add(wrinkleTangentNormal.xy.mul(0.85)),
    poreTangentNormal.z.mul(wrinkleTangentNormal.z).add(0.22),
  ))
  const layeredNormalTex     = layeredTangentNormal.mul(0.5).add(0.5)

  // Fade normal map to neutral at grazing angles to prevent silhouette artifacts.
  const NdotV        = clamp(dot(normalView, positionViewDirection), float(0.0), float(1.0))
  const grazingFade  = smoothstep(float(0.0), float(0.65), NdotV)
  const fadedNormal  = mix(neutralNormal, layeredNormalTex, grazingFade)
  const fadedClearcoatNormal = mix(neutralNormal, poreNormalTex, grazingFade)

  const normalY      = settings.flipNormalY ? -1.0 : 1.0
  const combinedN    = normalMap(fadedNormal, vec2(1.0, normalY))
  const clearcoatN   = normalMap(fadedClearcoatNormal, vec2(0.24, normalY * 0.24))

  const scatterRim   = pow(clamp(float(1.0).sub(NdotV), float(0.0), float(1.0)), float(2.25))
  const scatterMask  = smoothstep(float(0.05), float(0.9), scatterRim).mul(settings.subsurfaceStrength)
  const scatterColor = mix(baseColor, bloodTint, scatterMask.mul(0.34))
  const oilFilm      = clamp(
    specular.mul(0.34).add(float(settings.oiliness).mul(0.52)),
    float(0.03),
    float(0.75),
  )
  const oilRoughness = clamp(
    roughness.mul(0.25).add(0.06 + (1.0 - settings.oiliness) * 0.18),
    float(0.045),
    float(0.32),
  )

  const mat = new THREE.MeshPhysicalNodeMaterial()
  mat.name                  = 'TSL_Skin'
  mat.colorNode             = scatterColor
  mat.emissiveNode          = bloodTint.mul(scatterMask.mul(0.055))
  mat.roughnessNode         = roughness
  mat.normalNode            = combinedN
  mat.specularIntensityNode = specIntensity
  mat.specularColorNode     = specTint
  mat.clearcoatNode         = oilFilm
  mat.clearcoatRoughnessNode = oilRoughness
  mat.clearcoatNormalNode   = clearcoatN
  mat.sheenNode             = vec3(1.0, 0.52, 0.38).mul(0.03 + settings.subsurfaceStrength * 0.12)
  mat.sheenRoughnessNode    = float(0.84)

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
  mat.sheen             = 0.12
  mat.sheenRoughness    = 0.84
  mat.sheenColor        = new THREE.Color(1.0, 0.78, 0.68)
  mat.clearcoat          = Math.max(settings.oiliness, 0.03)
  mat.clearcoatRoughness = 0.06 + (1.0 - settings.oiliness) * 0.18
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
