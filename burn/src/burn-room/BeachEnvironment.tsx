'use client'

import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import React, { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { getToonRampTexture } from '../shaders/toonRamp'

// ── Layout ────────────────────────────────────────────────────────────────
// The museum room's plinth is centered near (0.5, -0.51, 0.09) with its
// underside at y ≈ -0.63. The beach island sits just beneath it so the room
// reads as a hut built on the sand instead of floating in a void.
const CENTER_X = 0.5
const CENTER_Z = 0.1
const SAND_TOP_Y = -0.635
const SAND_RX = 15
const SAND_RZ = 12
const OCEAN_Y = -0.92

const SERPENT_SPOTS: readonly (readonly [number, number])[] = [
  [-13.5, -6],
  [14.4, -7.5],
  [-12.6, 6.8],
]

const smoothstep01 = (x: number) => {
  const c = Math.min(1, Math.max(0, x))
  return c * c * (3 - 2 * c)
}

// ── Materials ─────────────────────────────────────────────────────────────
function sandMaterial() {
  return <meshToonMaterial color="#ecd39f" gradientMap={getToonRampTexture()} />
}

function wetSandMaterial() {
  return <meshBasicMaterial color="#d9bd85" transparent opacity={0.55} depthWrite={false} />
}

function oceanMaterial() {
  return <meshToonMaterial color="#4aa3b8" gradientMap={getToonRampTexture()} />
}

function foamMaterial({ opacity = 0.5 }: { opacity?: number } = {}) {
  return <meshBasicMaterial color="#f6fbf4" transparent opacity={opacity} depthWrite={false} />
}

function grassMaterial() {
  return <meshToonMaterial color="#6faa66" gradientMap={getToonRampTexture()} />
}

function darkGrassMaterial() {
  return <meshToonMaterial color="#5c9c68" gradientMap={getToonRampTexture()} />
}

function treeLeafMaterial() {
  return <meshToonMaterial color="#3c7a52" gradientMap={getToonRampTexture()} />
}

function palmLeafMaterial() {
  return <meshToonMaterial color="#4f9e63" gradientMap={getToonRampTexture()} />
}

function trunkMaterial() {
  return <meshToonMaterial color="#7c4f30" gradientMap={getToonRampTexture()} />
}

function fenceWoodMaterial() {
  return <meshToonMaterial color="#8a5a3a" gradientMap={getToonRampTexture()} />
}

function strawMaterial() {
  return <meshToonMaterial color="#e3bd7a" gradientMap={getToonRampTexture()} />
}

function strawFringeMaterial() {
  return <meshToonMaterial color="#c9a05e" gradientMap={getToonRampTexture()} />
}

function bedCanvasMaterial() {
  return <meshToonMaterial color="#efe6d2" gradientMap={getToonRampTexture()} />
}

function bedStripeMaterial() {
  return <meshBasicMaterial color="#2f7168" />
}

function stoneMaterial() {
  return <meshToonMaterial color="#9a958b" gradientMap={getToonRampTexture()} />
}

function shellCreamMaterial() {
  return <meshToonMaterial color="#f3e7d4" gradientMap={getToonRampTexture()} />
}

function shellPinkMaterial() {
  return <meshToonMaterial color="#eec2ab" gradientMap={getToonRampTexture()} />
}

function starfishMaterial() {
  return <meshToonMaterial color="#e8875f" gradientMap={getToonRampTexture()} />
}

function starfishDeepMaterial() {
  return <meshToonMaterial color="#d9694a" gradientMap={getToonRampTexture()} />
}

function crabShellMaterial() {
  return <meshToonMaterial color="#e0563a" gradientMap={getToonRampTexture()} />
}

function inkMaterial() {
  return <meshBasicMaterial color="#17121f" />
}

function serpentBodyMaterial() {
  return <meshToonMaterial color="#d9484f" gradientMap={getToonRampTexture()} />
}

function serpentFinMaterial() {
  return <meshToonMaterial color="#f4e0c8" gradientMap={getToonRampTexture()} side={THREE.DoubleSide} />
}

function cloudMaterial() {
  return <meshBasicMaterial color="#fdfbf2" transparent opacity={0.92} fog={false} />
}

function deckWoodMaterial() {
  return <meshToonMaterial color="#a06b3e" gradientMap={getToonRampTexture()} />
}

function deckLineMaterial() {
  return <meshBasicMaterial color="#5b3323" transparent opacity={0.4} />
}

// ── Sky ───────────────────────────────────────────────────────────────────
function SkyDome() {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 256
    const context = canvas.getContext('2d')
    if (context) {
      const gradient = context.createLinearGradient(0, 0, 0, 256)
      gradient.addColorStop(0, '#58b6d6')
      gradient.addColorStop(0.55, '#a9e2ec')
      gradient.addColorStop(1, '#d9efdf')
      context.fillStyle = gradient
      context.fillRect(0, 0, 2, 256)
    }
    const canvasTexture = new THREE.CanvasTexture(canvas)
    canvasTexture.colorSpace = THREE.SRGBColorSpace
    return canvasTexture
  }, [])

  return (
    <mesh position={[CENTER_X, 0, CENTER_Z]}>
      <sphereGeometry args={[110, 24, 16]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} fog={false} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

function SunAndClouds() {
  const cloudRefs = useRef<(THREE.Group | null)[]>([])
  const cloudSeeds = useMemo(
    () => [
      { x: -26, y: 13.5, z: -58, scale: 1.5, speed: 0.32 },
      { x: 6, y: 16.5, z: -62, scale: 1.1, speed: 0.22 },
      { x: 26, y: 11.5, z: -56, scale: 1.3, speed: 0.27 },
      { x: -8, y: 19, z: -66, scale: 0.85, speed: 0.18 },
    ],
    [],
  )

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    cloudSeeds.forEach((seed, index) => {
      const node = cloudRefs.current[index]
      if (!node) return
      node.position.x = ((seed.x + t * seed.speed + 55) % 110) - 55
      node.position.y = seed.y + Math.sin(t * 0.3 + index * 2.1) * 0.35
    })
  })

  return (
    <group>
      <mesh position={[-19, 17.5, -60]}>
        <circleGeometry args={[3.4, 30]} />
        <meshBasicMaterial color="#ffe9a8" fog={false} toneMapped={false} />
      </mesh>
      <mesh position={[-19, 17.5, -60.2]}>
        <circleGeometry args={[4.6, 30]} />
        <meshBasicMaterial color="#fff4cf" transparent opacity={0.35} fog={false} toneMapped={false} />
      </mesh>
      {cloudSeeds.map((seed, index) => (
        <group
          key={`beach-cloud-${index}`}
          ref={(node) => {
            cloudRefs.current[index] = node
          }}
          position={[seed.x, seed.y, seed.z]}
          scale={seed.scale}
        >
          <mesh scale={[3.2, 1.05, 1]}>
            <sphereGeometry args={[1, 12, 10]} />
            {cloudMaterial()}
          </mesh>
          <mesh position={[-1.7, -0.12, 0.2]} scale={[1.7, 0.8, 0.9]}>
            <sphereGeometry args={[1, 12, 10]} />
            {cloudMaterial()}
          </mesh>
          <mesh position={[1.8, -0.05, -0.1]} scale={[1.9, 0.85, 0.9]}>
            <sphereGeometry args={[1, 12, 10]} />
            {cloudMaterial()}
          </mesh>
        </group>
      ))}
    </group>
  )
}

// ── Water ─────────────────────────────────────────────────────────────────
function OceanAndTide() {
  const tideRefs = useRef<(THREE.Mesh | null)[]>([])
  const shoreFoam = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    for (let index = 0; index < 3; index += 1) {
      const ring = tideRefs.current[index]
      if (!ring) continue
      const u = (t * 0.115 + index / 3) % 1
      const factor = 1.5 - u * 0.46
      ring.scale.set(SAND_RX * factor, SAND_RZ * factor, 1)
      const material = ring.material as THREE.MeshBasicMaterial
      material.opacity = Math.sin(u * Math.PI) * 0.32
    }
    if (shoreFoam.current) {
      const pulse = 1.015 + Math.sin(t * 0.9) * 0.012
      shoreFoam.current.scale.set(SAND_RX * pulse, SAND_RZ * pulse, 1)
    }
  })

  return (
    <group position={[CENTER_X, 0, CENTER_Z]}>
      <mesh position={[0, OCEAN_Y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[280, 240]} />
        {oceanMaterial()}
      </mesh>
      {/* Rolling tide rings easing toward the shore */}
      {[0, 1, 2].map((index) => (
        <mesh
          key={`tide-ring-${index}`}
          ref={(node) => {
            tideRefs.current[index] = node
          }}
          position={[0, OCEAN_Y + 0.014 + index * 0.002, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.982, 1, 64]} />
          {foamMaterial({ opacity: 0.3 })}
        </mesh>
      ))}
      {/* Standing foam collar where water meets the sand */}
      <mesh ref={shoreFoam} position={[0, OCEAN_Y + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[SAND_RX * 1.015, SAND_RZ * 1.015, 1]}>
        <ringGeometry args={[0.975, 1, 64]} />
        {foamMaterial({ opacity: 0.55 })}
      </mesh>
      <mesh position={[0, OCEAN_Y + 0.021, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[SAND_RX * 1.05, SAND_RZ * 1.05, 1]}>
        <ringGeometry args={[0.988, 1, 64]} />
        {foamMaterial({ opacity: 0.2 })}
      </mesh>
    </group>
  )
}

function SandIsland() {
  return (
    <group position={[CENTER_X, 0, CENTER_Z]}>
      <mesh position={[0, SAND_TOP_Y - 0.15, 0]} scale={[SAND_RX, 1, SAND_RZ]}>
        <cylinderGeometry args={[1, 1.05, 0.3, 42]} />
        {sandMaterial()}
      </mesh>
      {/* Damp sand ring near the waterline */}
      <mesh position={[0, SAND_TOP_Y + 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[SAND_RX, SAND_RZ, 1]}>
        <ringGeometry args={[0.9, 1, 48]} />
        {wetSandMaterial()}
      </mesh>
    </group>
  )
}

// ── Land: island, hills, fence ────────────────────────────────────────────
function ForestIsland() {
  const trees = useMemo(
    () => [
      { x: -2.6, z: 0.6, h: 2.2, r: 1.05 },
      { x: -0.4, z: -0.8, h: 2.9, r: 1.3 },
      { x: 1.9, z: 0.3, h: 2.4, r: 1.1 },
      { x: 3.9, z: -0.5, h: 1.9, r: 0.9 },
      { x: -4.4, z: -0.4, h: 1.7, r: 0.85 },
      { x: 0.9, z: 1.4, h: 2.0, r: 0.95 },
    ],
    [],
  )
  return (
    <group position={[-14, 0, -42]}>
      <mesh position={[0, OCEAN_Y - 0.4, 0]} scale={[10.5, 1, 7]}>
        <cylinderGeometry args={[1, 1.08, 0.9, 26]} />
        {sandMaterial()}
      </mesh>
      <mesh position={[0, OCEAN_Y + 0.3, 0]} scale={[8.6, 2.9, 5.6]}>
        <sphereGeometry args={[1, 20, 14]} />
        {darkGrassMaterial()}
      </mesh>
      {trees.map((tree, index) => (
        <group key={`island-tree-${index}`} position={[tree.x, OCEAN_Y + 2.1, tree.z]}>
          <mesh position={[0, 0.4, 0]} scale={[0.22, 1, 0.22]}>
            <cylinderGeometry args={[1, 1.2, 1, 8]} />
            {trunkMaterial()}
          </mesh>
          <mesh position={[0, tree.h * 0.62 + 0.7, 0]}>
            <coneGeometry args={[tree.r, tree.h, 9]} />
            {treeLeafMaterial()}
          </mesh>
        </group>
      ))}
    </group>
  )
}

function GrassyHills() {
  // Fence posts march along the crest of the grass tongue that connects the
  // beach to the hills.
  const fence = useMemo(() => {
    const posts: { x: number; y: number; z: number }[] = []
    const count = 8
    for (let index = 0; index < count; index += 1) {
      const u = index / (count - 1)
      posts.push({
        x: 11.6 + u * 7.6,
        y: -0.05 + Math.sin(u * Math.PI) * 0.32 + u * 0.26,
        z: 2.0 - u * 6.6,
      })
    }
    const rails: { x: number; y: number; z: number; yaw: number; length: number; pitch: number }[] = []
    for (let index = 0; index < posts.length - 1; index += 1) {
      const a = posts[index]
      const b = posts[index + 1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dz = b.z - a.z
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
      rails.push({
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        z: (a.z + b.z) / 2,
        yaw: Math.atan2(-dz, dx),
        pitch: Math.asin(dy / length),
        length,
      })
    }
    return { posts, rails }
  }, [])

  return (
    <group>
      {/* Grass tongue leading from the sand up to the hills */}
      <mesh position={[14.6, -0.9, -2.8]} scale={[6.6, 1.05, 5.2]}>
        <sphereGeometry args={[1, 20, 14]} />
        {grassMaterial()}
      </mesh>
      {/* Rolling hills behind */}
      <mesh position={[21, OCEAN_Y, -19]} scale={[11.5, 4.1, 7.5]}>
        <sphereGeometry args={[1, 20, 14]} />
        {grassMaterial()}
      </mesh>
      <mesh position={[29, OCEAN_Y, -7]} scale={[9, 3, 6]}>
        <sphereGeometry args={[1, 20, 14]} />
        {darkGrassMaterial()}
      </mesh>
      <mesh position={[13.5, OCEAN_Y, -30]} scale={[10, 3.4, 6.5]}>
        <sphereGeometry args={[1, 20, 14]} />
        {darkGrassMaterial()}
      </mesh>
      {/* Wooden fence */}
      {fence.posts.map((post, index) => (
        <mesh key={`fence-post-${index}`} position={[post.x, post.y + 0.26, post.z]} scale={[0.09, 0.56, 0.09]}>
          <boxGeometry args={[1, 1, 1]} />
          {fenceWoodMaterial()}
        </mesh>
      ))}
      {fence.rails.map((rail, index) => (
        <group key={`fence-rail-${index}`} position={[rail.x, rail.y, rail.z]} rotation={[0, rail.yaw, rail.pitch]}>
          <mesh position={[0, 0.38, 0]} scale={[rail.length + 0.12, 0.055, 0.05]}>
            <boxGeometry args={[1, 1, 1]} />
            {fenceWoodMaterial()}
          </mesh>
          <mesh position={[0, 0.16, 0]} scale={[rail.length + 0.12, 0.055, 0.05]}>
            <boxGeometry args={[1, 1, 1]} />
            {fenceWoodMaterial()}
          </mesh>
        </group>
      ))}
    </group>
  )
}

// ── Beach props ───────────────────────────────────────────────────────────
function PalmTree({ position, scale = 1, lean = 0.14, phase = 0 }: {
  position: readonly [number, number, number]
  scale?: number
  lean?: number
  phase?: number
}) {
  const crown = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!crown.current) return
    crown.current.rotation.z = Math.sin(clock.elapsedTime * 0.8 + phase) * 0.035
  })
  const fronds = useMemo(() => [0, 1, 2, 3, 4, 5, 6].map((index) => ({
    yaw: (index / 7) * Math.PI * 2,
    droop: 0.42 + (index % 3) * 0.12,
  })), [])

  return (
    <group position={position as [number, number, number]} scale={scale} rotation={[0, 0, lean]}>
      {[0, 1, 2, 3].map((index) => (
        <mesh
          key={`palm-trunk-${index}`}
          position={[index * 0.09, 0.3 + index * 0.52, 0]}
          rotation={[0, 0, -0.06 * index]}
          scale={[1, 1, 1]}
        >
          <cylinderGeometry args={[0.085 - index * 0.008, 0.105 - index * 0.008, 0.6, 8]} />
          {trunkMaterial()}
        </mesh>
      ))}
      <group ref={crown} position={[0.32, 2.42, 0]}>
        {fronds.map((frond, index) => (
          <group key={`palm-frond-${index}`} rotation={[0, frond.yaw, 0]}>
            <mesh position={[0.52, 0.06, 0]} rotation={[0, 0, -frond.droop]} scale={[0.62, 0.05, 0.17]}>
              <sphereGeometry args={[1, 10, 8]} />
              {palmLeafMaterial()}
            </mesh>
          </group>
        ))}
        <mesh position={[0.1, -0.08, 0.08]} scale={0.075}>
          <sphereGeometry args={[1, 10, 8]} />
          {trunkMaterial()}
        </mesh>
        <mesh position={[-0.06, -0.1, -0.06]} scale={0.065}>
          <sphereGeometry args={[1, 10, 8]} />
          {trunkMaterial()}
        </mesh>
      </group>
    </group>
  )
}

function StrawUmbrella({ position, yaw = 0 }: { position: readonly [number, number, number]; yaw?: number }) {
  return (
    <group position={position as [number, number, number]} rotation={[0, yaw, 0.1]}>
      <mesh position={[0, 0.95, 0]}>
        <cylinderGeometry args={[0.045, 0.055, 1.9, 8]} />
        {trunkMaterial()}
      </mesh>
      <mesh position={[0, 1.86, 0]}>
        <coneGeometry args={[1.18, 0.52, 12]} />
        {strawMaterial()}
      </mesh>
      <mesh position={[0, 1.62, 0]}>
        <coneGeometry args={[1.2, 0.13, 12]} />
        {strawFringeMaterial()}
      </mesh>
      <mesh position={[0, 2.16, 0]} scale={0.07}>
        <sphereGeometry args={[1, 10, 8]} />
        {fenceWoodMaterial()}
      </mesh>
    </group>
  )
}

function BeachBed({ position, yaw = 0 }: { position: readonly [number, number, number]; yaw?: number }) {
  return (
    <group position={position as [number, number, number]} rotation={[0, yaw, 0]}>
      {[[-0.62, -0.24], [0.62, -0.24], [-0.62, 0.24], [0.62, 0.24]].map(([x, z], index) => (
        <mesh key={`bed-leg-${index}`} position={[x, 0.09, z]} scale={[0.07, 0.18, 0.07]}>
          <boxGeometry args={[1, 1, 1]} />
          {fenceWoodMaterial()}
        </mesh>
      ))}
      <RoundedBox args={[1.55, 0.1, 0.62]} radius={0.035} smoothness={3} position={[0, 0.22, 0]}>
        {bedCanvasMaterial()}
      </RoundedBox>
      {[-0.32, 0.08, 0.48].map((x, index) => (
        <mesh key={`bed-stripe-${index}`} position={[x, 0.276, 0]} scale={[0.09, 0.012, 0.58]}>
          <boxGeometry args={[1, 1, 1]} />
          {bedStripeMaterial()}
        </mesh>
      ))}
      <RoundedBox args={[0.52, 0.09, 0.6]} radius={0.03} smoothness={3} position={[-0.72, 0.4, 0]} rotation={[0, 0, 0.62]}>
        {bedCanvasMaterial()}
      </RoundedBox>
      <RoundedBox args={[0.24, 0.09, 0.4]} radius={0.035} smoothness={3} position={[-0.7, 0.42, 0]} rotation={[0, 0, 0.62]}>
        {strawMaterial()}
      </RoundedBox>
    </group>
  )
}

function Campfire({ position }: { position: readonly [number, number, number] }) {
  const flameRefs = useRef<(THREE.Mesh | null)[]>([])
  const smokeRefs = useRef<(THREE.Mesh | null)[]>([])
  const glow = useRef<THREE.PointLight>(null)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    flameRefs.current.forEach((flame, index) => {
      if (!flame) return
      const flicker = Math.sin(t * (8.4 + index * 1.7) + index * 2.4)
      flame.scale.set(1 + flicker * 0.08, 1 + flicker * 0.16, 1 + flicker * 0.08)
      flame.rotation.y = t * (0.7 + index * 0.3)
    })
    smokeRefs.current.forEach((puff, index) => {
      if (!puff) return
      const u = (t * 0.24 + index * 0.5) % 1
      puff.position.y = 0.55 + u * 1.3
      puff.position.x = Math.sin(t * 0.8 + index * 3) * 0.08 + u * 0.16
      puff.scale.setScalar(0.1 + u * 0.24)
      const material = puff.material as THREE.MeshBasicMaterial
      material.opacity = Math.sin(u * Math.PI) * 0.16
    })
    if (glow.current) glow.current.intensity = 0.24 + Math.sin(t * 9.2) * 0.05
  })

  return (
    <group position={position as [number, number, number]}>
      {[0, 1, 2, 3, 4, 5, 6].map((index) => {
        const angle = (index / 7) * Math.PI * 2
        return (
          <mesh key={`fire-stone-${index}`} position={[Math.cos(angle) * 0.52, 0.05, Math.sin(angle) * 0.52]} scale={[0.13, 0.09, 0.11]}>
            <sphereGeometry args={[1, 8, 6]} />
            {stoneMaterial()}
          </mesh>
        )
      })}
      {[0, 1, 2].map((index) => (
        <mesh
          key={`fire-log-${index}`}
          position={[Math.cos(index * 2.1) * 0.08, 0.1, Math.sin(index * 2.1) * 0.08]}
          rotation={[0.22, index * 2.1, 1.35]}
        >
          <cylinderGeometry args={[0.055, 0.065, 0.72, 7]} />
          {trunkMaterial()}
        </mesh>
      ))}
      <mesh
        ref={(node) => {
          flameRefs.current[0] = node
        }}
        position={[0, 0.36, 0]}
      >
        <coneGeometry args={[0.2, 0.44, 7]} />
        <meshBasicMaterial color="#ff8f2f" toneMapped={false} />
      </mesh>
      <mesh
        ref={(node) => {
          flameRefs.current[1] = node
        }}
        position={[0.02, 0.4, 0.01]}
      >
        <coneGeometry args={[0.125, 0.3, 7]} />
        <meshBasicMaterial color="#ffc148" toneMapped={false} />
      </mesh>
      <mesh
        ref={(node) => {
          flameRefs.current[2] = node
        }}
        position={[-0.01, 0.42, -0.01]}
      >
        <coneGeometry args={[0.06, 0.17, 6]} />
        <meshBasicMaterial color="#fff3c4" toneMapped={false} />
      </mesh>
      {[0, 1].map((index) => (
        <mesh
          key={`fire-smoke-${index}`}
          ref={(node) => {
            smokeRefs.current[index] = node
          }}
          position={[0, 0.6, 0]}
        >
          <sphereGeometry args={[1, 8, 6]} />
          <meshBasicMaterial color="#c8c2bb" transparent opacity={0.14} depthWrite={false} />
        </mesh>
      ))}
      <pointLight ref={glow} position={[0, 0.5, 0]} intensity={0.24} distance={3.2} decay={2} color="#ff9a3d" />
    </group>
  )
}

function ShellsAndStarfish() {
  const shells = useMemo(
    () => [
      { x: -4.2, z: 6.4, yaw: 0.6, pink: false },
      { x: -1.8, z: 7.8, yaw: 2.4, pink: true },
      { x: 2.6, z: 6.9, yaw: 1.1, pink: false },
      { x: 5.4, z: 5.2, yaw: 3.6, pink: true },
      { x: 8.2, z: 4.4, yaw: 0.2, pink: false },
      { x: -7.6, z: 1.6, yaw: 1.9, pink: true },
      { x: -9.8, z: -1.8, yaw: 4.4, pink: false },
      { x: 10.6, z: -2.4, yaw: 2.9, pink: true },
      { x: 3.9, z: 8.6, yaw: 5.1, pink: false },
    ],
    [],
  )
  const starfish = useMemo(
    () => [
      { x: -3.1, z: 8.9, yaw: 0.8, deep: false },
      { x: 6.8, z: 7.1, yaw: 2.2, deep: true },
      { x: -10.9, z: 3.4, yaw: 4.1, deep: false },
      { x: 11.8, z: 1.3, yaw: 1.4, deep: true },
    ],
    [],
  )

  return (
    <group position={[CENTER_X, 0, CENTER_Z]}>
      {shells.map((shell, index) => (
        <mesh key={`beach-shell-${index}`} position={[shell.x, SAND_TOP_Y + 0.035, shell.z]} rotation={[0, shell.yaw, 0]}>
          <coneGeometry args={[0.095, 0.075, 8]} />
          {shell.pink ? shellPinkMaterial() : shellCreamMaterial()}
        </mesh>
      ))}
      {starfish.map((star, index) => (
        <group key={`beach-star-${index}`} position={[star.x, SAND_TOP_Y + 0.022, star.z]} rotation={[0, star.yaw, 0]}>
          {[0, 1, 2, 3, 4].map((arm) => (
            <mesh key={`star-arm-${arm}`} rotation={[0, (arm / 5) * Math.PI * 2, 0]} position={[0, 0, 0]}>
              <boxGeometry args={[0.3, 0.045, 0.075]} />
              {star.deep ? starfishDeepMaterial() : starfishMaterial()}
            </mesh>
          ))}
          <mesh position={[0, 0.02, 0]} scale={[0.07, 0.035, 0.07]}>
            <sphereGeometry args={[1, 8, 6]} />
            {star.deep ? starfishDeepMaterial() : starfishMaterial()}
          </mesh>
        </group>
      ))}
    </group>
  )
}

function Crab({ center, rx, rz, speed, phase, scale, }: {
  center: readonly [number, number]
  rx: number
  rz: number
  speed: number
  phase: number
  scale: number
}) {
  const root = useRef<THREE.Group>(null)
  const angle = useRef(phase)

  useFrame(({ clock }, dt) => {
    const node = root.current
    if (!node) return
    const t = clock.elapsedTime
    // Scuttle in bursts: crabs pause, then skitter.
    const gate = Math.sin(t * 0.7 + phase * 3.1)
    const moving = gate > -0.2
    if (moving) angle.current += dt * speed
    const a = angle.current
    const x = center[0] + Math.cos(a) * rx
    const z = center[1] + Math.sin(a) * rz
    node.position.set(x, SAND_TOP_Y + 0.075 * scale + (moving ? Math.abs(Math.sin(t * 11 + phase)) * 0.02 : 0), z)
    // Crabs walk sideways: face perpendicular to the direction of travel.
    const heading = Math.atan2(-Math.sin(a) * rz, -Math.cos(a) * rx) + Math.PI
    node.rotation.y = -heading
    node.rotation.z = moving ? Math.sin(t * 11 + phase) * 0.05 : 0
  })

  return (
    <group ref={root} scale={scale}>
      <mesh scale={[0.17, 0.11, 0.13]}>
        <sphereGeometry args={[1, 12, 9]} />
        {crabShellMaterial()}
      </mesh>
      {/* Eye stalks */}
      {[-0.055, 0.055].map((x, index) => (
        <group key={`crab-eye-${index}`} position={[x, 0.1, 0.09]}>
          <mesh position={[0, 0.015, 0]} scale={[0.012, 0.05, 0.012]}>
            <cylinderGeometry args={[1, 1, 1, 6]} />
            {crabShellMaterial()}
          </mesh>
          <mesh position={[0, 0.055, 0]} scale={0.024}>
            <sphereGeometry args={[1, 8, 6]} />
            {inkMaterial()}
          </mesh>
        </group>
      ))}
      {/* Claws */}
      {[-0.16, 0.16].map((x, index) => (
        <mesh key={`crab-claw-${index}`} position={[x, -0.01, 0.08]} rotation={[0, index === 0 ? 0.5 : -0.5, 0]} scale={[0.07, 0.05, 0.055]}>
          <sphereGeometry args={[1, 8, 6]} />
          {crabShellMaterial()}
        </mesh>
      ))}
      {/* Legs */}
      {[-1, 1].map((side) =>
        [0, 1, 2].map((leg) => (
          <mesh
            key={`crab-leg-${side}-${leg}`}
            position={[side * 0.15, -0.045, -0.05 + leg * 0.05]}
            rotation={[0, side * (0.45 - leg * 0.3), side * 0.55]}
            scale={[0.11, 0.016, 0.016]}
          >
            <boxGeometry args={[1, 1, 1]} />
            {crabShellMaterial()}
          </mesh>
        )),
      )}
    </group>
  )
}

// ── The rare shiny visitor ────────────────────────────────────────────────
function ShinySeaSerpent() {
  const tail = useRef<THREE.Group>(null)
  const splashA = useRef<THREE.Mesh>(null)
  const splashB = useRef<THREE.Mesh>(null)
  const sparkle = useRef<THREE.Mesh>(null)
  // First appearance 45–120s after load, then every 2.5–6 minutes.
  const state = useRef({ nextAt: 45 + Math.random() * 75, start: -1, spot: 0 })

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const s = state.current
    const node = tail.current
    if (!node) return

    if (s.start < 0) {
      node.visible = false
      if (splashA.current) splashA.current.visible = false
      if (splashB.current) splashB.current.visible = false
      if (sparkle.current) sparkle.current.visible = false
      if (t >= s.nextAt) {
        s.start = t
        s.spot = Math.floor(Math.random() * SERPENT_SPOTS.length)
      }
      return
    }

    const u = (t - s.start) / 5.4
    if (u >= 1) {
      s.start = -1
      s.nextAt = t + 150 + Math.random() * 210
      return
    }

    const [sx, sz] = SERPENT_SPOTS[s.spot]
    const rise = smoothstep01(u / 0.22)
    const dive = smoothstep01((u - 0.7) / 0.3)
    node.visible = true
    node.position.set(sx, OCEAN_Y - 2.7 + rise * 3.4 - dive * 3.8, sz)
    node.rotation.z = Math.sin(u * 13) * 0.22 * (1 - dive)
    node.rotation.y = Math.sin(u * 3.1) * 0.35

    const splashActive = (mesh: THREE.Mesh | null, k: number) => {
      if (!mesh) return
      if (k <= 0 || k >= 1) {
        mesh.visible = false
        return
      }
      mesh.visible = true
      mesh.position.set(sx, OCEAN_Y + 0.03, sz)
      const spread = 0.9 + k * 2.8
      mesh.scale.set(spread, spread, 1)
      const material = mesh.material as THREE.MeshBasicMaterial
      material.opacity = (1 - k) * 0.55
    }
    splashActive(splashA.current, u / 0.28)
    splashActive(splashB.current, (u - 0.68) / 0.32)

    if (sparkle.current) {
      const mid = u > 0.2 && u < 0.72
      sparkle.current.visible = mid && Math.sin(t * 9) > 0.3
      sparkle.current.position.set(sx + 0.4, OCEAN_Y + 3.1 - dive * 3.4, sz + 0.3)
      const material = sparkle.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.85
    }
  })

  const segments = useMemo(
    () => [
      { radius: 0.44, y: 0.25, bend: 0 },
      { radius: 0.36, y: 0.75, bend: 0.18 },
      { radius: 0.28, y: 1.24, bend: 0.4 },
      { radius: 0.21, y: 1.7, bend: 0.68 },
      { radius: 0.15, y: 2.12, bend: 1.0 },
    ],
    [],
  )

  return (
    <group>
      <group ref={tail} visible={false}>
        {segments.map((segment, index) => (
          <mesh
            key={`serpent-seg-${index}`}
            position={[Math.sin(segment.bend) * 0.55, segment.y, 0]}
            rotation={[0, 0, -segment.bend * 0.55]}
          >
            <cylinderGeometry args={[segment.radius * 0.82, segment.radius, 0.56, 10]} />
            {serpentBodyMaterial()}
          </mesh>
        ))}
        {/* Cream tail fin fan */}
        {[-0.55, 0, 0.55].map((tilt, index) => (
          <mesh
            key={`serpent-fin-${index}`}
            position={[0.62 + Math.abs(tilt) * 0.08, 2.42, tilt * 0.22]}
            rotation={[tilt * 0.7, 0, -0.9 + tilt * 0.22]}
            scale={[0.34, 0.62, 0.05]}
          >
            <sphereGeometry args={[1, 10, 8]} />
            {serpentFinMaterial()}
          </mesh>
        ))}
      </group>
      <mesh ref={splashA} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.72, 1, 26]} />
        {foamMaterial({ opacity: 0.55 })}
      </mesh>
      <mesh ref={splashB} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.72, 1, 26]} />
        {foamMaterial({ opacity: 0.55 })}
      </mesh>
      <mesh ref={sparkle} visible={false}>
        <circleGeometry args={[0.16, 4]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.85} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

// ── Boardwalk apron in front of the hut ───────────────────────────────────
function FrontDeck() {
  return (
    <group position={[CENTER_X, 0, 0]}>
      <mesh position={[0, -0.45, 4.14]} scale={[7.4, 0.09, 1.06]}>
        <boxGeometry args={[1, 1, 1]} />
        {deckWoodMaterial()}
      </mesh>
      {[-3.1, -1.55, 0, 1.55, 3.1].map((x, index) => (
        <mesh key={`deck-line-${index}`} position={[x, -0.4, 4.14]} scale={[0.02, 0.012, 0.98]}>
          <boxGeometry args={[1, 1, 1]} />
          {deckLineMaterial()}
        </mesh>
      ))}
      <mesh position={[0, -0.55, 4.86]} scale={[3.1, 0.08, 0.5]}>
        <boxGeometry args={[1, 1, 1]} />
        {deckWoodMaterial()}
      </mesh>
      <mesh position={[0, -0.62, 5.3]} scale={[2.5, 0.07, 0.42]}>
        <boxGeometry args={[1, 1, 1]} />
        {deckWoodMaterial()}
      </mesh>
    </group>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────
export function BeachEnvironment() {
  return (
    <group>
      <SkyDome />
      <SunAndClouds />
      <OceanAndTide />
      <SandIsland />
      <ForestIsland />
      <GrassyHills />
      <FrontDeck />
      <PalmTree position={[-8.9, SAND_TOP_Y, 3.2]} scale={1.05} lean={0.16} phase={0.4} />
      <PalmTree position={[10.8, SAND_TOP_Y, 0.8]} scale={0.9} lean={-0.12} phase={2.2} />
      <StrawUmbrella position={[9.9, SAND_TOP_Y, 3.6]} yaw={-0.5} />
      <BeachBed position={[8.6, SAND_TOP_Y, 4.8]} yaw={-0.35} />
      <StrawUmbrella position={[-7.4, SAND_TOP_Y, 4.6]} yaw={0.7} />
      <BeachBed position={[-6.2, SAND_TOP_Y, 5.5]} yaw={2.6} />
      <Campfire position={[-4.2, SAND_TOP_Y, 6.9]} />
      <ShellsAndStarfish />
      <Crab center={[1.5, 7.7]} rx={2.4} rz={1.2} speed={0.5} phase={0.4} scale={1} />
      <Crab center={[-4.5, 5.4]} rx={1.8} rz={1.1} speed={0.7} phase={2.8} scale={0.8} />
      <Crab center={[7.8, 5.6]} rx={1.5} rz={0.9} speed={0.62} phase={5.1} scale={0.65} />
      <ShinySeaSerpent />
    </group>
  )
}
