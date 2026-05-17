import type { PatternDocument, PatternPlacement } from '../document/types'

export type ClothConstraintKind = 'stretch' | 'shear' | 'bend' | 'seam' | 'pin'

export type DistanceConstraint = {
  a: number
  b: number
  rest: number
  targetRest?: number
  compliance: number
  kind: Extract<ClothConstraintKind, 'stretch' | 'shear' | 'seam'>
}

export type BendConstraint = {
  a: number
  b: number
  c: number
  rest: number
  compliance: number
  kind: 'bend'
}

export type PinConstraint = {
  particle: number
  x: number
  y: number
  z: number
  stiffness: number
  kind: 'pin'
}

export type ClothSimMesh = {
  particleCount: number
  positions: Float32Array
  prevPositions: Float32Array
  velocities: Float32Array
  invMass: Float32Array
  panelIds: string[]
  panelUvs: Float32Array
  panelLocalPositions: Float32Array
  triangles: Uint32Array
  stretchConstraints: DistanceConstraint[]
  shearConstraints: DistanceConstraint[]
  bendConstraints: BendConstraint[]
  seamConstraints: DistanceConstraint[]
  pinConstraints: PinConstraint[]
}

export type SphereProxy = {
  kind: 'sphere'
  cx: number
  cy: number
  cz: number
  r: number
  friction: number
  skin: number
}

export type CapsuleProxy = {
  kind: 'capsule'
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  bz: number
  r: number
  friction: number
  skin: number
}

export type EllipsoidProxy = {
  kind: 'ellipsoid'
  cx: number
  cy: number
  cz: number
  rx: number
  ry: number
  rz: number
  qx: number
  qy: number
  qz: number
  qw: number
  friction: number
  skin: number
}

export type ColliderProxy = SphereProxy | CapsuleProxy | EllipsoidProxy

export type ColliderSnapshot = {
  version: number
  proxies: ColliderProxy[]
}

export type SolverParams = {
  gravity: number
  damping: number
  substeps: number
  iterations: number
  dt: number
  groundY: number
  maxVelocity?: number
  sewingTime?: number
  gravityDelayTime?: number
  gravityRampTime?: number
}

export type ClothFrame = {
  positions: Float32Array
}

export type PanelRuntimeInfo = {
  panelId: string
  placement: PatternPlacement
  particleIndices: number[]
  triangleIndices: Uint32Array
}

export type RenderEmbedding = {
  simTriangles: Uint32Array
  barycentrics: Float32Array
}

export type RenderPanelRuntime = {
  panelId: string
  indices: Uint32Array
  panelUvs: Float32Array
  embedding: RenderEmbedding
}

export type GarmentRuntime = {
  document: PatternDocument
  simMesh: ClothSimMesh
  renderPanels: RenderPanelRuntime[]
  panelInfo: Record<string, PanelRuntimeInfo>
}
