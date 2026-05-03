export type BonePose = {
  // LOCAL bone-space delta. Use sparingly; exported deform bones have mixed axes.
  position?: [number, number, number]
  // Model/world-facing delta converted into each bone parent's local space at runtime.
  worldPosition?: [number, number, number]
  rotation?: [number, number, number] // Euler delta in radians
}

export type Emotion = {
  label: string
  bones: Record<string, BonePose>
}

type PoseMap = Record<string, BonePose>

const move = (worldPosition: [number, number, number]): BonePose => ({ worldPosition })
const rotate = (rotation: [number, number, number]): BonePose => ({ rotation })

const assign = (names: string[], pose: BonePose): PoseMap =>
  Object.fromEntries(names.map((name) => [name, pose]))

const combine = (...maps: PoseMap[]): PoseMap => Object.assign({}, ...maps)

// These names are authored without the DEF- prefix. HumanModel retargets them to
// the deform-only glTF export, e.g. lip.T.L.001 -> DEF-lip.T.L.001.
const browLeft = ['brow.B.L', 'brow.B.L.001', 'brow.B.L.002', 'brow.B.L.003', 'brow.B.L.004']
const browRight = ['brow.B.R', 'brow.B.R.001', 'brow.B.R.002', 'brow.B.R.003', 'brow.B.R.004']
const browTopLeft = ['brow.T.L', 'brow.T.L.001', 'brow.T.L.002', 'brow.T.L.003']
const browTopRight = ['brow.T.R', 'brow.T.R.001', 'brow.T.R.002', 'brow.T.R.003']
const foreheadLeft = ['forehead.L', 'forehead.L.001', 'forehead.L.002']
const foreheadRight = ['forehead.R', 'forehead.R.001', 'forehead.R.002']
const lidTopLeft = ['lid.T.L', 'lid.T.L.001', 'lid.T.L.002', 'lid.T.L.003']
const lidTopRight = ['lid.T.R', 'lid.T.R.001', 'lid.T.R.002', 'lid.T.R.003']
const lidBottomLeft = ['lid.B.L', 'lid.B.L.001', 'lid.B.L.002', 'lid.B.L.003']
const lidBottomRight = ['lid.B.R', 'lid.B.R.001', 'lid.B.R.002', 'lid.B.R.003']
const cheekLeft = ['cheek.B.L', 'cheek.B.L.001', 'cheek.T.L', 'cheek.T.L.001']
const cheekRight = ['cheek.B.R', 'cheek.B.R.001', 'cheek.T.R', 'cheek.T.R.001']
const nose = ['nose', 'nose.001', 'nose.002', 'nose.003', 'nose.004']
const noseLeft = ['nose.L', 'nose.L.001']
const noseRight = ['nose.R', 'nose.R.001']
const chin = ['chin', 'chin.001', 'chin.L', 'chin.R']

export const EMOTIONS: Record<string, Emotion> = {
  neutral: {
    label: 'Neutral',
    bones: {},
  },

  diagnostic: {
    label: 'Face Test',
    bones: combine(
      assign(browLeft, move([0, 0.18, 0.02])),
      assign(browRight, move([0, 0.18, 0.02])),
      assign(browTopLeft, move([0, 0.22, 0.02])),
      assign(browTopRight, move([0, 0.22, 0.02])),
      assign(lidTopLeft, move([0, 0.12, 0.02])),
      assign(lidTopRight, move([0, 0.12, 0.02])),
      assign(lidBottomLeft, move([0, -0.1, 0.02])),
      assign(lidBottomRight, move([0, -0.1, 0.02])),
      assign(cheekLeft, move([0.08, 0.14, 0.04])),
      assign(cheekRight, move([-0.08, 0.14, 0.04])),
      {
        'lip.T.L': move([0.04, 0.12, 0.04]),
        'lip.T.R': move([-0.04, 0.12, 0.04]),
        'lip.T.L.001': move([0.12, 0.14, 0.05]),
        'lip.T.R.001': move([-0.12, 0.14, 0.05]),
      },
    ),
  },

  smile: {
    label: 'Smile',
    bones: combine(
      {
        'lip.T.L': move([0.008, 0.012, 0.004]),
        'lip.T.R': move([-0.008, 0.012, 0.004]),
        'lip.T.L.001': move([0.038, 0.036, 0.01]),
        'lip.T.R.001': move([-0.038, 0.036, 0.01]),
        'lip.B.L': move([0.006, 0.012, 0.002]),
        'lip.B.R': move([-0.006, 0.012, 0.002]),
        'lip.B.L.001': move([0.032, 0.026, 0.006]),
        'lip.B.R.001': move([-0.032, 0.026, 0.006]),
        jaw_master: rotate([0.035, 0, 0]),
      },
      assign(cheekLeft, move([0.02, 0.035, 0.018])),
      assign(cheekRight, move([-0.02, 0.035, 0.018])),
      assign(lidTopLeft, move([0, -0.006, 0])),
      assign(lidTopRight, move([0, -0.006, 0])),
      assign(lidBottomLeft, move([0, 0.012, 0])),
      assign(lidBottomRight, move([0, 0.012, 0])),
      assign(browTopLeft, move([0, 0.01, 0])),
      assign(browTopRight, move([0, 0.01, 0])),
    ),
  },

  angry: {
    label: 'Angry',
    bones: combine(
      {
        'lip.T.L': move([-0.006, -0.012, -0.006]),
        'lip.T.R': move([0.006, -0.012, -0.006]),
        'lip.T.L.001': move([-0.018, -0.02, -0.01]),
        'lip.T.R.001': move([0.018, -0.02, -0.01]),
        'lip.B.L': move([-0.004, 0.012, -0.004]),
        'lip.B.R': move([0.004, 0.012, -0.004]),
        'lip.B.L.001': move([-0.014, 0.014, -0.006]),
        'lip.B.R.001': move([0.014, 0.014, -0.006]),
        jaw_master: rotate([-0.025, 0, 0]),
        jaw: rotate([-0.02, 0, 0]),
      },
      assign(browLeft, move([-0.018, -0.034, 0.006])),
      assign(browRight, move([0.018, -0.034, 0.006])),
      assign(browTopLeft, move([-0.012, -0.026, 0.002])),
      assign(browTopRight, move([0.012, -0.026, 0.002])),
      assign(foreheadLeft, move([-0.004, -0.014, 0.002])),
      assign(foreheadRight, move([0.004, -0.014, 0.002])),
      assign(lidTopLeft, move([0, -0.016, 0])),
      assign(lidTopRight, move([0, -0.016, 0])),
      assign(lidBottomLeft, move([0, 0.012, 0])),
      assign(lidBottomRight, move([0, 0.012, 0])),
      assign(cheekLeft, move([0.004, 0.012, 0.006])),
      assign(cheekRight, move([-0.004, 0.012, 0.006])),
      assign(noseLeft, move([-0.006, 0.006, 0.004])),
      assign(noseRight, move([0.006, 0.006, 0.004])),
      assign(chin, move([0, 0.008, -0.004])),
    ),
  },

  sad: {
    label: 'Sad',
    bones: combine(
      {
        'lip.T.L': move([0.002, -0.012, -0.002]),
        'lip.T.R': move([-0.002, -0.012, -0.002]),
        'lip.T.L.001': move([0.024, -0.034, -0.004]),
        'lip.T.R.001': move([-0.024, -0.034, -0.004]),
        'lip.B.L': move([0.002, -0.006, 0.004]),
        'lip.B.R': move([-0.002, -0.006, 0.004]),
        'lip.B.L.001': move([0.02, -0.028, 0.006]),
        'lip.B.R.001': move([-0.02, -0.028, 0.006]),
        jaw_master: rotate([0.055, 0, 0]),
      },
      assign(['brow.B.L', 'brow.B.L.001', 'brow.T.L', 'brow.T.L.001'], move([-0.014, 0.036, 0])),
      assign(['brow.B.R', 'brow.B.R.001', 'brow.T.R', 'brow.T.R.001'], move([0.014, 0.036, 0])),
      assign(['brow.B.L.003', 'brow.B.L.004', 'brow.T.L.003'], move([0.01, -0.012, 0])),
      assign(['brow.B.R.003', 'brow.B.R.004', 'brow.T.R.003'], move([-0.01, -0.012, 0])),
      assign(lidTopLeft, move([0, 0.006, 0])),
      assign(lidTopRight, move([0, 0.006, 0])),
      assign(cheekLeft, move([0.006, -0.012, -0.004])),
      assign(cheekRight, move([-0.006, -0.012, -0.004])),
      assign(chin, move([0, 0.012, 0.004])),
    ),
  },

  surprised: {
    label: 'Surprised',
    bones: combine(
      {
        'lip.T.L': move([0.006, 0.035, 0.008]),
        'lip.T.R': move([-0.006, 0.035, 0.008]),
        'lip.T.L.001': move([-0.006, 0.02, 0.014]),
        'lip.T.R.001': move([0.006, 0.02, 0.014]),
        'lip.B.L': move([0.004, -0.035, 0.01]),
        'lip.B.R': move([-0.004, -0.035, 0.01]),
        'lip.B.L.001': move([-0.004, -0.026, 0.014]),
        'lip.B.R.001': move([0.004, -0.026, 0.014]),
        jaw_master: rotate([0.22, 0, 0]),
        jaw: rotate([0.08, 0, 0]),
      },
      assign(browLeft, move([0, 0.05, 0])),
      assign(browRight, move([0, 0.05, 0])),
      assign(browTopLeft, move([0, 0.06, 0])),
      assign(browTopRight, move([0, 0.06, 0])),
      assign(foreheadLeft, move([0, 0.03, 0])),
      assign(foreheadRight, move([0, 0.03, 0])),
      assign(lidTopLeft, move([0, 0.03, 0])),
      assign(lidTopRight, move([0, 0.03, 0])),
      assign(lidBottomLeft, move([0, -0.024, 0])),
      assign(lidBottomRight, move([0, -0.024, 0])),
      assign(cheekLeft, move([0.006, -0.016, 0.004])),
      assign(cheekRight, move([-0.006, -0.016, 0.004])),
      assign(chin, move([0, -0.024, 0.008])),
    ),
  },

  disgusted: {
    label: 'Disgusted',
    bones: combine(
      {
        'lip.T.L': move([0.004, 0.024, 0.008]),
        'lip.T.L.001': move([0.012, 0.044, 0.012]),
        'lip.T.R': move([0, -0.004, -0.002]),
        'lip.T.R.001': move([0.006, 0.006, -0.004]),
        'lip.B.L': move([0.004, 0.006, -0.004]),
        'lip.B.L.001': move([0.014, -0.012, -0.006]),
        'lip.B.R.001': move([0.004, 0.004, -0.004]),
        jaw_master: rotate([0.045, 0, 0.015]),
      },
      assign(nose, move([0, 0.014, -0.004])),
      assign(noseLeft, move([0.01, 0.022, -0.002])),
      assign(noseRight, move([-0.004, 0.006, -0.002])),
      assign(['cheek.B.L', 'cheek.B.L.001', 'cheek.T.L', 'cheek.T.L.001'], move([0.018, 0.032, 0.012])),
      assign(['cheek.B.R', 'cheek.B.R.001'], move([-0.006, 0.006, 0.002])),
      assign(browLeft, move([-0.012, -0.026, 0.004])),
      assign(browRight, move([0.01, -0.018, 0.002])),
      assign(lidTopLeft, move([0, -0.012, 0])),
      assign(lidBottomLeft, move([0, 0.01, 0])),
      assign(chin, move([0.006, 0.004, -0.004])),
    ),
  },

  fearful: {
    label: 'Fearful',
    bones: combine(
      {
        'lip.T.L': move([0.008, 0.006, -0.006]),
        'lip.T.R': move([-0.008, 0.006, -0.006]),
        'lip.T.L.001': move([0.032, -0.012, -0.012]),
        'lip.T.R.001': move([-0.032, -0.012, -0.012]),
        'lip.B.L': move([0.004, -0.02, 0.004]),
        'lip.B.R': move([-0.004, -0.02, 0.004]),
        'lip.B.L.001': move([0.026, -0.016, -0.008]),
        'lip.B.R.001': move([-0.026, -0.016, -0.008]),
        jaw_master: rotate([0.16, 0, 0]),
        jaw: rotate([0.04, 0, 0]),
      },
      assign(['brow.B.L', 'brow.B.L.001', 'brow.T.L', 'brow.T.L.001'], move([-0.012, 0.044, 0])),
      assign(['brow.B.R', 'brow.B.R.001', 'brow.T.R', 'brow.T.R.001'], move([0.012, 0.044, 0])),
      assign(['brow.B.L.002', 'brow.B.L.003', 'brow.T.L.002', 'brow.T.L.003'], move([0.004, 0.026, 0])),
      assign(['brow.B.R.002', 'brow.B.R.003', 'brow.T.R.002', 'brow.T.R.003'], move([-0.004, 0.026, 0])),
      assign(lidTopLeft, move([0, 0.026, 0])),
      assign(lidTopRight, move([0, 0.026, 0])),
      assign(lidBottomLeft, move([0, -0.02, 0])),
      assign(lidBottomRight, move([0, -0.02, 0])),
      assign(cheekLeft, move([0.012, -0.008, -0.006])),
      assign(cheekRight, move([-0.012, -0.008, -0.006])),
      assign(chin, move([0, -0.01, 0.006])),
    ),
  },
}

export const EMOTION_KEYS = Object.keys(EMOTIONS) as (keyof typeof EMOTIONS)[]
