export type ModelingControl = {
  id: string
  label: string
  group: 'Head' | 'Eyes' | 'Midface' | 'Nose' | 'Jaw' | 'Mouth'
  negativeLabel: string
  positiveLabel: string
  negativeTarget: string
  positiveTarget: string
}

export type ModelingValues = Record<string, number>

export const MODELING_CONTROLS: ModelingControl[] = [
  {
    id: 'head_width',
    label: 'Head Width',
    group: 'Head',
    negativeLabel: 'Narrow',
    positiveLabel: 'Wide',
    negativeTarget: 'identity_head_width_narrow',
    positiveTarget: 'identity_head_width_wide',
  },
  {
    id: 'eye_spacing',
    label: 'Eye Spacing',
    group: 'Eyes',
    negativeLabel: 'Narrow',
    positiveLabel: 'Wide',
    negativeTarget: 'identity_eye_spacing_narrow',
    positiveTarget: 'identity_eye_spacing_wide',
  },
  {
    id: 'cheek_volume',
    label: 'Cheek Volume',
    group: 'Midface',
    negativeLabel: 'Reduced',
    positiveLabel: 'Full',
    negativeTarget: 'identity_cheek_volume_narrow',
    positiveTarget: 'identity_cheek_volume_wide',
  },
  {
    id: 'nose_length',
    label: 'Nose Length',
    group: 'Nose',
    negativeLabel: 'Short',
    positiveLabel: 'Long',
    negativeTarget: 'identity_nose_length_narrow',
    positiveTarget: 'identity_nose_length_wide',
  },
  {
    id: 'nose_width',
    label: 'Nose Width',
    group: 'Nose',
    negativeLabel: 'Narrow',
    positiveLabel: 'Wide',
    negativeTarget: 'identity_nose_width_narrow',
    positiveTarget: 'identity_nose_width_wide',
  },
  {
    id: 'jaw_width',
    label: 'Jaw Width',
    group: 'Jaw',
    negativeLabel: 'Narrow',
    positiveLabel: 'Wide',
    negativeTarget: 'identity_jaw_width_narrow',
    positiveTarget: 'identity_jaw_width_wide',
  },
  {
    id: 'chin_forward',
    label: 'Chin Projection',
    group: 'Jaw',
    negativeLabel: 'Back',
    positiveLabel: 'Forward',
    negativeTarget: 'identity_chin_forward_narrow',
    positiveTarget: 'identity_chin_forward_wide',
  },
  {
    id: 'lip_upper_fullness',
    label: 'Upper Lip Fullness',
    group: 'Mouth',
    negativeLabel: 'Thin',
    positiveLabel: 'Full',
    negativeTarget: 'identity_lip_upper_fulness_narrow',
    positiveTarget: 'identity_lip_upper_fulness_wide',
  },
  {
    id: 'lip_lower_fullness',
    label: 'Lower Lip Fullness',
    group: 'Mouth',
    negativeLabel: 'Thin',
    positiveLabel: 'Full',
    negativeTarget: 'identity_lip_lower_fulness_narrow',
    positiveTarget: 'identity_lip_lower_flness_wide',
  },
]

export const MODELING_GROUPS = Array.from(
  new Set(MODELING_CONTROLS.map((control) => control.group)),
)

export function createNeutralModelingValues(): ModelingValues {
  return Object.fromEntries(MODELING_CONTROLS.map((control) => [control.id, 0]))
}

export function buildModelingMorphs(values: ModelingValues): Record<string, number> {
  const morphs: Record<string, number> = {}

  for (const control of MODELING_CONTROLS) {
    const value = Math.max(-1, Math.min(1, values[control.id] ?? 0))
    morphs[control.negativeTarget] = value < 0 ? Math.abs(value) : 0
    morphs[control.positiveTarget] = value > 0 ? value : 0
  }

  return morphs
}
