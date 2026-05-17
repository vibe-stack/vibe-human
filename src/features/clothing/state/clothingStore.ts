import { proxy } from 'valtio'
import type { GarmentDocument, ClothingTool } from './clothingTypes'

// ---------------------------------------------------------------------------
// Clothing feature state
// ---------------------------------------------------------------------------

type Viewport2DState = {
  zoom: number
  panX: number
  panY: number
  hoveredEntityId: string | null
  hoveredEntityType: 'point' | 'edge' | 'pattern' | 'seam' | null
}

type PreviewOptions3D = {
  showWireframe: boolean
  showSeams: boolean
  showTriangulation: boolean
}

type DirtyFlags = {
  triangulationDirty: boolean
  previewDirty: boolean
}

type ClothingState = {
  activeClothingTool: ClothingTool
  garment: GarmentDocument
  viewport2D: Viewport2DState
  previewOptions: PreviewOptions3D
  dirty: DirtyFlags
  simRunning: boolean
  simResetKey: number
}

const EMPTY_GARMENT: GarmentDocument = {
  id: 'empty',
  name: 'Untitled',
  patterns: {},
  seams: {},
}

export const clothingStore = proxy<ClothingState>({
  activeClothingTool: 'select',
  garment: EMPTY_GARMENT,
  viewport2D: {
    zoom: 1,
    panX: 0,
    panY: 0,
    hoveredEntityId: null,
    hoveredEntityType: null,
  },
  previewOptions: {
    showWireframe: false,
    showSeams: true,
    showTriangulation: false,
  },
  dirty: {
    triangulationDirty: false,
    previewDirty: false,
  },
  simRunning: true,
  simResetKey: 0,
})
