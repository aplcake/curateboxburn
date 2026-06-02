import * as THREE from 'three'
import { PALETTE } from '../core/palettes'

let outlineMaterial: THREE.MeshBasicMaterial | null = null

export function getOutlineMaterial() {
  if (!outlineMaterial) {
    outlineMaterial = new THREE.MeshBasicMaterial({
      color: PALETTE.outline,
      side: THREE.BackSide,
    })
  }
  return outlineMaterial
}
