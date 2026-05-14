import * as THREE from 'three'

// -----------------------------------------------------------------------------
// UV-space scalp mask texture.
//
// We rasterize every painted triangle's *UV-space* footprint into a Float32
// canvas, then run a separable Gaussian blur on it.  The skin shader samples
// this texture by uv() and uses the result as the follicle tint strength.
//
// This is how XGen / MetaHuman do it: the mask lives in texture space and is
// soft-blurred so the follicle band fades over a few millimeters of skin.
// Vertex-paint via face-index can never produce that gradient — only one-tri-
// wide transitions at the boundary.
// -----------------------------------------------------------------------------

const MASK_RES = 512
const BLUR_RADIUS_PX = 6 // ~12px Gaussian kernel, sigma ≈ 2.5

export type ScalpMaskTexture = {
  texture: THREE.DataTexture
  rebuild: (geometry: THREE.BufferGeometry, triangleIndices: ReadonlyArray<number>) => void
  dispose: () => void
}

export function createScalpMaskTexture(): ScalpMaskTexture {
  const data = new Float32Array(MASK_RES * MASK_RES)
  const tex = new THREE.DataTexture(
    data,
    MASK_RES,
    MASK_RES,
    THREE.RedFormat,
    THREE.FloatType,
  )
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true

  // Scratch buffers reused by rebuild().  Two so we can ping-pong the blur.
  const buf0 = new Float32Array(MASK_RES * MASK_RES)
  const buf1 = new Float32Array(MASK_RES * MASK_RES)

  function rebuild(geometry: THREE.BufferGeometry, triangleIndices: ReadonlyArray<number>) {
    buf0.fill(0)

    const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
    if (!uvAttr) {
      data.fill(0)
      tex.needsUpdate = true
      return
    }
    const index = geometry.index

    for (const tri of triangleIndices) {
      const i0 = index ? index.getX(tri * 3)     : tri * 3
      const i1 = index ? index.getX(tri * 3 + 1) : tri * 3 + 1
      const i2 = index ? index.getX(tri * 3 + 2) : tri * 3 + 2

      const ax = uvAttr.getX(i0), ay = uvAttr.getY(i0)
      const bx = uvAttr.getX(i1), by = uvAttr.getY(i1)
      const cx = uvAttr.getX(i2), cy = uvAttr.getY(i2)

      rasterizeTriangle(buf0, ax, ay, bx, by, cx, cy)
    }

    // Separable Gaussian blur: horizontal pass into buf1, vertical pass back
    // into buf0.  Sigma chosen so the mask fades over a few mm of UV space
    // (depends on UV layout — works well for typical head topologies).
    gaussianBlurH(buf0, buf1, MASK_RES, MASK_RES, BLUR_RADIUS_PX)
    gaussianBlurV(buf1, buf0, MASK_RES, MASK_RES, BLUR_RADIUS_PX)

    // Copy into the texture's backing array.
    data.set(buf0)
    tex.needsUpdate = true
  }

  return {
    texture: tex,
    rebuild,
    dispose: () => tex.dispose(),
  }
}

// -----------------------------------------------------------------------------
// Triangle rasterization with conservative 1-pixel dilation: we paint any
// pixel whose centre lies inside the triangle, plus a 1-pixel border around
// the silhouette so UV seams don't produce holes in the mask.
// -----------------------------------------------------------------------------
function rasterizeTriangle(
  buf: Float32Array,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
) {
  const minU = Math.max(0, Math.min(ax, bx, cx))
  const maxU = Math.min(1, Math.max(ax, bx, cx))
  const minV = Math.max(0, Math.min(ay, by, cy))
  const maxV = Math.min(1, Math.max(ay, by, cy))
  if (maxU < minU || maxV < minV) return

  const px0 = Math.max(0, Math.floor(minU * MASK_RES) - 1)
  const px1 = Math.min(MASK_RES - 1, Math.ceil(maxU * MASK_RES) + 1)
  const py0 = Math.max(0, Math.floor(minV * MASK_RES) - 1)
  const py1 = Math.min(MASK_RES - 1, Math.ceil(maxV * MASK_RES) + 1)

  // Edge function precomputation.
  const v0x = bx - ax, v0y = by - ay
  const v1x = cx - ax, v1y = cy - ay
  const denom = v0x * v1y - v1x * v0y
  if (Math.abs(denom) < 1e-12) return
  const invDenom = 1 / denom

  for (let py = py0; py <= py1; py += 1) {
    const v = (py + 0.5) / MASK_RES
    const row = py * MASK_RES
    for (let px = px0; px <= px1; px += 1) {
      const u = (px + 0.5) / MASK_RES
      const pxRel = u - ax, pyRel = v - ay
      const s = (pxRel * v1y - v1x * pyRel) * invDenom
      const t = (v0x * pyRel - pxRel * v0y) * invDenom
      if (s >= -0.0015 && t >= -0.0015 && s + t <= 1.003) {
        buf[row + px] = 1
      }
    }
  }
}

// 1D Gaussian weights cache.
const blurKernelCache = new Map<number, Float32Array>()
function gaussianKernel(radius: number): Float32Array {
  const cached = blurKernelCache.get(radius)
  if (cached) return cached
  const sigma = Math.max(radius / 2.5, 0.5)
  const k = new Float32Array(radius * 2 + 1)
  let sum = 0
  for (let i = -radius; i <= radius; i += 1) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma))
    k[i + radius] = w
    sum += w
  }
  for (let i = 0; i < k.length; i += 1) k[i] /= sum
  blurKernelCache.set(radius, k)
  return k
}

function gaussianBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, radius: number) {
  const k = gaussianKernel(radius)
  for (let y = 0; y < h; y += 1) {
    const row = y * w
    for (let x = 0; x < w; x += 1) {
      let acc = 0
      for (let i = -radius; i <= radius; i += 1) {
        const sx = Math.min(w - 1, Math.max(0, x + i))
        acc += src[row + sx] * k[i + radius]
      }
      dst[row + x] = acc
    }
  }
}

function gaussianBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, radius: number) {
  const k = gaussianKernel(radius)
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      let acc = 0
      for (let i = -radius; i <= radius; i += 1) {
        const sy = Math.min(h - 1, Math.max(0, y + i))
        acc += src[sy * w + x] * k[i + radius]
      }
      dst[y * w + x] = acc
    }
  }
}
