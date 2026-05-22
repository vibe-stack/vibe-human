type OrbitController = { enabled: boolean } | null

let orbitLockCount = 0
let orbitUserEnabled = true
let orbitController: OrbitController = null

export function setOrbitController(controller: OrbitController) {
  orbitController = controller
  syncOrbitEnabled()
}

export function setOrbitUserEnabled(enabled: boolean) {
  orbitUserEnabled = enabled
  syncOrbitEnabled()
}

export function lockOrbit() {
  orbitLockCount += 1
  syncOrbitEnabled()
}

export function unlockOrbit() {
  orbitLockCount = Math.max(0, orbitLockCount - 1)
  syncOrbitEnabled()
}

function syncOrbitEnabled() {
  if (orbitController) orbitController.enabled = orbitUserEnabled && orbitLockCount === 0
}
