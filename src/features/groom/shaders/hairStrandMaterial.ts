import * as THREE from 'three/webgpu'
import {
  BRDF_Lambert,
  Fn,
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  float,
  max,
  min,
  mix,
  modelViewMatrix,
  modelWorldMatrix,
  normalize,
  positionGeometry,
  pow,
  saturate,
  uniform,
  varyingProperty,
  vec2,
  vec3,
  vec4,
  viewport,
} from 'three/tsl'
import { LightingModel } from 'three/webgpu'
import type { HairMaterialSettings } from '../core/types'

// -----------------------------------------------------------------------------
// Strand hair material — Karis-style approximation of Marschner (R + TRT + diffuse)
//
// Geometry expected (per-vertex):
//   position (vec3) – centre-line point, local space
//   tangent  (vec3) – local-space strand tangent (unit, forward)
//   uv       (vec2) – (side, t)  side ∈ {-1, +1}, t ∈ [0, 1] root→tip
//
// Ribbons expand in NDC perpendicular to the projected tangent and scale back
// to clip space by w — same technique used by Three's Line2NodeMaterial.
// World-space width is clamped to ≥0.5 px on the GPU and alpha is scaled by
// the shrink ratio so sub-pixel hair fades smoothly instead of aliasing.
//
// Compositing uses alpha-test + depth-write rather than blended transparency,
// so hair correctly occludes the scalp/scalp-mask underneath it (this is the
// same path UE5 uses for its strand-hair "coverage from alpha" mode).
//
// Shading is a tangent-space dual-specular hair BSDF (Karis 2016, "Physically
// Based Hair Shading in Unreal"): primary R lobe + tinted TRT lobe shifted by
// cuticle tilt, plus a wrapped diffuse term that fakes multiple-scattering
// brightening on the shadow side.  Evaluated per-light via a custom
// LightingModel so it reacts to every scene light.
// -----------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

// One hair specular lobe.
function hairSpecular(T: any, V: any, L: any, shift: any, exponent: any): any {
  const VdotT = V.dot(T)
  const Nproj = normalize(V.sub(T.mul(VdotT)))
  const Tshift = normalize(T.add(Nproj.mul(shift)))

  const LdotT = L.dot(Tshift)
  const VdotTs = V.dot(Tshift)

  const sinTL = max(float(0.0), float(1.0).sub(LdotT.mul(LdotT))).sqrt()
  const sinTV = max(float(0.0), float(1.0).sub(VdotTs.mul(VdotTs))).sqrt()

  const cosTLV = LdotT.mul(VdotTs).add(sinTL.mul(sinTV))
  return pow(saturate(cosTLV), exponent)
}

class HairLightingModel extends LightingModel {
  declare ctx: {
    tangentWorld: any
    viewDir: any
    baseColor: any
    tipTint: any
    specStrength: any
    roughness: any
  }

  constructor(ctx: HairLightingModel['ctx']) {
    super()
    this.ctx = ctx
  }

  direct(lightData: any) {
    const { lightDirection, lightColor, reflectedLight } = lightData
    const { tangentWorld, viewDir, baseColor, tipTint, specStrength, roughness } = this.ctx

    const T = normalize(tangentWorld)
    const V = normalize(viewDir)
    const L = normalize(lightDirection)

    // Reconstructed hair normal: component of V perpendicular to T.
    const VdotT = V.dot(T)
    const Nrec = normalize(V.sub(T.mul(VdotT)))
    const NdotL = Nrec.dot(L)

    // Wrap diffuse — fakes multi-scatter brightening on the shadow side.
    const wrap = saturate(NdotL.mul(0.5).add(0.5))
    const diffuse = mix(float(0.25), float(1.0), wrap)

    const expR = mix(float(80.0), float(8.0), roughness)
    const expTRT = expR.mul(0.5)

    const alpha = float(0.06) // cuticle tilt, ~3.4°

    const R = hairSpecular(T, V, L, alpha.negate(), expR).mul(specStrength)
    const TRT = hairSpecular(T, V, L, alpha.mul(0.5), expTRT).mul(specStrength).mul(0.5)

    const specular = vec3(R).add(vec3(tipTint).mul(TRT))

    const litDiffuse: any = vec3(baseColor).mul(diffuse)
    const lambert: any = BRDF_Lambert({ diffuseColor: litDiffuse })
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
  widthRoot:    ReturnType<typeof uniform>
  widthTip:     ReturnType<typeof uniform>
  opacity:      ReturnType<typeof uniform>
  rootColor:    ReturnType<typeof uniform>
  tipColor:     ReturnType<typeof uniform>
  roughness:    ReturnType<typeof uniform>
  specStrength: ReturnType<typeof uniform>
}

export function createHairStrandMaterial(settings: HairMaterialSettings): HairMaterial {
  const uniforms: GroomUniforms = {
    widthRoot:    uniform(settings.strandWidthRoot),
    widthTip:     uniform(settings.strandWidthTip),
    opacity:      uniform(settings.opacity),
    rootColor:    uniform(new THREE.Color(settings.rootColor)),
    tipColor:     uniform(new THREE.Color(settings.tipColor)),
    roughness:    uniform(settings.roughness),
    specStrength: uniform(settings.specularStrength),
  }

  const uWidthRoot    = uniforms.widthRoot    as any
  const uWidthTip     = uniforms.widthTip     as any
  const uOpacity      = uniforms.opacity      as any
  const uRootColor    = uniforms.rootColor    as any
  const uTipColor     = uniforms.tipColor     as any
  const uRoughness    = uniforms.roughness    as any
  const uSpecStrength = uniforms.specStrength as any

  // --- Vertex stage --------------------------------------------------------
  // Wrap in Fn() so TSL emits a self-contained function — this also avoids
  // the WGSL "cannot index type 'f32'" issue caused by uniform packing when
  // small float uniforms are referenced from a top-level vertexNode.
  const vertexNode = Fn(() => {
    const sideT = attribute('uv', 'vec2') as any
    const side = float(sideT.x).toVar()
    const tParam = float(sideT.y).toVar()

    const tangentLocal = attribute('tangent', 'vec3') as any

    const centerView = modelViewMatrix.mul(vec4(positionGeometry, 1.0))
    const aheadView = modelViewMatrix.mul(vec4(positionGeometry.add(tangentLocal), 1.0))
    const centerClip = vec4(cameraProjectionMatrix.mul(centerView)).toVar() as any
    const aheadClip = vec4(cameraProjectionMatrix.mul(aheadView)).toVar() as any

    // Aspect-corrected NDC direction along the strand.
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

    // World-space half-width at this vertex.
    const halfWidth = mix(uWidthRoot, uWidthTip, tParam).mul(0.5)

    // Convert world width to on-screen pixels via projection's vertical scale.
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

    // Varyings → fragment
    const worldPos = modelWorldMatrix.mul(vec4(positionGeometry, 1.0)).xyz
    const tangentWorld = normalize(modelWorldMatrix.mul(vec4(tangentLocal, 0.0)).xyz)

    varyingProperty('vec3', 'vHairTangent').assign(tangentWorld)
    varyingProperty('vec3', 'vHairWorldPos').assign(worldPos)
    varyingProperty('float', 'vHairT').assign(tParam)
    varyingProperty('float', 'vHairSide').assign(side)
    varyingProperty('float', 'vHairCoverage').assign(coverageScale)

    return finalClip
  })()

  // --- Fragment stage ------------------------------------------------------
  const tParamF = varyingProperty('float', 'vHairT') as any
  const sideF = varyingProperty('float', 'vHairSide') as any
  const tangentWorld = varyingProperty('vec3', 'vHairTangent') as any
  const worldPos = varyingProperty('vec3', 'vHairWorldPos') as any
  const coverage = varyingProperty('float', 'vHairCoverage') as any

  const baseColor = mix(uRootColor, uTipColor, tParamF)
  const viewDir = normalize(vec3(cameraPosition).sub(worldPos))

  // Analytic ribbon-edge falloff: smoother towards the silhouette.
  const edge = sideF.abs()
  const edgeAA = saturate(float(1.0).sub(edge).mul(4.0))
  const tipFade = saturate(float(1.0).sub(tParamF.mul(tParamF).mul(0.4)))
  const alpha = uOpacity.mul(edgeAA).mul(tipFade).mul(coverage)

  // --- Material assembly ---------------------------------------------------
  const mat = new THREE.NodeMaterial() as HairMaterial
  mat.name = 'HairStrandMaterial'
  mat.vertexNode = vertexNode
  mat.colorNode = baseColor
  mat.opacityNode = alpha

  // Alpha-test + depth-write so hair correctly occludes the scalp.  Anything
  // below the threshold is discarded; anything above writes depth and is
  // composited opaquely.  This is UE's "Coverage From Alpha" hair compositing.
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
    tipTint: uTipColor,
    specStrength: uSpecStrength,
    roughness: uRoughness,
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
  u.widthRoot.value    = settings.strandWidthRoot
  u.widthTip.value     = settings.strandWidthTip
  u.opacity.value      = settings.opacity
  u.roughness.value    = settings.roughness
  u.specStrength.value = settings.specularStrength
  ;(u.rootColor.value as THREE.Color).set(settings.rootColor)
  ;(u.tipColor.value as THREE.Color).set(settings.tipColor)
}
