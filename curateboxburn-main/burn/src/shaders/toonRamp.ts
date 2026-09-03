import * as THREE from 'three'

let cachedToonRamp: THREE.DataTexture | null = null

export function getToonRampTexture() {
  if (cachedToonRamp) return cachedToonRamp

  const colors = new Uint8Array([
    55, 50, 68, 255,
    138, 129, 156, 255,
    247, 224, 152, 255,
  ])
  const texture = new THREE.DataTexture(colors, 3, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  cachedToonRamp = texture
  return texture
}

export function makeToonMaterial(color: THREE.ColorRepresentation) {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: getToonRampTexture(),
  })
}
