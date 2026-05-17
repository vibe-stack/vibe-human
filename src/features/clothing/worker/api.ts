import type { PatternDocument } from '../document/types'
import type { ColliderSnapshot, ClothFrame, SolverParams } from '../simulation/types'
import type { CompilerOptions } from '../compiler/types'

export type CompileGarmentRequest = {
  type: 'compile-garment'
  document: PatternDocument
  options: CompilerOptions
}

export type StepSolverRequest = {
  type: 'step-solver'
  colliderSnapshot: ColliderSnapshot
  params?: Partial<SolverParams>
}

export type WorkerRequest = CompileGarmentRequest | StepSolverRequest

export type CompileGarmentResponse = {
  type: 'compile-garment:result'
  issues: Array<{ code: string; message: string; severity: 'error' | 'warning' }>
}

export type StepSolverResponse = {
  type: 'step-solver:result'
  frame: ClothFrame
}

export type WorkerResponse = CompileGarmentResponse | StepSolverResponse