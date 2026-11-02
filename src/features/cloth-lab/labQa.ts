import type { ClothLabController } from './labController'
import type { OutfitItem } from '../clothing/runtime/garmentLibrary'

// Deterministic stability checks for the cloth lab. Each scenario dresses the
// current character, then steps the fixed-step loop (animation → skin → cloth)
// without rendering, sampling garment health along the way. Results compare
// across characters, clips and garments because the stepping is identical.

export type MatrixRow = {
  character: string
  outfit: string
  clip: string
  /** Garment still worn at every sample (enough of it stays near the skin). */
  stayedOn: boolean
  /** Lowest sampled fraction of particles within 6 cm of the skin. */
  minNearSkin: number
  /** Fraction within 6 cm of the skin at the end of the scenario. */
  finalNearSkin: number
  maxStretch: number
  /** Worst sampled fraction of render vertices inside the skin (%). */
  renderPenetration: number
  /** Mean cloth solver cost per fixed step while animating (ms). */
  clothMs: number
}

export type MatrixOptions = {
  clips: string[]
  outfits?: Array<{ name: string; items: OutfitItem[] }>
  /** Animated seconds per scenario (after dressing). */
  seconds?: number
  onRow?: (row: MatrixRow) => void
}

export async function runStabilityMatrix(controller: ClothLabController, options: MatrixOptions): Promise<MatrixRow[]> {
  const rows: MatrixRow[] = []
  const seconds = options.seconds ?? 8
  const outfits = options.outfits ?? [{ name: describeOutfit(controller.outfit), items: controller.outfit }]
  const wasPaused = controller.paused
  for (const outfit of outfits) {
    for (const clip of options.clips) {
      controller.setClip(clip)
      controller.setOutfit(outfit.items)
      controller.setPaused(true)
      const row = await sampleScenario(controller, clip, outfit.name, seconds)
      rows.push(row)
      options.onRow?.(row)
    }
  }
  controller.setPaused(wasPaused)
  return rows
}

async function sampleScenario(controller: ClothLabController, clip: string, outfit: string, seconds: number): Promise<MatrixRow> {
  let minNear = Infinity
  let finalNear = 0
  let maxStretch = 0
  let renderPenetration = 0
  let clothMs = 0
  let animatedSteps = 0
  const totalSteps = Math.round((controller.cloth.assemblyDuration + 0.1 + seconds) * 60)
  for (let step = 1; step <= totalSteps; step += 1) {
    // Yield regularly so the page stays responsive (and is not flagged as hung).
    if (step % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    controller.stepOnce()
    const snapshot = controller.snapshot()
    if (snapshot.phase !== 'animating') continue
    animatedSteps += 1
    const profile = controller.cloth.solverProfile
    clothMs += profile.constraints + profile.selfCollision + profile.bodyCollision
    if (step % 30 !== 0 && step !== totalSteps) continue
    const near = controller.cloth.nearSkinFraction(0.06)
    minNear = Math.min(minNear, near)
    finalNear = near
    maxStretch = Math.max(maxStretch, snapshot.stats.maxStretch)
    renderPenetration = Math.max(renderPenetration, snapshot.stats.renderPenetration)
  }
  return {
    character: controller.snapshot().characterName,
    outfit,
    clip,
    stayedOn: minNear > 0.25 && finalNear > 0.45,
    minNearSkin: round(Number.isFinite(minNear) ? minNear : 0, 2),
    finalNearSkin: round(finalNear, 2),
    maxStretch: round(maxStretch, 2),
    renderPenetration: round(renderPenetration * 100, 2),
    clothMs: round(clothMs / Math.max(1, animatedSteps), 2),
  }
}

export function describeOutfit(items: OutfitItem[]) {
  return items.map((item) => `${item.kind}${item.fabric ? `:${item.fabric}` : ''}`).join('+')
}

function round(value: number, digits: number) {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}
