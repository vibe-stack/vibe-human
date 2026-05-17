import RapierClothDemo from './RapierClothDemo'

// GarmentPreviewMesh is the 3D clothing entry point used by App.tsx.
// It now renders a real Rapier-backed cloth sample instead of flat demo panels.
export default function GarmentPreviewMesh() {
  return <RapierClothDemo />
}
