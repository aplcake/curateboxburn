import * as THREE from 'three'

export type Vec3Tuple = [number, number, number]

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function clamp01(value: number) {
  return clamp(value, 0, 1)
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export function damp(current: number, target: number, lambda: number, dt: number) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt))
}

export function tupleFromVector(v: THREE.Vector3): Vec3Tuple {
  return [v.x, v.y, v.z]
}

export function vectorFromTuple(tuple: Vec3Tuple, target = new THREE.Vector3()) {
  return target.set(tuple[0], tuple[1], tuple[2])
}

export function seededNoise(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

export function signedSeededNoise(seed: number) {
  return seededNoise(seed) * 2 - 1
}

export function clampArena(target: THREE.Vector3, halfWidth: number, halfDepth: number) {
  target.x = clamp(target.x, -halfWidth, halfWidth)
  target.z = clamp(target.z, -halfDepth, halfDepth)
  return target
}
