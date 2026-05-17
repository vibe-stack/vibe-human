import { ClothScene } from '../cloth'

export default function ClothingRuntimeController({ enabled }: { enabled: boolean }) {
  if (!enabled) return null
  return <ClothScene />
}
