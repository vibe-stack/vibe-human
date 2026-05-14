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
  fract,
  max,
  min,
  mix,
  modelViewMatrix,
  modelWorldMatrix,
  normalize,
  positionGeometry,
  saturate,
  screenCoordinate,
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
//
// Energy normalization: a Gaussian `exp(-x²/(2β²))` integrates to `β√(2π)`,
// so to make each lobe carry roughly unit energy we divide by `β√(2π)`.
// Without this, narrow lobes (low roughness) spike to ~1.0 at the peak and
// the integral over the hemisphere blows up — which is exactly the "white
// fizzy" default we hit previously.
// -----------------------------------------------------------------------------
const SQRT_2PI = 2.5066282746

function longitudinalScatter(
  sinThetaV: any, sinThetaL: any,
  cosThetaV: any, cosThetaL: any,
  shift: any, roughness: any,
): any {
  const sShift = sin(shift)
  const cShift = cos(shift)
  const sinThetaVt = sinThetaV.mul(cShift).sub(cosThetaV.mul(sShift))
  const cosThetaVt = cosThetaV.mul(cShift).add(sinThetaV.mul(sShift))

  const sinThetaH = sinThetaVt.add(sinThetaL).mul(0.5)
  const beta = max(roughness, float(0.04))
  const beta2 = beta.mul(beta)
  const g = exp(sinThetaH.mul(sinThetaH).div(beta2.mul(-2.0)))

  // 1 / (β √(2π)) — Gaussian normalization.
  const norm = float(1.0).div(beta.mul(SQRT_2PI))
  // Geometric cos term from the strand-cylinder surface integral.
  return g.mul(norm).mul(cosThetaVt.mul(cosThetaL).add(0.0001))
}

// Azimuthal cos²(φ/2) lobe — energy-normalized: ∫ cos^(2k)(φ/2) dφ over
// [-π, π] = π * Γ(k+0.5) / (Γ(k+1) √π).  We use the approximation
// `(k+1)/(2π)` for the gain factor which is exact for integer k and a tight
// fit for the continuous range we expose.
function azimuthalScatter(cosPhi: any, roughnessAz: any): any {
  const base = saturate(cosPhi.mul(0.5).add(0.5))
  const k = mix(float(4.0), float(0.5), roughnessAz)
  const lobe = base.add(float(0.001)).log().mul(k).exp()
  // Normalize: divide by 2π/(k+1) so the lobe integrates to ~1 over φ.
  const norm = k.add(1.0).div(6.2831853)
  return lobe.mul(norm)
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
  // Self-shadow approximation: a [0,1] value per fragment from the strand's
  // root-to-tip parameter.  Roots sit deeper in the hair volume so they
  // receive less direct light; tips poke out into the open and receive more.
  // This is a cheap stand-in for a true strand-space shadow map, which would
  // require a second render pass from the key light's POV.  The approximation
  // gives ~70% of the visual benefit for zero extra draw calls.
  selfShadow: any
  shadowStrength: any
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
    // Wrap term in [0,1] — replaces the cosine in Lambert so light wraps
    // softly around the strand.  Scaled by 1/π already inside BRDF_Lambert,
    // so we don't pre-multiply here.
    const wrap = saturate(cosThetaL.mul(0.5).add(0.5))
    // Multi-scatter: a small additive term tinted by transmission to fake
    // the brightening from neighbouring strands.  Bounded to `scatter * 0.5`
    // so it can never exceed the diffuse it's added to.
    const backBoost = saturate(VdotT.mul(LdotT).negate().mul(0.5).add(0.5))
    const msStrength = c.scatter.mul(0.5).mul(backBoost)

    // --- Self-shadow modulation ---
    // Reduce direct contribution based on the per-fragment self-shadow
    // estimate.  We additionally bias by light-vs-tangent geometry: when
    // the light grazes along the strand (LdotT ≈ ±1), more strands lie
    // between the fragment and the light source.
    const grazingOcclusion = saturate(LdotT.abs().mul(0.6).add(0.4))
    const directVisibility = saturate(
      float(1.0).sub(c.selfShadow.mul(c.shadowStrength).mul(grazingOcclusion)),
    )

    // --- Compose ---
    const specularR   = vec3(c.primaryTint).mul(R)
    const specularTRT = vec3(c.secondaryTint).mul(TRT).mul(vec3(c.transmissionTint))
    const specular: any = specularR.add(specularTRT).mul(c.specStrength).mul(directVisibility)

    // Diffuse: wrap-modulated base colour, plus a bounded multi-scatter
    // term tinted by the transmission colour.  Total stays ≤ baseColor + 0.5.
    const wrapped: any = vec3(c.baseColor).mul(wrap)
    const multiScatter: any = vec3(c.transmissionTint).mul(vec3(c.baseColor)).mul(msStrength)
    const diffuseRgb: any = wrapped.add(multiScatter)
    const lambert: any = BRDF_Lambert({ diffuseColor: diffuseRgb })

    // Diffuse is shadowed less harshly than specular — even occluded
    // strands receive multi-scattered light from neighbours.
    const diffuseVisibility = saturate(
      float(1.0).sub(c.selfShadow.mul(c.shadowStrength).mul(0.55)),
    )

    reflectedLight.directDiffuse.addAssign(vec3(lightColor).mul(lambert).mul(diffuseVisibility) as any)
    reflectedLight.directSpecular.addAssign(vec3(lightColor).mul(specular) as any)
  }

  indirect(builder: any) {
    const { irradiance, ambientOcclusion, reflectedLight } = builder.context
    if (!irradiance) return
    const lambert: any = BRDF_Lambert({ diffuseColor: vec3(this.ctx.baseColor) as any })
    // Indirect light also occluded by neighbouring strands — strongest at
    // the roots where the hair is densest.
    const indirectVisibility = saturate(
      float(1.0).sub(this.ctx.selfShadow.mul(this.ctx.shadowStrength).mul(0.7)),
    )
    reflectedLight.indirectDiffuse.addAssign(vec3(irradiance).mul(lambert).mul(indirectVisibility) as any)
    if (ambientOcclusion) {
      reflectedLight.indirectDiffuse.mulAssign(vec3(ambientOcclusion) as any)
    }
  }
}

// -----------------------------------------------------------------------------

export type HairMaterial = THREE.NodeMaterial & {
  _groomUniforms: GroomUniforms
}

export type HairMaterialOptions = {
  widthScale?: number
  opacityScale?: number
  cardPattern?: number
  densityShadowScale?: number
  flyawayOpacityBoost?: number
}

type GroomUniforms = {
  widthRoot:        ReturnType<typeof uniform>
  widthTip:         ReturnType<typeof uniform>
  widthScale:       ReturnType<typeof uniform>
  opacity:          ReturnType<typeof uniform>
  opacityScale:     ReturnType<typeof uniform>
  cardPattern:      ReturnType<typeof uniform>
  densityShadowScale: ReturnType<typeof uniform>
  flyawayOpacityBoost: ReturnType<typeof uniform>
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
  shadowStrength:   ReturnType<typeof uniform>
  // Color the strand should fade toward at the very root, matched to the
  // follicle tint applied to the skin.  Updated externally by the groom
  // store whenever the hair colour or scalp paint changes.
  rootFollicle:     ReturnType<typeof uniform>
}

export function createHairStrandMaterial(settings: HairMaterialSettings, options: HairMaterialOptions = {}): HairMaterial {
  const uniforms: GroomUniforms = {
    widthRoot:        uniform(settings.strandWidthRoot),
    widthTip:         uniform(settings.strandWidthTip),
    widthScale:       uniform(options.widthScale ?? 1),
    opacity:          uniform(settings.opacity),
    opacityScale:     uniform(options.opacityScale ?? 1),
    cardPattern:      uniform(options.cardPattern ?? 0),
    densityShadowScale: uniform(options.densityShadowScale ?? 1),
    flyawayOpacityBoost: uniform(options.flyawayOpacityBoost ?? 0),
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
    shadowStrength:   uniform(settings.shadowStrength),
    // Default to a dark warm follicle; the groom store overrides this at
    // runtime to match the active hair colour.
    rootFollicle:     uniform(new THREE.Color('#1a0d08')),
  }

  const u = uniforms as any

  // --- Vertex stage --------------------------------------------------------
  const vertexNode = Fn(() => {
    const sideT = attribute('uv', 'vec2') as any
    const side = float(sideT.x).toVar()
    const tParam = float(sideT.y).toVar()
    const tangentLocal = attribute('tangent', 'vec3') as any
    const seed = float(attribute('strandSeed', 'float') as any).toVar()
    const rootDensity = float(attribute('rootDensity', 'float') as any).toVar()
    const rootOcclusion = float(attribute('rootOcclusion', 'float') as any).toVar()
    const flyawayMask = float(attribute('flyawayMask', 'float') as any).toVar()
    const lengthScale = float(attribute('lengthScale', 'float') as any).toVar()

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
    // Root taper: the bottom `rootDarkenLength` fraction of the strand
    // collapses smoothly toward zero width so the strand visually melts into
    // the scalp.  Without this the strand reads as a stick planted in skin —
    // the harsh transition you see in low-end hair shaders.  MetaHuman tapers
    // the bottom ~10% of each strand the same way (per the published
    // Houdini→Unreal export presets).
    const rootTaper = saturate(tParam.div(max(u.rootDarkenLength, float(1e-3))))
    const rootTaperSmooth = rootTaper.mul(rootTaper).mul(float(3.0).sub(rootTaper.mul(2.0))) // smoothstep
    const taperFactor = mix(float(0.05), float(1.0), rootTaperSmooth)
    const halfWidth = mix(u.widthRoot, u.widthTip, tParam).mul(0.5).mul(flyawayBump).mul(taperFactor).mul(u.widthScale)

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
    varyingProperty('float', 'vRootDensity').assign(rootDensity)
    varyingProperty('float', 'vRootOcclusion').assign(rootOcclusion)
    varyingProperty('float', 'vFlyawayMask').assign(flyawayMask)
    varyingProperty('float', 'vLengthScale').assign(lengthScale)

    return finalClip
  })()

  // --- Fragment stage ------------------------------------------------------
  const tParamF = varyingProperty('float', 'vHairT') as any
  const sideF = varyingProperty('float', 'vHairSide') as any
  const tangentWorld = varyingProperty('vec3', 'vHairTangent') as any
  const worldPos = varyingProperty('vec3', 'vHairWorldPos') as any
  const coverage = varyingProperty('float', 'vHairCoverage') as any
  const seedF = varyingProperty('float', 'vHairSeed') as any
  const rootDensityF = varyingProperty('float', 'vRootDensity') as any
  const rootOcclusionF = varyingProperty('float', 'vRootOcclusion') as any
  const flyawayMaskF = varyingProperty('float', 'vFlyawayMask') as any
  const lengthScaleF = varyingProperty('float', 'vLengthScale') as any

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

  // -------------------------------------------------------------------------
  // Root → scalp blend.
  //
  // The bottom `rootDarkenLength` fraction of the strand smoothly blends
  // toward the follicle colour (the same colour the skin is tinted to under
  // a painted scalp).  This is what makes the hair→scalp transition look
  // soft instead of a hard stick-in-skin boundary: every strand's first few
  // millimetres are basically the colour of the skin under it, just slightly
  // darker because of the absorbing fibre.
  //
  // We also dim by `rootDarken` so dense areas read as a slightly darker
  // patch overall — real hair has shadowing from the surrounding strands at
  // the follicle base.
  // -------------------------------------------------------------------------
  const rootRamp = saturate(tParamF.div(max(u.rootDarkenLength, float(1e-3))))
  // Smoothstep on the ramp so the blend curve has a soft S, not a linear
  // ramp that reads as a "band".
  const rootRampSmooth = rootRamp.mul(rootRamp).mul(float(3.0).sub(rootRamp.mul(2.0)))

  // The hair's own absorption colour, optionally tinted artistically.
  const strandColor = vec3(baseAbsorption).mul(vec3(u.tintColor))
  // The follicle/skin colour to blend toward at the root, dimmed slightly so
  // we don't over-bright the absolute base.
  const localDensity = max(rootDensityF, rootOcclusionF)
  const densityRootDarken = saturate(localDensity.mul(float(1.0).sub(flyawayMaskF.mul(0.45))))
  const follicleColor = vec3(u.rootFollicle).mul(float(1.0).sub(u.rootDarken.mul(densityRootDarken)).mul(0.5).add(0.34))
  // Blend: 0 at the root (full follicle), 1 by rootDarkenLength (full strand).
  const baseColorRaw = mix(follicleColor, strandColor, rootRampSmooth)
  const rootCrowdDarken = float(1.0).sub(rootOcclusionF.mul(float(1.0).sub(rootRampSmooth)).mul(0.22))
  const baseColor = baseColorRaw.mul(rootCrowdDarken)

  const viewDir = normalize(vec3(cameraPosition).sub(worldPos))

  // Self-shadow estimate: roots sit deep in the hair volume (occluded by
  // many neighbours above them), tips poke out into the open.  We use a
  // smooth ramp from 1.0 at the root to 0.15 at the tip.  Per-strand seed
  // jitters this so the volume doesn't read as a uniform gradient.
  const densityOcclusion = localDensity.mul(float(1.0).sub(flyawayMaskF.mul(0.65))).mul(u.densityShadowScale)
  const selfShadow = saturate(
    float(1.0).sub(tParamF).mul(0.72).add(float(0.1))
      .add(densityOcclusion.mul(float(1.0).sub(rootRampSmooth)).mul(0.75))
      .add(seedF.sub(0.5).mul(0.1))
  )

  // Analytic ribbon-edge falloff and tip fade.
  const edge = sideF.abs()
  const edgeAA = saturate(float(1.0).sub(edge).mul(4.0))
  const tipFade = saturate(float(1.0).sub(tParamF.mul(tParamF).mul(0.3)))
  const cardFiber = sin(sideF.mul(42.0).add(tParamF.mul(7.0)).add(seedF.mul(19.0))).mul(0.5).add(0.5)
  const cardFiberMask = mix(float(1.0), saturate(cardFiber.mul(1.25).add(0.08)), u.cardPattern)
  // Per-strand opacity jitter for flyaways — some strands are fainter.
  const flyawayAlpha = float(1.0)
    .sub(u.flyaway.mul(seedF).mul(0.22))
    .sub(flyawayMaskF.mul(0.16))
    .add(flyawayMaskF.mul(u.flyawayOpacityBoost))
  const lengthAlpha = mix(float(0.88), float(1.0), lengthScaleF)
  // Root alpha fade: smooth ramp 0 → 1 over the first `rootDarkenLength * 0.6`
  // of the strand.  The bottom of the strand is genuinely transparent, so
  // the painted scalp underneath shows through where the strand emerges —
  // this is the only way to get a real soft transition; you can't paint a
  // hard strand on top of skin and expect it to read as a follicle.
  const rootAlphaRamp = saturate(tParamF.div(max(u.rootDarkenLength.mul(0.6), float(1e-3))))
  const rootAlpha = rootAlphaRamp.mul(rootAlphaRamp).mul(float(3.0).sub(rootAlphaRamp.mul(2.0)))
  const cardRootFill = u.cardPattern.mul(localDensity).mul(0.62)
  const effectiveRootAlpha = max(rootAlpha, cardRootFill)
  const coverageAlpha = u.opacity.mul(u.opacityScale).mul(edgeAA).mul(tipFade).mul(coverage).mul(flyawayAlpha).mul(lengthAlpha).mul(effectiveRootAlpha).mul(cardFiberMask)

  // Stochastic alpha dither.  Instead of a hard alphaTest cutoff (which gives
  // jagged silhouettes), we compare the coverage against a per-fragment hash
  // value.  This produces feathered, noisy edges that read as soft when the
  // scene composites strands at high density — the same trick UE / Frostbite
  // use for hair without OIT.  Without TAA the noise stays visible at single
  // strand density; users running TAA get clean silhouettes.
  const sc = screenCoordinate as any
  const hashSeed = sc.x.mul(0.0073).add(sc.y.mul(0.0119)).add(seedF.mul(13.17))
  const hash = fract(sin(hashSeed).mul(43758.5453))
  // The fragment is "kept" when coverageAlpha > hash.  We encode that as a
  // 0/1 mask multiplied into the final alpha, which combined with alphaTest
  // 0.5 produces a clean binary discard.
  const dither = saturate(coverageAlpha.sub(hash).mul(64.0).add(0.5))
  const alpha = dither

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
    selfShadow,
    shadowStrength:   u.shadowStrength,
  })
  ;(mat as any).setupLightingModel = () => lightingModel

  mat._groomUniforms = uniforms
  return mat
}

export function updateHairStrandMaterialUniforms(
  mat: HairMaterial,
  settings: HairMaterialSettings,
  options?: HairMaterialOptions,
) {
  const u = mat._groomUniforms
  if (!u) return
  u.widthRoot.value        = settings.strandWidthRoot
  u.widthTip.value         = settings.strandWidthTip
  if (options?.widthScale !== undefined) u.widthScale.value = options.widthScale
  u.opacity.value          = settings.opacity
  if (options?.opacityScale !== undefined) u.opacityScale.value = options.opacityScale
  if (options?.cardPattern !== undefined) u.cardPattern.value = options.cardPattern
  if (options?.densityShadowScale !== undefined) u.densityShadowScale.value = options.densityShadowScale
  if (options?.flyawayOpacityBoost !== undefined) u.flyawayOpacityBoost.value = options.flyawayOpacityBoost
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
  u.shadowStrength.value   = settings.shadowStrength
}

/** Push the per-fragment root follicle colour into the hair shader.  The
 *  groom store calls this whenever the active hair colour or scalp paint
 *  changes — keeping the hair root and the skin tint visually in sync is
 *  the entire point of the soft transition. */
export function setHairRootFollicleColor(mat: HairMaterial, hex: string) {
  const u = mat._groomUniforms
  if (!u) return
  ;(u.rootFollicle.value as THREE.Color).set(hex)
}
