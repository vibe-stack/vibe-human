import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { HairCardMesh } from './hairCardBuilder'

/**
 * Export the hair card geometry + baked atlas as a self-contained GLB.
 * The atlas canvas is embedded as the albedo+alpha map so game engines
 * (Unreal, Unity, Godot, Blender) receive a complete asset.
 */
export async function exportGeometryAsGLB(
  hairCardMesh: HairCardMesh,
  filename = 'hair-cards.glb',
): Promise<void> {
  const geo = hairCardMesh.geometry.clone()
  if (!geo.attributes.normal) geo.computeVertexNormals()

  const tex = new THREE.CanvasTexture(hairCardMesh.atlasCanvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.premultiplyAlpha = false

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.001,
    depthWrite: false,
    roughness: 0.85,
    metalness: 0,
  })
  mat.name = 'HairCardMaterial'

  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'HairCards'

  const scene = new THREE.Scene()
  scene.add(mesh)

  const exporter = new GLTFExporter()
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => resolve(result as ArrayBuffer),
      (err) => reject(err),
      { binary: true },
    )
  })

  const blob = new Blob([buffer], { type: 'model/gltf-binary' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
