'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { damp, seededNoise } from '../core/math'
import { PALETTE } from '../core/palettes'
import { OutlineMesh } from '../render/OutlineMesh'
import { createMouthRingMaterial, type MouthRingMaterial } from '../shaders/mouthRingMaterial'
import { getOutlineMaterial } from '../shaders/outlineMaterial'
import { getToonRampTexture } from '../shaders/toonRamp'
import { computeSuctionForce } from '../systems/suction/SuctionField'

export type VacuumRuntime = {
  position: THREE.Vector3
  velocity: THREE.Vector3
  target: THREE.Vector3
  mouth: THREE.Vector3
  forward: THREE.Vector3
  yaw: number
  pulse: number
  recoil: number
  flash: number
  bagPuff: number
  gulpFlow: number
  gulpAge: number
  hoseLift: number
  active: boolean
  pointerDown: boolean
  swallowCycles: number
  fps: number
  frameMs: number
  maxFrameMs: number
}

type Mote = {
  position: THREE.Vector3
  velocity: THREE.Vector3
  home: THREE.Vector3
  seed: number
  size: number
  swirl: number
  palette: number
  warmth: number
}

export type NozzleEntryScratch = {
  root: THREE.Object3D
  anchor: THREE.Vector3
  before: THREE.Vector3
  tangent: THREE.Vector3
  worldTangent: THREE.Vector3
}

type BagPulseMaterial = THREE.ShaderMaterial & {
  uniforms: {
    uTime: { value: number }
    uPulse: { value: number }
    uFill: { value: number }
    uSuctionActive: { value: number }
    uBase: { value: THREE.Color }
    uWaveColor0: { value: THREE.Color }
    uWaveColor1: { value: THREE.Color }
    uWaveColor2: { value: THREE.Color }
    uWaveColor3: { value: THREE.Color }
    uWaveAge0: { value: number }
    uWaveAge1: { value: number }
    uWaveAge2: { value: number }
    uWaveAge3: { value: number }
    uBloomCenter0: { value: THREE.Vector2 }
    uBloomCenter1: { value: THREE.Vector2 }
    uBloomCenter2: { value: THREE.Vector2 }
    uBloomCenter3: { value: THREE.Vector2 }
  }
}

declare global {
  interface Window {
    __VACUUM_LAB_STATS__?: {
      mode: string
      vacuumOnly: boolean
      slimePrototypeLocked: boolean
      slimePrototypeRoute: string
      gameplayPressure: boolean
      suctionModel: string
      visualModel: string
      vacuumMounted: boolean
      testMoteCount: number
      dpr: number
      techniques: string[]
      perf?: {
        fps: number
        frameMs: number
        maxFrameMs: number
      }
    }
  }
}

const VACUUM_DPR = 0.65
const MOTE_COUNT = 68
const ARENA_LIMIT_X = 4.8
const ARENA_LIMIT_Z = 3.1
const RIBBON_COUNT = 16
const FLOW_BEAD_COUNT = 12
const COMIC_FLECK_COUNT = 12
const COMIC_SLASH_COUNT = 7
const COMIC_DOT_COUNT = 5
const GULP_FLOW_RING_COUNT = 4
const TRUNK_BAND_COUNT = 12
const TRUNK_CURVE_POINT_COUNT = 16
const TRUNK_TUBE_SEGMENTS = 56
const TRUNK_RADIAL_SEGMENTS = 10
const tempObject = new THREE.Object3D()
const rightVector = new THREE.Vector3()
const sourceVector = new THREE.Vector3()
const deltaVector = new THREE.Vector3()
const mouthVector = new THREE.Vector3()
const trunkAxis = new THREE.Vector3(0, 0, 1)
const trunkMouthAxis = new THREE.Vector3(0, 0, -1)
const BAG_WAVE_PALETTE = ['#f5a3cf', '#a8d9ff', '#fff19a', '#b9efc8', '#c7b7ff', '#ffbc8a', '#8fe9df', '#f0a7ff']
const FLOW_BEAD_PALETTE = ['#fff2a3', '#6bd8ff', '#f47bdc', '#aaf6c8']
const BAG_PUFF_CLOUD_SPECS = [
  [-0.38, 0.96, 0.92, 0.16, '#fff0ba', 0.2],
  [0.32, 0.84, 0.98, 0.13, '#a8eaff', 1.1],
  [0.05, 1.1, 0.82, 0.115, '#f7a8cf', 2.2],
  [-0.02, 0.58, 1.03, 0.1, '#fff8d4', 3.1],
] as const

function easeOutBack(value: number) {
  const c1 = 1.7
  const c3 = c1 + 1
  return 1 + c3 * (value - 1) ** 3 + c1 * (value - 1) ** 2
}

function makeBurstGeometry(spikes: number, innerRadius: number, outerRadius: number) {
  const shape = new THREE.Shape()
  const steps = spikes * 2
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2 - Math.PI / 2
    const wobble = 1 + Math.sin(index * 2.17) * 0.055
    const radius = (index % 2 === 0 ? outerRadius : innerRadius) * wobble
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    if (index === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
}

function createBagPulseMaterial(): BagPulseMaterial {
  return new THREE.ShaderMaterial({
    transparent: false,
    depthWrite: true,
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uFill: { value: 0 },
      uSuctionActive: { value: 0 },
      uBase: { value: new THREE.Color('#d79b76') },
      uWaveColor0: { value: new THREE.Color('#f5a3cf') },
      uWaveColor1: { value: new THREE.Color('#a8d9ff') },
      uWaveColor2: { value: new THREE.Color('#fff19a') },
      uWaveColor3: { value: new THREE.Color('#b9efc8') },
      uWaveAge0: { value: 9 },
      uWaveAge1: { value: 9 },
      uWaveAge2: { value: 9 },
      uWaveAge3: { value: 9 },
      uBloomCenter0: { value: new THREE.Vector2(-0.2, -0.12) },
      uBloomCenter1: { value: new THREE.Vector2(0.18, 0.16) },
      uBloomCenter2: { value: new THREE.Vector2(-0.04, 0.22) },
      uBloomCenter3: { value: new THREE.Vector2(0.24, -0.18) },
    },
    vertexShader: `
      varying vec3 vLocal;
      varying vec3 vNormalView;

      void main() {
        vLocal = position;
        vNormalView = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uPulse;
      uniform float uFill;
      uniform float uSuctionActive;
      uniform vec3 uBase;
      uniform vec3 uWaveColor0;
      uniform vec3 uWaveColor1;
      uniform vec3 uWaveColor2;
      uniform vec3 uWaveColor3;
      uniform float uWaveAge0;
      uniform float uWaveAge1;
      uniform float uWaveAge2;
      uniform float uWaveAge3;
      uniform vec2 uBloomCenter0;
      uniform vec2 uBloomCenter1;
      uniform vec2 uBloomCenter2;
      uniform vec2 uBloomCenter3;
      varying vec3 vLocal;
      varying vec3 vNormalView;

      vec2 rotate2(vec2 point, float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat2(c, -s, s, c) * point;
      }

      float bloomStrength(float age, vec2 flow, vec2 center, float offset) {
        float life = 3.65;
        float waveLive = step(0.0, age) * (1.0 - step(life, age));
        float progress = clamp(age / life, 0.0, 1.0);
        float arrive = smoothstep(0.0, 0.16, progress);
        float fade = 1.0 - smoothstep(0.76, 1.0, progress);
        vec2 drift = vec2(
          sin(uTime * 0.34 + offset) * 0.08 + sin(progress * 5.0 + offset * 1.3) * 0.05,
          cos(uTime * 0.29 + offset * 1.6) * 0.07 + cos(progress * 4.1 + offset) * 0.04
        );
        vec2 tide = mix(vec2(-0.18, -0.16), vec2(0.22, 0.2), smoothstep(0.05, 0.9, progress));
        vec2 origin = center + tide * 0.55 + drift * (0.45 + progress * 0.65);
        vec2 p = flow - origin;
        float twist = sin(uTime * 0.2 + offset) * 0.65 + progress * 1.1;
        p = rotate2(p, twist);
        p.x *= mix(1.45, 0.82, progress);
        p.y *= mix(0.78, 1.28, progress);
        float d = length(p);
        float edge = sin(p.x * 8.0 + p.y * 3.7 + uTime * 0.72 + offset) * 0.034;
        edge += sin(p.x * 3.2 - p.y * 7.1 - uTime * 0.48 + offset * 2.1) * 0.024;
        float spread = mix(0.06, 0.82, smoothstep(0.0, 0.86, progress));
        float core = 1.0 - smoothstep(spread * 0.14, spread * 0.68, d + edge * 0.18);
        float veil = 1.0 - smoothstep(spread * 0.68, spread + 0.46, d + edge);
        float undertow = 1.0 - smoothstep(0.24, 0.94, length(flow + center * 0.24 - drift * 0.35));
        float breathe = 0.87 + sin(progress * 6.283 + uTime * 0.42 + offset) * 0.08;
        return waveLive * arrive * fade * max(veil * breathe, max(core * 0.64, undertow * progress * 0.22));
      }

      float eventPulse(float age, float offset) {
        float life = 3.65;
        float waveLive = step(0.0, age) * (1.0 - step(life, age));
        float progress = clamp(age / life, 0.0, 1.0);
        float arrive = smoothstep(0.0, 0.18, progress);
        float fade = 1.0 - smoothstep(0.78, 1.0, progress);
        float breathe = 0.86 + sin(progress * 6.283 + uTime * 0.38 + offset) * 0.1;
        return waveLive * arrive * fade * breathe;
      }

      void main() {
        vec2 centered = vec2(vLocal.x * 0.92 + vLocal.z * 0.34, vLocal.y * 0.78 - vLocal.z * 0.18);
        float radius = length(centered);
        float inhale = uTime * (0.9 + uPulse * 0.18);
        float fillGlow = smoothstep(0.05, 0.95, uFill);
        vec2 eddyA = vec2(sin(inhale * 0.42) * 0.22, cos(inhale * 0.31) * 0.2);
        vec2 eddyB = vec2(cos(inhale * 0.36 + 1.7) * 0.24, sin(inhale * 0.48 + 0.9) * 0.18);
        float twist = sin(radius * 4.0 - inhale * 0.68) * 0.36 + fillGlow * 0.16;
        vec2 flowA = rotate2(centered - eddyA * 0.45, twist);
        vec2 flowB = rotate2(centered - eddyB, -twist * 0.78 + inhale * 0.16);
        float s0 = bloomStrength(uWaveAge0, flowA, uBloomCenter0, 0.4);
        float s1 = bloomStrength(uWaveAge1, flowB, uBloomCenter1, 1.9);
        float s2 = bloomStrength(uWaveAge2, flowA + flowB * 0.32, uBloomCenter2, 3.4);
        float s3 = bloomStrength(uWaveAge3, flowB - flowA * 0.22, uBloomCenter3, 5.1);
        float waveEnergy = s0 + s1 + s2 + s3;
        float e0 = eventPulse(uWaveAge0, 0.4);
        float e1 = eventPulse(uWaveAge1, 1.9);
        float e2 = eventPulse(uWaveAge2, 3.4);
        float e3 = eventPulse(uWaveAge3, 5.1);
        float eventEnergy = e0 + e1 + e2 + e3;
        vec3 spatialColor = (
          uWaveColor0 * s0
          + uWaveColor1 * s1
          + uWaveColor2 * s2
          + uWaveColor3 * s3
        ) / max(waveEnergy, 0.001);
        vec3 eventColor = (
          uWaveColor0 * e0
          + uWaveColor1 * e1
          + uWaveColor2 * e2
          + uWaveColor3 * e3
        ) / max(eventEnergy, 0.001);
        float bloomPresence = smoothstep(0.04, 1.45, waveEnergy);
        float eventPresence = smoothstep(0.02, 1.25, eventEnergy);
        vec3 waveColor = mix(eventColor, spatialColor, bloomPresence);
        float clothBand = smoothstep(-0.48, 0.78, sin(centered.y * 2.0 + centered.x * 1.15 - inhale * 0.46));
        float clothGrain = sin(centered.x * 11.0 + centered.y * 5.0 - inhale * 0.22) * 0.012;
        clothGrain += sin(centered.y * 13.0 - centered.x * 2.6 + inhale * 0.18) * 0.01;
        vec3 color = uBase * (0.77 + clothBand * 0.07 + clothGrain + fillGlow * 0.035);
        float cluster = smoothstep(0.92, 2.45, max(waveEnergy, eventEnergy));
        float pearl = sin(length(flowA - flowB) * 4.3 - inhale * 0.42) * 0.5 + 0.5;
        float liquidVeil = smoothstep(
          -0.82,
          0.92,
          sin(flowA.x * 2.15 + flowA.y * 1.3 - inhale * 0.32)
            + sin(flowB.x * 1.45 - flowB.y * 2.05 + inhale * 0.24) * 0.58
        );
        float lowEddy = sin(radius * 3.2 + flowB.x * 1.6 - inhale * 0.28) * 0.5 + 0.5;
        float cloud = smoothstep(
          -0.72,
          0.88,
          sin(centered.x * 2.0 - centered.y * 1.45 + inhale * 0.26)
            + sin(centered.x * 1.25 + centered.y * 2.55 - inhale * 0.18) * 0.52
        );
        vec3 pearlBlue = mix(waveColor, vec3(0.74, 0.9, 1.0), 0.46);
        vec3 pearlGold = mix(waveColor, vec3(1.0, 0.9, 0.58), 0.34);
        vec3 pearlMint = mix(waveColor, vec3(0.76, 0.98, 0.84), 0.32);
        vec3 pearlColor = mix(pearlBlue, pearlMint, lowEddy);
        vec3 aurora = mix(pearlColor, pearlGold, liquidVeil * 0.7);
        aurora = mix(aurora, waveColor, 0.38 - pearl * 0.1);
        vec3 sharedGlow = mix(aurora, mix(vec3(0.96, 0.78, 0.86), vec3(0.78, 0.94, 1.0), liquidVeil), cluster * 0.28);
        float suctionGlow = max(smoothstep(1.04, 1.58, uPulse), smoothstep(0.12, 0.95, uSuctionActive));
        vec3 suctionAura = mix(vec3(0.86, 0.72, 0.98), vec3(0.66, 0.94, 0.86), liquidVeil);
        suctionAura = mix(suctionAura, mix(vec3(0.72, 0.9, 1.0), vec3(1.0, 0.76, 0.86), cloud), 0.36);
        suctionAura = mix(suctionAura, vec3(1.0, 0.86, 0.56), pearl * 0.24);
        color = mix(color, suctionAura, suctionGlow * (0.32 + liquidVeil * 0.24));
        color = mix(color, aurora, eventPresence * (0.3 + liquidVeil * 0.3 + cluster * 0.14));
        color = mix(color, sharedGlow, max(bloomPresence, eventPresence * (0.48 + liquidVeil * 0.3)) * (0.48 + cluster * 0.36));
        float bodyTakeover = smoothstep(0.34, 1.72, waveEnergy + eventEnergy * 0.5 + fillGlow * 0.16);
        color = mix(color, mix(sharedGlow, waveColor, 0.42), bodyTakeover * cluster * 0.22);
        float rim = pow(1.0 - abs(vNormalView.z), 1.7);
        color = mix(color, vec3(0.94, 0.74, 0.55), rim * 0.18);
        color += sharedGlow * min(0.14, waveEnergy * 0.035);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  }) as BagPulseMaterial
}

function toon(color: string) {
  return <meshToonMaterial color={color} gradientMap={getToonRampTexture()} />
}

function DetailRivet({
  position,
  scale = 0.018,
  color = PALETTE.bone,
}: {
  position: [number, number, number]
  scale?: number
  color?: string
}) {
  return (
    <OutlineMesh
      position={position}
      scale={[scale, scale, scale]}
      outlineWidth={0.004}
      geometry={<sphereGeometry args={[1, 8, 6]} />}
      material={toon(color)}
    />
  )
}

function clampWorld(target: THREE.Vector3) {
  target.x = Math.max(-ARENA_LIMIT_X, Math.min(ARENA_LIMIT_X, target.x))
  target.z = Math.max(-ARENA_LIMIT_Z, Math.min(ARENA_LIMIT_Z, target.z))
  target.y = 0.62
  return target
}

function dampAngle(current: number, target: number, lambda: number, dt: number) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  return current + delta * (1 - Math.exp(-lambda * dt))
}

function smooth01(value: number) {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - clamped * 2)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function createRuntime(): VacuumRuntime {
  return {
    position: new THREE.Vector3(-0.35, 0.62, 0.15),
    velocity: new THREE.Vector3(),
    target: new THREE.Vector3(0.45, 0.62, 0.25),
    mouth: new THREE.Vector3(-0.35, 0.72, 1.33),
    forward: new THREE.Vector3(0, 0, 1),
    yaw: Math.PI,
    pulse: 0.55,
    recoil: 0,
    flash: 0,
    bagPuff: 0,
    gulpFlow: 0,
    gulpAge: 9,
    hoseLift: 0,
    active: false,
    pointerDown: false,
    swallowCycles: 0,
    fps: 60,
    frameMs: 16.7,
    maxFrameMs: 16.7,
  }
}

function spawnMote(mote: Mote, runtime: VacuumRuntime, t: number) {
  const forward = runtime.forward
  rightVector.set(-forward.z, 0, forward.x).normalize()
  const lane = seededNoise(mote.seed + t * 0.17) * 2 - 1
  const depth = 2.2 + seededNoise(mote.seed + 5.1 + t * 0.07) * 3.2
  const side = lane * (1.2 + seededNoise(mote.seed + 8.3) * 2.8)
  const lift = 0.18 + seededNoise(mote.seed + 9.7) * 0.52

  mote.home.copy(runtime.mouth)
    .addScaledVector(forward, depth)
    .addScaledVector(rightVector, side)
  mote.home.y = lift
  clampWorld(mote.home)
  mote.home.y = lift
  mote.position.copy(mote.home)
  mote.velocity.set(
    (seededNoise(mote.seed + 12.4) - 0.5) * 0.22,
    (seededNoise(mote.seed + 14.9) - 0.5) * 0.08,
    (seededNoise(mote.seed + 17.2) - 0.5) * 0.22,
  )
}

function makeMotes(runtime: VacuumRuntime) {
  return Array.from({ length: MOTE_COUNT }, (_, index) => {
    const seed = index * 3.173 + 1.11
    const mote: Mote = {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      home: new THREE.Vector3(),
      seed,
      size: 0.026 + seededNoise(seed + 2.4) * 0.034,
      swirl: 0.25 + seededNoise(seed + 4.6) * 0.52,
      palette: seededNoise(seed + 6.8),
      warmth: seededNoise(seed + 9.1),
    }
    spawnMote(mote, runtime, index * 0.37)
    return mote
  })
}

function VacuumCamera() {
  const { camera, size } = useThree()

  useEffect(() => {
    const narrow = size.width / Math.max(1, size.height) < 0.72
    camera.position.set(0, narrow ? 7.05 : 5.15, narrow ? 10.4 : 7.4)
    camera.lookAt(0, 0.35, -0.2)
    camera.updateProjectionMatrix()
  }, [camera, size.height, size.width])

  return null
}

function VacuumPointer({ runtime }: { runtime: MutableRefObject<VacuumRuntime> }) {
  const { camera, gl } = useThree()
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const ndc = useMemo(() => new THREE.Vector2(), [])
  const floor = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const hit = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    const element = gl.domElement

    function update(event: PointerEvent, active: boolean) {
      const rect = element.getBoundingClientRect()
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
      raycaster.setFromCamera(ndc, camera)
      raycaster.ray.intersectPlane(floor, hit)
      hit.y = 0.62
      clampWorld(hit)
      runtime.current.target.copy(hit)
      runtime.current.active = active
    }

    function onMove(event: PointerEvent) {
      update(event, true)
    }

    function onDown(event: PointerEvent) {
      runtime.current.pointerDown = true
      element.setPointerCapture?.(event.pointerId)
      update(event, true)
    }

    function onUp(event: PointerEvent) {
      runtime.current.pointerDown = false
      update(event, true)
      element.releasePointerCapture?.(event.pointerId)
    }

    function onLeave() {
      runtime.current.active = false
      runtime.current.pointerDown = false
    }

    function preventContext(event: Event) {
      event.preventDefault()
    }

    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerdown', onDown)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onUp)
    element.addEventListener('pointerleave', onLeave)
    element.addEventListener('contextmenu', preventContext)

    return () => {
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerdown', onDown)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onUp)
      element.removeEventListener('pointerleave', onLeave)
      element.removeEventListener('contextmenu', preventContext)
    }
  }, [camera, floor, gl.domElement, hit, ndc, raycaster, runtime])

  return null
}

function VacuumMotion({ runtime }: { runtime: MutableRefObject<VacuumRuntime> }) {
  const nozzleScratch = useMemo(() => createNozzleEntryScratch(), [])

  useFrame(({ clock }, dt) => {
    const state = runtime.current
    const cappedDt = Math.min(dt, 0.04)
    const t = clock.elapsedTime

    if (!state.active) {
      state.target.set(Math.sin(t * 0.42) * 1.45, 0.62, Math.cos(t * 0.34) * 0.42 + 0.08)
    }

    deltaVector.copy(state.target).sub(state.position)
    state.velocity.addScaledVector(deltaVector, 18 * cappedDt)
    state.velocity.multiplyScalar(Math.exp(-7.2 * cappedDt))
    state.position.addScaledVector(state.velocity, cappedDt)
    clampWorld(state.position)

    if (!state.active) {
      state.yaw = dampAngle(state.yaw, Math.PI + Math.sin(t * 0.48) * 0.16, 3.8, cappedDt)
    } else if (state.velocity.lengthSq() > 0.0004) {
      state.yaw = Math.atan2(state.velocity.x, -state.velocity.z)
    } else {
      state.yaw += Math.sin(t * 0.8) * 0.0018
    }

    state.forward.set(Math.sin(state.yaw), 0, -Math.cos(state.yaw)).normalize()
    state.pulse = damp(state.pulse, state.pointerDown ? 1.35 : 0.82, 6.5, cappedDt)
    state.recoil = damp(state.recoil, 0, 9.5, cappedDt)
    state.flash = damp(state.flash, 0, 8.8, cappedDt)
    state.gulpAge += cappedDt
    state.gulpFlow = damp(state.gulpFlow, 0, 4.2, cappedDt)
    setNozzleEntryPoint(state.mouth, state.forward, state, t, nozzleScratch)

    state.frameMs = cappedDt * 1000
    state.maxFrameMs = Math.max(state.maxFrameMs * 0.96, state.frameMs)
    state.fps = 1 / Math.max(cappedDt, 0.0001)

    window.__VACUUM_LAB_STATS__ = {
      mode: 'vacuum-suction-lab',
      vacuumOnly: true,
      slimePrototypeLocked: true,
      slimePrototypeRoute: '/slime-prototype',
      gameplayPressure: false,
      suctionModel: 'cartoon-hose-mouth-forward-force-cone-with-recoil-flash',
      visualModel: 'oldschool-bag-vacuum-with-endpoint-locked-hose-nozzle',
      vacuumMounted: true,
      testMoteCount: MOTE_COUNT,
      dpr: VACUUM_DPR,
      techniques: [
        'separate-vacuum-lab-route',
        'locked-slime-prototype-route',
        'pointer-spring-vacuum-body',
        'cartoon-hose-sucker',
        'corrugated-hose-body',
        'elephant-trunk-vacuum-hose',
        'continuous-single-hose-body',
        'gapless-hose-core',
        'curve-locked-corrugation-bands',
        'single-sweeping-hose-bend',
        'damped-front-nozzle-wiggle',
        'low-frequency-hose-physics',
        'endpoint-locked-nozzle',
        'hose-nozzle-overlap-collar',
        'thin-zany-trunk-hose',
        'up-down-arching-hose',
        'rubber-hose-flail-curve',
        'eyes-cleared-front-read',
        'oldschool-vacuum-bag-body',
        'cloth-bag-squash-recoil',
        'opaque-matte-vacuum-bag',
        'gulp-inflating-bag-animation',
        'organic-undercloth-bag-bloom',
        'soft-aurora-bag-takeover',
        'single-field-gulp-color-diffusion',
        'cartoon-bag-bulge-pop',
        'aaa-vacuum-character-polish',
        'eye-focus-intake-reactivity',
        'weighted-body-squash-recoil',
        'organic-suction-pulse-beads',
        'restrained-tapered-flow-ribbons',
        'cohesive-vacuum-energy-loop',
        'thoughtful-vacuum-accessory-kit',
        'animated-pressure-gauge',
        'service-rivet-plates',
        'bag-cinch-hardware',
        'hose-clamp-screws',
        'dangling-inspection-tag',
        'surface-fastened-accessories',
        'bag-accessory-surface-fit',
        'vacuum-part-overlap-audit',
        'bag-patch-artifact-removed',
        'gulp-recoil-flow-through-body',
        'traveling-intake-shockwave',
        'hose-to-bag-gulp-transfer',
        'satisfying-swallow-recoil-layer',
        'flowy-rubber-hose-animation',
        'hose-mounted-face-clearance',
        'eye-hose-clearance-orbit',
        'hose-eye-stalks',
        'mouth-endpoint-clearance',
        'small-snuffling-nozzle-mouth',
        'accordion-suction-pulse',
        'out-of-control-hose-wobble',
        'funny-hose-detailing',
        'mouth-forward-suction-field',
        'computeSuctionForce-test-motes',
        'layered-air-ribbons',
        'mouth-pulse-flash',
        'original-cel-comic-bam-burst',
        'gulp-impact-starburst',
        'short-lived-pop-shards',
        'precise-nozzle-entry-impact-fx',
        'micro-comic-pop-variants',
        'small-clustered-gulp-animations',
        'recoil-on-swallow-cycle',
        'no-score-no-progression',
      ],
      perf: {
        fps: Number(state.fps.toFixed(1)),
        frameMs: Number(state.frameMs.toFixed(1)),
        maxFrameMs: Number(state.maxFrameMs.toFixed(1)),
      },
    }
  })

  return null
}

function Stage() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.015, 0]} scale={[12, 8, 1]}>
        <planeGeometry args={[1, 1, 1, 1]} />
        <meshToonMaterial color="#4b3b6a" gradientMap={getToonRampTexture()} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[-2.6, 0.002, -0.8]} scale={[2.4, 1.35, 1]}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial color="#332a4d" transparent opacity={0.46} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[2.5, 0.004, 0.65]} scale={[2.9, 1.5, 1]}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial color="#6d5385" transparent opacity={0.34} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.006, 0.18]} scale={[8.4, 0.55, 1]}>
        <planeGeometry args={[1, 1, 1, 1]} />
        <meshBasicMaterial color="#765f8d" transparent opacity={0.32} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} rotation-z={-0.26} position={[0.3, 0.008, -1.28]} scale={[8.6, 0.38, 1]}>
        <planeGeometry args={[1, 1, 1, 1]} />
        <meshBasicMaterial color="#2d2945" transparent opacity={0.32} depthWrite={false} />
      </mesh>
    </group>
  )
}

function trunkRadiusAt(pct: number) {
  return 0.185 - pct * 0.04 + Math.sin(pct * Math.PI) * 0.016
}

function setTrunkPoint(
  target: THREE.Vector3,
  pct: number,
  t: number,
  suction: number,
  flash: number,
  recoil: number,
  gulpFlow = 0,
  gulpAge = 9,
) {
  const sideEnvelope = Math.sin(pct * Math.PI)
  const lead = pct ** 1.25
  const frontEnvelope = smooth01((pct - 0.58) / 0.42)
  const phase = pct * 2.65
  const flowPhase = pct * 5.65
  const gulpCenter = 1 - gulpAge * 2.45
  const gulpFade = Math.max(0, 1 - gulpAge / 0.9)
  const gulpBand = gulpFlow > 0.005 && gulpCenter > -0.32
    ? Math.exp(-((pct - gulpCenter) ** 2) * 92) * gulpFlow * gulpFade
    : 0
  const bodySway = Math.sin(t * 2.0 + 0.35) * 0.05 * suction * sideEnvelope
  const rubberWave = sideEnvelope * suction * (
    Math.sin(t * 1.55 + flowPhase) * 0.068
    + Math.sin(t * 2.35 - pct * 4.6) * 0.034
  )
  const verticalWave = sideEnvelope * suction * (
    Math.sin(t * 1.85 + pct * 4.2) * 0.04
    + Math.sin(t * 3.05 - pct * 3.35) * 0.017
  )
  const depthWave = sideEnvelope * suction * Math.sin(t * 1.35 + pct * 5.1) * 0.026
  const frontWhip = frontEnvelope * suction * (
    Math.sin(t * 4.15 + phase) * 0.082
    + Math.sin(t * 6.85 + phase * 1.4) * 0.027
  )
  const recoilLag = recoil * (0.98 - pct * 0.42)
  const frontCurl = frontEnvelope * Math.sin((pct - 0.58) * Math.PI * 1.35) * 0.072
  const baseX = sideEnvelope * 0.32 + frontCurl - pct * 0.035
  const baseY = 0.16 + sideEnvelope * 0.5 - pct * 0.07
  const baseZ = 0.34 - pct * 1.78 + sideEnvelope * 0.055

  target.set(
    baseX
      + bodySway
      + rubberWave
      + frontWhip
      + Math.sin(t * 12.4 + phase * 1.7) * gulpBand * 0.028
      + Math.sin(t * 11.0 + phase) * flash * 0.014 * lead * frontEnvelope,
    baseY
      + gulpBand * (0.035 + sideEnvelope * 0.03)
      + verticalWave
      + Math.sin(t * 2.55 + 0.7) * 0.026 * sideEnvelope * suction
      + Math.sin(t * 5.1 + phase) * 0.024 * frontEnvelope * suction
      + sideEnvelope * recoil * 0.026,
    baseZ
      + depthWave
      + Math.sin(t * 8.8 + pct * 6.0) * gulpBand * 0.018
      + Math.sin(t * 3.1 + phase * 0.6) * 0.018 * frontEnvelope * suction
      - recoilLag * 0.024,
  )
}

function hoseLiftAt(pct: number, lift: number) {
  return lift * smooth01((pct - 0.08) / 0.92)
}

export function createNozzleEntryScratch(): NozzleEntryScratch {
  return {
    root: new THREE.Object3D(),
    anchor: new THREE.Vector3(),
    before: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    worldTangent: new THREE.Vector3(),
  }
}

function setNozzlePoint(
  target: THREE.Vector3,
  forwardTarget: THREE.Vector3 | null,
  state: VacuumRuntime,
  t: number,
  scratch: NozzleEntryScratch,
  clearance: number,
) {
  const suction = state.pulse + state.flash * 0.55
  const bob = Math.sin(t * 4.8) * 0.023
  scratch.root.position.copy(state.position)
  scratch.root.position.y += bob + state.recoil * 0.012
  scratch.root.rotation.set(
    Math.sin(t * 5.2) * 0.012 * suction,
    state.yaw + Math.sin(t * 2.7) * 0.026 * suction + Math.sin(t * 16.0) * 0.012 * state.flash,
    Math.sin(t * 6.4) * 0.021 * suction + state.recoil * 0.026,
  )
  scratch.root.scale.set(1 + state.recoil * 0.055 + state.flash * 0.025, 1 + state.flash * 0.018, 1 - state.recoil * 0.026)
  scratch.root.updateMatrixWorld(true)

  const trunkSuction = Math.max(0.45, state.pulse) + state.flash * 0.35
  setTrunkPoint(scratch.anchor, 1, t, trunkSuction, state.flash, state.recoil, state.gulpFlow, state.gulpAge)
  setTrunkPoint(scratch.before, 0.94, t, trunkSuction, state.flash, state.recoil, state.gulpFlow, state.gulpAge)
  scratch.anchor.y += hoseLiftAt(1, state.hoseLift)
  scratch.before.y += hoseLiftAt(0.94, state.hoseLift)
  scratch.anchor.y += 0.02
  scratch.before.y += 0.02
  scratch.tangent.copy(scratch.anchor).sub(scratch.before).normalize()
  target.copy(scratch.anchor).addScaledVector(scratch.tangent, clearance)
  target.applyMatrix4(scratch.root.matrixWorld)

  if (forwardTarget) {
    scratch.worldTangent.copy(scratch.tangent).transformDirection(scratch.root.matrixWorld).normalize()
    forwardTarget.copy(scratch.worldTangent)
  }
}

export function setNozzleEntryPoint(
  target: THREE.Vector3,
  forwardTarget: THREE.Vector3 | null,
  state: VacuumRuntime,
  t: number,
  scratch: NozzleEntryScratch,
) {
  setNozzlePoint(target, forwardTarget, state, t, scratch, 0.245 + state.flash * 0.008)
}

export function setNozzleMouthPoint(
  target: THREE.Vector3,
  forwardTarget: THREE.Vector3 | null,
  state: VacuumRuntime,
  t: number,
  scratch: NozzleEntryScratch,
) {
  const suction = state.pulse + state.flash * 0.55
  const intakeHit = state.gulpFlow * Math.exp(-((state.gulpAge - 0.05) ** 2) * 120)
  const mouthClearance = 0.074 + Math.sin(t * 9.2) * 0.006 * suction + state.flash * 0.012 + intakeHit * 0.012
  setNozzlePoint(target, forwardTarget, state, t, scratch, mouthClearance)
}

function makeTrunkGeometry(points: THREE.Vector3[], radiusOffset = 0) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.55)
  return new THREE.TubeGeometry(curve, TRUNK_TUBE_SEGMENTS, trunkRadiusAt(0.42) + radiusOffset, TRUNK_RADIAL_SEGMENTS, false)
}

function ContinuousTrunk({ runtime }: { runtime: MutableRefObject<VacuumRuntime> }) {
  const body = useRef<THREE.Mesh>(null)
  const outline = useRef<THREE.Mesh>(null)
  const bands = useRef<Array<THREE.Group | null>>([])
  const flowRings = useRef<Array<THREE.Mesh | null>>([])
  const points = useMemo(
    () => Array.from({ length: TRUNK_CURVE_POINT_COUNT }, (_, index) => {
      const point = new THREE.Vector3()
      setTrunkPoint(point, index / (TRUNK_CURVE_POINT_COUNT - 1), 0, 0.8, 0, 0)
      return point
    }),
    [],
  )
  const curve = useMemo(() => new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.55), [points])
  const bandPosition = useMemo(() => new THREE.Vector3(), [])
  const bandTangent = useMemo(() => new THREE.Vector3(), [])
  const bodyGeometry = useMemo(() => makeTrunkGeometry(points), [points])
  const outlineGeometry = useMemo(() => makeTrunkGeometry(points, 0.028), [points])
  const bodyMaterial = useMemo(
    () => new THREE.MeshToonMaterial({ color: '#67b8bd', gradientMap: getToonRampTexture() }),
    [],
  )
  const outlineMaterial = useMemo(() => getOutlineMaterial(), [])
  const flowMaterials = useMemo(
    () =>
      ['#fff2a3', '#6bd8ff', '#f47bdc', '#b9efc8'].map((color) =>
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: false,
          toneMapped: false,
        }),
      ),
    [],
  )

  useFrame(({ clock }) => {
    const state = runtime.current
    const t = clock.elapsedTime
    const suction = Math.max(0.45, state.pulse) + state.flash * 0.35

    for (let index = 0; index < points.length; index += 1) {
      const pct = index / (points.length - 1)
      setTrunkPoint(points[index], pct, t, suction, state.flash, state.recoil, state.gulpFlow, state.gulpAge)
      points[index].y += hoseLiftAt(pct, state.hoseLift)
    }
    curve.updateArcLengths()

    if (body.current) {
      const previous = body.current.geometry
      body.current.geometry = makeTrunkGeometry(points)
      previous.dispose()
    }
    if (outline.current) {
      const previous = outline.current.geometry
      outline.current.geometry = makeTrunkGeometry(points, 0.028)
      previous.dispose()
    }

    for (let index = 0; index < TRUNK_BAND_COUNT; index += 1) {
      const band = bands.current[index]
      if (!band) continue
      const pct = (index + 0.5) / TRUNK_BAND_COUNT
      const phase = index * 0.74
      const gulpCenter = 1 - state.gulpAge * 2.45
      const gulpBand = state.gulpFlow > 0.005 && gulpCenter > -0.32
        ? Math.exp(-((pct - gulpCenter) ** 2) * 105) * state.gulpFlow * Math.max(0, 1 - state.gulpAge / 0.9)
        : 0
      const accordion = Math.sin(t * 10.4 + phase) * 0.026 * suction + state.recoil * 0.035 + gulpBand * 0.2
      curve.getPointAt(pct, bandPosition)
      curve.getTangentAt(pct, bandTangent).normalize()
      band.position.copy(bandPosition)
      band.quaternion.setFromUnitVectors(trunkAxis, bandTangent)
      band.scale.setScalar(trunkRadiusAt(pct) * (1.09 + accordion))
    }

    for (let index = 0; index < GULP_FLOW_RING_COUNT; index += 1) {
      const ring = flowRings.current[index]
      const material = flowMaterials[index]
      if (!ring) continue
      const localAge = state.gulpAge - index * 0.045
      const pct = 1 - localAge * 2.45
      const live = state.gulpFlow > 0.01 && localAge >= 0 && pct >= 0 && pct <= 1
      ring.visible = live
      if (!live) {
        material.opacity = 0
        continue
      }
      const fade = Math.max(0, 1 - localAge / 0.62)
      const pop = state.gulpFlow * fade
      curve.getPointAt(pct, bandPosition)
      curve.getTangentAt(pct, bandTangent).normalize()
      ring.position.copy(bandPosition)
      ring.quaternion.setFromUnitVectors(trunkAxis, bandTangent)
      ring.scale.setScalar(trunkRadiusAt(pct) * (1.42 + pop * 0.5))
      material.opacity = Math.min(0.74, 0.26 + pop * 0.42)
    }
  })

  return (
    <group>
      <mesh ref={outline} geometry={outlineGeometry} material={outlineMaterial} frustumCulled={false} />
      <mesh ref={body} geometry={bodyGeometry} material={bodyMaterial} frustumCulled={false} />
      {Array.from({ length: TRUNK_BAND_COUNT }, (_, index) => (
        <group
          key={index}
          ref={(node) => {
            bands.current[index] = node
          }}
        >
          <OutlineMesh
            outlineWidth={0.035}
            geometry={<torusGeometry args={[1, 0.08, 8, 20]} />}
            material={toon(index % 2 === 0 ? '#ecd15f' : '#cf6170')}
          />
        </group>
      ))}
      {Array.from({ length: GULP_FLOW_RING_COUNT }, (_, index) => (
        <mesh
          key={`gulp-flow-ring-${index}`}
          ref={(node) => {
            flowRings.current[index] = node
          }}
          visible={false}
          renderOrder={42 + index}
          frustumCulled={false}
        >
          <torusGeometry args={[1, 0.085, 8, 22]} />
          <primitive object={flowMaterials[index]} attach="material" />
        </mesh>
      ))}
    </group>
  )
}

export function VacuumBody({ runtime }: { runtime: MutableRefObject<VacuumRuntime> }) {
  const root = useRef<THREE.Group>(null)
  const bodyShell = useRef<THREE.Group>(null)
  const bag = useRef<THREE.Group>(null)
  const eyeGroup = useRef<THREE.Group>(null)
  const leftPupil = useRef<THREE.Mesh>(null)
  const rightPupil = useRef<THREE.Mesh>(null)
  const leftBrow = useRef<THREE.Group>(null)
  const rightBrow = useRef<THREE.Group>(null)
  const grin = useRef<THREE.Group>(null)
  const gaugeNeedle = useRef<THREE.Group>(null)
  const inspectionTag = useRef<THREE.Group>(null)
  const mouthDisc = useRef<THREE.Group>(null)
  const bagPuffClouds = useRef<THREE.Mesh[]>([])
  const bagPuffOutlines = useRef<THREE.Mesh[]>([])
  const bagFill = useRef(0.22)
  const bagKick = useRef(0)
  const lastBagCycle = useRef(0)
  const bagWaveCursor = useRef(0)
  const bagWaveStarts = useRef([-9, -9, -9, -9])
  const bagWaveColors = useRef([
    new THREE.Color(BAG_WAVE_PALETTE[0]),
    new THREE.Color(BAG_WAVE_PALETTE[1]),
    new THREE.Color(BAG_WAVE_PALETTE[2]),
    new THREE.Color(BAG_WAVE_PALETTE[3]),
  ])
  const bagBloomCenters = useRef([
    new THREE.Vector2(-0.22, -0.12),
    new THREE.Vector2(0.18, 0.16),
    new THREE.Vector2(-0.04, 0.24),
    new THREE.Vector2(0.24, -0.18),
  ])
  const nozzleAnchor = useMemo(() => new THREE.Vector3(), [])
  const nozzleBefore = useMemo(() => new THREE.Vector3(), [])
  const nozzleTangent = useMemo(() => new THREE.Vector3(), [])
  const eyeAnchor = useMemo(() => new THREE.Vector3(), [])
  const eyeBefore = useMemo(() => new THREE.Vector3(), [])
  const eyeTangent = useMemo(() => new THREE.Vector3(), [])
  const eyeSide = useMemo(() => new THREE.Vector3(), [])
  const bagMaterial = useMemo(() => createBagPulseMaterial(), [])
  const mouthMaterial = useMemo(() => {
    const material = createMouthRingMaterial()
    material.side = THREE.DoubleSide
    return material
  }, []) as MouthRingMaterial

  useFrame(({ clock }, dt) => {
    const state = runtime.current
    const rootGroup = root.current
    if (!rootGroup) return
    const cappedDt = Math.min(dt, 0.04)
    const t = clock.elapsedTime
    const suction = state.pulse + state.flash * 0.55
    const bagPuff = Math.max(0, state.bagPuff)
    const gulpFade = state.gulpFlow * Math.max(0, 1 - state.gulpAge / 0.95)
    const intakeHit = state.gulpFlow * Math.exp(-((state.gulpAge - 0.05) ** 2) * 120)
    const bodyHit = state.gulpFlow * Math.exp(-((state.gulpAge - 0.22) ** 2) * 44)
    const bagTransfer = state.gulpFlow * Math.exp(-((state.gulpAge - 0.4) ** 2) * 30)
    const swallowed = state.swallowCycles - lastBagCycle.current
    if (swallowed > 0) {
      const events = Math.min(swallowed, 4)
      for (let index = 0; index < events; index += 1) {
        const slot = bagWaveCursor.current % 4
        const cycle = lastBagCycle.current + index + 1
        bagWaveStarts.current[slot] = t - index * 0.045
        bagWaveColors.current[slot].set(BAG_WAVE_PALETTE[cycle % BAG_WAVE_PALETTE.length])
        bagBloomCenters.current[slot].set((seededNoise(cycle * 7.31 + 0.4) - 0.5) * 0.72, (seededNoise(cycle * 4.73 + 2.1) - 0.5) * 0.54)
        bagWaveCursor.current += 1
      }
      bagFill.current = Math.min(1.15, bagFill.current + swallowed * 0.15)
      bagKick.current = Math.min(1.8, bagKick.current + swallowed * 0.38)
      lastBagCycle.current = state.swallowCycles
    }
    const fillTarget = state.pulse > 0.9 || bagPuff > 0.08 ? 0.42 + bagPuff * 0.16 : 0.24
    bagFill.current = damp(bagFill.current, fillTarget, 0.42, cappedDt)
    bagKick.current = damp(bagKick.current, 0, 4.8, cappedDt)
    const bob = Math.sin(t * 4.8) * 0.023
    rootGroup.position.copy(state.position)
    rootGroup.position.addScaledVector(state.forward, -(intakeHit * 0.045 + bodyHit * 0.035))
    rootGroup.position.y += bob + state.recoil * 0.012 + bodyHit * 0.018
    rootGroup.rotation.set(
      Math.sin(t * 5.2) * 0.012 * suction - intakeHit * 0.028,
      state.yaw + Math.sin(t * 2.7) * 0.026 * suction + Math.sin(t * 16.0) * 0.012 * state.flash + bodyHit * 0.03,
      Math.sin(t * 6.4) * 0.021 * suction + state.recoil * 0.026 + Math.sin(t * 18.0) * gulpFade * 0.018,
    )
    rootGroup.scale.set(
      1 + state.recoil * 0.055 + state.flash * 0.025 + bodyHit * 0.04,
      1 + state.flash * 0.018 + intakeHit * 0.018,
      1 - state.recoil * 0.026 - intakeHit * 0.026 + bodyHit * 0.02,
    )
    if (bodyShell.current) {
      const bodyBreath = Math.sin(t * 5.4) * 0.006 * suction
      bodyShell.current.position.set(
        0,
        0.02 + bodyBreath - state.recoil * 0.01 + bodyHit * 0.012,
        state.recoil * 0.018 - state.flash * 0.006 - intakeHit * 0.018,
      )
      bodyShell.current.scale.set(
        1 + state.recoil * 0.032 + bodyHit * 0.035,
        1 - state.recoil * 0.018 + state.flash * 0.012 + intakeHit * 0.015,
        1 + state.flash * 0.014 - intakeHit * 0.02 + bodyHit * 0.03,
      )
    }
    if (bag.current) {
      const inhale = Math.sin(t * 7.8) * 0.028 * suction
      const fill = bagFill.current
      const kick = bagKick.current
      const bagPopWobble = Math.sin(t * 16.0) * 0.018 * bagPuff
      const bagSway = Math.sin(t * 2.15 + fill * 3.2) * 0.018 * suction + kick * 0.01 + Math.sin(t * 8.5) * bagPuff * 0.012
      bag.current.position.set(
        bagSway,
        0.67 + fill * 0.035 + kick * 0.018 + bagTransfer * 0.026 + bagPuff * 0.074,
        0.81 + fill * 0.035 + bagTransfer * 0.018 + bagPuff * 0.058,
      )
      bag.current.rotation.x = -0.24 + Math.sin(t * 3.2) * 0.028 * suction - state.recoil * 0.04 - kick * 0.038 - bagTransfer * 0.04 - bagPuff * 0.105
      bag.current.rotation.y = Math.sin(t * 2.35) * 0.018 * suction + kick * 0.026 + bagTransfer * 0.032 + bagPuff * 0.045
      bag.current.rotation.z = Math.sin(t * 5.1) * 0.02 * suction + state.flash * 0.018 + Math.sin(t * 10.0) * kick * 0.028 + Math.sin(t * 12.0) * bagTransfer * 0.035 + bagPopWobble
      bag.current.scale.set(
        1.1 + fill * 0.3 + kick * 0.24 + inhale * 0.32 + bagTransfer * 0.34 + bagPuff * 0.5,
        1.08 + fill * 0.36 + kick * 0.34 - inhale + state.recoil * 0.04 + bagTransfer * 0.28 + bagPuff * 0.62,
        1.08 + fill * 0.28 + kick * 0.26 + inhale * 0.18 + bagTransfer * 0.24 + bagPuff * 0.42,
      )
    }
    BAG_PUFF_CLOUD_SPECS.forEach(([x, y, z, size, , phase], index) => {
      const puff = bagPuffClouds.current[index]
      const outline = bagPuffOutlines.current[index]
      const pulse = clamp((bagPuff - index * 0.035) * 1.25 + Math.sin(t * 8.5 + phase) * 0.025, 0, 1)
      const visible = pulse > 0.02
      const drift = 0.72 + pulse * 1.55
      const px = x + Math.sin(t * 4.2 + phase) * 0.016 + x * pulse * 0.14
      const py = y + pulse * 0.092 + Math.cos(t * 3.8 + phase) * 0.012
      const pz = z + pulse * 0.07

      if (puff) {
        puff.visible = visible
        puff.position.set(px, py, pz)
        puff.scale.setScalar(size * drift)
        ;(puff.material as THREE.MeshBasicMaterial).opacity = pulse * 0.24
      }
      if (outline) {
        outline.visible = visible
        outline.position.set(px, py, pz - 0.006)
        outline.scale.setScalar(size * (drift + 0.18))
        ;(outline.material as THREE.MeshBasicMaterial).opacity = pulse * 0.18
      }
    })
    if (gaugeNeedle.current) {
      const gaugeKick = Math.min(1, state.pulse * 0.48 + state.flash * 0.54 + bagKick.current * 0.16 + bodyHit * 0.22 + bagTransfer * 0.28)
      gaugeNeedle.current.rotation.z = -0.62 + gaugeKick * 1.05 + Math.sin(t * 13.0) * state.flash * 0.08
    }
    if (inspectionTag.current) {
      const tagSwing = Math.sin(t * 6.1) * 0.08 * suction + state.recoil * 0.11 + bagKick.current * 0.08 + bagTransfer * 0.16
      inspectionTag.current.rotation.z = -0.18 + tagSwing
      inspectionTag.current.position.y = -0.08 + Math.sin(t * 5.2) * 0.008 * suction
    }
    bagMaterial.uniforms.uTime.value = t
    bagMaterial.uniforms.uPulse.value = suction + bagKick.current * 1.45 + bagTransfer * 1.25 + bagPuff * 2.15
    bagMaterial.uniforms.uFill.value = bagFill.current + bagKick.current * 0.32 + bagTransfer * 0.18 + bagPuff * 0.22
    bagMaterial.uniforms.uSuctionActive.value = Math.min(1.55, (state.pointerDown ? 1 : state.active ? 0.88 : 0) + bagKick.current * 0.48 + bagTransfer * 0.5 + bagPuff * 0.62)
    bagMaterial.uniforms.uWaveColor0.value.copy(bagWaveColors.current[0])
    bagMaterial.uniforms.uWaveColor1.value.copy(bagWaveColors.current[1])
    bagMaterial.uniforms.uWaveColor2.value.copy(bagWaveColors.current[2])
    bagMaterial.uniforms.uWaveColor3.value.copy(bagWaveColors.current[3])
    bagMaterial.uniforms.uWaveAge0.value = t - bagWaveStarts.current[0]
    bagMaterial.uniforms.uWaveAge1.value = t - bagWaveStarts.current[1]
    bagMaterial.uniforms.uWaveAge2.value = t - bagWaveStarts.current[2]
    bagMaterial.uniforms.uWaveAge3.value = t - bagWaveStarts.current[3]
    bagMaterial.uniforms.uBloomCenter0.value.copy(bagBloomCenters.current[0])
    bagMaterial.uniforms.uBloomCenter1.value.copy(bagBloomCenters.current[1])
    bagMaterial.uniforms.uBloomCenter2.value.copy(bagBloomCenters.current[2])
    bagMaterial.uniforms.uBloomCenter3.value.copy(bagBloomCenters.current[3])
    if (eyeGroup.current) {
      const focus = Math.min(1, state.pulse * 0.36 + state.flash * 0.48 + bodyHit * 0.22 + (state.pointerDown ? 0.2 : 0))
      const faceSuction = Math.max(0.45, state.pulse) + state.flash * 0.35
      const eyePct = 0.54 + Math.sin(t * 1.25) * 0.025 * suction
      setTrunkPoint(eyeAnchor, eyePct, t + 0.08, faceSuction, state.flash, state.recoil, state.gulpFlow, state.gulpAge)
      setTrunkPoint(eyeBefore, Math.max(0.08, eyePct - 0.08), t + 0.08, faceSuction, state.flash, state.recoil, state.gulpFlow, state.gulpAge)
      eyeAnchor.y += hoseLiftAt(eyePct, state.hoseLift)
      eyeBefore.y += hoseLiftAt(Math.max(0.08, eyePct - 0.08), state.hoseLift)
      eyeTangent.copy(eyeAnchor).sub(eyeBefore).normalize()
      eyeSide.set(-eyeTangent.z, 0, eyeTangent.x)
      if (eyeSide.lengthSq() < 0.001) eyeSide.set(1, 0, 0)
      eyeSide.normalize()
      const hoseY = eyeAnchor.y
      const orbit = Math.sin(t * 2.85 + 0.4) * 0.052 * suction + state.flash * 0.016
      const eyeLift = trunkRadiusAt(eyePct) * 1.38 + 0.105 + focus * 0.018
      eyeAnchor
        .addScaledVector(eyeSide, orbit - 0.035)
      eyeAnchor.y = Math.max(hoseY + eyeLift, eyeAnchor.y + eyeLift)
      eyeAnchor.z -= 0.035 + focus * 0.016
      eyeGroup.current.position.set(
        eyeAnchor.x + Math.sin(t * 7.6) * 0.008 * suction,
        eyeAnchor.y + Math.sin(t * 5.5) * 0.008 * suction,
        eyeAnchor.z,
      )
      eyeGroup.current.rotation.set(
        -0.08 + Math.sin(t * 5.0) * 0.018 * suction + eyeTangent.y * 0.12,
        Math.sin(t * 4.4) * 0.025 * suction - eyeTangent.x * 0.16,
        Math.sin(t * 9.0) * 0.026 * state.flash + orbit * 0.36,
      )
      if (leftPupil.current && rightPupil.current) {
        const jitterX = Math.sin(t * 8.8) * 0.005 * suction
        const jitterY = Math.cos(t * 7.1) * 0.004 * suction
        leftPupil.current.position.set(-0.205 + focus * 0.025 + jitterX, -0.01 - focus * 0.025 + jitterY, -0.065)
        rightPupil.current.position.set(0.175 - focus * 0.025 + jitterX, -0.01 - focus * 0.025 - jitterY, -0.065)
        leftPupil.current.scale.set(0.039 + state.flash * 0.006, 0.05 + focus * 0.006, 0.018)
        rightPupil.current.scale.set(0.039 + state.flash * 0.006, 0.05 + focus * 0.006, 0.018)
      }
      if (leftBrow.current && rightBrow.current) {
        leftBrow.current.rotation.z = 0.18 + focus * 0.12 + state.flash * 0.06
        rightBrow.current.rotation.z = -0.18 - focus * 0.12 - state.flash * 0.06
        leftBrow.current.position.y = 0.15 + focus * 0.012
        rightBrow.current.position.y = 0.15 + focus * 0.012
      }
      if (grin.current) {
        grin.current.position.y = -0.19 - focus * 0.012 + state.flash * 0.008
        grin.current.scale.set(1 + focus * 0.08, 1 + state.flash * 0.28, 1)
        grin.current.rotation.z = Math.sin(t * 7.5) * 0.035 * state.flash
      }
    }
    mouthMaterial.uniforms.uTime.value = t
    mouthMaterial.uniforms.uPulse.value = state.pulse + state.flash * 1.4 + intakeHit * 0.9
    if (mouthDisc.current) {
      const pulse = Math.sin(t * 19.0) * 0.026 * suction
      const trunkSuction = Math.max(0.45, state.pulse) + state.flash * 0.35
      setTrunkPoint(nozzleAnchor, 1, t, trunkSuction, state.flash, state.recoil, state.gulpFlow, state.gulpAge)
      setTrunkPoint(nozzleBefore, 0.94, t, trunkSuction, state.flash, state.recoil, state.gulpFlow, state.gulpAge)
      nozzleAnchor.y += hoseLiftAt(1, state.hoseLift)
      nozzleBefore.y += hoseLiftAt(0.94, state.hoseLift)
      nozzleAnchor.y += 0.02
      nozzleBefore.y += 0.02
      nozzleTangent.copy(nozzleAnchor).sub(nozzleBefore).normalize()
      const mouthClearance = 0.074 + Math.sin(t * 9.2) * 0.006 * suction + state.flash * 0.012 + intakeHit * 0.012
      mouthDisc.current.position.copy(nozzleAnchor).addScaledVector(nozzleTangent, mouthClearance)
      mouthDisc.current.quaternion.setFromUnitVectors(trunkMouthAxis, nozzleTangent)
      mouthDisc.current.rotateZ(Math.sin(t * 12.7) * 0.055 * suction)
      mouthDisc.current.rotateX(Math.sin(t * 8.6) * 0.018 * suction)
      mouthDisc.current.rotateY(Math.sin(t * 7.4 + 0.8) * 0.026 * suction)
      mouthDisc.current.scale.set(
        1 + pulse + state.flash * 0.08 + intakeHit * 0.12,
        1 - pulse * 0.6 + state.recoil * 0.035 + intakeHit * 0.04,
        1 + state.recoil * 0.08 + intakeHit * 0.08,
      )
    }
  })

  return (
    <group ref={root}>
      <group ref={bodyShell} position={[0, 0.02, 0]}>
        <OutlineMesh
          position={[0, 0.14, 0.58]}
          rotation-x={Math.PI / 2}
          scale={[0.72, 0.47, 0.78]}
          outlineWidth={0.05}
          geometry={<cylinderGeometry args={[0.88, 1, 1, 16]} />}
          material={toon(PALETTE.uiSteel)}
        />
        <OutlineMesh
          position={[0, 0.17, -0.05]}
          rotation-x={Math.PI / 2}
          scale={[0.34, 0.27, 0.36]}
          outlineWidth={0.032}
          geometry={<cylinderGeometry args={[1, 0.74, 1, 14]} />}
          material={toon('#d95d59')}
        />
        <OutlineMesh
          position={[0, 0.2, 0.19]}
          scale={[1, 0.84, 1]}
          outlineWidth={0.019}
          geometry={<torusGeometry args={[0.32, 0.042, 8, 22]} />}
          material={toon(PALETTE.warningYellow)}
        />
        <group position={[-0.31, 0.46, -0.42]} rotation-x={Math.PI / 2}>
          <OutlineMesh
            scale={[0.13, 0.13, 0.025]}
            outlineWidth={0.012}
            geometry={<cylinderGeometry args={[1, 1, 1, 16]} />}
            material={toon(PALETTE.bone)}
          />
          <mesh position={[0, 0, -0.032]} scale={[0.086, 0.086, 0.008]}>
            <cylinderGeometry args={[1, 1, 1, 16]} />
            <meshBasicMaterial color="#7ec6c8" />
          </mesh>
          {[
            [-0.055, 0.066, -0.046, 0.45],
            [0, 0.078, -0.046, 0],
            [0.055, 0.066, -0.046, -0.45],
          ].map(([x, y, z, rotate], index) => (
            <mesh key={`gauge-tick-${index}`} position={[x, y, z]} rotation-z={rotate} scale={[0.008, 0.026, 0.006]}>
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial color={PALETTE.asphaltInk} />
            </mesh>
          ))}
          <group ref={gaugeNeedle} position={[0, 0, -0.056]}>
            <mesh position={[0.036, 0, 0]} scale={[0.046, 0.007, 0.006]}>
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial color={PALETTE.rust} />
            </mesh>
            <mesh scale={[0.014, 0.014, 0.007]}>
              <sphereGeometry args={[1, 8, 6]} />
              <meshBasicMaterial color={PALETTE.asphaltInk} />
            </mesh>
          </group>
        </group>
        <group position={[0.29, 0.43, -0.4]} rotation-z={-0.04}>
          <OutlineMesh
            scale={[0.19, 0.066, 0.025]}
            outlineWidth={0.01}
            geometry={<boxGeometry args={[1, 1, 1]} />}
            material={toon('#6f8b98')}
          />
          <DetailRivet position={[-0.078, 0.025, -0.018]} scale={0.012} color={PALETTE.warningYellow} />
          <DetailRivet position={[0.078, 0.025, -0.018]} scale={0.012} color={PALETTE.warningYellow} />
          <DetailRivet position={[-0.078, -0.025, -0.018]} scale={0.012} color={PALETTE.warningYellow} />
          <DetailRivet position={[0.078, -0.025, -0.018]} scale={0.012} color={PALETTE.warningYellow} />
          {[-0.038, 0, 0.038].map((x) => (
            <mesh key={`service-slot-${x}`} position={[x, 0, -0.032]} scale={[0.018, 0.034, 0.006]}>
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial color={PALETTE.uiDark} />
            </mesh>
          ))}
        </group>
        <group ref={eyeGroup} position={[0, 0.83, -0.68]} rotation-x={-0.08}>
          <OutlineMesh
            position={[-0.12, -0.14, 0.018]}
            rotation-z={0.14}
            scale={[0.026, 0.14, 0.026]}
            outlineWidth={0.007}
            geometry={<cylinderGeometry args={[1, 1, 1, 8]} />}
            material={toon(PALETTE.bone)}
          />
          <OutlineMesh
            position={[0.12, -0.14, 0.018]}
            rotation-z={-0.14}
            scale={[0.026, 0.14, 0.026]}
            outlineWidth={0.007}
            geometry={<cylinderGeometry args={[1, 1, 1, 8]} />}
            material={toon(PALETTE.bone)}
          />
          <group ref={leftBrow} position={[-0.19, 0.15, -0.015]} rotation-z={0.18}>
            <OutlineMesh
              scale={[0.15, 0.026, 0.035]}
              outlineWidth={0.006}
              geometry={<boxGeometry args={[1, 1, 1]} />}
              material={toon(PALETTE.uiDark)}
            />
          </group>
          <group ref={rightBrow} position={[0.19, 0.15, -0.015]} rotation-z={-0.18}>
            <OutlineMesh
              scale={[0.15, 0.026, 0.035]}
              outlineWidth={0.006}
              geometry={<boxGeometry args={[1, 1, 1]} />}
              material={toon(PALETTE.uiDark)}
            />
          </group>
          <OutlineMesh
            position={[-0.19, 0.0, 0]}
            scale={[0.135, 0.165, 0.075]}
            outlineWidth={0.017}
            geometry={<sphereGeometry args={[1, 12, 8]} />}
            material={toon(PALETTE.offWhite)}
          />
          <mesh ref={leftPupil} position={[-0.205, -0.01, -0.065]} scale={[0.039, 0.05, 0.018]}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshBasicMaterial color={PALETTE.asphaltInk} />
          </mesh>
          <OutlineMesh
            position={[0.19, 0.0, 0]}
            scale={[0.135, 0.165, 0.075]}
            outlineWidth={0.017}
            geometry={<sphereGeometry args={[1, 12, 8]} />}
            material={toon(PALETTE.offWhite)}
          />
          <mesh ref={rightPupil} position={[0.175, -0.01, -0.065]} scale={[0.039, 0.05, 0.018]}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshBasicMaterial color={PALETTE.asphaltInk} />
          </mesh>
          <group ref={grin} position={[0, -0.19, -0.025]}>
            <OutlineMesh
              scale={[0.22, 0.035, 0.044]}
              outlineWidth={0.008}
              geometry={<boxGeometry args={[1, 1, 1]} />}
              material={toon(PALETTE.warningYellow)}
            />
          </group>
        </group>
        <group ref={bag} position={[0, 0.67, 0.81]}>
          <mesh scale={[0.64, 0.9, 0.48]} material={getOutlineMaterial()} frustumCulled={false}>
            <sphereGeometry args={[1, 20, 14]} />
          </mesh>
          <mesh scale={[0.58, 0.84, 0.43]} renderOrder={8} frustumCulled={false}>
            <sphereGeometry args={[1, 28, 18]} />
            <primitive object={bagMaterial} attach="material" />
          </mesh>
          <OutlineMesh
            position={[0, 0.02, -0.468]}
            scale={[0.32, 0.022, 0.014]}
            outlineWidth={0.005}
            geometry={<boxGeometry args={[1, 1, 1]} />}
            material={toon(PALETTE.uiDark)}
          />
          {[-0.345, 0.345].map((x) => (
            <group key={`bag-buckle-${x}`} position={[x, 0.03, -0.365]} rotation-z={x < 0 ? 0.08 : -0.08}>
              <OutlineMesh
                scale={[0.056, 0.086, 0.03]}
                outlineWidth={0.007}
                geometry={<boxGeometry args={[1, 1, 1]} />}
                material={toon(PALETTE.warningYellow)}
              />
              <mesh position={[0, 0, -0.018]} scale={[0.026, 0.044, 0.008]}>
                <boxGeometry args={[1, 1, 1]} />
                <meshBasicMaterial color={PALETTE.uiDark} />
              </mesh>
            </group>
          ))}
          <OutlineMesh
            position={[0.335, -0.037, -0.365]}
            rotation-z={-0.12}
            scale={[0.014, 0.064, 0.01]}
            outlineWidth={0.004}
            geometry={<boxGeometry args={[1, 1, 1]} />}
            material={toon(PALETTE.uiDark)}
          />
          <group ref={inspectionTag} position={[0.335, -0.08, -0.372]} rotation-z={-0.18}>
            <OutlineMesh
              rotation-x={Math.PI / 2}
              scale={[0.032, 0.032, 0.01]}
              outlineWidth={0.004}
              geometry={<torusGeometry args={[1, 0.18, 6, 12]} />}
              material={toon(PALETTE.warningYellow)}
            />
            <OutlineMesh
              position={[0, -0.07, -0.006]}
              rotation-z={0.12}
              scale={[0.052, 0.076, 0.014]}
              outlineWidth={0.005}
              geometry={<boxGeometry args={[1, 1, 1]} />}
              material={toon(PALETTE.bone)}
            />
            <mesh position={[0, -0.072, -0.016]} scale={[0.026, 0.009, 0.004]}>
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial color={PALETTE.rust} />
            </mesh>
          </group>
        </group>
        {BAG_PUFF_CLOUD_SPECS.map(([x, y, z, size, color], index) => (
          <group key={`bag-puff-cloud-${index}`}>
            <mesh
              ref={(node) => {
                if (node) bagPuffOutlines.current[index] = node
              }}
              position={[x, y, z - 0.006]}
              scale={[size, size, size]}
              visible={false}
              renderOrder={7}
              frustumCulled={false}
            >
              <sphereGeometry args={[1, 10, 7]} />
              <meshBasicMaterial color={PALETTE.asphaltInk} transparent opacity={0} depthWrite={false} />
            </mesh>
            <mesh
              ref={(node) => {
                if (node) bagPuffClouds.current[index] = node
              }}
              position={[x, y, z]}
              scale={[size * 0.84, size * 0.84, size * 0.84]}
              visible={false}
              renderOrder={8}
              frustumCulled={false}
            >
              <sphereGeometry args={[1, 10, 7]} />
              <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} toneMapped={false} />
            </mesh>
          </group>
        ))}
        <group position={[0, 0.0, 0.06]}>
          <OutlineMesh
            position={[-0.46, 0.0, 0.72]}
            rotation-z={Math.PI / 2}
            scale={[0.18, 0.18, 0.12]}
            outlineWidth={0.024}
            geometry={<cylinderGeometry args={[1, 1, 1, 12]} />}
            material={toon(PALETTE.asphaltInk)}
          />
          <OutlineMesh
            position={[-0.58, 0.0, 0.72]}
            rotation-z={Math.PI / 2}
            scale={[0.068, 0.068, 0.026]}
            outlineWidth={0.009}
            geometry={<cylinderGeometry args={[1, 1, 1, 12]} />}
            material={toon(PALETTE.warningYellow)}
          />
          <OutlineMesh
            position={[0.46, 0.0, 0.72]}
            rotation-z={Math.PI / 2}
            scale={[0.18, 0.18, 0.12]}
            outlineWidth={0.024}
            geometry={<cylinderGeometry args={[1, 1, 1, 12]} />}
            material={toon(PALETTE.asphaltInk)}
          />
          <OutlineMesh
            position={[0.58, 0.0, 0.72]}
            rotation-z={Math.PI / 2}
            scale={[0.068, 0.068, 0.026]}
            outlineWidth={0.009}
            geometry={<cylinderGeometry args={[1, 1, 1, 12]} />}
            material={toon(PALETTE.warningYellow)}
          />
        </group>
        <OutlineMesh
          position={[-0.44, 0.63, 0.61]}
          scale={[0.08, 0.48, 0.09]}
          outlineWidth={0.02}
          geometry={<boxGeometry args={[1, 1, 1]} />}
          material={toon(PALETTE.uiDark)}
        />
        <OutlineMesh
          position={[0.44, 0.63, 0.61]}
          scale={[0.08, 0.48, 0.09]}
          outlineWidth={0.02}
          geometry={<boxGeometry args={[1, 1, 1]} />}
          material={toon(PALETTE.uiDark)}
        />
        <OutlineMesh
          position={[0, 0.9, 0.6]}
          scale={[0.58, 0.1, 0.14]}
          outlineWidth={0.024}
          geometry={<boxGeometry args={[1, 1, 1]} />}
          material={toon(PALETTE.bone)}
        />
        {[-0.25, 0, 0.25].map((x) => (
          <OutlineMesh
            key={`handle-grip-${x}`}
            position={[x, 0.925, 0.49]}
            scale={[0.032, 0.038, 0.03]}
            outlineWidth={0.006}
            geometry={<boxGeometry args={[1, 1, 1]} />}
            material={toon(x === 0 ? PALETTE.warningYellow : '#f0a65c')}
          />
        ))}
        <ContinuousTrunk runtime={runtime} />
      </group>
      <group ref={mouthDisc} position={[-0.035, 0.1, -1.43]}>
        <OutlineMesh
          rotation-x={Math.PI / 2}
          scale={[0.26, 0.21, 0.23]}
          outlineWidth={0.032}
          geometry={<cylinderGeometry args={[0.8, 1, 1, 16]} />}
          material={toon('#f1894c')}
        />
        <OutlineMesh
          position={[0, 0, 0.08]}
          scale={[1, 0.78, 1]}
          outlineWidth={0.026}
          geometry={<torusGeometry args={[0.22, 0.048, 8, 24]} />}
          material={toon('#f1894c')}
        />
        <OutlineMesh
          position={[0, 0, -0.17]}
          scale={[1, 0.78, 1]}
          outlineWidth={0.032}
          geometry={<torusGeometry args={[0.245, 0.058, 10, 28]} />}
          material={toon(PALETTE.warningYellow)}
        />
        <OutlineMesh
          position={[0, 0.01, -0.18]}
          scale={[1, 0.72, 1]}
          outlineWidth={0.014}
          geometry={<torusGeometry args={[0.152, 0.022, 8, 18]} />}
          material={toon(PALETTE.uiDark)}
        />
        {[
          [-0.18, 0.12, -0.19],
          [0.18, 0.12, -0.19],
          [-0.18, -0.12, -0.19],
          [0.18, -0.12, -0.19],
        ].map(([x, y, z], index) => (
          <DetailRivet
            key={`nozzle-clamp-screw-${index}`}
            position={[x, y, z]}
            scale={0.018}
            color={index % 2 === 0 ? PALETTE.bone : PALETTE.warningYellow}
          />
        ))}
        <OutlineMesh
          position={[-0.095, 0.19, -0.18]}
          rotation-z={0.22}
          scale={[0.038, 0.082, 0.034]}
          outlineWidth={0.011}
          geometry={<boxGeometry args={[1, 1, 1]} />}
          material={toon(PALETTE.bone)}
        />
        <OutlineMesh
          position={[0.1, -0.19, -0.18]}
          rotation-z={-0.2}
          scale={[0.038, 0.082, 0.034]}
          outlineWidth={0.011}
          geometry={<boxGeometry args={[1, 1, 1]} />}
          material={toon(PALETTE.bone)}
        />
        <mesh position={[0, 0, -0.19]} scale={[1, 0.72, 1]}>
          <circleGeometry args={[0.195, 36]} />
          <primitive object={mouthMaterial} attach="material" />
        </mesh>
      </group>
      <mesh position={[0, -0.46, 0.28]} rotation-x={-Math.PI / 2} scale={[1.5, 0.86, 1]}>
        <circleGeometry args={[1, 30]} />
        <meshBasicMaterial color="#171421" transparent opacity={0.34} depthWrite={false} />
      </mesh>
    </group>
  )
}

function SuctionRibbon({
  runtime,
  index,
}: {
  runtime: MutableRefObject<VacuumRuntime>
  index: number
}) {
  const mesh = useRef<THREE.Mesh>(null)
  const sideSeed = seededNoise(index + 2.4) * 2 - 1
  const depthSeed = seededNoise(index + 8.7)
  const liftSeed = seededNoise(index + 16.1)

  useFrame(({ clock }) => {
    const state = runtime.current
    const target = mesh.current
    if (!target) return
    const t = clock.elapsedTime
    const forward = state.forward
    rightVector.set(-forward.z, 0, forward.x).normalize()
    const activeFlow = state.pointerDown ? 1.18 : state.active ? 0.94 : 0.68
    const flow = (t * activeFlow * (0.72 + depthSeed * 0.42) + index * 0.19) % 1
    const throatFocus = 1 - flow
    const focused = throatFocus * throatFocus
    const depth = 0.38 + depthSeed * 2.45 + flow * 1.62
    const side = sideSeed * (0.18 + depth * 0.28) * (0.45 + flow * 0.48) + Math.sin(t * 1.7 + index) * 0.09
    const lift = 0.2 + liftSeed * 0.44 + Math.sin(t * 2.1 + index) * 0.04
    mouthVector.copy(state.mouth)
    sourceVector.copy(mouthVector)
      .addScaledVector(forward, depth)
      .addScaledVector(rightVector, side)
    sourceVector.y = lift
    deltaVector.copy(sourceVector).sub(mouthVector)
    target.position.copy(mouthVector).add(sourceVector).multiplyScalar(0.5)
    target.position.y += Math.sin(flow * Math.PI) * 0.055
    target.rotation.set(0, Math.atan2(deltaVector.x, deltaVector.z), 0)
    target.scale.set(0.018 + focused * 0.065 + state.flash * 0.018, 0.014, deltaVector.length() * (0.72 + state.pulse * 0.075))
    const material = target.material as THREE.MeshBasicMaterial
    material.opacity = Math.min(0.32, (0.07 + focused * 0.24 + state.flash * 0.05) * (0.66 + state.pulse * 0.2))
  })

  return (
    <mesh ref={mesh} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={index % 3 === 0 ? '#f7ef93' : index % 3 === 1 ? '#6bd8ff' : '#f47bdc'} transparent opacity={0.18} depthWrite={false} />
    </mesh>
  )
}

function SuctionRibbons({ runtime }: { runtime: MutableRefObject<VacuumRuntime> }) {
  return (
    <group>
      {Array.from({ length: RIBBON_COUNT }, (_, index) => (
        <SuctionRibbon key={index} runtime={runtime} index={index} />
      ))}
    </group>
  )
}

function SuctionPulseBead({
  runtime,
  index,
}: {
  runtime: MutableRefObject<VacuumRuntime>
  index: number
}) {
  const { camera } = useThree()
  const mesh = useRef<THREE.Mesh>(null)
  const sideSeed = seededNoise(index * 2.37 + 4.2) * 2 - 1
  const liftSeed = seededNoise(index * 3.11 + 7.8)
  const speedSeed = seededNoise(index * 1.83 + 1.2)
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: FLOW_BEAD_PALETTE[index % FLOW_BEAD_PALETTE.length],
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [index],
  )

  useFrame(({ clock }) => {
    const target = mesh.current
    if (!target) return
    const state = runtime.current
    const t = clock.elapsedTime
    const active = state.pointerDown ? 1 : state.active ? 0.74 : 0.34
    const travel = (t * (0.72 + speedSeed * 0.6) * (0.7 + active * 0.64) + index * 0.137) % 1
    const focus = smooth01(travel)
    const forward = state.forward
    rightVector.set(-forward.z, 0, forward.x).normalize()
    const depth = 2.45 - focus * 2.25
    const side = sideSeed * (0.46 * (1 - focus) + 0.035) + Math.sin(t * 2.4 + index) * 0.045 * (1 - focus)
    const lift = 0.16 + liftSeed * 0.42 + Math.sin(t * 2.9 + index * 0.43) * 0.028 * (1 - focus)
    target.position.copy(state.mouth)
      .addScaledVector(forward, depth)
      .addScaledVector(rightVector, side)
    target.position.y = lift + focus * 0.04
    target.quaternion.copy(camera.quaternion)
    const pop = Math.sin(travel * Math.PI)
    const size = 0.035 + focus * 0.078 + state.flash * 0.018
    target.scale.set(size * (1 + focus * 0.85), size * (0.64 + pop * 0.22), 1)
    material.opacity = Math.min(0.72, (0.08 + focus * 0.42 + state.flash * 0.12) * pop * (0.42 + active * 0.74))
  })

  return (
    <mesh ref={mesh} material={material} renderOrder={74} frustumCulled={false}>
      <circleGeometry args={[1, 14]} />
    </mesh>
  )
}

function SuctionPulseBeads({ runtime }: { runtime: MutableRefObject<VacuumRuntime> }) {
  return (
    <group>
      {Array.from({ length: FLOW_BEAD_COUNT }, (_, index) => (
        <SuctionPulseBead key={index} runtime={runtime} index={index} />
      ))}
    </group>
  )
}

function SuctionMotes({ runtime }: { runtime: MutableRefObject<VacuumRuntime> }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const initialized = useRef(false)
  const motes = useMemo(() => makeMotes(createRuntime()), [])

  useFrame(({ clock }, dt) => {
    const target = mesh.current
    if (!target) return
    const state = runtime.current
    const cappedDt = Math.min(dt, 0.04)
    const mouth = state.mouth
    const forward = state.forward

    if (!initialized.current) {
      for (let i = 0; i < motes.length; i += 1) {
        spawnMote(motes[i], state, clock.elapsedTime + i * 0.37)
      }
      initialized.current = true
    }

    for (let i = 0; i < motes.length; i += 1) {
      const mote = motes[i]
      const fromMouth = mote.position.clone().sub(mouth)
      const ahead = Math.max(0, fromMouth.normalize().dot(forward))
      const distance = mote.position.distanceTo(mouth)
      const force = computeSuctionForce(mote.position, mote.velocity, mouth, mote.swirl)
      const coneGate = Math.max(0.08, ahead) * Math.max(0, 1 - distance / 4.35)
      mote.velocity.addScaledVector(force.total, coneGate * state.pulse * cappedDt * 0.82)
      mote.velocity.y += Math.sin(clock.elapsedTime * 1.7 + mote.seed) * 0.018 * cappedDt
      mote.velocity.multiplyScalar(Math.exp(-1.2 * cappedDt))
      mote.position.addScaledVector(mote.velocity, cappedDt)
      const swallowDistance = mote.position.distanceTo(mouth)

      if (swallowDistance < 0.34 || Math.abs(mote.position.x) > ARENA_LIMIT_X + 1 || Math.abs(mote.position.z) > ARENA_LIMIT_Z + 1.4) {
        state.swallowCycles += 1
        state.flash = Math.min(1.5, state.flash + 0.24)
        state.recoil = Math.min(1.5, state.recoil + 0.18)
        state.gulpFlow = Math.min(1.85, state.gulpFlow + 0.48)
        state.gulpAge = 0
        spawnMote(mote, state, clock.elapsedTime + i * 0.13)
      }

      const scale = mote.size * (1 + force.influence * 0.85)
      tempObject.position.copy(mote.position)
      tempObject.rotation.set(clock.elapsedTime * 0.7 + mote.seed, mote.seed, clock.elapsedTime * 0.5)
      tempObject.scale.set(scale * (1 + force.influence * 1.2), scale * (1 - force.influence * 0.25), scale)
      tempObject.updateMatrix()
      target.setMatrixAt(i, tempObject.matrix)
    }

    target.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MOTE_COUNT]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 1]} />
      <meshBasicMaterial color="#6bd8ff" transparent opacity={0.94} toneMapped={false} />
    </instancedMesh>
  )
}

function MouthFlash({ runtime }: { runtime: MutableRefObject<VacuumRuntime> }) {
  const ring = useRef<THREE.Mesh>(null)
  const puff = useRef<THREE.Mesh>(null)

  useFrame(() => {
    const state = runtime.current
    rightVector.set(-state.forward.z, 0, state.forward.x).normalize()
    const mouth = state.mouth
    if (ring.current) {
      ring.current.position.copy(mouth).addScaledVector(state.forward, 0.018)
      ring.current.position.y += 0.006
      ring.current.rotation.set(Math.PI / 2, 0, -state.yaw)
      ring.current.scale.setScalar(0.36 + state.flash * 0.34 + state.pulse * 0.045)
      ;(ring.current.material as THREE.MeshBasicMaterial).opacity = 0.06 + state.flash * 0.28
    }
    if (puff.current) {
      puff.current.position.copy(mouth).addScaledVector(state.forward, 0.07)
      puff.current.position.y += 0.018
      puff.current.rotation.set(Math.PI / 2, 0, -state.yaw)
      puff.current.scale.set(0.42 + state.flash * 0.46, 0.2 + state.flash * 0.22, 1)
      ;(puff.current.material as THREE.MeshBasicMaterial).opacity = 0.04 + state.flash * 0.18
    }
  })

  return (
    <group>
      <mesh ref={ring} frustumCulled={false}>
        <torusGeometry args={[0.62, 0.05, 8, 28]} />
        <meshBasicMaterial color="#fff2a3" transparent opacity={0.12} depthWrite={false} />
      </mesh>
      <mesh ref={puff} frustumCulled={false}>
        <circleGeometry args={[1, 28]} />
        <meshBasicMaterial color="#78e5ff" transparent opacity={0.12} depthWrite={false} />
      </mesh>
    </group>
  )
}

function BamBurstLayer({ runtime }: { runtime: MutableRefObject<VacuumRuntime> }) {
  const { camera } = useThree()
  const group = useRef<THREE.Group>(null)
  const burst = useRef<THREE.Mesh>(null)
  const burstOutline = useRef<THREE.Mesh>(null)
  const snapBurst = useRef<THREE.Mesh>(null)
  const snapOutline = useRef<THREE.Mesh>(null)
  const corePop = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const pinchRing = useRef<THREE.Mesh>(null)
  const flecks = useRef<Array<THREE.Mesh | null>>([])
  const slashes = useRef<Array<THREE.Mesh | null>>([])
  const dots = useRef<Array<THREE.Mesh | null>>([])
  const startedAt = useRef(-10)
  const lastCycle = useRef(0)
  const strength = useRef(1)
  const variant = useRef(0)
  const burstGeometry = useMemo(() => makeBurstGeometry(11, 0.34, 0.82), [])
  const burstOutlineGeometry = useMemo(() => makeBurstGeometry(11, 0.39, 0.92), [])
  const snapGeometry = useMemo(() => makeBurstGeometry(7, 0.28, 0.6), [])
  const snapOutlineGeometry = useMemo(() => makeBurstGeometry(7, 0.32, 0.68), [])
  const burstMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#f6d34f',
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    [],
  )
  const outlineMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: PALETTE.outline,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    [],
  )
  const ringMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#fff2a3',
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    [],
  )
  const snapMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#f47bdc',
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    [],
  )
  const coreMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#fff8c4',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    [],
  )
  const fleckMaterials = useMemo(
    () =>
      Array.from({ length: COMIC_FLECK_COUNT }, (_, index) => {
        const colors = ['#f47bdc', '#6bd8ff', '#fff2a3', '#83ef79']
        return new THREE.MeshBasicMaterial({
          color: colors[index % colors.length],
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest: false,
          toneMapped: false,
        })
      }),
    [],
  )
  const dotMaterials = useMemo(
    () =>
      Array.from({ length: COMIC_DOT_COUNT }, (_, index) => {
        const colors = ['#6bd8ff', '#fff2a3', '#f47bdc']
        return new THREE.MeshBasicMaterial({
          color: colors[index % colors.length],
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest: false,
          toneMapped: false,
        })
      }),
    [],
  )
  const slashMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#fff8c4',
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    [],
  )

  useFrame(({ clock }) => {
    const state = runtime.current
    const now = clock.elapsedTime
    const swallowed = state.swallowCycles - lastCycle.current
    if (swallowed > 0) {
      startedAt.current = now
      strength.current = Math.min(1.28, 0.78 + swallowed * 0.08 + state.flash * 0.16)
      variant.current = state.swallowCycles % 4
      lastCycle.current = state.swallowCycles
    }

    const age = now - startedAt.current
    const duration = 0.46
    const gulpVisible = age >= 0 && age < duration
    const idleWave = (Math.sin(now * 8.4 + state.swallowCycles * 0.73) + 1) * 0.5
    const idleStrength = 0.34 + idleWave * 0.36
    const visible = gulpVisible || state.pulse > 0.5
    const layer = group.current
    if (!layer) return
    layer.visible = visible

    const fade = gulpVisible ? Math.max(0, 1 - age / duration) : idleStrength
    const pop = gulpVisible ? easeOutBack(Math.min(1, Math.max(0, age) / 0.18)) : 0.26 + idleWave * 0.16
    const snap = gulpVisible ? Math.sin(Math.min(1, Math.max(0, age) / 0.16) * Math.PI) : idleStrength
    const impact = gulpVisible ? strength.current : 0.36
    layer.position.copy(state.mouth).addScaledVector(state.forward, 0.012)
    layer.position.y += 0.014
    layer.quaternion.copy(camera.quaternion)
    layer.rotateZ(Math.sin(now * 13.0) * 0.03 + state.swallowCycles * 0.47)
    layer.scale.setScalar(gulpVisible ? 0.2 + pop * (variant.current === 1 ? 0.22 : 0.17) * impact : 0.34 + idleWave * 0.055)

    if (burst.current) {
      ;(burst.current.material as THREE.MeshBasicMaterial).opacity = gulpVisible ? (variant.current === 2 ? 0.26 : 0.42) * fade : 0.32 * idleStrength
      burst.current.scale.set(0.8 + pop * 0.12, 0.62 + pop * 0.08, 1)
      burst.current.rotation.z = -age * 3.6
    }
    if (burstOutline.current) {
      ;(burstOutline.current.material as THREE.MeshBasicMaterial).opacity = gulpVisible ? (variant.current === 2 ? 0.48 : 0.72) * fade : 0.78 * idleStrength
      burstOutline.current.scale.set(0.86 + pop * 0.14, 0.66 + pop * 0.1, 1)
      burstOutline.current.rotation.z = -age * 3.6
    }
    if (snapBurst.current) {
      const snapOffset = variant.current % 2 === 0 ? -0.2 : 0.18
      ;(snapBurst.current.material as THREE.MeshBasicMaterial).opacity = 0.46 * fade * snap
      snapBurst.current.position.set(snapOffset, 0.14 * Math.sin(state.swallowCycles), 0.017)
      snapBurst.current.scale.set(0.42 + pop * 0.14, 0.36 + pop * 0.1, 1)
      snapBurst.current.rotation.z = age * 6.5 + variant.current
    }
    if (snapOutline.current) {
      const snapOffset = variant.current % 2 === 0 ? -0.2 : 0.18
      ;(snapOutline.current.material as THREE.MeshBasicMaterial).opacity = 0.62 * fade * snap
      snapOutline.current.position.set(snapOffset, 0.14 * Math.sin(state.swallowCycles), 0.016)
      snapOutline.current.scale.set(0.47 + pop * 0.16, 0.4 + pop * 0.12, 1)
      snapOutline.current.rotation.z = age * 6.5 + variant.current
    }
    if (corePop.current) {
      ;(corePop.current.material as THREE.MeshBasicMaterial).opacity = gulpVisible ? 0.9 * fade : 0.55 * idleStrength
      corePop.current.position.set(Math.sin(now * 10.0) * 0.035, Math.cos(now * 8.0) * 0.026, 0.07)
      corePop.current.rotation.set(age * 6.0, now * 4.0, age * 3.0)
      corePop.current.scale.setScalar(0.22 + snap * 0.12)
    }
    if (ring.current) {
      ;(ring.current.material as THREE.MeshBasicMaterial).opacity = gulpVisible ? 0.34 * fade : 0.38 * idleStrength
      ring.current.scale.set(0.4 + pop * 0.5 * impact, 0.28 + pop * 0.28 * impact, 1)
    }
    if (pinchRing.current) {
      ;(pinchRing.current.material as THREE.MeshBasicMaterial).opacity = gulpVisible ? 0.42 * fade * snap : 0.28 * snap
      pinchRing.current.scale.set(0.24 + pop * 0.2, 0.12 + pop * 0.14, 1)
      pinchRing.current.rotation.z = Math.PI * 0.5 + age * 5.0
    }

    for (let index = 0; index < COMIC_FLECK_COUNT; index += 1) {
      const fleck = flecks.current[index]
      if (!fleck) continue
      const angle = (index / COMIC_FLECK_COUNT) * Math.PI * 2 + state.swallowCycles * 0.19
      const stagger = 0.68 + seededNoise(index + state.swallowCycles * 0.31) * 0.5
      const travel = (0.18 + pop * 0.54) * stagger
      fleck.position.set(Math.cos(angle) * travel, Math.sin(angle) * travel * 0.62, 0.022 + index * 0.001)
      fleck.rotation.z = angle + age * 7.0
      fleck.scale.set(0.07 + pop * 0.07, 0.026 + fade * 0.012, 0.012)
      ;(fleck.material as THREE.MeshBasicMaterial).opacity = gulpVisible ? 0.68 * fade : (index < 5 ? 0.26 * idleStrength : 0)
    }

    for (let index = 0; index < COMIC_SLASH_COUNT; index += 1) {
      const slash = slashes.current[index]
      if (!slash) continue
      const angle = (index / COMIC_SLASH_COUNT) * Math.PI * 2 + variant.current * 0.6
      const travel = 0.34 + pop * 0.46 + (index % 2) * 0.08
      slash.position.set(Math.cos(angle) * travel, Math.sin(angle) * travel * 0.54, 0.038 + index * 0.001)
      slash.rotation.z = angle + Math.PI / 2
      slash.scale.set(0.16 + snap * 0.08, 0.018 + fade * 0.01, 0.01)
      ;(slash.material as THREE.MeshBasicMaterial).opacity = gulpVisible ? 0.44 * fade * (0.45 + snap) : (index < 4 ? 0.24 * idleStrength : 0)
    }

    for (let index = 0; index < COMIC_DOT_COUNT; index += 1) {
      const dot = dots.current[index]
      if (!dot) continue
      const angle = (index / COMIC_DOT_COUNT) * Math.PI * 2 - state.swallowCycles * 0.28
      const travel = 0.12 + pop * (0.28 + index * 0.018)
      dot.position.set(Math.cos(angle) * travel * 0.82, Math.sin(angle) * travel * 0.52, 0.052 + index * 0.001)
      dot.scale.setScalar(0.055 + snap * 0.035)
      ;(dot.material as THREE.MeshBasicMaterial).opacity = gulpVisible ? 0.58 * fade : 0.3 * idleStrength
    }
  })

  return (
    <group ref={group} visible={false}>
      <mesh ref={burstOutline} geometry={burstOutlineGeometry} material={outlineMaterial} renderOrder={86} frustumCulled={false} />
      <mesh ref={burst} geometry={burstGeometry} material={burstMaterial} position={[0, 0, 0.01]} renderOrder={87} frustumCulled={false} />
      <mesh ref={snapOutline} geometry={snapOutlineGeometry} material={outlineMaterial} renderOrder={88} frustumCulled={false} />
      <mesh ref={snapBurst} geometry={snapGeometry} material={snapMaterial} renderOrder={89} frustumCulled={false} />
      <mesh ref={corePop} material={coreMaterial} position={[0, 0, 0.07]} renderOrder={93} frustumCulled={false}>
        <octahedronGeometry args={[1, 0]} />
      </mesh>
      <mesh ref={ring} material={ringMaterial} position={[0, 0, 0.02]} renderOrder={88} frustumCulled={false}>
        <torusGeometry args={[0.42, 0.04, 8, 24]} />
      </mesh>
      <mesh ref={pinchRing} material={ringMaterial} position={[0, 0, 0.025]} renderOrder={89} frustumCulled={false}>
        <torusGeometry args={[0.34, 0.036, 8, 20]} />
      </mesh>
      {Array.from({ length: COMIC_SLASH_COUNT }, (_, index) => (
        <mesh
          key={`slash-${index}`}
          ref={(node) => {
            slashes.current[index] = node
          }}
          material={slashMaterial}
          position={[0, 0, 0.03 + index * 0.001]}
          renderOrder={90}
          frustumCulled={false}
        >
          <boxGeometry args={[1, 1, 1]} />
        </mesh>
      ))}
      {Array.from({ length: COMIC_FLECK_COUNT }, (_, index) => (
        <mesh
          key={`fleck-${index}`}
          ref={(node) => {
            flecks.current[index] = node
          }}
          material={fleckMaterials[index]}
          position={[0, 0, 0.03 + index * 0.001]}
          renderOrder={91}
          frustumCulled={false}
        >
          <boxGeometry args={[1, 1, 1]} />
        </mesh>
      ))}
      {Array.from({ length: COMIC_DOT_COUNT }, (_, index) => (
        <mesh
          key={`dot-${index}`}
          ref={(node) => {
            dots.current[index] = node
          }}
          material={dotMaterials[index]}
          position={[0, 0, 0.045 + index * 0.001]}
          renderOrder={92}
          frustumCulled={false}
        >
          <circleGeometry args={[1, 10]} />
        </mesh>
      ))}
    </group>
  )
}

function VacuumScene() {
  const runtime = useRef(createRuntime())

  return (
    <>
      <VacuumCamera />
      <VacuumPointer runtime={runtime} />
      <VacuumMotion runtime={runtime} />
      <ambientLight intensity={1.6} />
      <directionalLight position={[-3, 5, 4]} intensity={2.2} />
      <directionalLight position={[4, 3, -3]} intensity={0.7} color="#7ee8ff" />
      <Stage />
      <SuctionRibbons runtime={runtime} />
      <SuctionPulseBeads runtime={runtime} />
      <SuctionMotes runtime={runtime} />
      <MouthFlash runtime={runtime} />
      <BamBurstLayer runtime={runtime} />
      <VacuumBody runtime={runtime} />
    </>
  )
}

export function VacuumLab() {
  return (
    <div className="vacuumLab">
      <Canvas
        dpr={VACUUM_DPR}
        camera={{ fov: 46, position: [0, 5.15, 7.4], near: 0.1, far: 60 }}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#2f2546']} />
        <VacuumScene />
      </Canvas>
    </div>
  )
}
