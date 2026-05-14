import * as THREE from 'three'
import type { HairMaterialSettings } from '../core/types'

export function createHairStrandMaterial(settings: HairMaterialSettings) {
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: settings.opacity < 0.999,
    opacity: settings.opacity,
    toneMapped: false,
  })

  material.depthWrite = false
  return material
}
