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

export type PoseTestLandmark = {
  x: number
  y: number
  z: number
  visibility?: number
  presence?: number
}

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
  showTest: boolean
  poseTestEnabled: boolean
  poseTestStatus: string
  poseTestModelUrl: string
  poseTestCameraId: string
  poseTestMirror: boolean
  poseTestRigStrength: number
  poseTestMinVisibility: number
  poseTestFollowPosition: boolean
  poseTestPositionScale: number
  poseTestWorldLandmarks: PoseTestLandmark[] | null
  poseTestFrameTime: number
}

export const DEFAULT_POSE_TEST_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'

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
  showTest: false,
  poseTestEnabled: false,
  poseTestStatus: 'Idle',
  poseTestModelUrl: DEFAULT_POSE_TEST_MODEL_URL,
  poseTestCameraId: '',
  poseTestMirror: true,
  poseTestRigStrength: 0.74,
  poseTestMinVisibility: 0.42,
  poseTestFollowPosition: true,
  poseTestPositionScale: 1.35,
  poseTestWorldLandmarks: null,
  poseTestFrameTime: 0,
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

export function setShowTest(value: boolean) {
  appState.showTest = value
}

export function setPoseTestEnabled(value: boolean) {
  appState.poseTestEnabled = value
}

export function setPoseTestStatus(value: string) {
  appState.poseTestStatus = value
}

export function setPoseTestModelUrl(value: string) {
  appState.poseTestModelUrl = value
}

export function setPoseTestCameraId(value: string) {
  appState.poseTestCameraId = value
}

export function setPoseTestMirror(value: boolean) {
  appState.poseTestMirror = value
}

export function setPoseTestRigStrength(value: number) {
  appState.poseTestRigStrength = value
}

export function setPoseTestMinVisibility(value: number) {
  appState.poseTestMinVisibility = value
}

export function setPoseTestFollowPosition(value: boolean) {
  appState.poseTestFollowPosition = value
}

export function setPoseTestPositionScale(value: number) {
  appState.poseTestPositionScale = value
}

export function setPoseTestWorldLandmarks(value: PoseTestLandmark[] | null) {
  appState.poseTestWorldLandmarks = value
  appState.poseTestFrameTime = value ? performance.now() : 0
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

export function toggleShowTest() {
  appState.showTest = !appState.showTest
}
