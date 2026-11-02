// Fabric presets for the runtime cloth system.
//
// Compliances are XPBD compliances (m/N) and therefore independent of the
// substep count: changing simulation quality changes accuracy, not stiffness.
// Bending is a cross-edge distance constraint, whose restoring force grows with
// the square of the fold angle, so stiff fabrics need low bend compliance to
// hold large soft folds (denim, wool) while silk is left almost free.

export type FabricId = 'silk' | 'jersey' | 'cotton' | 'denim' | 'wool' | 'leather'

export type FabricPreset = {
  id: FabricId
  name: string
  stretchCompliance: number
  shearCompliance: number
  bendCompliance: number
  /** Velocity damping per second (0..1). */
  damping: number
  /** Multiplies the skin friction. */
  friction: number
  /** Areal density relative to 150 g/m² cotton. */
  density: number
  /** Half thickness (m): how far the cloth mid-surface rests above what it covers. */
  thickness: number
  color: string
  roughness: number
}

export const FABRICS: Record<FabricId, FabricPreset> = {
  silk: { id: 'silk', name: 'Silk charmeuse', stretchCompliance: 1.2e-5, shearCompliance: 2e-5, bendCompliance: 6e-3, damping: 0.03, friction: 0.3, density: 0.45, thickness: 0.002, color: '#b8466f', roughness: 0.38 },
  jersey: { id: 'jersey', name: 'Cotton jersey', stretchCompliance: 1.2e-4, shearCompliance: 1.6e-4, bendCompliance: 1.2e-3, damping: 0.05, friction: 0.6, density: 1.15, thickness: 0.003, color: '#d9d4c7', roughness: 0.92 },
  cotton: { id: 'cotton', name: 'Cotton poplin', stretchCompliance: 2.5e-5, shearCompliance: 4e-5, bendCompliance: 6e-4, damping: 0.05, friction: 0.6, density: 0.9, thickness: 0.003, color: '#5b86c9', roughness: 0.85 },
  denim: { id: 'denim', name: 'Denim 12oz', stretchCompliance: 5e-6, shearCompliance: 1e-5, bendCompliance: 1e-4, damping: 0.08, friction: 0.75, density: 2.4, thickness: 0.005, color: '#34507a', roughness: 0.95 },
  wool: { id: 'wool', name: 'Wool melton', stretchCompliance: 1e-5, shearCompliance: 2e-5, bendCompliance: 1.6e-4, damping: 0.08, friction: 0.8, density: 2.6, thickness: 0.007, color: '#6d5b4b', roughness: 0.97 },
  leather: { id: 'leather', name: 'Lambskin leather', stretchCompliance: 3e-6, shearCompliance: 6e-6, bendCompliance: 4e-5, damping: 0.1, friction: 0.5, density: 3.4, thickness: 0.006, color: '#3b2b24', roughness: 0.55 },
}

export const FABRIC_IDS = Object.keys(FABRICS) as FabricId[]
