'use client'

import { useMemo } from 'react'
import * as THREE from 'three'
import { OutlineMesh } from '../render/OutlineMesh'
import { getToonRampTexture } from '../shaders/toonRamp'

type Point2 = [number, number]

function purpleMaterial() {
  return <meshToonMaterial color="#4e168f" gradientMap={getToonRampTexture()} />
}

function lidMaterial() {
  return <meshToonMaterial color="#5f1aa8" gradientMap={getToonRampTexture()} />
}

function ribbonMaterial() {
  return (
    <meshPhongMaterial
      color="#e8ad2f"
      emissive="#6a3800"
      emissiveIntensity={0.08}
      specular="#fff0a8"
      shininess={112}
      flatShading
    />
  )
}

function ribbonShadowMaterial() {
  return <meshBasicMaterial color="#744206" />
}

function ribbonCreaseMaterial() {
  return <meshBasicMaterial color="#8b5109" transparent opacity={0.68} />
}

function ribbonHighlightMaterial() {
  return <meshBasicMaterial color="#fff3ad" toneMapped={false} transparent opacity={0.72} />
}

function ribbonGlazeMaterial() {
  return <meshBasicMaterial color="#ffd66b" toneMapped={false} transparent opacity={0.46} />
}

function ribbonWarmReflectionMaterial() {
  return <meshBasicMaterial color="#b46f0e" transparent opacity={0.42} />
}

function makeShape(points: Point2[]) {
  const shape = new THREE.Shape()
  shape.moveTo(points[0][0], points[0][1])
  for (const point of points.slice(1)) {
    shape.lineTo(point[0], point[1])
  }
  shape.closePath()
  return shape
}

function RibbonPanel({
  points,
  position,
  rotation = [0, 0, 0],
  shadowScale = [1.08, 1.06, 1],
  glazePoints,
  hotPoints,
  lowPoints,
}: {
  points: Point2[]
  position: [number, number, number]
  rotation?: [number, number, number]
  shadowScale?: [number, number, number]
  glazePoints?: Point2[]
  hotPoints?: Point2[]
  lowPoints?: Point2[]
}) {
  const shape = useMemo(() => makeShape(points), [points])
  const glazeShape = useMemo(() => (glazePoints ? makeShape(glazePoints) : null), [glazePoints])
  const hotShape = useMemo(() => (hotPoints ? makeShape(hotPoints) : null), [hotPoints])
  const lowShape = useMemo(() => (lowPoints ? makeShape(lowPoints) : null), [lowPoints])

  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0, -0.003]} scale={shadowScale}>
        <shapeGeometry args={[shape]} />
        {ribbonShadowMaterial()}
      </mesh>
      <mesh>
        <shapeGeometry args={[shape]} />
        {ribbonMaterial()}
      </mesh>
      {lowShape ? (
        <mesh position={[0, 0, 0.001]}>
          <shapeGeometry args={[lowShape]} />
          {ribbonWarmReflectionMaterial()}
        </mesh>
      ) : null}
      {glazeShape ? (
        <mesh position={[0, 0, 0.002]}>
          <shapeGeometry args={[glazeShape]} />
          {ribbonGlazeMaterial()}
        </mesh>
      ) : null}
      {hotShape ? (
        <mesh position={[0, 0, 0.003]}>
          <shapeGeometry args={[hotShape]} />
          {ribbonHighlightMaterial()}
        </mesh>
      ) : null}
    </group>
  )
}

function RibbonCrease({
  position,
  rotation = [0, 0, 0],
  scale,
}: {
  position: [number, number, number]
  rotation?: [number, number, number]
  scale: [number, number, number]
}) {
  return (
    <mesh position={position} rotation={rotation} scale={scale}>
      <boxGeometry args={[1, 1, 1]} />
      {ribbonCreaseMaterial()}
    </mesh>
  )
}

function RibbonPatch({
  points,
  position,
  rotation = [0, 0, 0],
  tone = 'crease',
}: {
  points: Point2[]
  position: [number, number, number]
  rotation?: [number, number, number]
  tone?: 'crease' | 'highlight' | 'shadow' | 'glaze' | 'warm'
}) {
  const shape = useMemo(() => makeShape(points), [points])

  return (
    <mesh position={position} rotation={rotation}>
      <shapeGeometry args={[shape]} />
      {tone === 'highlight'
        ? ribbonHighlightMaterial()
        : tone === 'shadow'
          ? ribbonShadowMaterial()
          : tone === 'glaze'
            ? ribbonGlazeMaterial()
            : tone === 'warm'
              ? ribbonWarmReflectionMaterial()
              : ribbonCreaseMaterial()}
    </mesh>
  )
}

const verticalRibbon: Point2[] = [
  [-0.052, -0.244],
  [0.038, -0.252],
  [0.052, -0.142],
  [0.041, 0.034],
  [0.05, 0.286],
  [-0.039, 0.304],
  [-0.054, 0.148],
  [-0.043, -0.048],
]

const lidVerticalRibbon: Point2[] = [
  [-0.05, -0.082],
  [0.038, -0.089],
  [0.052, -0.018],
  [0.041, 0.084],
  [-0.046, 0.091],
  [-0.038, 0.014],
]

const topForwardRibbon: Point2[] = [
  [-0.054, -0.288],
  [0.036, -0.302],
  [0.051, -0.096],
  [0.04, 0.04],
  [0.052, 0.29],
  [-0.038, 0.302],
  [-0.052, 0.112],
  [-0.041, -0.055],
]

const topSideRibbon: Point2[] = [
  [-0.326, -0.052],
  [-0.132, -0.041],
  [0.06, -0.052],
  [0.328, -0.04],
  [0.318, 0.048],
  [0.112, 0.052],
  [-0.058, 0.042],
  [-0.334, 0.054],
]

const verticalGlaze: Point2[] = [
  [-0.04, -0.222],
  [-0.012, -0.236],
  [-0.006, -0.092],
  [-0.018, 0.034],
  [-0.008, 0.264],
  [-0.032, 0.286],
  [-0.042, 0.092],
  [-0.034, -0.058],
]

const verticalHotGlint: Point2[] = [
  [-0.022, -0.17],
  [-0.01, -0.186],
  [-0.008, -0.028],
  [-0.018, 0.154],
  [-0.028, 0.13],
  [-0.024, -0.038],
]

const verticalLowReflection: Point2[] = [
  [0.026, -0.228],
  [0.048, -0.238],
  [0.04, -0.034],
  [0.048, 0.27],
  [0.025, 0.286],
  [0.018, 0.046],
]

const lidGlaze: Point2[] = [
  [-0.04, -0.064],
  [-0.014, -0.074],
  [-0.01, -0.012],
  [-0.018, 0.06],
  [-0.036, 0.076],
]

const lidHotGlint: Point2[] = [
  [-0.024, -0.044],
  [-0.012, -0.052],
  [-0.012, 0.012],
  [-0.02, 0.046],
  [-0.028, 0.03],
]

const lidLowReflection: Point2[] = [
  [0.022, -0.074],
  [0.044, -0.078],
  [0.038, 0.004],
  [0.044, 0.068],
  [0.02, 0.078],
]

const wideGlaze: Point2[] = [
  [-0.304, -0.034],
  [-0.112, -0.02],
  [0.092, -0.032],
  [0.282, -0.018],
  [0.264, 0.006],
  [0.044, 0],
  [-0.142, 0.012],
  [-0.314, -0.004],
]

const wideHotGlint: Point2[] = [
  [-0.216, -0.022],
  [-0.038, -0.016],
  [0.168, -0.022],
  [0.158, -0.012],
  [-0.046, -0.006],
  [-0.224, -0.012],
]

const wideLowReflection: Point2[] = [
  [-0.314, 0.024],
  [-0.08, 0.014],
  [0.286, 0.024],
  [0.28, 0.046],
  [0.052, 0.052],
  [-0.322, 0.048],
]

const naturalCreaseMark: Point2[] = [
  [-0.048, -0.004],
  [-0.012, -0.01],
  [0.046, -0.004],
  [0.038, 0.006],
  [-0.006, 0.008],
  [-0.052, 0.002],
]

const softTopSheen: Point2[] = [
  [-0.09, -0.008],
  [-0.018, -0.013],
  [0.092, -0.006],
  [0.08, 0.006],
  [-0.03, 0.014],
  [-0.094, 0.004],
]

const softFrontSheen: Point2[] = [
  [-0.014, -0.12],
  [0.006, -0.132],
  [0.012, 0.104],
  [-0.004, 0.126],
  [-0.016, 0.02],
]

const bottomForwardRibbon: Point2[] = [
  [-0.052, -0.252],
  [0.036, -0.266],
  [0.048, -0.088],
  [0.038, 0.054],
  [0.05, 0.254],
  [-0.038, 0.266],
  [-0.052, 0.086],
  [-0.042, -0.052],
]

const bottomSideRibbon: Point2[] = [
  [-0.288, -0.05],
  [-0.102, -0.04],
  [0.06, -0.052],
  [0.29, -0.039],
  [0.28, 0.048],
  [0.092, 0.053],
  [-0.052, 0.04],
  [-0.294, 0.054],
]

const topForwardFold: Point2[] = [
  [-0.052, 0.238],
  [0.05, 0.252],
  [0.038, 0.29],
  [-0.044, 0.28],
]

const topBackFold: Point2[] = [
  [-0.048, -0.282],
  [0.042, -0.296],
  [0.05, -0.256],
  [-0.042, -0.246],
]

const topLeftFold: Point2[] = [
  [-0.322, -0.05],
  [-0.284, -0.038],
  [-0.294, 0.048],
  [-0.332, 0.054],
]

const topRightFold: Point2[] = [
  [0.286, -0.04],
  [0.328, -0.038],
  [0.318, 0.046],
  [0.28, 0.052],
]

export function VacuumStylePurpleBox() {
  return (
    <group position={[0, 0.54, 0]} rotation={[0.04, -0.38, -0.02]} scale={0.44}>
      <OutlineMesh
        scale={[0.58, 0.54, 0.52]}
        outlineWidth={0.07}
        outlineColor="#030208"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={purpleMaterial()}
      />
      <OutlineMesh
        position={[0, 0.335, 0]}
        scale={[0.66, 0.14, 0.58]}
        outlineWidth={0.065}
        outlineColor="#030208"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={lidMaterial()}
      />

      <RibbonPanel
        points={verticalRibbon}
        position={[0, -0.02, 0.274]}
        glazePoints={verticalGlaze}
        hotPoints={verticalHotGlint}
        lowPoints={verticalLowReflection}
      />
      <RibbonPanel
        points={verticalRibbon}
        position={[0, -0.02, -0.274]}
        rotation={[0, Math.PI, 0]}
        glazePoints={verticalGlaze}
        hotPoints={verticalHotGlint}
        lowPoints={verticalLowReflection}
      />
      <RibbonPanel
        points={verticalRibbon}
        position={[0.304, -0.02, 0]}
        rotation={[0, Math.PI / 2, 0]}
        glazePoints={verticalGlaze}
        hotPoints={verticalHotGlint}
        lowPoints={verticalLowReflection}
      />
      <RibbonPanel
        points={verticalRibbon}
        position={[-0.304, -0.02, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        glazePoints={verticalGlaze}
        hotPoints={verticalHotGlint}
        lowPoints={verticalLowReflection}
      />

      <RibbonPanel
        points={bottomForwardRibbon}
        position={[0, -0.294, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        glazePoints={verticalGlaze}
        lowPoints={verticalLowReflection}
      />
      <RibbonPanel
        points={bottomSideRibbon}
        position={[0, -0.294, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        glazePoints={wideGlaze}
        lowPoints={wideLowReflection}
      />

      <RibbonPanel
        points={lidVerticalRibbon}
        position={[0, 0.34, 0.306]}
        glazePoints={lidGlaze}
        hotPoints={lidHotGlint}
        lowPoints={lidLowReflection}
      />
      <RibbonPanel
        points={lidVerticalRibbon}
        position={[0, 0.34, -0.306]}
        rotation={[0, Math.PI, 0]}
        glazePoints={lidGlaze}
        hotPoints={lidHotGlint}
        lowPoints={lidLowReflection}
      />
      <RibbonPanel
        points={lidVerticalRibbon}
        position={[0.346, 0.34, 0]}
        rotation={[0, Math.PI / 2, 0]}
        glazePoints={lidGlaze}
        hotPoints={lidHotGlint}
        lowPoints={lidLowReflection}
      />
      <RibbonPanel
        points={lidVerticalRibbon}
        position={[-0.346, 0.34, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        glazePoints={lidGlaze}
        hotPoints={lidHotGlint}
        lowPoints={lidLowReflection}
      />

      <RibbonPanel
        points={topForwardRibbon}
        position={[0, 0.428, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        glazePoints={verticalGlaze}
        hotPoints={verticalHotGlint}
        lowPoints={verticalLowReflection}
      />
      <RibbonPanel
        points={topSideRibbon}
        position={[0, 0.433, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        glazePoints={wideGlaze}
        hotPoints={wideHotGlint}
        lowPoints={wideLowReflection}
      />
      <RibbonPatch points={topForwardFold} position={[0, 0.436, 0]} rotation={[-Math.PI / 2, 0, 0]} tone="warm" />
      <RibbonPatch points={topBackFold} position={[0, 0.436, 0]} rotation={[-Math.PI / 2, 0, 0]} tone="warm" />
      <RibbonPatch points={topLeftFold} position={[0, 0.439, 0]} rotation={[-Math.PI / 2, 0, 0]} tone="warm" />
      <RibbonPatch points={topRightFold} position={[0, 0.439, 0]} rotation={[-Math.PI / 2, 0, 0]} tone="warm" />

      <RibbonCrease position={[0, 0.264, 0.309]} scale={[0.096, 0.008, 0.006]} />
      <RibbonCrease position={[0, 0.264, -0.309]} scale={[0.096, 0.008, 0.006]} />
      <RibbonCrease position={[0.349, 0.264, 0]} rotation={[0, Math.PI / 2, 0]} scale={[0.096, 0.008, 0.006]} />
      <RibbonCrease position={[-0.349, 0.264, 0]} rotation={[0, Math.PI / 2, 0]} scale={[0.096, 0.008, 0.006]} />

      <RibbonCrease position={[0, -0.266, 0.268]} scale={[0.09, 0.005, 0.005]} />
      <RibbonCrease position={[0, -0.266, -0.268]} scale={[0.09, 0.005, 0.005]} />
      <RibbonCrease position={[0.294, -0.266, 0]} rotation={[0, Math.PI / 2, 0]} scale={[0.09, 0.005, 0.005]} />
      <RibbonCrease position={[-0.294, -0.266, 0]} rotation={[0, Math.PI / 2, 0]} scale={[0.09, 0.005, 0.005]} />

      <RibbonPatch points={naturalCreaseMark} position={[0.022, 0.12, 0.282]} rotation={[0, 0, 0.68]} tone="warm" />
      <RibbonPatch points={naturalCreaseMark} position={[-0.014, -0.135, 0.282]} rotation={[0, 0, -0.55]} tone="warm" />
      <RibbonPatch points={naturalCreaseMark} position={[0.312, 0.1, 0.022]} rotation={[0, Math.PI / 2, 0.64]} tone="warm" />
      <RibbonPatch points={naturalCreaseMark} position={[0.154, 0.442, 0.018]} rotation={[-Math.PI / 2, 0, 0.46]} tone="warm" />
      <RibbonPatch points={naturalCreaseMark} position={[-0.03, 0.442, -0.168]} rotation={[-Math.PI / 2, 0, 0.38]} tone="warm" />
      <RibbonPatch points={softFrontSheen} position={[0.012, 0.02, 0.284]} rotation={[0, 0, -0.03]} tone="highlight" />
      <RibbonPatch points={softTopSheen} position={[0.148, 0.445, 0.018]} rotation={[-Math.PI / 2, 0, -0.06]} tone="highlight" />
      <RibbonPatch points={softTopSheen} position={[-0.146, 0.445, 0.012]} rotation={[-Math.PI / 2, 0, 0.1]} tone="highlight" />
    </group>
  )
}
