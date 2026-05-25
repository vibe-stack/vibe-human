import type { HairCardMesh } from './hairCardBuilder'

let latestHairCardMesh: HairCardMesh | null = null

export function setLatestHairCardMesh(mesh: HairCardMesh | null) {
  latestHairCardMesh = mesh
}

export function getLatestHairCardMesh() {
  return latestHairCardMesh
}
