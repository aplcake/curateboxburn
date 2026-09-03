import type { ThreeElements } from '@react-three/fiber'
import { cloneElement, isValidElement, type ReactElement } from 'react'
import * as THREE from 'three'
import { getOutlineMaterial } from '../shaders/outlineMaterial'

type OutlineMeshProps = Omit<ThreeElements['mesh'], 'children' | 'scale' | 'geometry' | 'material'> & {
  geometry: ReactElement
  material: ReactElement
  outlineWidth?: number
  outlineColor?: string
  scale?: number | [number, number, number]
}

function toScale(scale: OutlineMeshProps['scale']): [number, number, number] {
  if (Array.isArray(scale)) return scale
  if (typeof scale === 'number') return [scale, scale, scale]
  return [1, 1, 1]
}

function cloneGeometry(geometry: ReactElement) {
  return isValidElement(geometry) ? cloneElement(geometry) : geometry
}

export function OutlineMesh({
  geometry,
  material,
  outlineWidth = 0.035,
  outlineColor,
  scale,
  ...meshProps
}: OutlineMeshProps) {
  const baseScale = toScale(scale)
  const outlineScale = baseScale.map((value) => value + outlineWidth) as [number, number, number]

  return (
    <group>
      <mesh {...meshProps} scale={outlineScale} material={outlineColor ? undefined : getOutlineMaterial()}>
        {cloneGeometry(geometry)}
        {outlineColor ? <meshBasicMaterial color={outlineColor} side={THREE.BackSide} /> : null}
      </mesh>
      <mesh {...meshProps} scale={baseScale}>
        {geometry}
        {material}
      </mesh>
    </group>
  )
}
