import type { GarmentKind } from '../clothing/runtime/garmentLibrary'
import type { FabricId } from '../clothing/runtime/fabrics'

// `import.meta.env` is absent when the lab runs headless (Node QA harness).
const BASE = `${import.meta.env?.BASE_URL ?? '/'}cloth-lab/`

export type LabCharacterEntry = {
  id: string
  name: string
  url: string
  /** What this character exercises in the test matrix. */
  note: string
  source: string
}

export const LAB_CHARACTERS: LabCharacterEntry[] = [
  { id: 'ybot', name: 'Y Bot', url: `${BASE}characters/ybot.fbx`, note: 'Standard Mixamo rig (FBX). Source rig of the clip library.', source: 'mg-3d-assets/ybot.fbx' },
  { id: 'michelle', name: 'Michelle', url: `${BASE}characters/Michelle.glb`, note: 'Mixamo, female proportions, armature rotated +90° X.', source: 'three.js examples (Mixamo)' },
  { id: 'mixamo-character', name: 'Mixamo character', url: `${BASE}characters/mixamo-character.glb`, note: 'Mixamo 23-joint skeleton (no fingers, extra head bone), quantized + meshopt mesh.', source: 'mg-3d-assets/characters/character.glb' },
  { id: 'soldier', name: 'Soldier (Vanguard)', url: `${BASE}characters/Soldier.glb`, note: 'Mixamo, armoured mesh + separate visor mesh, 49 joints, armature rotated −90° X.', source: 'three.js examples (Mixamo)' },
  { id: 'xbot', name: 'X Bot', url: `${BASE}characters/Xbot.glb`, note: 'Mixamo, two overlapping skinned shells (surface + joints).', source: 'three.js examples (Mixamo)' },
  { id: 'robot', name: 'Robot Expressive', url: `${BASE}characters/RobotExpressive.glb`, note: 'Non-Mixamo skeleton; most meshes rigidly parented to bones, not skinned.', source: 'three.js examples (Quaternius)' },
  { id: 'cesium', name: 'Cesium Man', url: `${BASE}characters/CesiumMan.glb`, note: 'Non-Mixamo 19-joint skeleton, Z-up export.', source: 'Khronos glTF sample assets' },
]

export type LabClipEntry = { id: string; name: string; category: 'idle' | 'walk' | 'run' | 'jump' | 'turn' | 'direction' | 'stress' }

export const LAB_CLIPS: LabClipEntry[] = [
  { id: 'idle', name: 'Breathing idle', category: 'idle' },
  { id: 'walk', name: 'Walk', category: 'walk' },
  { id: 'happy-walk', name: 'Happy walk', category: 'walk' },
  { id: 'jog', name: 'Jog', category: 'run' },
  { id: 'run', name: 'Fast run', category: 'run' },
  { id: 'jump-in-place', name: 'Jump in place', category: 'jump' },
  { id: 'running-jump', name: 'Running jump', category: 'jump' },
  { id: 'turn-left-90', name: 'Turn left 90°', category: 'turn' },
  { id: 'turn-right-90', name: 'Turn right 90°', category: 'turn' },
  { id: 'change-direction-180', name: 'Run, change direction 180°', category: 'turn' },
  { id: 'jog-circle', name: 'Jog in a circle', category: 'direction' },
  { id: 'strafe-left', name: 'Strafe left', category: 'direction' },
  { id: 'strafe-right', name: 'Strafe right', category: 'direction' },
  { id: 'jog-backward', name: 'Jog backward', category: 'direction' },
  { id: 'air-squat', name: 'Air squat (knees, waist)', category: 'stress' },
  { id: 'arms-dance', name: 'Arms dance (shoulders, armpits)', category: 'stress' },
]

export const clipUrl = (id: string) => `${BASE}clips/${id}.json`
export const SOURCE_RIG_URL = `${BASE}characters/ybot.fbx`

export type LabOutfitPreset = { id: string; name: string; items: Array<{ kind: GarmentKind; fabric?: FabricId }> }

export const LAB_OUTFITS: LabOutfitPreset[] = [
  { id: 'tshirt', name: 'T-shirt (jersey)', items: [{ kind: 'tshirt' }] },
  { id: 'shirt', name: 'Long-sleeve shirt (cotton)', items: [{ kind: 'shirt' }] },
  { id: 'trousers', name: 'Trousers (denim)', items: [{ kind: 'trousers' }] },
  { id: 'jacket', name: 'Open jacket (wool, loose)', items: [{ kind: 'jacket' }] },
  { id: 'skirt', name: 'Flared skirt (silk)', items: [{ kind: 'skirt' }] },
  { id: 'dress', name: 'Sleeveless dress (silk)', items: [{ kind: 'dress' }] },
  { id: 'tshirt-trousers', name: 'T-shirt + trousers', items: [{ kind: 'trousers' }, { kind: 'tshirt' }] },
  { id: 'shirt-skirt', name: 'Shirt + skirt', items: [{ kind: 'skirt' }, { kind: 'shirt' }] },
]
