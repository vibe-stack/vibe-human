export type BonePose = {
  // LOCAL bone-space delta. Use sparingly; exported deform bones have mixed axes.
  position?: [number, number, number]
  // Model/world-facing delta converted into each bone parent's local space at runtime.
  worldPosition?: [number, number, number]
  rotation?: [number, number, number]
}

export type PoseMap = Record<string, BonePose>

export type FacsGroup = 'Brows' | 'Eyes' | 'Midface' | 'Mouth' | 'Jaw' | 'Performance'
export type FacsSide = 'L' | 'R' | 'C' | 'B'

export type FacsControl = {
  id: string
  au: string
  label: string
  group: FacsGroup
  side: FacsSide
  max?: number
  bones: PoseMap
}

export type FacsValues = Record<string, number>
export type FacsPreset = {
  id: string
  label: string
  values: Partial<FacsValues>
}

const move = (worldPosition: [number, number, number]): BonePose => ({ worldPosition })

const assign = (names: string[], pose: BonePose): PoseMap =>
  Object.fromEntries(names.map((name) => [name, pose]))

const combine = (...maps: PoseMap[]): PoseMap => Object.assign({}, ...maps)

const mirrorPose = (pose: BonePose): BonePose => ({
  position: pose.position ? [-pose.position[0], pose.position[1], pose.position[2]] : undefined,
  worldPosition: pose.worldPosition
    ? [-pose.worldPosition[0], pose.worldPosition[1], pose.worldPosition[2]]
    : undefined,
  rotation: pose.rotation ? [pose.rotation[0], -pose.rotation[1], -pose.rotation[2]] : undefined,
})

const mirrorMap = (map: PoseMap): PoseMap =>
  Object.fromEntries(
    Object.entries(map).map(([name, pose]) => [
      name.replace(/\.L/g, '.R'),
      mirrorPose(pose),
    ]),
  )

const leftRight = (left: PoseMap): PoseMap => combine(left, mirrorMap(left))

// UI range is intentionally larger than the authored full-strength value.
// 5.0 is authored full strength; values above 5.0 are deliberate overdrive.
export const FACS_AUTHORED_VALUE = 5
export const FACS_VALUE_MAX = 5
const FACS_AUTHORED_RESPONSE = 1.55
const FACS_OVERDRIVE_RESPONSE = 0.85

// In this rig, the lower brow chain runs lateral-to-medial:
// brow.B.L is the outside tail, brow.B.L.004 is closest to the nose.
// The upper brow follows the same pattern: brow.T.L is outer, brow.T.L.003 is inner.
const browInnerLeft = ['brow.B.L.003', 'brow.B.L.004', 'brow.T.L.003']
const browMidLeft = ['brow.B.L.002', 'brow.T.L.002']
const browOuterLeft = ['brow.B.L', 'brow.B.L.001', 'brow.T.L', 'brow.T.L.001']
const foreheadLeft = ['forehead.L', 'forehead.L.001', 'forehead.L.002']
const lidTopLeft = ['lid.T.L', 'lid.T.L.001', 'lid.T.L.002', 'lid.T.L.003']
const lidBottomLeft = ['lid.B.L', 'lid.B.L.001', 'lid.B.L.002', 'lid.B.L.003']
const cheekLeft = ['cheek.B.L', 'cheek.B.L.001', 'cheek.T.L', 'cheek.T.L.001']
const noseCenter = ['nose', 'nose.001', 'nose.002', 'nose.003', 'nose.004']
const noseLeft = ['nose.L', 'nose.L.001']
const chin = ['chin', 'chin.001', 'chin.L', 'chin.R']

const upperLidRaiseLeft = {
  'lid.T.L': move([0, 0.024, 0.002]),
  'lid.T.L.001': move([0, 0.042, 0.004]),
  'lid.T.L.002': move([0, 0.052, 0.004]),
  'lid.T.L.003': move([0, 0.038, 0.003]),
  'lid.B.L': move([0, -0.008, 0]),
  'lid.B.L.001': move([0, -0.012, 0]),
  'lid.B.L.002': move([0, -0.014, 0]),
  'lid.B.L.003': move([0, -0.01, 0]),
}

const lidTightenLeft = {
  'lid.T.L': move([0, -0.014, 0.001]),
  'lid.T.L.001': move([0, -0.022, 0.002]),
  'lid.T.L.002': move([0, -0.026, 0.002]),
  'lid.T.L.003': move([0, -0.02, 0.002]),
  'lid.B.L': move([0, 0.012, 0.001]),
  'lid.B.L.001': move([0, 0.02, 0.002]),
  'lid.B.L.002': move([0, 0.024, 0.002]),
  'lid.B.L.003': move([0, 0.018, 0.002]),
}

const eyeClosureLeft = {
  'lid.T.L': move([0, -0.034, 0.002]),
  'lid.T.L.001': move([0, -0.054, 0.004]),
  'lid.T.L.002': move([0, -0.062, 0.004]),
  'lid.T.L.003': move([0, -0.048, 0.003]),
  'lid.B.L': move([0, 0.012, 0.001]),
  'lid.B.L.001': move([0, 0.024, 0.002]),
  'lid.B.L.002': move([0, 0.03, 0.002]),
  'lid.B.L.003': move([0, 0.02, 0.002]),
}

const controls: FacsControl[] = [
  {
    id: 'au01_inner_brow_raiser',
    au: 'AU01',
    label: 'Inner Brow Raiser',
    group: 'Brows',
    side: 'B',
    bones: leftRight(
      combine(
        assign(browInnerLeft, move([0.016, 0.128, 0.014])),
        assign(browMidLeft, move([0.004, 0.044, 0.006])),
        assign(foreheadLeft, move([0.006, 0.052, 0.006])),
      ),
    ),
  },
  {
    id: 'au02_outer_brow_raiser',
    au: 'AU02',
    label: 'Outer Brow Raiser',
    group: 'Brows',
    side: 'B',
    bones: leftRight(
      combine(
        assign(browOuterLeft, move([0.018, 0.138, 0.016])),
        assign(browMidLeft, move([0.006, 0.052, 0.008])),
        assign(foreheadLeft, move([0.014, 0.058, 0.006])),
      ),
    ),
  },
  {
    id: 'au04_brow_lowerer',
    au: 'AU04',
    label: 'Brow Lowerer',
    group: 'Brows',
    side: 'B',
    bones: leftRight(
      combine(
        assign(browInnerLeft, move([-0.052, -0.116, 0.004])),
        assign(browMidLeft, move([-0.026, -0.064, 0])),
        assign(browOuterLeft, move([0.018, -0.048, 0])),
        assign(foreheadLeft, move([-0.018, -0.046, 0.004])),
      ),
    ),
  },
  {
    id: 'brow_compress',
    au: 'CTRL',
    label: 'Brow Compress',
    group: 'Brows',
    side: 'B',
    bones: leftRight(
      combine(
        assign(browInnerLeft, move([-0.032, -0.082, 0.004])),
        assign(browMidLeft, move([-0.018, -0.052, 0])),
        assign(foreheadLeft, move([-0.012, -0.034, 0.002])),
      ),
    ),
  },
  {
    id: 'au05_upper_lid_raiser',
    au: 'AU05',
    label: 'Upper Lid Raiser',
    group: 'Eyes',
    side: 'B',
    bones: leftRight(
      combine(
        upperLidRaiseLeft,
        assign(browMidLeft, move([0.004, 0.024, 0])),
      ),
    ),
  },
  {
    id: 'au06_cheek_raiser',
    au: 'AU06',
    label: 'Cheek Raiser',
    group: 'Midface',
    side: 'B',
    bones: leftRight(
      combine(
        assign(cheekLeft, move([0.052, 0.104, 0.034])),
        assign(lidBottomLeft, move([0.002, 0.052, 0.004])),
        assign(lidTopLeft, move([0, -0.026, 0.002])),
      ),
    ),
  },
  {
    id: 'au07_lid_tightener',
    au: 'AU07',
    label: 'Lid Tightener',
    group: 'Eyes',
    side: 'B',
    bones: leftRight(
      combine(
        lidTightenLeft,
        assign(cheekLeft, move([0.018, 0.036, 0.01])),
      ),
    ),
  },
  {
    id: 'glare',
    au: 'CTRL',
    label: 'Glare',
    group: 'Eyes',
    side: 'B',
    bones: leftRight(
      combine(
        lidTightenLeft,
        assign(browInnerLeft, move([-0.018, -0.05, 0.002])),
        assign(browMidLeft, move([-0.012, -0.038, 0])),
        assign(cheekLeft, move([0.01, 0.022, 0.004])),
      ),
    ),
  },
  {
    id: 'au09_nose_wrinkler',
    au: 'AU09',
    label: 'Nose Wrinkler',
    group: 'Midface',
    side: 'B',
    bones: combine(
      assign(noseCenter, move([0, 0.06, -0.02])),
      leftRight(
        combine(
          assign(noseLeft, move([0.042, 0.088, -0.018])),
          assign(cheekLeft, move([0.034, 0.072, 0.014])),
          assign(lidBottomLeft, move([0, 0.028, 0.002])),
        ),
      ),
    ),
  },
  {
    id: 'au38_nostril_dilator',
    au: 'AU38',
    label: 'Nostril Dilator',
    group: 'Midface',
    side: 'B',
    bones: combine(
      assign(noseCenter, move([0, -0.012, 0.006])),
      leftRight(
        combine(
          assign(noseLeft, move([0.052, -0.012, 0.018])),
          assign(['cheek.B.L', 'cheek.T.L.001'], move([0.018, -0.012, 0.008])),
        ),
      ),
    ),
  },
  {
    id: 'au10_upper_lip_raiser_l',
    au: 'AU10',
    label: 'Upper Lip Raiser L',
    group: 'Mouth',
    side: 'L',
    bones: combine(
      {
        'lip.T.L': move([0.022, 0.08, 0.018]),
        'lip.T.L.001': move([0.056, 0.114, 0.026]),
        'lip.B.L': move([0.016, 0.036, -0.006]),
      },
      assign(noseLeft, move([0.022, 0.046, -0.008])),
      assign(['cheek.B.L', 'cheek.T.L'], move([0.036, 0.07, 0.02])),
    ),
  },
  {
    id: 'au10_upper_lip_raiser_r',
    au: 'AU10',
    label: 'Upper Lip Raiser R',
    group: 'Mouth',
    side: 'R',
    bones: mirrorMap({
      'lip.T.L': move([0.022, 0.08, 0.018]),
      'lip.T.L.001': move([0.056, 0.114, 0.026]),
      'lip.B.L': move([0.016, 0.036, -0.006]),
      'nose.L': move([0.022, 0.046, -0.008]),
      'nose.L.001': move([0.022, 0.046, -0.008]),
      'cheek.B.L': move([0.036, 0.07, 0.02]),
      'cheek.T.L': move([0.036, 0.07, 0.02]),
    }),
  },
  {
    id: 'au12_lip_corner_puller_l',
    au: 'AU12',
    label: 'Lip Corner Puller L',
    group: 'Mouth',
    side: 'L',
    bones: combine(
      {
        'lip.T.L': move([0.018, 0.024, 0.01]),
        'lip.T.L.001': move([0.082, 0.074, 0.026]),
        'lip.B.L': move([0.014, 0.02, 0.008]),
        'lip.B.L.001': move([0.072, 0.062, 0.022]),
      },
      assign(cheekLeft, move([0.052, 0.096, 0.032])),
      assign(lidBottomLeft, move([0, 0.034, 0.002])),
    ),
  },
  {
    id: 'au12_lip_corner_puller_r',
    au: 'AU12',
    label: 'Lip Corner Puller R',
    group: 'Mouth',
    side: 'R',
    bones: mirrorMap({
      'lip.T.L': move([0.018, 0.024, 0.01]),
      'lip.T.L.001': move([0.082, 0.074, 0.026]),
      'lip.B.L': move([0.014, 0.02, 0.008]),
      'lip.B.L.001': move([0.072, 0.062, 0.022]),
      'cheek.B.L': move([0.052, 0.096, 0.032]),
      'cheek.B.L.001': move([0.052, 0.096, 0.032]),
      'cheek.T.L': move([0.052, 0.096, 0.032]),
      'cheek.T.L.001': move([0.052, 0.096, 0.032]),
      'lid.B.L': move([0, 0.034, 0.002]),
      'lid.B.L.001': move([0, 0.034, 0.002]),
      'lid.B.L.002': move([0, 0.034, 0.002]),
      'lid.B.L.003': move([0, 0.034, 0.002]),
    }),
  },
  {
    id: 'au14_dimpler',
    au: 'AU14',
    label: 'Dimpler',
    group: 'Mouth',
    side: 'B',
    bones: leftRight({
      'lip.T.L.001': move([0.044, -0.012, -0.018]),
      'lip.B.L.001': move([0.052, -0.012, -0.018]),
      'cheek.B.L': move([0.028, 0.024, -0.012]),
      'cheek.T.L': move([0.022, 0.026, -0.012]),
    }),
  },
  {
    id: 'au15_lip_corner_depressor_l',
    au: 'AU15',
    label: 'Corner Depressor L',
    group: 'Mouth',
    side: 'L',
    bones: combine(
      {
        'lip.T.L.001': move([-0.046, -0.034, -0.016]),
        'lip.B.L.001': move([-0.06, -0.078, -0.014]),
        'lip.B.L': move([-0.014, -0.034, -0.008]),
      },
      assign(['chin.L', 'chin.001'], move([-0.012, -0.034, -0.006])),
    ),
  },
  {
    id: 'au15_lip_corner_depressor_r',
    au: 'AU15',
    label: 'Corner Depressor R',
    group: 'Mouth',
    side: 'R',
    bones: mirrorMap({
      'lip.T.L.001': move([-0.046, -0.034, -0.016]),
      'lip.B.L.001': move([-0.06, -0.078, -0.014]),
      'lip.B.L': move([-0.014, -0.034, -0.008]),
      'chin.L': move([-0.012, -0.034, -0.006]),
      'chin.001': move([-0.012, -0.034, -0.006]),
    }),
  },
  {
    id: 'au17_chin_raiser',
    au: 'AU17',
    label: 'Chin Raiser',
    group: 'Mouth',
    side: 'C',
    bones: combine(
      assign(chin, move([0, 0.064, 0.01])),
      {
        'lip.B.L': move([0.012, 0.038, 0.01]),
        'lip.B.R': move([-0.012, 0.038, 0.01]),
        'lip.B.L.001': move([0.028, 0.044, 0.012]),
        'lip.B.R.001': move([-0.028, 0.044, 0.012]),
      },
    ),
  },
  {
    id: 'au16_lower_lip_depressor',
    au: 'AU16',
    label: 'Lower Lip Depressor',
    group: 'Mouth',
    side: 'B',
    bones: leftRight({
      'lip.B.L': move([0.01, -0.052, 0.01]),
      'lip.B.L.001': move([0.03, -0.082, 0.012]),
      'chin.L': move([0.012, -0.03, 0.002]),
      'chin.001': move([0, -0.024, 0.002]),
    }),
  },
  {
    id: 'au18_lip_pucker',
    au: 'AU18',
    label: 'Lip Pucker',
    group: 'Mouth',
    side: 'C',
    bones: {
      'lip.T.L': move([0.008, 0.012, 0.03]),
      'lip.T.R': move([-0.008, 0.012, 0.03]),
      'lip.T.L.001': move([-0.03, 0.004, 0.036]),
      'lip.T.R.001': move([0.03, 0.004, 0.036]),
      'lip.B.L': move([0.008, -0.008, 0.032]),
      'lip.B.R': move([-0.008, -0.008, 0.032]),
      'lip.B.L.001': move([-0.032, -0.006, 0.038]),
      'lip.B.R.001': move([0.032, -0.006, 0.038]),
      chin: move([0, 0.012, 0.006]),
    },
  },
  {
    id: 'au20_lip_stretcher',
    au: 'AU20',
    label: 'Lip Stretcher',
    group: 'Mouth',
    side: 'B',
    bones: leftRight({
      'lip.T.L': move([0.024, -0.01, -0.014]),
      'lip.T.L.001': move([0.096, -0.034, -0.03]),
      'lip.B.L': move([0.024, -0.026, -0.004]),
      'lip.B.L.001': move([0.09, -0.044, -0.026]),
      'cheek.B.L': move([0.036, -0.038, -0.018]),
    }),
  },
  {
    id: 'au23_lip_tightener',
    au: 'AU23',
    label: 'Lip Tightener',
    group: 'Mouth',
    side: 'B',
    bones: leftRight({
      'lip.T.L': move([0.02, -0.022, -0.018]),
      'lip.T.L.001': move([0.052, -0.034, -0.026]),
      'lip.B.L': move([0.02, 0.024, -0.018]),
      'lip.B.L.001': move([0.052, 0.028, -0.026]),
    }),
  },
  {
    id: 'au24_lip_pressor',
    au: 'AU24',
    label: 'Lip Pressor',
    group: 'Mouth',
    side: 'B',
    bones: leftRight({
      'lip.T.L': move([0.006, -0.024, -0.018]),
      'lip.T.L.001': move([0.028, -0.032, -0.028]),
      'lip.B.L': move([0.006, 0.03, -0.018]),
      'lip.B.L.001': move([0.03, 0.038, -0.028]),
      chin: move([0, 0.02, -0.006]),
      'chin.001': move([0, 0.024, -0.008]),
    }),
  },
  {
    id: 'au25_lips_part',
    au: 'AU25',
    label: 'Lips Part',
    group: 'Jaw',
    side: 'C',
    bones: {
      'lip.T.L': move([0, 0.028, 0.008]),
      'lip.T.R': move([0, 0.028, 0.008]),
      'lip.T.L.001': move([0, 0.016, 0.008]),
      'lip.T.R.001': move([0, 0.016, 0.008]),
      'lip.B.L': move([0, -0.046, 0.01]),
      'lip.B.R': move([0, -0.046, 0.01]),
      'lip.B.L.001': move([0, -0.038, 0.01]),
      'lip.B.R.001': move([0, -0.038, 0.01]),
      jaw: move([0, -0.018, -0.006]),
      jaw_master: move([0, -0.01, -0.004]),
      chin: move([0, -0.036, -0.002]),
      'chin.001': move([0, -0.03, -0.002]),
    },
  },
  {
    id: 'au26_jaw_drop',
    au: 'AU26',
    label: 'Jaw Drop',
    group: 'Jaw',
    side: 'C',
    bones: combine(
      {
        jaw: move([0, -0.048, -0.014]),
        jaw_master: move([0, -0.026, -0.01]),
        'jaw.L': move([0.008, -0.034, -0.01]),
        'jaw.R': move([-0.008, -0.034, -0.01]),
        'jaw.L.001': move([0.006, -0.056, -0.014]),
        'jaw.R.001': move([-0.006, -0.056, -0.014]),
        'lip.B.L': move([0.006, -0.104, 0.012]),
        'lip.B.R': move([-0.006, -0.104, 0.012]),
        'lip.B.L.001': move([0.006, -0.084, 0.014]),
        'lip.B.R.001': move([-0.006, -0.084, 0.014]),
        'lip.T.L': move([0.006, 0.034, 0.008]),
        'lip.T.R': move([-0.006, 0.034, 0.008]),
      },
      assign(chin, move([0, -0.088, -0.01])),
    ),
  },
  {
    id: 'au27_mouth_stretch',
    au: 'AU27',
    label: 'Mouth Stretch',
    group: 'Jaw',
    side: 'C',
    bones: {
      jaw: move([0, -0.06, -0.018]),
      jaw_master: move([0, -0.032, -0.012]),
      'jaw.L': move([0.01, -0.044, -0.012]),
      'jaw.R': move([-0.01, -0.044, -0.012]),
      'jaw.L.001': move([0.01, -0.07, -0.018]),
      'jaw.R.001': move([-0.01, -0.07, -0.018]),
      'lip.T.L': move([0.018, 0.052, 0.012]),
      'lip.T.R': move([-0.018, 0.052, 0.012]),
      'lip.T.L.001': move([0.026, 0.034, 0.014]),
      'lip.T.R.001': move([-0.026, 0.034, 0.014]),
      'lip.B.L': move([0.018, -0.128, 0.016]),
      'lip.B.R': move([-0.018, -0.128, 0.016]),
      'lip.B.L.001': move([0.024, -0.104, 0.018]),
      'lip.B.R.001': move([-0.024, -0.104, 0.018]),
      chin: move([0, -0.112, -0.014]),
      'chin.001': move([0, -0.1, -0.012]),
      'chin.L': move([0.018, -0.094, -0.012]),
      'chin.R': move([-0.018, -0.094, -0.012]),
    },
  },
  {
    id: 'au43_eye_closure',
    au: 'AU43',
    label: 'Eye Closure',
    group: 'Eyes',
    side: 'B',
    bones: leftRight(
      combine(
        eyeClosureLeft,
        assign(cheekLeft, move([0.008, 0.018, 0.004])),
      ),
    ),
  },
  {
    id: 'jaw_forward',
    au: 'CTRL',
    label: 'Jaw Forward',
    group: 'Jaw',
    side: 'C',
    bones: combine(
      {
        jaw: move([0, -0.004, 0.05]),
        jaw_master: move([0, 0, 0.032]),
        'jaw.L': move([0, -0.002, 0.034]),
        'jaw.R': move([0, -0.002, 0.034]),
        'jaw.L.001': move([0, -0.004, 0.042]),
        'jaw.R.001': move([0, -0.004, 0.042]),
      },
      assign(chin, move([0, -0.004, 0.04])),
    ),
  },
  {
    id: 'jaw_left',
    au: 'CTRL',
    label: 'Jaw Left',
    group: 'Jaw',
    side: 'C',
    bones: combine(
      {
        jaw: move([0.038, 0, 0]),
        jaw_master: move([0.026, 0, 0]),
        'jaw.L': move([0.036, 0, 0]),
        'jaw.R': move([0.03, 0, 0]),
        'jaw.L.001': move([0.042, 0, 0]),
        'jaw.R.001': move([0.034, 0, 0]),
      },
      assign(chin, move([0.036, 0, 0])),
    ),
  },
  {
    id: 'jaw_right',
    au: 'CTRL',
    label: 'Jaw Right',
    group: 'Jaw',
    side: 'C',
    bones: combine(
      {
        jaw: move([-0.038, 0, 0]),
        jaw_master: move([-0.026, 0, 0]),
        'jaw.L': move([-0.03, 0, 0]),
        'jaw.R': move([-0.036, 0, 0]),
        'jaw.L.001': move([-0.034, 0, 0]),
        'jaw.R.001': move([-0.042, 0, 0]),
      },
      assign(chin, move([-0.036, 0, 0])),
    ),
  },
  {
    id: 'scowl',
    au: 'CTRL',
    label: 'Scowl',
    group: 'Performance',
    side: 'B',
    bones: combine(
      leftRight(
        combine(
          assign(browInnerLeft, move([-0.04, -0.092, 0.006])),
          assign(browMidLeft, move([-0.026, -0.056, 0])),
          assign(browOuterLeft, move([0.012, -0.03, 0])),
          lidTightenLeft,
          assign(cheekLeft, move([0.01, 0.016, 0.002])),
        ),
      ),
      {
        'lip.T.L': move([-0.006, -0.018, -0.006]),
        'lip.T.R': move([0.006, -0.018, -0.006]),
        'lip.B.L': move([-0.008, 0.012, -0.008]),
        'lip.B.R': move([0.008, 0.012, -0.008]),
        chin: move([0, 0.02, -0.006]),
        'chin.001': move([0, 0.018, -0.006]),
      },
    ),
  },
  {
    id: 'snarl_l',
    au: 'CTRL',
    label: 'Snarl L',
    group: 'Performance',
    side: 'L',
    bones: combine(
      {
        'lip.T.L': move([0.024, 0.076, 0.018]),
        'lip.T.L.001': move([0.062, 0.114, 0.024]),
        'lip.B.L': move([0.012, 0.018, -0.008]),
        'lip.B.L.001': move([0.028, -0.026, -0.014]),
      },
      assign(noseLeft, move([0.034, 0.06, -0.01])),
      assign(['cheek.B.L', 'cheek.T.L'], move([0.036, 0.066, 0.014])),
      assign(['lid.B.L.001', 'lid.B.L.002'], move([0, 0.014, 0])),
    ),
  },
  {
    id: 'snarl_r',
    au: 'CTRL',
    label: 'Snarl R',
    group: 'Performance',
    side: 'R',
    bones: mirrorMap({
      'lip.T.L': move([0.024, 0.076, 0.018]),
      'lip.T.L.001': move([0.062, 0.114, 0.024]),
      'lip.B.L': move([0.012, 0.018, -0.008]),
      'lip.B.L.001': move([0.028, -0.026, -0.014]),
      'nose.L': move([0.034, 0.06, -0.01]),
      'nose.L.001': move([0.034, 0.06, -0.01]),
      'cheek.B.L': move([0.036, 0.066, 0.014]),
      'cheek.T.L': move([0.036, 0.066, 0.014]),
      'lid.B.L.001': move([0, 0.014, 0]),
      'lid.B.L.002': move([0, 0.014, 0]),
    }),
  },
]

export const FACS_CONTROLS = controls
export const FACS_GROUPS: FacsGroup[] = ['Brows', 'Eyes', 'Midface', 'Mouth', 'Jaw', 'Performance']

export const createNeutralFacsValues = (): FacsValues =>
  Object.fromEntries(FACS_CONTROLS.map((control) => [control.id, 0]))

export const createFacsPresetValues = (values: Partial<FacsValues>): FacsValues => {
  const next = createNeutralFacsValues()

  for (const [id, value] of Object.entries(values)) {
    if (typeof value === 'number') next[id] = value
  }

  return next
}

export const FACS_PRESETS: FacsPreset[] = [
  {
    id: 'happy',
    label: 'Happy',
    values: {
      au06_cheek_raiser: 2.4,
      au07_lid_tightener: 0.8,
      au12_lip_corner_puller_l: 3.2,
      au12_lip_corner_puller_r: 3.2,
      au25_lips_part: 0.7,
    },
  },
  {
    id: 'angry',
    label: 'Angry',
    values: {
      au04_brow_lowerer: 2.6,
      brow_compress: 2.2,
      glare: 2.4,
      au24_lip_pressor: 1.7,
      au23_lip_tightener: 1.3,
      scowl: 2.7,
      au38_nostril_dilator: 1.1,
    },
  },
  {
    id: 'sad',
    label: 'Sad',
    values: {
      au01_inner_brow_raiser: 2.3,
      au15_lip_corner_depressor_l: 2.6,
      au15_lip_corner_depressor_r: 2.6,
      au17_chin_raiser: 1,
      au43_eye_closure: 0.45,
    },
  },
  {
    id: 'surprise',
    label: 'Surprise',
    values: {
      au01_inner_brow_raiser: 2.2,
      au02_outer_brow_raiser: 2.5,
      au05_upper_lid_raiser: 2.8,
      au25_lips_part: 1.6,
      au26_jaw_drop: 2.7,
    },
  },
  {
    id: 'fear',
    label: 'Fear',
    values: {
      au01_inner_brow_raiser: 2.4,
      au02_outer_brow_raiser: 1.7,
      au05_upper_lid_raiser: 2.5,
      au20_lip_stretcher: 1.9,
      au25_lips_part: 1.3,
      au26_jaw_drop: 1.1,
    },
  },
  {
    id: 'disgust',
    label: 'Disgust',
    values: {
      au09_nose_wrinkler: 2.7,
      au10_upper_lip_raiser_l: 2,
      au10_upper_lip_raiser_r: 1.3,
      snarl_l: 2.1,
      au04_brow_lowerer: 1,
      au15_lip_corner_depressor_r: 1.1,
    },
  },
  {
    id: 'snarl',
    label: 'Snarl',
    values: {
      scowl: 1.9,
      glare: 1.7,
      au09_nose_wrinkler: 1.7,
      snarl_l: 3,
      au24_lip_pressor: 0.8,
      au26_jaw_drop: 0.7,
    },
  },
]

const addTuple = (
  current: [number, number, number] | undefined,
  next: [number, number, number],
  weight: number,
): [number, number, number] => [
  (current?.[0] ?? 0) + next[0] * weight,
  (current?.[1] ?? 0) + next[1] * weight,
  (current?.[2] ?? 0) + next[2] * weight,
]

const addPose = (target: BonePose, source: BonePose, weight: number) => {
  if (source.position) {
    target.position = addTuple(target.position, source.position, weight)
  }

  if (source.worldPosition) {
    target.worldPosition = addTuple(target.worldPosition, source.worldPosition, weight)
  }

  if (source.rotation) {
    target.rotation = addTuple(target.rotation, source.rotation, weight)
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const getControlResponse = (values: FacsValues, controlId: string) => {
  const control = FACS_CONTROLS.find((item) => item.id === controlId)
  const max = control?.max ?? FACS_VALUE_MAX
  const value = clamp(values[controlId] ?? 0, 0, max)

  if (value <= FACS_AUTHORED_VALUE) {
    return (value / FACS_AUTHORED_VALUE) * FACS_AUTHORED_RESPONSE
  }

  const overdrive = value - FACS_AUTHORED_VALUE
  const overdriveRange = Math.max(max - FACS_AUTHORED_VALUE, 0.001)
  const easedOverdrive = 1 - Math.exp((-3 * overdrive) / overdriveRange)

  return FACS_AUTHORED_RESPONSE + easedOverdrive * FACS_OVERDRIVE_RESPONSE
}

const addDentalFollow = (pose: PoseMap, values: FacsValues) => {
  const lipsPart = getControlResponse(values, 'au25_lips_part')
  const jawDrop = getControlResponse(values, 'au26_jaw_drop')
  const mouthStretch = getControlResponse(values, 'au27_mouth_stretch')
  const lowerLipDepressor = getControlResponse(values, 'au16_lower_lip_depressor')
  const upperLipRaise =
    Math.max(
      getControlResponse(values, 'au10_upper_lip_raiser_l'),
      getControlResponse(values, 'au10_upper_lip_raiser_r'),
      getControlResponse(values, 'snarl_l'),
      getControlResponse(values, 'snarl_r'),
    )
  const smile = Math.max(
    getControlResponse(values, 'au12_lip_corner_puller_l'),
    getControlResponse(values, 'au12_lip_corner_puller_r'),
  )
  const cornerDepress = Math.max(
    getControlResponse(values, 'au15_lip_corner_depressor_l'),
    getControlResponse(values, 'au15_lip_corner_depressor_r'),
  )
  const jawForward = getControlResponse(values, 'jaw_forward')
  const jawLeft = getControlResponse(values, 'jaw_left')
  const jawRight = getControlResponse(values, 'jaw_right')
  const jawSide = jawLeft - jawRight
  const jawOpen = clamp(lipsPart * 0.35 + jawDrop * 0.8 + mouthStretch, 0, 3)
  const upperReveal = clamp(upperLipRaise * 0.75 + smile * 0.18 + jawOpen * 0.22, 0, 3)
  const lowerReveal = clamp(lowerLipDepressor * 0.45 + cornerDepress * 0.22 + jawOpen * 0.85, 0, 3)

  if (upperReveal > 0.001 || jawOpen > 0.001) {
    pose['teeth.T'] ??= {}
    addPose(
      pose['teeth.T'],
      move([
        jawSide * 0.004,
        upperReveal * 0.022 + jawOpen * 0.01,
        upperReveal * -0.006 + jawForward * 0.006,
      ]),
      1,
    )
  }

  if (lowerReveal > 0.001 || jawOpen > 0.001 || jawForward > 0.001 || Math.abs(jawSide) > 0.001) {
    pose['teeth.B'] ??= {}
    addPose(
      pose['teeth.B'],
      move([
        jawSide * 0.028,
        lowerReveal * -0.052,
        jawForward * 0.024 - jawOpen * 0.01,
      ]),
      1,
    )
  }
}

export function buildFacsPose(values: FacsValues): PoseMap {
  const pose: PoseMap = {}

  for (const control of FACS_CONTROLS) {
    const value = getControlResponse(values, control.id)
    if (value <= 0.001) continue

    for (const [boneName, bonePose] of Object.entries(control.bones)) {
      pose[boneName] ??= {}
      addPose(pose[boneName], bonePose, value)
    }
  }

  addDentalFollow(pose, values)

  return pose
}
