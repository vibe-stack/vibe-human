import { ClothScene } from '../cloth'

export default function ClothingRuntimeController({
  enabled,
  controlsEnabled = true,
}: {
  enabled: boolean
  controlsEnabled?: boolean
}) {
  if (!enabled) return null
  return <ClothScene controlsEnabled={controlsEnabled} />
}
