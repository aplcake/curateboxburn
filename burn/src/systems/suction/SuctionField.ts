import * as THREE from 'three'
import { SLURPER_PARAMS } from '../../core/parameters'
import { clamp01 } from '../../core/math'

export type SuctionResult = {
  inward: THREE.Vector3
  tangent: THREE.Vector3
  damping: THREE.Vector3
  total: THREE.Vector3
  distance: number
  influence: number
}

export function computeSuctionForce(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  mouth: THREE.Vector3,
  personalitySwirl = 1,
): SuctionResult {
  const p = SLURPER_PARAMS.slime
  const toMouth = mouth.clone().sub(position)
  const distance = Math.max(toMouth.length(), 0.0001)
  const dir = toMouth.clone().multiplyScalar(1 / distance)
  const influence = clamp01(1 - distance / p.suctionRadius)
  const nearBoost = Math.pow(influence, p.nearExponent)
  const inwardMag = p.basePull + p.maxPull * nearBoost
  const inward = dir.clone().multiplyScalar(inwardMag)
  const tangentDir = new THREE.Vector3(-dir.z, 0, dir.x).normalize()
  const tangent = tangentDir.multiplyScalar(inwardMag * p.maxTangentialRatio * personalitySwirl)
  const tangentRatio = tangent.length() / Math.max(inward.length(), 0.0001)
  if (tangentRatio > p.maxTangentialRatio) {
    tangent.multiplyScalar(p.maxTangentialRatio / tangentRatio)
  }
  const damping = velocity.clone().multiplyScalar(-0.9)
  const total = inward.clone().add(tangent).add(damping)
  return { inward, tangent, damping, total, distance, influence }
}
