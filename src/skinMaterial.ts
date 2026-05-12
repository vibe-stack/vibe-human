import * as THREE from 'three/webgpu'
import { texture, uv, mix, normalMap, float, clamp, vec2 } from 'three/tsl'

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

export async function createSkinMaterial(overrides: SkinTextures = {}): Promise<THREE.MeshPhysicalNodeMaterial> {
  const loader = new THREE.TextureLoader()

  async function loadTex(slot: SkinTextureSlot, colorSpace: THREE.ColorSpace, repeat = 1): Promise<THREE.Texture> {
    const url = overrides[slot] ?? `${import.meta.env.BASE_URL}${SKIN_TEXTURE_DEFAULTS[slot]}`
    const tex = await loader.loadAsync(url)
    tex.colorSpace = colorSpace
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
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
    loadTex('colorFinal',    THREE.SRGBColorSpace),
    loadTex('subdermal',     THREE.SRGBColorSpace),
    loadTex('epidermal',     THREE.SRGBColorSpace),
    loadTex('roughness',     THREE.NoColorSpace),
    loadTex('specular',      THREE.NoColorSpace),
    loadTex('wrinkleNormal', THREE.NoColorSpace),
    loadTex('poresNormal',   THREE.NoColorSpace),
  ])

  const baseUv      = uv()
  const tiledPoreUv = baseUv.mul(30.0)

  const colorFinal  = texture(colorFinalMap,  baseUv).rgb
  const subdermal   = texture(subdermalMap,   baseUv).rgb
  const epidermal   = texture(epidermalMap,   baseUv).rgb
  const skinLayer   = mix(subdermal, epidermal, float(0.488))
  const baseColor   = mix(colorFinal, skinLayer, float(0.571))

  const roughness     = clamp(texture(roughnessMap, baseUv).r, float(0.28), float(0.82))
  const specular      = texture(specularMap, baseUv).r
  const specIntensity = clamp(specular, float(0.15), float(0.75))

  const poreNormalTex    = texture(poresNormalMap, tiledPoreUv).rgb
  const wrinkleNormalTex = texture(wrinkleNormalMap, baseUv).rgb
  const blendedNormalTex = mix(poreNormalTex, wrinkleNormalTex, float(0.5))
  const combinedN        = normalMap(blendedNormalTex, vec2(1.0, 1.0))

  const mat = new THREE.MeshPhysicalNodeMaterial()
  mat.name                  = 'TSL_Skin'
  mat.colorNode             = baseColor
  mat.roughnessNode         = roughness
  mat.normalNode            = combinedN
  mat.specularIntensityNode = specIntensity

  mat.metalness         = 0.0
  mat.roughness         = 0.55
  mat.ior               = 1.45
  mat.specularIntensity = 0.45
  mat.specularColor     = new THREE.Color(1.0, 0.92, 0.86)
  mat.transparent       = false
  mat.opacity           = 1.0
  mat.transmission      = 0.0
  mat.thickness         = 0.0
  mat.sheen             = 0.08
  mat.sheenRoughness    = 0.65
  mat.sheenColor        = new THREE.Color(1.0, 0.78, 0.68)
  mat.needsUpdate       = true

  return mat
}
