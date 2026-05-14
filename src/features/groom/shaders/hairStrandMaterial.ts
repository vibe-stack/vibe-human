import * as THREE from 'three/webgpu'
import {
  BRDF_Lambert,
  Fn,
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cos,
  exp,
  float,
  max,
  min,
  mix,
  modelViewMatrix,
  modelWorldMatrix,
  normalize,
  positionGeometry,
  saturate,
  sin,
  uniform,
  varyingProperty,
  vec2,
  vec3,
  vec4,
  viewport,
} from 'three/tsl'
import { LightingModel } from 'three/webgpu'
import type { HairMaterialSettings } from '../core/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

// -----------------------------------------------------------------------------
// Production strand hair material.
//
// Lighting: separable hair BSDF in the style of Karis 2016 (UE) / Chiang 2016
// (Disney).  Uses *spherical coordinates around the strand tangent*, not a
// surface normal — this is what makes hair look anisotropic instead of like a
// plastic blob.
//
// For each light direction L and view direction V we derive:
//
//   θ_v, θ_l  — angles between V/L and the plane perpendicular to T
//   θ_h        = (θ_v + θ_l) / 2     (half-angle, longitudinal)
//   cos(φ)     = projection of L and V onto the perpendicular plane, dotted
//
// Two longitudinal lobes (R, TRT) are evaluated as Gaussians in θ_h shifted
// by the cuticle-tilt angles α_R, α_TRT, with widths β_R, β_TRT derived from
// `roughness` and `roughnessAzimuthal`.  Each lobe has its own colour tint.
// Multi-scatter ("scatter") brightens the shadow side by re-using diffuse
// energy that physically would have come from neighbouring strands.
//
// Base colour is derived from melanin via the absorption→reflectance map
// (Chiang 2016 §4).  σ_a = melanin * eumelanin + redness * pheomelanin, and
// the resulting strand colour is exp(-σ_a) — small absorption ⇒ light hair,
// large absorption ⇒ dark hair.
//
// Geometry attributes (per-vertex):
//   position   (vec3) – centre-line point, local space
//   tangent    (vec3) – local-space strand tangent (unit, forward)
//   uv         (vec2) – (side, t)   side ∈ {-1, +1}, t ∈ [0, 1] root→tip
//   strandSeed (float)– per-strand random in [0,1] for variation
//
// Ribbon expansion is performed in NDC perpendicular to the projected
// tangent and scaled back to clip space by w (Line2NodeMaterial technique).
// Width is in world units, clamped to ≥0.5 px on the GPU; alpha is scaled
// by the shrink ratio so sub-pixel hair fades cleanly instead of aliasing.
//
// Compositing uses alpha-test + depth-write rather than blended transparency
// (UE5 "Coverage From Alpha") so hair correctly occludes the scalp below it.
// -----------------------------------------------------------------------------

// Constant absorption coefficients for the melanin pigments (Chiang 2016,
// "A Practical and Controllable Hair and Fur Model for Production").  These
// are the per-component absorption per unit pigment concentration.
const EUMELANIN = new THREE.Vector3(0.419, 0.697, 1.37)   // brown
const PHEOMELANIN = new THREE.Vector3(0.187, 0.4, 1.05)   // red

// -----------------------------------------------------------------------------
// Hair BSDF — one longitudinal lobe (Gaussian in θ_h shifted by α).
// Returns a scalar attenuation; the lobe is tinted/coloured at the call site.
// -----------------------------------------------------------------------------
function longitudinalScatter(
  sinThetaV: any, sinThetaL: any,
  cosThetaV: any, cosThetaL: any,
  shift: any, roughness: any,
): any {
  // Apply tilt: rotate (sin,cos)(θ_v) and (θ_l) by `shift` so the peak sits
  // off the tangent plane by the cuticle-tilt angle.
  const sShift = sin(shift)
  const cShift = cos(shift)
  const sinThetaVt = sinThetaV.mul(cShift).sub(cosThetaV.mul(sShift))
  const cosThetaVt = cosThetaV.mul(cShift).add(sinThetaV.mul(sShift))

  // Half-angle on the longitudinal axis.  We work in sin/cos because hair
  // strands are nearly parallel to the tangent and acos(small_value) is
  // numerically unstable.
  // sin(θ_h) ≈ (sin(θ_vt) + sin(θ_l)) / 2 for narrow lobes
  const sinThetaH = sinThetaVt.add(sinThetaL).mul(0.5)
  // Gaussian in sin(θ_h - α): exp(-sinθ_h² / (2β²)) / (sqrt(2π) β)
  const beta = max(roughness, float(0.04))
  const beta2 = beta.mul(beta)
  const g = exp(sinThetaH.mul(sinThetaH).div(beta2.mul(-2.0)))

  // Energy normalization (not 1/sqrt(2π β) — Karis uses a simplified gain).
  // Also include the geometric cos term that arises from the surface integral.
  return g.mul(cosThetaVt.mul(cosThetaL).add(0.0001))
}

// Azimuthal cos²(φ/2) lobe — used for both R and TRT in the Karis simplified
// model.  Returns a saturated scalar in [0,1].
function azimuthalScatter(cosPhi: any, roughnessAz: any): any {
  // (1 + cos(φ)) / 2  → cos²(φ/2)
  const base = saturate(cosPhi.mul(0.5).add(0.5))
  // Higher azimuthal roughness flattens the lobe.
  const k = mix(float(4.0), float(0.5), roughnessAz)
  // pow without the function call (which TSL types overload aggressively):
  // x^k via exp(k * ln(x)).  Avoid pow for cosPhi==0 by adding epsilon.
  return base.add(float(0.001)).log().mul(k).exp()
}

type HairLightingCtx = {
  tangentWorld: any
  viewDir: any
  baseColor: any
  primaryTint: any
  secondaryTint: any
  transmissionTint: any
  scatter: any
  specStrength: any
  roughness: any
  roughnessAz: any
  primaryShift: any
  secondaryShift: any
}

class HairLightingModel extends LightingModel {
  declare ctx: HairLightingCtx
  constructor(ctx: HairLightingCtx) { super(); this.ctx = ctx }

  direct(lightData: any) {
    const { lightDirection, lightColor, reflectedLight } = lightData
    const c = this.ctx

    const T = normalize(c.tangentWorld)
    const V = normalize(c.viewDir)
    const L = normalize(lightDirection)

    // Project L and V onto the plane perpendicular to T.
    const LdotT = L.dot(T)
    const VdotT = V.dot(T)
    const sinThetaL = LdotT
    const sinThetaV = VdotT
    const cosThetaL = saturate(float(1.0).sub(sinThetaL.mul(sinThetaL))).sqrt()
    const cosThetaV = saturate(float(1.0).sub(sinThetaV.mul(sinThetaV))).sqrt()

    // Azimuthal angle: dot product of L and V projected onto the perp plane.
    const Lperp = L.sub(T.mul(LdotT))
    const Vperp = V.sub(T.mul(VdotT))
    // Normalize the perp projections; clamp denom for L || T or V || T.
    const LperpN = Lperp.div(max(cosThetaL, float(1e-3)))
    const VperpN = Vperp.div(max(cosThetaV, float(1e-3)))
    const cosPhi = saturate(LperpN.dot(VperpN).mul(0.5).add(0.5)).mul(2.0).sub(1.0)

    // --- Lobes ---
    const M_R = longitudinalScatter(sinThetaV, sinThetaL, cosThetaV, cosThetaL, c.primaryShift,   c.roughness)
    const M_TRT = longitudinalScatter(sinThetaV, sinThetaL, cosThetaV, cosThetaL, c.secondaryShift, c.roughness.mul(2.0))

    const N_R = azimuthalScatter(cosPhi, c.roughnessAz)
    // TRT has its caustic glints around back-scatter; approximate by an
    // additional narrow lobe at φ ≈ 180° plus the broad TRT lobe.
    const cosPhiBack = cosPhi.negate()
    const N_TRT = azimuthalScatter(cosPhi, c.roughnessAz.mul(1.4))
      .add(azimuthalScatter(cosPhiBack, c.roughnessAz.mul(0.4)).mul(0.25))

    const R   = M_R.mul(N_R)
    const TRT = M_TRT.mul(N_TRT)

    // --- Diffuse / multi-scatter ---
    // Wrapped diffuse fakes the brightening you get from neighbouring strands
    // scattering light into the shadow side of the head.
    const wrap = saturate(LdotT.mul(0.0).add(cosThetaL).mul(0.5).add(0.5))
    const diffuseTerm = mix(float(0.15), float(1.0), wrap)
    // Strength of the multi-scatter brightening at the back side.
    const backBoost = saturate(VdotT.mul(LdotT).negate().mul(0.5).add(0.5))
    const msGain = float(1.0).add(c.scatter.mul(backBoost).mul(0.9))

    // --- Compose ---
    const specularR   = vec3(c.primaryTint).mul(R)
    const specularTRT = vec3(c.secondaryTint).mul(TRT).mul(vec3(c.transmissionTint))
    const specular: any = specularR.add(specularTRT).mul(c.specStrength)

    const diffuseRgb: any = vec3(c.baseColor).mul(diffuseTerm).mul(msGain)
    const lambert: any = BRDF_Lambert({ diffuseColor: diffuseRgb })

    reflectedLight.directDiffuse.addAssign(vec3(lightColor).mul(lambert) as any)
    reflectedLight.directSpecular.addAssign(vec3(lightColor).mul(specular) as any)
  }

  indirect(builder: any) {
    const { irradiance, ambientOcclusion, reflectedLight } = builder.context
    if (!irradiance) return
    const lambert: any = BRDF_Lambert({ diffuseColor: vec3(this.ctx.baseColor) as any })
    reflectedLight.indirectDiffuse.addAssign(vec3(irradiance).mul(lambert) as any)
    if (ambientOcclusion) {
      reflectedLight.indirectDiffuse.mulAssign(vec3(ambientOcclusion) as any)
    }
  }
}

// -----------------------------------------------------------------------------

export type HairMaterial = THREE.NodeMaterial & {
  _groomUniforms: GroomUniforms
}

type GroomUniforms = {
  widthRoot:        ReturnType<typeof uniform>
  widthTip:         ReturnType<typeof uniform>
  opacity:          ReturnType<typeof uniform>
  melanin:          ReturnType<typeof uniform>
  melaninRedness:   ReturnType<typeof uniform>
  melaninRandomize: ReturnType<typeof uniform>
  tintColor:        ReturnType<typeof uniform>
  rootDarken:       ReturnType<typeof uniform>
  rootDarkenLength: ReturnType<typeof uniform>
  specStrength:     ReturnType<typeof uniform>
  primaryShift:     ReturnType<typeof uniform>
  primaryTint:      ReturnType<typeof uniform>
  secondaryShift:   ReturnType<typeof uniform>
  secondaryTint:    ReturnType<typeof uniform>
  roughness:        ReturnType<typeof uniform>
  roughnessAz:      ReturnType<typeof uniform>
  scatter:          ReturnType<typeof uniform>
  transmissionTint: ReturnType<typeof uniform>
  flyaway:          ReturnType<typeof uniform>
}

export function createHairStrandMaterial(settings: HairMaterialSettings): HairMaterial {
  const uniforms: GroomUniforms = {
    widthRoot:        uniform(settings.strandWidthRoot),
    widthTip:         uniform(settings.strandWidthTip),
    opacity:          uniform(settings.opacity),
    melanin:          uniform(settings.melanin),
    melaninRedness:   uniform(settings.melaninRedness),
    melaninRandomize: uniform(settings.melaninRandomize),
    tintColor:        uniform(new THREE.Color(settings.tintColor)),
    rootDarken:       uniform(settings.rootDarken),
    rootDarkenLength: uniform(settings.rootDarkenLength),
    specStrength:     uniform(settings.specularStrength),
    primaryShift:     uniform(settings.primaryShift),
    primaryTint:      uniform(new THREE.Color(settings.primaryHighlightTint)),
    secondaryShift:   uniform(settings.secondaryShift),
    secondaryTint:    uniform(new THREE.Color(settings.secondaryHighlightTint)),
    roughness:        uniform(settings.roughness),
    roughnessAz:      uniform(settings.roughnessAzimuthal),
    scatter:          uniform(settings.scatter),
    transmissionTint: uniform(new THREE.Color(settings.transmissionTint)),
    flyaway:          uniform(settings.flyaway),
  }

  const u = uniforms as any

  // --- Vertex stage --------------------------------------------------------
  const vertexNode = Fn(() => {
    const sideT = attribute('uv', 'vec2') as any
    const side = float(sideT.x).toVar()
    const tParam = float(sideT.y).toVar()
    const tangentLocal = attribute('tangent', 'vec3') as any
    const seed = float(attribute('strandSeed', 'float') as any).toVar()

    // View + clip-space transforms.
    const centerView = modelViewMatrix.mul(vec4(positionGeometry, 1.0))
    const aheadView = modelViewMatrix.mul(vec4(positionGeometry.add(tangentLocal), 1.0))
    const centerClip = vec4(cameraProjectionMatrix.mul(centerView)).toVar() as any
    const aheadClip = vec4(cameraProjectionMatrix.mul(aheadView)).toVar() as any

    // Aspect-corrected NDC tangent direction.
    const vw = viewport as any
    const aspect = vw.z.div(vw.w)
    const ndcCenter = centerClip.xy.div(centerClip.w)
    const ndcAhead = aheadClip.xy.div(aheadClip.w)
    const dir = vec2(
      ndcAhead.x.sub(ndcCenter.x).mul(aspect),
      ndcAhead.y.sub(ndcCenter.y),
    ) as any
    const dirN = normalize(dir.add(vec2(1e-6, 0.0))) as any
    const perp = vec2(dirN.y, dirN.x.negate()) as any
    const perpFixed = vec2(perp.x.div(aspect), perp.y) as any

    // World-space half-width at this vertex, with per-strand flyaway bump.
    const flyawayBump = float(1.0).add(u.flyaway.mul(seed.mul(2.0).sub(1.0)).mul(0.6))
    const halfWidth = mix(u.widthRoot, u.widthTip, tParam).mul(0.5).mul(flyawayBump)

    // World → pixel scale at this depth.
    const projMat = cameraProjectionMatrix as any
    const projY = projMat.element(float(1)).element(float(1)) as any
    const halfViewportPx = vw.w.mul(0.5)
    const pxPerWorld = projY.mul(halfViewportPx).div(max(centerClip.w, float(1e-4)))
    const widthPxRaw = halfWidth.mul(pxPerWorld)
    const widthPx = max(widthPxRaw, float(0.5))

    // Sub-pixel coverage compensation.
    const coverageScale = min(float(1.0), widthPxRaw.div(widthPx))

    const ndcScale = widthPx.div(halfViewportPx)
    const clipOffsetX = perpFixed.x.mul(ndcScale).mul(centerClip.w)
    const clipOffsetY = perpFixed.y.mul(ndcScale).mul(centerClip.w)
    const finalClip = vec4(
      centerClip.x.add(side.mul(clipOffsetX)),
      centerClip.y.add(side.mul(clipOffsetY)),
      centerClip.z,
      centerClip.w,
    )

    const worldPos = modelWorldMatrix.mul(vec4(positionGeometry, 1.0)).xyz
    const tangentWorld = normalize(modelWorldMatrix.mul(vec4(tangentLocal, 0.0)).xyz)

    varyingProperty('vec3', 'vHairTangent').assign(tangentWorld)
    varyingProperty('vec3', 'vHairWorldPos').assign(worldPos)
    varyingProperty('float', 'vHairT').assign(tParam)
    varyingProperty('float', 'vHairSide').assign(side)
    varyingProperty('float', 'vHairCoverage').assign(coverageScale)
    varyingProperty('float', 'vHairSeed').assign(seed)

    return finalClip
  })()

  // --- Fragment stage ------------------------------------------------------
  const tParamF = varyingProperty('float', 'vHairT') as any
  const sideF = varyingProperty('float', 'vHairSide') as any
  const tangentWorld = varyingProperty('vec3', 'vHairTangent') as any
  const worldPos = varyingProperty('vec3', 'vHairWorldPos') as any
  const coverage = varyingProperty('float', 'vHairCoverage') as any
  const seedF = varyingProperty('float', 'vHairSeed') as any

  // Melanin variation per strand: seed in [0,1] → offset in [-1, 1].
  const melaninJitter = seedF.mul(2.0).sub(1.0).mul(u.melaninRandomize)
  const melaninAdjusted = saturate(u.melanin.add(melaninJitter))

  // Absorption coefficients per Chiang 2016.
  const eumelaninAbs = vec3(EUMELANIN.x, EUMELANIN.y, EUMELANIN.z)
  const pheomelaninAbs = vec3(PHEOMELANIN.x, PHEOMELANIN.y, PHEOMELANIN.z)
  const sigmaA = eumelaninAbs.mul(melaninAdjusted.mul(float(1.0).sub(u.melaninRedness)))
    .add(pheomelaninAbs.mul(melaninAdjusted.mul(u.melaninRedness)))
  // Sigma scaled by 5.0 to bring the dynamic range into [black, light blonde]
  // territory for melanin in [0,1].
  const baseAbsorption = vec3(exp(sigmaA.x.mul(-5.0)), exp(sigmaA.y.mul(-5.0)), exp(sigmaA.z.mul(-5.0)))

  // Root darkening: smooth ramp at the bottom of the strand using
  // rootDarkenLength as the falloff distance.
  const rootRamp = saturate(tParamF.div(max(u.rootDarkenLength, float(1e-3))))
  const rootDarkFactor = mix(
    float(1.0).sub(u.rootDarken).mul(0.5).add(0.5), // darkest at root
    float(1.0),
    rootRamp,
  )

  // Final base color = absorption * tint * rootDarken.
  const baseColor = vec3(baseAbsorption).mul(vec3(u.tintColor)).mul(rootDarkFactor)

  const viewDir = normalize(vec3(cameraPosition).sub(worldPos))

  // Analytic ribbon-edge falloff and tip fade.
  const edge = sideF.abs()
  const edgeAA = saturate(float(1.0).sub(edge).mul(4.0))
  const tipFade = saturate(float(1.0).sub(tParamF.mul(tParamF).mul(0.3)))
  // Per-strand opacity jitter for flyaways — some strands are fainter.
  const flyawayAlpha = float(1.0).sub(u.flyaway.mul(seedF).mul(0.4))
  const alpha = u.opacity.mul(edgeAA).mul(tipFade).mul(coverage).mul(flyawayAlpha)

  // --- Material assembly ---------------------------------------------------
  const mat = new THREE.NodeMaterial() as HairMaterial
  mat.name = 'HairStrandMaterial'
  mat.vertexNode = vertexNode
  mat.colorNode = baseColor
  mat.opacityNode = alpha

  mat.transparent = false
  mat.alphaTest = 0.5
  mat.depthWrite = true
  mat.depthTest = true
  mat.side = THREE.DoubleSide
  mat.lights = true

  const lightingModel = new HairLightingModel({
    tangentWorld,
    viewDir,
    baseColor,
    primaryTint:      u.primaryTint,
    secondaryTint:    u.secondaryTint,
    transmissionTint: u.transmissionTint,
    scatter:          u.scatter,
    specStrength:     u.specStrength,
    roughness:        u.roughness,
    roughnessAz:      u.roughnessAz,
    primaryShift:     u.primaryShift,
    secondaryShift:   u.secondaryShift,
  })
  ;(mat as any).setupLightingModel = () => lightingModel

  mat._groomUniforms = uniforms
  return mat
}

export function updateHairStrandMaterialUniforms(
  mat: HairMaterial,
  settings: HairMaterialSettings,
) {
  const u = mat._groomUniforms
  if (!u) return
  u.widthRoot.value        = settings.strandWidthRoot
  u.widthTip.value         = settings.strandWidthTip
  u.opacity.value          = settings.opacity
  u.melanin.value          = settings.melanin
  u.melaninRedness.value   = settings.melaninRedness
  u.melaninRandomize.value = settings.melaninRandomize
  ;(u.tintColor.value as THREE.Color).set(settings.tintColor)
  u.rootDarken.value       = settings.rootDarken
  u.rootDarkenLength.value = settings.rootDarkenLength
  u.specStrength.value     = settings.specularStrength
  u.primaryShift.value     = settings.primaryShift
  ;(u.primaryTint.value as THREE.Color).set(settings.primaryHighlightTint)
  u.secondaryShift.value   = settings.secondaryShift
  ;(u.secondaryTint.value as THREE.Color).set(settings.secondaryHighlightTint)
  u.roughness.value        = settings.roughness
  u.roughnessAz.value      = settings.roughnessAzimuthal
  u.scatter.value          = settings.scatter
  ;(u.transmissionTint.value as THREE.Color).set(settings.transmissionTint)
  u.flyaway.value          = settings.flyaway
}
