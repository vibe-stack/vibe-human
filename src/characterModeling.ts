export type ModelingControl = {
  id: string
  label: string
  tab: string
  section: string
  negativeLabel: string
  positiveLabel: string
  negativeTarget: string
  positiveTarget: string
}

export type ModelingValues = Record<string, number>

function makeControl(
  morphBase: string,
  negLabel: string,
  posLabel: string,
  overrides?: { label?: string; tab?: string; section?: string },
): ModelingControl {
  // morphBase: e.g. "id.skull.browRidge.depth"
  // derives tab, section, label from the dot-separated path
  const parts = morphBase.split('.')
  // parts[0] = "id", parts[1] = category, parts[2..n-1] = subsections, parts[n] = property
  const category = parts[1]
  const property = parts[parts.length - 1]
  const subsections = parts.slice(2, parts.length - 1)

  const tab = overrides?.tab ?? capitalize(category)
  const section = overrides?.section ?? (subsections.length > 0 ? camelToLabel(subsections[subsections.length - 1]) : capitalize(category))
  const label = overrides?.label ?? camelToLabel(property)

  return {
    id: morphBase,
    label,
    tab,
    section,
    negativeLabel: negLabel,
    positiveLabel: posLabel,
    negativeTarget: `${morphBase}.neg`,
    positiveTarget: `${morphBase}.pos`,
  }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function camelToLabel(s: string) {
  return s.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim()
}

export const MODELING_CONTROLS: ModelingControl[] = [
  // ── HEAD ──
  makeControl('id.head.width',  'Narrow', 'Wide'),
  makeControl('id.head.height', 'Short',  'Tall'),
  makeControl('id.head.depth',  'Flat',   'Deep'),
  makeControl('id.head.scale',  'Small',  'Large'),

  // ── SKULL > Braincase ──
  makeControl('id.skull.braincase.scale',      'Small',   'Large'),
  makeControl('id.skull.braincase.width',      'Narrow',  'Wide'),
  makeControl('id.skull.braincase.depth',      'Flat',    'Deep'),
  makeControl('id.skull.braincase.height',     'Low',     'High'),
  makeControl('id.skull.braincase.backDepth',  'Flat',    'Deep'),
  makeControl('id.skull.braincase.backHeight', 'Low',     'High'),
  makeControl('id.skull.braincase.topWidth',   'Narrow',  'Wide'),
  makeControl('id.skull.braincase.sideVolume', 'Thin',    'Full'),
  makeControl('id.skull.braincase.roundness',  'Angular', 'Round'),

  // ── SKULL > Forehead ──
  makeControl('id.skull.forehead.width',       'Narrow', 'Wide'),
  makeControl('id.skull.forehead.height',      'Low',    'High'),
  makeControl('id.skull.forehead.depth',       'Flat',   'Deep'),
  makeControl('id.skull.forehead.slope',       'Upright','Sloped'),
  makeControl('id.skull.forehead.lowerVolume', 'Thin',   'Full'),
  makeControl('id.skull.forehead.upperVolume', 'Thin',   'Full'),

  // ── SKULL > Brow Ridge ──
  makeControl('id.skull.browRidge.width',      'Narrow', 'Wide'),
  makeControl('id.skull.browRidge.height',     'Low',    'High'),
  makeControl('id.skull.browRidge.depth',      'Flat',   'Prominent'),
  makeControl('id.skull.browRidge.innerDepth', 'Flat',   'Prominent'),
  makeControl('id.skull.browRidge.outerDepth', 'Flat',   'Prominent'),

  // ── SKULL > Cheekbone ──
  makeControl('id.skull.cheekbone.width',      'Narrow',  'Wide'),
  makeControl('id.skull.cheekbone.height',     'Low',     'High'),
  makeControl('id.skull.cheekbone.angularity', 'Rounded', 'Angular'),

  // ── SKULL > Temple ──
  makeControl('id.skull.temple.width', 'Narrow', 'Wide'),

  // ── SKULL > Eye socket ──
  makeControl('id.skull.eye.spacing',       'Close',    'Wide'),
  makeControl('id.skull.eye.width',         'Narrow',   'Wide'),
  makeControl('id.skull.eye.height',        'Low',      'High'),
  makeControl('id.skull.eye.depth',         'Shallow',  'Deep'),
  makeControl('id.skull.eye.tilt',          'Down',     'Up'),
  makeControl('id.skull.eye.angularity',    'Rounded',  'Angular'),
  makeControl('id.skull.eye.upperRimDepth', 'Flat',     'Prominent'),
  makeControl('id.skull.eye.upperRimHeight','Low',      'High'),
  makeControl('id.skull.eye.lowerRimDepth', 'Flat',     'Prominent'),
  makeControl('id.skull.eye.lowerRimHeight','Low',      'High'),

  // ── SKULL > Upper Jaw ──
  makeControl('id.skull.upperJaw.width',    'Narrow',   'Wide'),
  makeControl('id.skull.upperJaw.height',   'Low',      'High'),
  makeControl('id.skull.upperJaw.depth',    'Recessed', 'Forward'),
  makeControl('id.skull.upperJaw.roundness','Angular',  'Round'),

  // ── SKULL > Lower Jaw ──
  makeControl('id.skull.lowerJaw.width',      'Narrow',  'Wide'),
  makeControl('id.skull.lowerJaw.height',     'Low',     'High'),
  makeControl('id.skull.lowerJaw.depth',      'Back',    'Forward'),
  makeControl('id.skull.lowerJaw.roundedness','Angular', 'Round'),

  // ── SKULL > Chin ──
  makeControl('id.skull.chin.width',  'Narrow',   'Wide'),
  makeControl('id.skull.chin.height', 'Short',    'Tall'),
  makeControl('id.skull.chin.depth',  'Recessed', 'Prominent'),

  // ── NOSE > Bridge ──
  makeControl('id.nose.bridge.width',      'Narrow',  'Wide'),
  makeControl('id.nose.bridge.angularity', 'Rounded', 'Angular'),

  // ── NOSE > Nasal Bone ──
  makeControl('id.nose.nasalBone.width',     'Narrow',  'Wide'),
  makeControl('id.nose.nasalBone.height',    'Low',     'High'),
  makeControl('id.nose.nasalBone.depth',     'Flat',    'Prominent'),
  makeControl('id.nose.nasalBone.direction', 'Down',    'Up'),

  // ── NOSE > Upper Cartilage ──
  makeControl('id.nose.upperCartilage.width',     'Narrow', 'Wide'),
  makeControl('id.nose.upperCartilage.height',    'Short',  'Tall'),
  makeControl('id.nose.upperCartilage.depth',     'Flat',   'Deep'),
  makeControl('id.nose.upperCartilage.direction', 'Down',   'Up'),

  // ── NOSE > Lower Cartilage ──
  makeControl('id.nose.lowerCartilage.width',      'Narrow',  'Wide'),
  makeControl('id.nose.lowerCartilage.height',     'Low',     'High'),
  makeControl('id.nose.lowerCartilage.depth',      'Flat',    'Deep'),
  makeControl('id.nose.lowerCartilage.direction',  'Down',    'Up'),
  makeControl('id.nose.lowerCartilage.roundedness','Angular', 'Round'),

  // ── NOSE > Tip ──
  makeControl('id.nose.tip.direction',  'Down',    'Up'),
  makeControl('id.nose.tip.angularity', 'Rounded', 'Angular'),

  // ── NOSE > Nostril ──
  makeControl('id.nose.nostril.width',      'Narrow',  'Wide'),
  makeControl('id.nose.nostril.height',     'Low',     'High'),
  makeControl('id.nose.nostril.depth',      'Flat',    'Deep'),
  makeControl('id.nose.nostril.angularity', 'Rounded', 'Angular'),
  makeControl('id.nose.nostril.innerScale', 'Small',   'Large'),

  // ── MOUTH ──
  makeControl('id.mouth.width', 'Narrow', 'Wide'),

  // ── MOUTH > Philtrum ──
  makeControl('id.mouth.philtrum.width', 'Narrow', 'Wide'),
  makeControl('id.mouth.philtrum.depth', 'Flat',   'Deep'),

  // ── MOUTH > Upper Lip ──
  makeControl('id.mouth.upperLip.width',      'Narrow', 'Wide'),
  makeControl('id.mouth.upperLip.height',     'Low',    'High'),
  makeControl('id.mouth.upperLip.depth',      'Thin',   'Full'),
  makeControl('id.mouth.upperLip.roudnedness','Angular','Round'),

  // ── MOUTH > Lower Lip ──
  makeControl('id.mouth.lowerLip.width',  'Narrow', 'Wide'),
  makeControl('id.mouth.lowerLip.height', 'Low',    'High'),
  makeControl('id.mouth.lowerLip.depth',  'Thin',   'Full'),
]

// Fix: "id.nose.nasalBone.direction.neg.pos" is a bad target in the model - skip
const BAD_TARGETS = new Set(['id.nose.nasalBone.direction.neg.pos'])

export const MODELING_TABS = Array.from(
  new Set(MODELING_CONTROLS.map((c) => c.tab)),
)

export function getControlsForTab(tab: string) {
  return MODELING_CONTROLS.filter((c) => c.tab === tab)
}

export function getSectionsForTab(tab: string) {
  return Array.from(new Set(getControlsForTab(tab).map((c) => c.section)))
}

export function createNeutralModelingValues(): ModelingValues {
  return Object.fromEntries(MODELING_CONTROLS.map((c) => [c.id, 0]))
}

export function buildModelingMorphs(values: ModelingValues): Record<string, number> {
  const morphs: Record<string, number> = {}

  for (const control of MODELING_CONTROLS) {
    const value = Math.max(-1, Math.min(1, values[control.id] ?? 0))
    if (!BAD_TARGETS.has(control.negativeTarget)) {
      morphs[control.negativeTarget] = value < 0 ? Math.abs(value) : 0
    }
    if (!BAD_TARGETS.has(control.positiveTarget)) {
      morphs[control.positiveTarget] = value > 0 ? value : 0
    }
  }

  return morphs
}
