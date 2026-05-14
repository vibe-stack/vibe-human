import { proxy } from 'valtio'
import { createNeutralModelingValues, type ModelingMode, type ModelingValues } from './characterModeling'
import { createNeutralEyeLook, createNeutralFacsValues, type EyeLookValues, type FacsValues } from './facs'
import {
  DEFAULT_FLIP_NORMAL_Y,
  DEFAULT_OILINESS,
  DEFAULT_PORE_NORMAL_STRENGTH,
  DEFAULT_PORE_SCALE,
  DEFAULT_SUBSURFACE_STRENGTH,
  DEFAULT_SURFACE_ROUGHNESS,
  DEFAULT_TONE_DEPTH,
  DEFAULT_WRINKLE_NORMAL_STRENGTH,
  type SkinTextures,
} from './skinMaterial'
import type { BoneDebug } from './HumanModel'

type Updater<T> = T | ((previous: T) => T)

type AppState = {
  facsValues: FacsValues
  modelingValues: ModelingValues
  modelingMode: ModelingMode
  modelingSymmetric: boolean
  selectedModelingHandleId: string | null
  eyeLook2D: EyeLookValues
  wireframe: boolean
  showBones: boolean
  eyeLook: boolean
  focusLock: boolean
  isTransforming: boolean
  boneDebug: BoneDebug | null
  fov: number
  skinTextures: SkinTextures
  poreScale: number
  poreNormalStrength: number
  wrinkleNormalStrength: number
  flipNormalY: boolean
  oiliness: number
  surfaceRoughness: number
  toneDepth: number
  subsurfaceStrength: number
  showExpressions: boolean
  showModeling: boolean
  showSkinning: boolean
  showHair: boolean
}

function resolveUpdater<T>(previous: T, next: Updater<T>) {
  return typeof next === 'function' ? (next as (value: T) => T)(previous) : next
}

export const appState = proxy<AppState>({
  facsValues: createNeutralFacsValues(),
  modelingValues: createNeutralModelingValues(),
  modelingMode: 'transform',
  modelingSymmetric: true,
  selectedModelingHandleId: null,
  eyeLook2D: createNeutralEyeLook(),
  wireframe: false,
  showBones: false,
  eyeLook: false,
  focusLock: false,
  isTransforming: false,
  boneDebug: null,
  fov: 16,
  skinTextures: {},
  poreScale: DEFAULT_PORE_SCALE,
  poreNormalStrength: DEFAULT_PORE_NORMAL_STRENGTH,
  wrinkleNormalStrength: DEFAULT_WRINKLE_NORMAL_STRENGTH,
  flipNormalY: DEFAULT_FLIP_NORMAL_Y,
  oiliness: DEFAULT_OILINESS,
  surfaceRoughness: DEFAULT_SURFACE_ROUGHNESS,
  toneDepth: DEFAULT_TONE_DEPTH,
  subsurfaceStrength: DEFAULT_SUBSURFACE_STRENGTH,
  showExpressions: false,
  showModeling: false,
  showSkinning: false,
  showHair: false,
})

export function setFacsValues(next: Updater<FacsValues>) {
  appState.facsValues = resolveUpdater(appState.facsValues, next)
}

export function setModelingValues(next: Updater<ModelingValues>) {
  appState.modelingValues = resolveUpdater(appState.modelingValues, next)
}

export function setEyeLook2D(next: Updater<EyeLookValues>) {
  appState.eyeLook2D = resolveUpdater(appState.eyeLook2D, next)
}

export function setSkinTextures(next: Updater<SkinTextures>) {
  appState.skinTextures = resolveUpdater(appState.skinTextures, next)
}

export function setModelingMode(mode: ModelingMode) {
  appState.modelingMode = mode
}

export function setModelingSymmetric(symmetric: boolean) {
  appState.modelingSymmetric = symmetric
}

export function setSelectedModelingHandleId(id: string | null) {
  appState.selectedModelingHandleId = id
}

export function setWireframe(value: boolean) {
  appState.wireframe = value
}

export function setShowBones(value: boolean) {
  appState.showBones = value
}

export function setEyeLook(value: boolean) {
  appState.eyeLook = value
}

export function setFocusLock(value: boolean) {
  appState.focusLock = value
}

export function setIsTransforming(value: boolean) {
  appState.isTransforming = value
}

export function setBoneDebug(debug: BoneDebug | null) {
  appState.boneDebug = debug
}

export function setFov(value: number) {
  appState.fov = value
}

export function setPoreScale(value: number) {
  appState.poreScale = value
}

export function setPoreNormalStrength(value: number) {
  appState.poreNormalStrength = value
}

export function setWrinkleNormalStrength(value: number) {
  appState.wrinkleNormalStrength = value
}

export function setFlipNormalY(value: boolean) {
  appState.flipNormalY = value
}

export function setOiliness(value: number) {
  appState.oiliness = value
}

export function setSurfaceRoughness(value: number) {
  appState.surfaceRoughness = value
}

export function setToneDepth(value: number) {
  appState.toneDepth = value
}

export function setSubsurfaceStrength(value: number) {
  appState.subsurfaceStrength = value
}

export function setShowExpressions(value: boolean) {
  appState.showExpressions = value
}

export function setShowModeling(value: boolean) {
  appState.showModeling = value
}

export function setShowSkinning(value: boolean) {
  appState.showSkinning = value
}

export function setShowHair(value: boolean) {
  appState.showHair = value
}

export function toggleShowExpressions() {
  appState.showExpressions = !appState.showExpressions
}

export function toggleShowModeling() {
  appState.showModeling = !appState.showModeling
}

export function toggleShowSkinning() {
  appState.showSkinning = !appState.showSkinning
}

export function toggleShowHair() {
  appState.showHair = !appState.showHair
}