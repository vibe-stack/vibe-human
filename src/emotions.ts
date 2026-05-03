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
const innerBrowLeft = ['brow.B.L', 'brow.B.L.001', 'brow.T.L', 'brow.T.L.001']
const innerBrowRight = ['brow.B.R', 'brow.B.R.001', 'brow.T.R', 'brow.T.R.001']
const midBrowLeft = ['brow.B.L.002', 'brow.T.L.002']
const midBrowRight = ['brow.B.R.002', 'brow.T.R.002']
const outerBrowLeft = ['brow.B.L.003', 'brow.B.L.004', 'brow.T.L.003']
const outerBrowRight = ['brow.B.R.003', 'brow.B.R.004', 'brow.T.R.003']

export const EMOTIONS: Record<string, Emotion> = {
  neutral: {
    label: 'Neutral',
    bones: {},
  },

  smile: {
    label: 'Smile',
    bones: combine(
      {
        'lip.T.L': move([0.016, 0.022, 0.008]),
        'lip.T.R': move([-0.016, 0.022, 0.008]),
        'lip.T.L.001': move([0.074, 0.07, 0.022]),
        'lip.T.R.001': move([-0.074, 0.07, 0.022]),
        'lip.B.L': move([0.012, 0.018, 0.008]),
        'lip.B.R': move([-0.012, 0.018, 0.008]),
        'lip.B.L.001': move([0.064, 0.056, 0.02]),
        'lip.B.R.001': move([-0.064, 0.056, 0.02]),
        'teeth.T': move([0, 0.012, 0.008]),
        'teeth.B': move([0, 0.018, 0.012]),
        jaw_master: rotate([0.042, 0, 0]),
      },
      assign(cheekLeft, move([0.054, 0.104, 0.034])),
      assign(cheekRight, move([-0.054, 0.104, 0.034])),
      assign(lidTopLeft, move([0, -0.028, 0.004])),
      assign(lidTopRight, move([0, -0.028, 0.004])),
      assign(lidBottomLeft, move([0, 0.046, 0.004])),
      assign(lidBottomRight, move([0, 0.046, 0.004])),
      assign(browTopLeft, move([0.004, 0.018, 0])),
      assign(browTopRight, move([-0.004, 0.018, 0])),
    ),
  },

  angry: {
    label: 'Angry',
    bones: combine(
      {
        'lip.T.L': move([-0.016, -0.034, 0.006]),
        'lip.T.R': move([0.016, -0.034, 0.006]),
        'lip.T.L.001': move([-0.06, -0.052, 0.008]),
        'lip.T.R.001': move([0.06, -0.052, 0.008]),
        'lip.B.L': move([-0.014, -0.03, 0.014]),
        'lip.B.R': move([0.014, -0.03, 0.014]),
        'lip.B.L.001': move([-0.064, -0.084, 0.018]),
        'lip.B.R.001': move([0.064, -0.084, 0.018]),
        'teeth.T': move([0, -0.006, 0.002]),
        'teeth.B': move([0, -0.032, 0.01]),
        jaw_master: rotate([0.044, 0, 0]),
      },
      assign(innerBrowLeft, move([-0.054, 0.108, 0])),
      assign(innerBrowRight, move([0.054, 0.108, 0])),
      assign(midBrowLeft, move([-0.018, 0.044, 0])),
      assign(midBrowRight, move([0.018, 0.044, 0])),
      assign(outerBrowLeft, move([0.034, -0.064, 0])),
      assign(outerBrowRight, move([-0.034, -0.064, 0])),
      assign(lidTopLeft, move([0, -0.034, 0.004])),
      assign(lidTopRight, move([0, -0.034, 0.004])),
      assign(lidBottomLeft, move([0, -0.022, 0])),
      assign(lidBottomRight, move([0, -0.022, 0])),
      assign(cheekLeft, move([0.022, -0.052, -0.01])),
      assign(cheekRight, move([-0.022, -0.052, -0.01])),
      assign(chin, move([0, 0.044, 0.01])),
    ),
  },

  sad: {
    label: 'Sad',
    bones: combine(
      {
        'lip.T.L': move([-0.022, -0.016, -0.016]),
        'lip.T.R': move([0.022, -0.016, -0.016]),
        'lip.T.L.001': move([-0.064, -0.026, -0.026]),
        'lip.T.R.001': move([0.064, -0.026, -0.026]),
        'lip.B.L': move([-0.018, -0.038, -0.01]),
        'lip.B.R': move([0.018, -0.038, -0.01]),
        'lip.B.L.001': move([-0.056, -0.052, -0.018]),
        'lip.B.R.001': move([0.056, -0.052, -0.018]),
        'teeth.T': move([0, -0.008, -0.006]),
        'teeth.B': move([0, -0.056, -0.002]),
        jaw_master: rotate([0.15, 0, 0]),
        jaw: rotate([0.06, 0, 0]),
      },
      assign(innerBrowLeft, move([0.042, -0.152, 0.014])),
      assign(innerBrowRight, move([-0.042, -0.152, 0.014])),
      assign(midBrowLeft, move([-0.034, -0.092, 0.01])),
      assign(midBrowRight, move([0.034, -0.092, 0.01])),
      assign(outerBrowLeft, move([0.026, 0.13, 0.016])),
      assign(outerBrowRight, move([-0.026, 0.13, 0.016])),
      assign(foreheadLeft, move([-0.026, -0.06, 0.008])),
      assign(foreheadRight, move([0.026, -0.06, 0.008])),
      assign(lidTopLeft, move([0, -0.064, 0.004])),
      assign(lidTopRight, move([0, -0.064, 0.004])),
      assign(lidBottomLeft, move([0, 0.048, 0.004])),
      assign(lidBottomRight, move([0, 0.048, 0.004])),
      assign(cheekLeft, move([0.018, 0.042, 0.012])),
      assign(cheekRight, move([-0.018, 0.042, 0.012])),
      assign(noseLeft, move([-0.022, 0.026, 0.012])),
      assign(noseRight, move([0.022, 0.026, 0.012])),
      assign(chin, move([0, -0.05, -0.008])),
    ),
  },

  surprised: {
    label: 'Surprised',
    bones: combine(
      {
        'lip.T.L': move([0.01, 0.062, 0.014]),
        'lip.T.R': move([-0.01, 0.062, 0.014]),
        'lip.T.L.001': move([-0.01, 0.038, 0.022]),
        'lip.T.R.001': move([0.01, 0.038, 0.022]),
        'lip.B.L': move([0.008, -0.124, 0.022]),
        'lip.B.R': move([-0.008, -0.124, 0.022]),
        'lip.B.L.001': move([-0.01, -0.098, 0.026]),
        'lip.B.R.001': move([0.01, -0.098, 0.026]),
        'teeth.T': move([0, 0.04, 0.014]),
        'teeth.B': move([0, -0.15, 0.03]),
        jaw_master: rotate([0.48, 0, 0]),
        jaw: rotate([0.2, 0, 0]),
      },
      assign(browLeft, move([0, 0.082, 0])),
      assign(browRight, move([0, 0.082, 0])),
      assign(browTopLeft, move([0, 0.096, 0])),
      assign(browTopRight, move([0, 0.096, 0])),
      assign(foreheadLeft, move([0, 0.05, 0])),
      assign(foreheadRight, move([0, 0.05, 0])),
      assign(lidTopLeft, move([0, 0.052, 0.002])),
      assign(lidTopRight, move([0, 0.052, 0.002])),
      assign(lidBottomLeft, move([0, -0.04, 0])),
      assign(lidBottomRight, move([0, -0.04, 0])),
      assign(cheekLeft, move([0.01, -0.026, 0.006])),
      assign(cheekRight, move([-0.01, -0.026, 0.006])),
      assign(chin, move([0, -0.12, 0.022])),
    ),
  },

  disgusted: {
    label: 'Disgusted',
    bones: combine(
      {
        'lip.T.L': move([0.026, 0.088, 0.02]),
        'lip.T.L.001': move([0.064, 0.132, 0.028]),
        'lip.T.R': move([0.006, -0.032, -0.012]),
        'lip.T.R.001': move([0.026, -0.024, -0.018]),
        'lip.B.L': move([0.018, 0.038, -0.014]),
        'lip.B.L.001': move([0.05, -0.05, -0.022]),
        'lip.B.R': move([0.006, 0.01, -0.012]),
        'lip.B.R.001': move([0.02, 0.006, -0.016]),
        'teeth.T': move([0.01, 0.014, 0.002]),
        'teeth.B': move([0.01, -0.02, 0.002]),
        jaw_master: rotate([0.12, 0, 0.066]),
      },
      assign(nose, move([0, 0.056, -0.018])),
      assign(noseLeft, move([0.044, 0.092, -0.016])),
      assign(noseRight, move([-0.022, 0.034, -0.01])),
      assign(['cheek.B.L', 'cheek.B.L.001', 'cheek.T.L', 'cheek.T.L.001'], move([0.07, 0.118, 0.032])),
      assign(['cheek.B.R', 'cheek.B.R.001'], move([-0.03, 0.038, 0.006])),
      assign(innerBrowLeft, move([-0.05, -0.082, 0.008])),
      assign(innerBrowRight, move([0.034, -0.056, 0.006])),
      assign(outerBrowLeft, move([0.026, 0.028, 0.004])),
      assign(lidTopLeft, move([0, -0.048, 0.004])),
      assign(lidBottomLeft, move([0, 0.038, 0.004])),
      assign(lidTopRight, move([0, -0.016, 0.002])),
      assign(chin, move([0.02, 0.02, -0.014])),
    ),
  },

  fearful: {
    label: 'Fearful',
    bones: combine(
      {
        'lip.T.L': move([0.026, -0.012, -0.018]),
        'lip.T.R': move([-0.026, -0.012, -0.018]),
        'lip.T.L.001': move([0.082, -0.048, -0.034]),
        'lip.T.R.001': move([-0.082, -0.048, -0.034]),
        'lip.B.L': move([0.022, -0.042, 0.006]),
        'lip.B.R': move([-0.022, -0.042, 0.006]),
        'lip.B.L.001': move([0.07, -0.064, -0.026]),
        'lip.B.R.001': move([-0.07, -0.064, -0.026]),
        'teeth.T': move([0, 0.012, 0.006]),
        'teeth.B': move([0, -0.052, 0.014]),
        jaw_master: rotate([0.17, 0, 0]),
        jaw: rotate([0.058, 0, 0]),
      },
      assign(innerBrowLeft, move([-0.054, 0.108, 0])),
      assign(innerBrowRight, move([0.054, 0.108, 0])),
      assign(midBrowLeft, move([0.01, 0.082, 0])),
      assign(midBrowRight, move([-0.01, 0.082, 0])),
      assign(outerBrowLeft, move([0.028, 0.044, 0])),
      assign(outerBrowRight, move([-0.028, 0.044, 0])),
      assign(lidTopLeft, move([0, 0.064, 0.004])),
      assign(lidTopRight, move([0, 0.064, 0.004])),
      assign(lidBottomLeft, move([0, -0.052, 0.002])),
      assign(lidBottomRight, move([0, -0.052, 0.002])),
      assign(cheekLeft, move([0.036, -0.046, -0.018])),
      assign(cheekRight, move([-0.036, -0.046, -0.018])),
      assign(chin, move([0, -0.036, 0.012])),
    ),
  },
}

export const EMOTION_KEYS = Object.keys(EMOTIONS) as (keyof typeof EMOTIONS)[]
