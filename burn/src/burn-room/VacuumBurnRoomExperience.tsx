'use client'

import { OrbitControls, RoundedBox } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import React, { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { OutlineMesh } from '../render/OutlineMesh'
import { getToonRampTexture } from '../shaders/toonRamp'
import {
  createNozzleEntryScratch,
  createRuntime,
  setNozzleEntryPoint,
  setNozzleMouthPoint,
  VacuumBody,
  type NozzleEntryScratch,
  type VacuumRuntime,
} from '../vacuum/VacuumLab'
import { VacuumStylePurpleBox } from '../vacuum/VacuumStyleBox'

const TABLE_POSITION = [-1.55, 0.02, 0.18] as const
const BOX_TABLE_LOCAL_X = 0
const TABLE_TOP_LOCAL_Y = 0.376 + 0.12 / 2
const TABLE_TOP_Y = TABLE_POSITION[1] + TABLE_TOP_LOCAL_Y
// These offsets match VacuumStylePurpleBox's authored pivot, including the outer toon outline.
// The present's visible bottom sits well above its parent origin, so contact placement must use
// the measured asset bounds rather than the smaller body-only dimensions.
const BOX_LOCAL_BOTTOM_OFFSET = 0.396
const BOX_TABLE_CLEARANCE = 0
const BOX_TABLE_REST_Y = TABLE_TOP_Y - BOX_LOCAL_BOTTOM_OFFSET + BOX_TABLE_CLEARANCE
const BOX_POSITION = [TABLE_POSITION[0] + BOX_TABLE_LOCAL_X, BOX_TABLE_REST_Y, TABLE_POSITION[2]] as const
type TableBoxSlot = readonly [x: number, z: number, yaw: number]
const TABLE_BOX_SLOTS = [
  [BOX_POSITION[0], BOX_POSITION[2], 0],
  [BOX_POSITION[0] - 0.46, BOX_POSITION[2] - 0.38, -0.22],
  [BOX_POSITION[0] + 0.48, BOX_POSITION[2] - 0.34, 0.18],
  [BOX_POSITION[0] - 0.58, BOX_POSITION[2] + 0.42, 0.24],
  [BOX_POSITION[0] + 0.54, BOX_POSITION[2] + 0.36, -0.16],
] as const satisfies readonly TableBoxSlot[]
const WALLET_BOX_DROP_STAGGER = 0.11
const WALLET_BOX_DROP_FLIGHT_TIME = 1.06
const WALLET_BOX_DROP_SETTLE_TIME = 0.66
const WALLET_BOX_DROP_START_OFFSETS = [
  [-0.08, -0.05],
  [0.12, 0.08],
  [-0.11, 0.06],
  [0.1, -0.09],
  [-0.06, 0.11],
] as const
const CONVEYOR_POSITION = [2.88, 0.02, 0.18] as const
const CONVEYOR_BELT_TOP_Y = CONVEYOR_POSITION[1] + 0.376 + 0.08 / 2
const BOX_CONVEYOR_REST_Y = CONVEYOR_BELT_TOP_Y - BOX_LOCAL_BOTTOM_OFFSET + BOX_TABLE_CLEARANCE
const TRAPDOOR_POSITION = [CONVEYOR_POSITION[0] + 1.14, -0.265, CONVEYOR_POSITION[2]] as const
const ROOM_FLOOR_Y = -0.35
const ROOM_LEFT_X = -4.95
const ROOM_RIGHT_X = 5.95
const ROOM_BACK_Z = -3.16
const ROOM_FRONT_Z = 3.1
const ROOM_CENTER_X = (ROOM_LEFT_X + ROOM_RIGHT_X) / 2
const ROOM_CENTER_Z = (ROOM_BACK_Z + ROOM_FRONT_Z) / 2
const DEMO_WALLET_BOX_COUNT = 5
const BURN_CATALOG_ITEMS = [
  {
    id: 'archive-tag',
    title: 'MUSEUM TAG',
    boxCost: 1,
    accent: '#2f7168',
    icon: 'tag',
  },
  {
    id: 'gilded-seal',
    title: 'GOLD SEAL',
    boxCost: 2,
    accent: '#8a5a24',
    icon: 'seal',
  },
] as const
type BurnCatalogItem = (typeof BURN_CATALOG_ITEMS)[number]
type BurnCatalogItemId = BurnCatalogItem['id']
export type BurnRoomCatalogItemId = BurnCatalogItemId
export type BurnRoomCatalogItem = BurnCatalogItem
export type BurnRoomBurnRequest = {
  source: 'vacuum-head-box-ritual'
  boxId: BurnCatalogItemId
  itemId: BurnCatalogItemId
  itemTitle: string
  tier: BurnCatalogItem['boxCost']
  boxCount: BurnCatalogItem['boxCost']
  visualState: 'burn-complete'
}
export type VacuumBurnRoomExperienceProps = {
  walletConnected?: boolean
  walletLabel?: string
  availableBoxCount?: number
  soldOutItemIds?: readonly BurnCatalogItemId[]
  showDevSoldOutSwitch?: boolean
  onConnectWallet?: () => void | Promise<void>
  onBurnRequested?: (request: BurnRoomBurnRequest) => void | Promise<void>
  burn2Remaining?: number
  burn1Open?: boolean
}

// Context so BurnCounterPlaque can read status without prop-drilling through ToonRoomShell
const BurnStatusContext = React.createContext<{ burn2Remaining: number; burn1Open: boolean }>({
  burn2Remaining: 5,
  burn1Open: true,
})
const DEFAULT_BURN_CATALOG_ITEM_ID: BurnCatalogItemId = BURN_CATALOG_ITEMS[0].id
function getBurnCatalogItem(itemId: BurnCatalogItemId) {
  return BURN_CATALOG_ITEMS.find((item) => item.id === itemId) ?? BURN_CATALOG_ITEMS[0]
}
const BURN_DETAIL_CHARGE_DURATION = 1.16
const BURN_DETAIL_EXIT_START = 0.76
const BOX_CONTACT_BOUNDS = {
  minX: -0.199,
  maxX: 0.204,
  minY: BOX_LOCAL_BOTTOM_OFFSET,
  maxY: 0.743,
  minZ: -0.186,
  maxZ: 0.2,
} as const
const BOX_CONTACT_EULER = new THREE.Euler()
const BOX_CONTACT_CORNER = new THREE.Vector3()
const CEILING_TRAPDOOR_POSITION = [BOX_POSITION[0], 3.36, BOX_POSITION[2]] as const
const BOX_LOCAL_TOP_OFFSET = 0.743
const CEILING_TRAPDOOR_PORTAL_BOTTOM_Y = CEILING_TRAPDOOR_POSITION[1] - 0.13
const BOX_DROP_START = [
  CEILING_TRAPDOOR_POSITION[0],
  CEILING_TRAPDOOR_PORTAL_BOTTOM_Y - BOX_LOCAL_TOP_OFFSET - 0.04,
  CEILING_TRAPDOOR_POSITION[2],
] as const
const BOX_TARGET = [0.08, 0.68, 0.08] as const
const VACUUM_STAGE_POSITION = [0.88, -0.08, -1.08] as const
const VACUUM_STAGE_SCALE = 0.72
const CAMERA_FACING_VACUUM_YAW = Math.PI
const VACUUM_FIXED_FORWARD = [0, 0, 1] as const
const VACUUM_GROUNDED_LOCAL_Y = 0.28
const VACUUM_MOUTH_ROOT_OFFSET = [-0.035, 0.135, 1.39] as const
const VACUUM_BODY_WORLD_Y = VACUUM_STAGE_POSITION[1] + VACUUM_GROUNDED_LOCAL_Y * VACUUM_STAGE_SCALE
const VACUUM_IDLE_BODY_WORLD = [1.42, VACUUM_BODY_WORLD_Y, -1.46] as const
const VACUUM_PICKUP_BODY_WORLD = [0.96, VACUUM_BODY_WORLD_Y, -1.86] as const
const VACUUM_CONVEYOR_BODY_WORLD = [
  CONVEYOR_POSITION[0] - 0.42 - VACUUM_MOUTH_ROOT_OFFSET[0] * VACUUM_STAGE_SCALE,
  VACUUM_BODY_WORLD_Y,
  CONVEYOR_POSITION[2] - 0.42 - VACUUM_MOUTH_ROOT_OFFSET[2] * VACUUM_STAGE_SCALE,
] as const
const VACUUM_IDLE_HOSE_LIFT = 0.08
const VACUUM_STAGE_FLOOR_LOCAL_Y = (ROOM_FLOOR_Y - VACUUM_STAGE_POSITION[1]) / VACUUM_STAGE_SCALE
const VACUUM_BAG_GLOW_LOCAL_POSITION = [0, 0.78, 0.88] as const
const CONVEYOR_HOSE_TARGET = [
  CONVEYOR_POSITION[0] - 0.42,
  CONVEYOR_BELT_TOP_Y + 0.32,
  CONVEYOR_POSITION[2] - 0.28,
] as const
const BOX_HOSE_CONTACT_RADIUS = 0.155
const BOX_HOSE_SEAL_FRONT_GAP = 0.045
const BOX_HOSE_SEAL_FINAL_FRONT_GAP = 0.016
const BOX_HOSE_CONTACT_LOCAL_Y = 0.6
const BOX_HOSE_CONTACT_LIFT = 0.035
const BOX_PICKUP_HOSE_AIR_GAP = 0.29
const BOX_SUCTION_LIFT_START_AMOUNT = 0.58
const BOX_SUCTION_PRESEAL_START_AMOUNT = 0.62
const BOX_SUCTION_SEAL_LOCK_START_AMOUNT = 0.72
const BOX_CONVEYOR_DROP_RELEASE_HEIGHT = 0.12
const BOX_CONVEYOR_DROP_DURATION = 0.2
const BOX_CONVEYOR_DROP_BOUNCE_HEIGHT = 0.038
const BOX_IDLE_JIGGLE_HOP = 0.034
const BOX_IDLE_JIGGLE_LEAN = 0.068
const BOX_IDLE_JIGGLE_SQUASH = 0.07
const MAX_TRAPDOOR_OPEN_ANGLE = 2.15
const CEILING_TRAPDOOR_OPEN_ANGLE = 1.18
const BOX_DROP_RELEASE_TIME = 0.88
const BOX_DROP_IMPACT_TIME = 2.16
const BOX_SUCTION_START_TIME = BOX_DROP_IMPACT_TIME + 0.34
const BOX_PULL_START_TIME = BOX_SUCTION_START_TIME + 0.42
const BOX_SUCTION_LATCH_TIME = BOX_SUCTION_START_TIME + 1.48
const BOX_CARRY_POSE_TIME = BOX_SUCTION_LATCH_TIME + 0.9
const BOX_CONVEYOR_PLACE_TIME = BOX_CARRY_POSE_TIME + 0.42
const BOX_CONVEYOR_SETTLE_TIME = BOX_CONVEYOR_PLACE_TIME
const BOX_CONVEYOR_START_TIME = BOX_CONVEYOR_SETTLE_TIME
const BOX_CONVEYOR_END_TIME = BOX_CONVEYOR_START_TIME + 1.04
const BOX_FIRE_DROP_START_TIME = BOX_CONVEYOR_END_TIME - 0.36
const BOX_FIRE_DISAPPEAR_TIME = BOX_FIRE_DROP_START_TIME + 0.68
const BOX_DROP_DURATION = BOX_FIRE_DISAPPEAR_TIME + 0.82
const BOX_FINAL_RUN_SETTLE_TIME = 0.9
const BOX_RUN_START_TIME = BOX_DROP_IMPACT_TIME - 0.72
const BOX_NEXT_PICKUP_RESTART_TIME = BOX_CONVEYOR_PLACE_TIME + 0.22
const BOX_CONVEYOR_START_POSITION = [
  CONVEYOR_POSITION[0] - 0.46,
  BOX_CONVEYOR_REST_Y,
  CONVEYOR_POSITION[2],
] as const
const BOX_CONVEYOR_END_POSITION = [
  TRAPDOOR_POSITION[0] - 0.08,
  BOX_CONVEYOR_START_POSITION[1],
  TRAPDOOR_POSITION[2],
] as const
const BOX_FIRE_EXIT_START_AMOUNT = (BOX_FIRE_DROP_START_TIME - BOX_CONVEYOR_START_TIME) / (BOX_CONVEYOR_END_TIME - BOX_CONVEYOR_START_TIME)
const BOX_FIRE_EXIT_BELT_AMOUNT = movingEase01(BOX_FIRE_EXIT_START_AMOUNT)
const BOX_FIRE_DROP_START_POSITION = [
  BOX_CONVEYOR_START_POSITION[0] + (BOX_CONVEYOR_END_POSITION[0] - BOX_CONVEYOR_START_POSITION[0]) * BOX_FIRE_EXIT_BELT_AMOUNT,
  BOX_CONVEYOR_START_POSITION[1],
  BOX_CONVEYOR_START_POSITION[2] + (BOX_CONVEYOR_END_POSITION[2] - BOX_CONVEYOR_START_POSITION[2]) * BOX_FIRE_EXIT_BELT_AMOUNT,
] as const
const BOX_FIRE_DROP_START_WOBBLE = Math.sin(BOX_FIRE_EXIT_START_AMOUNT * Math.PI * 2.9 + 0.35)
  * Math.sin(BOX_FIRE_EXIT_START_AMOUNT * Math.PI)
  * 0.012
const BOX_FIRE_DROP_START_ROTATION_X = BOX_FIRE_DROP_START_WOBBLE * 0.42
const BOX_FIRE_DROP_START_ROTATION_Y = 0.16 + BOX_FIRE_EXIT_BELT_AMOUNT * 0.22
const BOX_FIRE_DROP_START_ROTATION_Z = -BOX_FIRE_DROP_START_WOBBLE
const BOX_FIRE_DIVE_TARGET = [TRAPDOOR_POSITION[0] - 0.19, TRAPDOOR_POSITION[1] - 0.08, TRAPDOOR_POSITION[2] + 0.016] as const
const TABLE_COLLIDER = {
  minX: TABLE_POSITION[0] - 3.9 / 2 - 0.04,
  maxX: TABLE_POSITION[0] + 3.9 / 2 + 0.04,
  minZ: TABLE_POSITION[2] - 2.9 / 2 - 0.04,
  maxZ: TABLE_POSITION[2] + 2.9 / 2 + 0.04,
} as const
const CONVEYOR_COLLIDER = {
  minX: CONVEYOR_POSITION[0] - 1.42 / 2 - 0.04,
  maxX: CONVEYOR_POSITION[0] + 1.42 / 2 + 0.04,
  minZ: CONVEYOR_POSITION[2] - 0.72 / 2 - 0.04,
  maxZ: CONVEYOR_POSITION[2] + 0.72 / 2 + 0.04,
} as const
const VACUUM_BODY_COLLISION_RADIUS = 0.68
type DropSequenceStart = MutableRefObject<number | null>
type CarryoverBoxSequence = {
  sequenceStart: number
  slotIndex: number
}
type CarryoverBoxSequencesRef = MutableRefObject<CarryoverBoxSequence[]>

type VacuumPoseScratch = {
  aimWorld: THREE.Vector3
  aimLocal: THREE.Vector3
  localPosition: THREE.Vector3
  forward: THREE.Vector3
  mouthLocal: THREE.Vector3
  hoseLift: number
  collisionWorld: THREE.Vector3
  nozzle: NozzleEntryScratch
  runtime: VacuumRuntime
}

type BoxPoseSample = {
  position: THREE.Vector3
  rotation: THREE.Euler
  scale: THREE.Vector3
  shadowScale: THREE.Vector3
  mouthWorld: THREE.Vector3
  mouthForward: THREE.Vector3
  source: THREE.Vector3
  target: THREE.Vector3
  direction: THREE.Vector3
  right: THREE.Vector3
  visible: boolean
  shadowVisible: boolean
  suctionAmount: number
  pullAmount: number
  latchAmount: number
}

function tableTopMaterial() {
  return <meshToonMaterial color="#bd6a32" gradientMap={getToonRampTexture()} />
}

function tableLegMaterial() {
  return <meshToonMaterial color="#844622" gradientMap={getToonRampTexture()} />
}

function tableUndersideMaterial() {
  return <meshToonMaterial color="#5b3323" gradientMap={getToonRampTexture()} />
}

function tableBrassEdgeMaterial() {
  return <meshBasicMaterial color="#d6b55b" />
}

function tableSubtleGrainMaterial() {
  return <meshBasicMaterial color="#f4d28a" transparent opacity={0.12} />
}

function beltMaterial() {
  return <meshToonMaterial color="#23202e" gradientMap={getToonRampTexture()} />
}

function roomFloorMaterial() {
  return <meshToonMaterial color="#bec8bd" gradientMap={getToonRampTexture()} />
}

function roomWallMaterial() {
  return <meshToonMaterial color="#dfe3d3" gradientMap={getToonRampTexture()} />
}

function roomSideWallMaterial() {
  return <meshToonMaterial color="#bfccc1" gradientMap={getToonRampTexture()} />
}

function roomTrimMaterial() {
  return <meshBasicMaterial color="#211827" />
}

function roomFloorLineMaterial() {
  return <meshBasicMaterial color="#66766f" transparent opacity={0.24} />
}

function roomWoodGrainMaterial() {
  return <meshBasicMaterial color="#f8efd8" transparent opacity={0.1} />
}

function roomUpperWallLineMaterial() {
  return <meshBasicMaterial color="#73827b" transparent opacity={0.24} />
}

function roomWallContactShadowMaterial() {
  return <meshBasicMaterial color="#211827" transparent opacity={0.1} depthWrite={false} />
}

function roomStageContactShadowMaterial() {
  return <meshBasicMaterial color="#211827" transparent opacity={0.055} depthWrite={false} />
}

function stageBackdropMaterial() {
  return <meshToonMaterial color="#bfd5c8" gradientMap={getToonRampTexture()} />
}

function stageBackdropUpperMaterial() {
  return <meshToonMaterial color="#e7b17d" gradientMap={getToonRampTexture()} />
}

function stageBackdropSideMaterial() {
  return <meshToonMaterial color="#87a99a" gradientMap={getToonRampTexture()} />
}

function stagePlinthMaterial() {
  return <meshToonMaterial color="#7b553d" gradientMap={getToonRampTexture()} />
}

function stagePlinthFaceMaterial() {
  return <meshToonMaterial color="#4f392f" gradientMap={getToonRampTexture()} />
}

function stageGroundShadowMaterial() {
  return <meshBasicMaterial color="#17121f" transparent opacity={0.14} depthWrite={false} />
}

function stageDoorMaterial() {
  return <meshToonMaterial color="#376f68" gradientMap={getToonRampTexture()} />
}

function stageDoorPanelMaterial() {
  return <meshToonMaterial color="#2b5954" gradientMap={getToonRampTexture()} />
}

function stageDoorInsetMaterial() {
  return <meshToonMaterial color="#dce7d8" gradientMap={getToonRampTexture()} />
}

function stageDoorGlowMaterial() {
  return <meshBasicMaterial color="#ffe3a1" transparent opacity={0.14} depthWrite={false} toneMapped={false} />
}

function stageDoorGlassLineMaterial() {
  return <meshBasicMaterial color="#315f5d" transparent opacity={0.62} />
}

function stageDoorBrassShadowMaterial() {
  return <meshBasicMaterial color="#6f4c12" />
}

function mcmDoorMatShadowMaterial() {
  return <meshBasicMaterial color="#1b1320" transparent opacity={0.16} depthWrite={false} />
}

function mcmDoorMatBaseMaterial() {
  return <meshBasicMaterial color="#ad6844" side={THREE.DoubleSide} toneMapped={false} />
}

function mcmDoorMatInsetMaterial() {
  return <meshBasicMaterial color="#eadfbd" side={THREE.DoubleSide} toneMapped={false} />
}

function mcmDoorMatCreamMaterial() {
  return <meshBasicMaterial color="#f5dfaa" side={THREE.DoubleSide} toneMapped={false} />
}

function mcmDoorMatGoldMaterial() {
  return <meshBasicMaterial color="#d6b55b" side={THREE.DoubleSide} toneMapped={false} />
}

function mcmDoorMatTealMaterial() {
  return <meshBasicMaterial color="#2f7168" side={THREE.DoubleSide} toneMapped={false} />
}

function mcmPanelInkMaterial() {
  return <meshBasicMaterial color="#201527" />
}

function mcmPanelWalnutMaterial() {
  return <meshToonMaterial color="#725f4c" gradientMap={getToonRampTexture()} />
}

function mcmPanelDarkWalnutMaterial() {
  return <meshToonMaterial color="#4c3d35" gradientMap={getToonRampTexture()} />
}

function mcmPanelBrassMaterial() {
  return <meshBasicMaterial color="#d1b762" />
}

function roomLampShadeMaterial() {
  return <meshToonMaterial color="#f0d596" gradientMap={getToonRampTexture()} />
}

function roomStandingLampShadeMaterial() {
  return <meshToonMaterial color="#eabf6a" gradientMap={getToonRampTexture()} />
}

function roomStandingLampPanelMaterial() {
  return <meshToonMaterial color="#f6dda0" gradientMap={getToonRampTexture()} />
}

function roomStandingLampTrimMaterial() {
  return <meshBasicMaterial color="#211827" />
}

function roomStandingLampShadeHighlightMaterial() {
  return <meshBasicMaterial color="#fff0b6" transparent opacity={0.22} depthWrite={false} toneMapped={false} />
}

function roomLampPullChainMaterial() {
  return <meshBasicMaterial color="#f1cf6a" />
}

function roomLampInnerMaterial() {
  return <meshBasicMaterial color="#fff3bd" side={THREE.DoubleSide} toneMapped={false} />
}

function roomLampGlowMaterial() {
  return <meshBasicMaterial color="#fff0a6" transparent opacity={0.22} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
}

function roomLampWallWashMaterial({ color = '#ffd47a', opacity = 0.18 }: { color?: string; opacity?: number } = {}) {
  return (
    <meshBasicMaterial
      color={color}
      transparent
      opacity={opacity}
      depthWrite={false}
      side={THREE.DoubleSide}
      toneMapped={false}
    />
  )
}

function roomLampFloorPoolMaterial() {
  return (
    <meshBasicMaterial
      color="#ffc86b"
      transparent
      opacity={0.09}
      depthWrite={false}
      side={THREE.DoubleSide}
      toneMapped={false}
    />
  )
}

function trapdoorLightSpillMaterial() {
  return <meshBasicMaterial color="#ffad38" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
}

function trapdoorCoreGlowMaterial() {
  return <meshBasicMaterial color="#fff1a8" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
}

function roomClockFaceMaterial() {
  return <meshToonMaterial color="#f4ecd0" gradientMap={getToonRampTexture()} />
}

function roomClockInnerFaceMaterial() {
  return <meshToonMaterial color="#d9efe5" gradientMap={getToonRampTexture()} />
}

function roomClockRimMaterial() {
  return <meshToonMaterial color="#c99d48" gradientMap={getToonRampTexture()} />
}

function roomClockWalnutMaterial() {
  return <meshToonMaterial color="#624330" gradientMap={getToonRampTexture()} />
}

function roomClockHandMaterial() {
  return <meshBasicMaterial color="#211827" />
}

function roomClockSecondHandMaterial() {
  return <meshBasicMaterial color="#e87768" />
}

function roomClockGlassHighlightMaterial() {
  return <meshBasicMaterial color="#fff7d5" transparent opacity={0.28} depthWrite={false} toneMapped={false} />
}

function roomClockShadowMaterial() {
  return <meshBasicMaterial color="#17121f" transparent opacity={0.16} depthWrite={false} />
}

function galleryFrameMaterial() {
  return <meshToonMaterial color="#4c3d35" gradientMap={getToonRampTexture()} />
}

function galleryMatMaterial() {
  return <meshToonMaterial color="#c7d4c3" gradientMap={getToonRampTexture()} />
}

function galleryCreamMaterial() {
  return <meshBasicMaterial color="#f3e5b9" toneMapped={false} />
}

function galleryTealMaterial() {
  return <meshToonMaterial color="#2f7168" gradientMap={getToonRampTexture()} />
}

function galleryGoldMaterial() {
  return <meshBasicMaterial color="#d1b762" toneMapped={false} />
}

function galleryRustMaterial() {
  return <meshToonMaterial color="#ad6844" gradientMap={getToonRampTexture()} />
}

function galleryShadowMaterial() {
  return <meshBasicMaterial color="#17121f" transparent opacity={0.16} depthWrite={false} />
}

function tapestryFabricMaterial() {
  return <meshToonMaterial color="#efe2bb" gradientMap={getToonRampTexture()} />
}

function tapestryFabricInsetMaterial() {
  return <meshBasicMaterial color="#dccb9d" toneMapped={false} />
}

function tapestryTealYarnMaterial() {
  return <meshToonMaterial color="#2f7168" gradientMap={getToonRampTexture()} />
}

function tapestryRustYarnMaterial() {
  return <meshToonMaterial color="#ad6844" gradientMap={getToonRampTexture()} />
}

function tapestryGoldYarnMaterial() {
  return <meshToonMaterial color="#d6b55b" gradientMap={getToonRampTexture()} />
}

function tapestryCreamYarnMaterial() {
  return <meshToonMaterial color="#f5dfaa" gradientMap={getToonRampTexture()} />
}

function tapestryDarkYarnMaterial() {
  return <meshToonMaterial color="#251a24" gradientMap={getToonRampTexture()} />
}

function tapestryRodMaterial() {
  return <meshToonMaterial color="#5a3b2a" gradientMap={getToonRampTexture()} />
}

function walletPlaqueOutlineMaterial() {
  return <meshBasicMaterial color="#17121f" />
}

function walletPlaqueWalnutMaterial() {
  return <meshToonMaterial color="#5d3d2b" gradientMap={getToonRampTexture()} />
}

function walletPlaqueBrassMaterial() {
  return <meshToonMaterial color="#cfa858" gradientMap={getToonRampTexture()} />
}

function walletPlaqueFaceMaterial({ connected }: { connected: boolean }) {
  return <meshToonMaterial color={connected ? '#c6efe1' : '#e8d5a4'} gradientMap={getToonRampTexture()} />
}

function walletPlaqueInsetMaterial({ connected }: { connected: boolean }) {
  return <meshToonMaterial color={connected ? '#498b86' : '#7c6d5a'} gradientMap={getToonRampTexture()} />
}

function walletPlaqueGlowMaterial({ connected }: { connected: boolean }) {
  return <meshBasicMaterial color={connected ? '#99ffe6' : '#ffe58a'} transparent opacity={connected ? 0.38 : 0.18} depthWrite={false} />
}

function walletConnectActionFrameMaterial({ connected, hovered }: { connected: boolean; hovered: boolean }) {
  const color = connected ? hovered ? '#2f7168' : '#245c5b' : hovered ? '#d13d2f' : '#9c2c27'
  return <meshToonMaterial color={color} gradientMap={getToonRampTexture()} />
}

function walletConnectActionFaceMaterial({ connected, hovered }: { connected: boolean; hovered: boolean }) {
  const color = connected ? hovered ? '#c6efe1' : '#a7d6cc' : hovered ? '#ffd15a' : '#ef9f31'
  return <meshToonMaterial color={color} gradientMap={getToonRampTexture()} />
}

function walletConnectActionGlowMaterial({ connected, hovered }: { connected: boolean; hovered: boolean }) {
  const color = connected ? '#99ffe6' : '#fff1a2'
  const opacity = connected ? 0.22 : hovered ? 0.34 : 0.2
  return <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
}

function walletPlaqueShadowMaterial() {
  return <meshBasicMaterial color="#17121f" transparent opacity={0.16} depthWrite={false} />
}

function walletPlaqueOptionFaceMaterial({ selected }: { selected: boolean }) {
  return <meshToonMaterial color={selected ? '#c6efe1' : '#ead7a8'} gradientMap={getToonRampTexture()} />
}

function walletPlaqueOptionGlowMaterial({ selected }: { selected: boolean }) {
  return <meshBasicMaterial color={selected ? '#99ffe6' : '#ffe58a'} transparent opacity={selected ? 0.36 : 0.08} depthWrite={false} />
}

function pointerHitAreaMaterial() {
  return <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
}

function cursorInkMaterial({ opacity = 1 }: { opacity?: number } = {}) {
  return <meshBasicMaterial color="#17121f" transparent={opacity < 1} opacity={opacity} depthWrite={false} depthTest={false} toneMapped={false} />
}

function cursorGloveMaterial() {
  return <meshToonMaterial color="#fff0c8" gradientMap={getToonRampTexture()} depthWrite={false} depthTest={false} />
}

function cursorGloveShadeMaterial() {
  return <meshToonMaterial color="#e5ba72" gradientMap={getToonRampTexture()} depthWrite={false} depthTest={false} />
}

function cursorCuffMaterial() {
  return <meshToonMaterial color="#2f7168" gradientMap={getToonRampTexture()} depthWrite={false} depthTest={false} />
}

function cursorCuffInsetMaterial() {
  return <meshToonMaterial color="#9fd7cc" gradientMap={getToonRampTexture()} depthWrite={false} depthTest={false} />
}

function cursorBrassMaterial() {
  return <meshToonMaterial color="#d6b55b" gradientMap={getToonRampTexture()} depthWrite={false} depthTest={false} />
}

function cursorGlowMaterial({ color = '#fff1a2', opacity = 0.22 }: { color?: string; opacity?: number } = {}) {
  return <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} depthTest={false} toneMapped={false} side={THREE.DoubleSide} />
}

function museumCatalogTileFaceMaterial({
  item,
  selected,
  hovered,
  unavailable = false,
}: {
  item: BurnCatalogItem
  selected: boolean
  hovered: boolean
  unavailable?: boolean
}) {
  const color = unavailable
    ? selected || hovered ? '#d8c995' : '#bdb59d'
    : item.id === 'gilded-seal'
    ? selected || hovered ? '#efd77c' : '#ead7a8'
    : selected || hovered ? '#9fe7da' : '#c6efe1'

  return <meshToonMaterial color={color} gradientMap={getToonRampTexture()} />
}

function burnDetailDisabledButtonMaterial({ hovered }: { hovered: boolean }) {
  return <meshToonMaterial color={hovered ? '#d5c58d' : '#a99b78'} gradientMap={getToonRampTexture()} />
}

function burnDetailDisabledButtonInsetMaterial({ hovered }: { hovered: boolean }) {
  return <meshToonMaterial color={hovered ? '#efe1ad' : '#c9bea0'} gradientMap={getToonRampTexture()} />
}

function burnDetailPressureShadowMaterial() {
  return <meshBasicMaterial color="#17121f" transparent opacity={0} depthWrite={false} depthTest={false} side={THREE.DoubleSide} toneMapped={false} />
}

function burnDetailSnapFlashMaterial() {
  return <meshBasicMaterial color="#fff1c4" transparent opacity={0} depthWrite={false} depthTest={false} side={THREE.DoubleSide} toneMapped={false} />
}

function burnDetailDustPuffMaterial({ warm = false }: { warm?: boolean } = {}) {
  return <meshBasicMaterial color={warm ? '#c99a55' : '#6c5542'} transparent opacity={0} depthWrite={false} depthTest={false} side={THREE.DoubleSide} toneMapped={false} />
}

function burnDetailSmearMaterial() {
  return <meshBasicMaterial color="#fff4bd" transparent opacity={0} depthWrite={false} depthTest={false} toneMapped={false} />
}

function soldOutStampFaceMaterial() {
  return <meshBasicMaterial color="#c43426" transparent opacity={0.96} depthWrite={false} depthTest={false} toneMapped={false} />
}

function soldOutStampInsetMaterial() {
  return <meshBasicMaterial color="#fff0a8" transparent opacity={0.92} depthWrite={false} depthTest={false} toneMapped={false} />
}

function soldOutStampShadowMaterial() {
  return <meshBasicMaterial color="#17121f" transparent opacity={0.28} depthWrite={false} depthTest={false} toneMapped={false} />
}

function burnLaunchFaceMaterial({ hovered }: { hovered: boolean }) {
  return <meshToonMaterial color={hovered ? '#ffcf45' : '#ef8f2d'} gradientMap={getToonRampTexture()} />
}

function burnLaunchHotMaterial() {
  return <meshBasicMaterial color="#fff1a2" transparent opacity={0.42} depthWrite={false} toneMapped={false} />
}

function burnLaunchRedMaterial({ hovered }: { hovered: boolean }) {
  return <meshToonMaterial color={hovered ? '#ff5d43' : '#c43426'} gradientMap={getToonRampTexture()} />
}

function mcmHearthTileMaterial() {
  return <meshToonMaterial color="#59666a" gradientMap={getToonRampTexture()} />
}

function mcmHearthInsetMaterial() {
  return <meshToonMaterial color="#30393d" gradientMap={getToonRampTexture()} />
}

function mcmHearthLineMaterial() {
  return <meshBasicMaterial color="#25202a" transparent opacity={0.55} />
}

function mcmHearthBrassMaterial() {
  return <meshBasicMaterial color="#d1b762" />
}

function mcmHearthHeatPoolMaterial() {
  return <meshBasicMaterial color="#ff9b32" transparent opacity={0.085} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
}

function ritualStagePoolMaterial({
  color = '#fff0a6',
  opacity = 0.075,
}: {
  color?: string
  opacity?: number
} = {}) {
  return <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
}

function beltStripeMaterial() {
  return <meshBasicMaterial color="#3d3952" />
}

function railMaterial() {
  return <meshToonMaterial color="#4f8fa0" gradientMap={getToonRampTexture()} />
}

function legMaterial() {
  return <meshToonMaterial color="#486a77" gradientMap={getToonRampTexture()} />
}

function brassBoltMaterial() {
  return <meshBasicMaterial color="#f0cf62" />
}

function trapFrameMaterial() {
  return <meshToonMaterial color="#8d6040" gradientMap={getToonRampTexture()} />
}

function ceilingTrapFrameMaterial() {
  return <meshToonMaterial color="#83684b" gradientMap={getToonRampTexture()} />
}

function ceilingTrapDoorMaterial() {
  return <meshToonMaterial color="#728184" gradientMap={getToonRampTexture()} />
}

function ceilingTrapRailMaterial() {
  return <meshBasicMaterial color="#3b302d" />
}

function ceilingTrapStrapMaterial() {
  return <meshToonMaterial color="#536b70" gradientMap={getToonRampTexture()} />
}

function trapWoodGrainMaterial() {
  return <meshBasicMaterial color="#4d3327" transparent opacity={0.42} />
}

function trapDoorMaterial() {
  return <meshToonMaterial color="#6f7f86" gradientMap={getToonRampTexture()} />
}

function trapDarkMaterial() {
  return <meshBasicMaterial color="#16131e" />
}

function flameBedMaterial() {
  return <meshBasicMaterial color="#ff9a24" transparent opacity={0.54} side={THREE.DoubleSide} toneMapped={false} />
}

function flameOutlineMaterial() {
  return <meshBasicMaterial color="#32121d" transparent opacity={0.82} side={THREE.BackSide} />
}

function flameOuterMaterial() {
  return <meshToonMaterial color="#e83b25" gradientMap={getToonRampTexture()} toneMapped={false} />
}

function flameRedMaterial() {
  return <meshToonMaterial color="#ff6428" gradientMap={getToonRampTexture()} toneMapped={false} />
}

function flameMidMaterial() {
  return <meshToonMaterial color="#ffb12c" gradientMap={getToonRampTexture()} toneMapped={false} />
}

function flameCoreMaterial() {
  return <meshToonMaterial color="#fff06a" gradientMap={getToonRampTexture()} toneMapped={false} />
}

function flameWhiteCoreMaterial() {
  return <meshBasicMaterial color="#fff9be" side={THREE.DoubleSide} toneMapped={false} />
}

function emberHotMaterial() {
  return <meshBasicMaterial color="#ffe168" toneMapped={false} />
}

function emberWarmMaterial() {
  return <meshBasicMaterial color="#ff7c2e" toneMapped={false} />
}

function smokePuffMaterial() {
  return <meshBasicMaterial color="#7b7470" transparent opacity={0.24} />
}

function coalMaterial() {
  return <meshToonMaterial color="#4b1a22" gradientMap={getToonRampTexture()} />
}

function heatWispMaterial() {
  return <meshBasicMaterial color="#ffd45b" transparent opacity={0.3} toneMapped={false} />
}

function dropShadowMaterial() {
  return <meshBasicMaterial color="#1d1422" transparent opacity={0.18} side={THREE.DoubleSide} />
}

function tablePickupSpotlightMaterial() {
  return <meshBasicMaterial color="#ffe39a" transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
}

function impactDustMaterial() {
  return <meshBasicMaterial color="#725f51" transparent opacity={0.42} />
}

function impactRingMaterial() {
  return <meshBasicMaterial color="#221729" transparent opacity={0.34} side={THREE.DoubleSide} />
}

function impactGlintMaterial() {
  return <meshBasicMaterial color="#ffe17a" transparent opacity={0.82} toneMapped={false} />
}

function royalBoxSparkleMaterial() {
  return <meshBasicMaterial color="#fff1a2" transparent opacity={0} depthWrite={false} depthTest={false} toneMapped={false} />
}

function royalBoxSparkleWarmMaterial() {
  return <meshBasicMaterial color="#d6b55b" transparent opacity={0} depthWrite={false} depthTest={false} toneMapped={false} />
}

function royalBoxAuraMaterial() {
  return <meshBasicMaterial color="#ffe17a" transparent opacity={0} depthWrite={false} depthTest={false} side={THREE.DoubleSide} toneMapped={false} />
}

function ritualCoolGlowMaterial() {
  return <meshBasicMaterial color="#7ee8ff" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
}

function ritualWarmGlowMaterial() {
  return <meshBasicMaterial color="#ffb73a" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
}

function hoseContactShadowMaterial() {
  return <meshBasicMaterial color="#190d20" transparent opacity={0.38} depthWrite={false} depthTest={false} side={THREE.DoubleSide} />
}

function hoseContactGlintMaterial() {
  return <meshBasicMaterial color="#fff2a3" transparent opacity={0.66} depthWrite={false} depthTest={false} toneMapped={false} />
}

function hoseContactSleeveMaterial() {
  return <meshBasicMaterial color="#fff2a3" transparent opacity={0.42} depthWrite={false} depthTest={false} toneMapped={false} />
}

function hoseContactSleeveOutlineMaterial() {
  return <meshBasicMaterial color="#211827" transparent opacity={0.26} depthWrite={false} depthTest={false} />
}

function setMeshOpacity(mesh: THREE.Mesh | null | undefined, opacity: number) {
  if (!mesh || Array.isArray(mesh.material)) return
  mesh.material.opacity = opacity
  mesh.material.transparent = true
}

function smooth01(value: number) {
  const t = Math.min(1, Math.max(0, value))
  return t * t * (3 - 2 * t)
}

function smoother01(value: number) {
  const t = clamp01(value)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function movingEase01(value: number) {
  const t = clamp01(value)
  return t * 0.5 + smoother01(t) * 0.5
}

function easeOutBack01(value: number) {
  const t = clamp01(value) - 1
  return 1 + t * t * (2.45 * t + 1.45)
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function dampValue(current: number, target: number, lambda: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

function getBoxBottomOffsetForPose(
  rotationX = 0,
  rotationY = 0,
  rotationZ = 0,
  scaleX = 1,
  scaleY = 1,
  scaleZ = 1,
) {
  BOX_CONTACT_EULER.set(rotationX, rotationY, rotationZ)
  let lowestPoint = Infinity

  for (const x of [BOX_CONTACT_BOUNDS.minX, BOX_CONTACT_BOUNDS.maxX]) {
    for (const y of [BOX_CONTACT_BOUNDS.minY, BOX_CONTACT_BOUNDS.maxY]) {
      for (const z of [BOX_CONTACT_BOUNDS.minZ, BOX_CONTACT_BOUNDS.maxZ]) {
        BOX_CONTACT_CORNER.set(x * scaleX, y * scaleY, z * scaleZ).applyEuler(BOX_CONTACT_EULER)
        lowestPoint = Math.min(lowestPoint, BOX_CONTACT_CORNER.y)
      }
    }
  }

  return lowestPoint
}

function getBoxSurfaceRestY(
  surfaceY: number,
  scaleY = 1,
  rotationX = 0,
  rotationY = 0,
  rotationZ = 0,
  scaleX = 1,
  scaleZ = 1,
) {
  return surfaceY - getBoxBottomOffsetForPose(rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ) + BOX_TABLE_CLEARANCE
}

function getHoseSealPlaneOffset(elapsed: number, sealAmount: number) {
  const sealSettle = smooth01((elapsed - BOX_SUCTION_LATCH_TIME) / 0.26)
  const latchPulse = Math.max(0, dampedPulse(elapsed, BOX_SUCTION_LATCH_TIME, 0.42, 2.5))
  const settledGap = BOX_HOSE_SEAL_FRONT_GAP
    + (BOX_HOSE_SEAL_FINAL_FRONT_GAP - BOX_HOSE_SEAL_FRONT_GAP) * sealSettle

  return Math.max(
    BOX_HOSE_SEAL_FINAL_FRONT_GAP,
    settledGap - sealAmount * 0.003 - latchPulse * 0.003,
  )
}

function getTableBoxSlot(index: number): TableBoxSlot {
  const safeIndex = Math.min(TABLE_BOX_SLOTS.length - 1, Math.max(0, Math.floor(index)))
  return TABLE_BOX_SLOTS[safeIndex] ?? TABLE_BOX_SLOTS[0]
}

function getTableBoxRestRotationX() {
  return 0
}

function getTableBoxRestRotationZ() {
  return 0
}

function getWalletBoxDropStartOffset(index: number) {
  return WALLET_BOX_DROP_START_OFFSETS[index % WALLET_BOX_DROP_START_OFFSETS.length] ?? WALLET_BOX_DROP_START_OFFSETS[0]
}

function loop01(value: number) {
  return value - Math.floor(value)
}

function softLoopingPulse(time: number, rate: number, phase: number, width: number) {
  const cycle = loop01(time * rate + phase)
  if (cycle >= width) return 0

  const rise = smooth01(cycle / (width * 0.42))
  const fall = 1 - smooth01((cycle - width * 0.38) / (width * 0.62))
  return rise * fall
}

function applyTableBoxIdleJiggle(
  pose: BoxPoseSample,
  clockTime: number,
  index: number,
  amount: number,
  surfaceY = TABLE_TOP_Y,
) {
  const live = clamp01(amount)
  if (live <= 0.001) return

  const seed = index * 1.731
  const primaryKnock = softLoopingPulse(clockTime, 0.66 + (index % 3) * 0.038, seed * 0.19, 0.31)
  const secondaryKnock = softLoopingPulse(clockTime, 0.95 + (index % 2) * 0.05, seed * 0.27 + 0.37, 0.2)
  const anticipation = softLoopingPulse(clockTime, 0.66 + (index % 3) * 0.038, seed * 0.19 - 0.08, 0.12)
  const landingPop = softLoopingPulse(clockTime, 0.66 + (index % 3) * 0.038, seed * 0.19 + 0.22, 0.16)
  const smallQuiver = Math.sin(clockTime * (6.8 + index * 0.23) + seed) * 0.0026 * live
  const knock = clamp01(primaryKnock * 0.9 + secondaryKnock * 0.42) * live
  const settleFlutter = Math.sin(clockTime * (8.6 + index * 0.21) + seed * 0.6) * knock * 0.0026
  const side = index % 2 === 0 ? 1 : -1
  const forward = index % 3 === 0 ? -1 : 1
  const bounceLift = Math.pow(knock, 0.72)
  const squash = (knock * 0.52 + anticipation * 0.62 + landingPop * 0.82) * BOX_IDLE_JIGGLE_SQUASH
  const hop = Math.max(0, bounceLift - anticipation * 0.32) * BOX_IDLE_JIGGLE_HOP

  pose.rotation.x += smallQuiver * 0.7 + knock * BOX_IDLE_JIGGLE_LEAN * 0.74 * forward + landingPop * 0.022 * forward + settleFlutter
  pose.rotation.z += smallQuiver - knock * BOX_IDLE_JIGGLE_LEAN * side - landingPop * 0.028 * side
  pose.scale.x *= 1 + squash * 0.46 + hop * 0.65
  pose.scale.y *= 1 - squash + bounceLift * 0.016
  pose.scale.z *= 1 + squash * 0.36 + hop * 0.44
  pose.position.y = getBoxSurfaceRestY(
    surfaceY,
    pose.scale.y,
        pose.rotation.x,
        pose.rotation.y,
        pose.rotation.z,
        pose.scale.x,
        pose.scale.z,
  ) + hop
  pose.shadowScale.x *= 1 + knock * 0.22 - bounceLift * 0.08
  pose.shadowScale.y *= 1 + knock * 0.15 - bounceLift * 0.06
}

function sampleWalletTableBoxDropPose(
  elapsed: number,
  clockTime: number,
  index: number,
  slot: TableBoxSlot,
  pose: BoxPoseSample,
) {
  const [targetX, targetZ, targetYaw] = slot
  const localElapsed = elapsed - index * WALLET_BOX_DROP_STAGGER

  pose.visible = localElapsed >= 0
  pose.shadowVisible = pose.visible
  pose.suctionAmount = 0
  pose.pullAmount = 0
  pose.latchAmount = 0

  if (!pose.visible) return

  const [offsetX, offsetZ] = getWalletBoxDropStartOffset(index)
  const flightTime = WALLET_BOX_DROP_FLIGHT_TIME + (index % 2) * 0.045
  const airT = clamp01(localElapsed / flightTime)
  const landT = clamp01((localElapsed - flightTime) / WALLET_BOX_DROP_SETTLE_TIME)
  const gravityT = airT * airT
  const landingAlign = smoother01((airT - 0.52) / 0.48)
  const impactPulse = Math.max(0, dampedPulse(localElapsed, flightTime, 0.38, 2.4))
  const settleWobble = landT > 0 && landT < 1
    ? Math.sin(landT * Math.PI * 2.45) * Math.exp(-landT * 4.05)
    : 0
  const rebound = landT > 0 && landT < 1
    ? Math.max(0, Math.sin(landT * Math.PI * 1.75)) * Math.exp(-landT * 4.15) * 0.045
    : 0
  const settleSlide = landT > 0 && landT < 1
    ? Math.sin(landT * Math.PI) * Math.exp(-landT * 3.35) * 0.012
    : 0
  const startX = targetX + offsetX
  const startZ = targetZ + offsetZ
  const startY = BOX_DROP_START[1] - (index % 3) * 0.018
  const driftSwayX = Math.sin(airT * Math.PI) * offsetZ * 0.1
  const driftSwayZ = Math.sin(airT * Math.PI) * -offsetX * 0.08
  const spinEnvelope = 1 - landingAlign
  const airLean = Math.sin(airT * Math.PI) * (0.055 + index * 0.006)
  const rotationX = ((index % 2 === 0 ? -0.18 : 0.16) * airT + airLean) * spinEnvelope
    + settleWobble * 0.036
  const rotationY = targetYaw + ((index % 2 === 0 ? 0.18 : -0.15) * airT) * spinEnvelope
    + settleWobble * 0.022
  const rotationZ = ((index % 2 === 0 ? 0.12 : -0.1) * airT) * spinEnvelope
    - settleWobble * 0.03
  const scaleX = 1 + impactPulse * 0.075
  const scaleY = 1 - impactPulse * 0.16
  const scaleZ = 1 + impactPulse * 0.095
  const surfaceY = getBoxSurfaceRestY(
    TABLE_TOP_Y,
    scaleY,
    rotationX,
    rotationY,
    rotationZ,
    scaleX,
    scaleZ,
  )
  const airX = startX + (targetX - startX) * airT + driftSwayX
  const airZ = startZ + (targetZ - startZ) * airT + driftSwayZ
  const settledX = targetX + (index % 2 === 0 ? -settleSlide : settleSlide)
  const settledZ = targetZ + (index % 2 === 0 ? settleSlide : -settleSlide) * 0.55
  const fallingY = startY + (surfaceY - startY) * gravityT
  const heightAboveSurface = Math.max(0, fallingY - surfaceY)
  const shadowNearness = 1 - clamp01(heightAboveSurface / Math.max(0.001, startY - surfaceY))

  pose.position.set(
    airT < 1 ? airX : settledX,
    airT < 1 ? Math.max(surfaceY, fallingY) : surfaceY + rebound,
    airT < 1 ? airZ : settledZ,
  )
  pose.rotation.set(rotationX, rotationY, rotationZ)
  pose.scale.set(scaleX, scaleY, scaleZ)
  pose.shadowScale.set(
    0.16 + shadowNearness * 0.3 + impactPulse * 0.08,
    0.1 + shadowNearness * 0.18 + impactPulse * 0.045,
    1,
  )

  const idleJiggleAmount = smoother01((localElapsed - flightTime - 0.48) / 0.9)
  applyTableBoxIdleJiggle(pose, clockTime, index, idleJiggleAmount, TABLE_TOP_Y)
}

function getPickupHoseTargetX(slot: TableBoxSlot) {
  return slot[0] + clamp((slot[0] - BOX_POSITION[0]) * 0.08, -0.06, 0.06)
}

function getPickupHoseTargetY() {
  return BOX_POSITION[1] + BOX_HOSE_CONTACT_LOCAL_Y + BOX_PICKUP_HOSE_AIR_GAP
}

function getPickupHoseTargetZ(slot: TableBoxSlot) {
  return slot[1] - 0.1 + clamp((slot[1] - BOX_POSITION[2]) * 0.12, -0.06, 0.05)
}

function getPickupBodyWorldX(slot: TableBoxSlot) {
  return VACUUM_PICKUP_BODY_WORLD[0] + clamp((slot[0] - BOX_POSITION[0]) * 0.14, -0.08, 0.08)
}

function getPickupBodyWorldZ(slot: TableBoxSlot) {
  return clamp(slot[1] - 1.82, -2.14, -1.52)
}

function createVacuumPoseScratch(): VacuumPoseScratch {
  return {
    aimWorld: new THREE.Vector3(),
    aimLocal: new THREE.Vector3(),
    localPosition: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    mouthLocal: new THREE.Vector3(),
    hoseLift: 0,
    collisionWorld: new THREE.Vector3(),
    nozzle: createNozzleEntryScratch(),
    runtime: createRuntime(),
  }
}

function createBoxPoseSample(): BoxPoseSample {
  return {
    position: new THREE.Vector3(),
    rotation: new THREE.Euler(),
    scale: new THREE.Vector3(1, 1, 1),
    shadowScale: new THREE.Vector3(0.14, 0.09, 1),
    mouthWorld: new THREE.Vector3(),
    mouthForward: new THREE.Vector3(0, 0, 1),
    source: new THREE.Vector3(),
    target: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    right: new THREE.Vector3(1, 0, 0),
    visible: false,
    shadowVisible: false,
    suctionAmount: 0,
    pullAmount: 0,
    latchAmount: 0,
  }
}

function writeBoxHoseContactPoint(target: THREE.Vector3, pose: BoxPoseSample, surfaceOffset = 0) {
  target.copy(pose.position)
  target.y += BOX_HOSE_CONTACT_LOCAL_Y
  target.addScaledVector(pose.mouthForward, -BOX_HOSE_CONTACT_RADIUS + surfaceOffset)
}

function setWorldAsVacuumLocal(target: THREE.Vector3, world: THREE.Vector3) {
  target.set(
    (world.x - VACUUM_STAGE_POSITION[0]) / VACUUM_STAGE_SCALE,
    (world.y - VACUUM_STAGE_POSITION[1]) / VACUUM_STAGE_SCALE,
    (world.z - VACUUM_STAGE_POSITION[2]) / VACUUM_STAGE_SCALE,
  )
}

function setVacuumLocalAsWorld(target: THREE.Vector3, local: THREE.Vector3) {
  target.set(
    VACUUM_STAGE_POSITION[0] + local.x * VACUUM_STAGE_SCALE,
    VACUUM_STAGE_POSITION[1] + local.y * VACUUM_STAGE_SCALE,
    VACUUM_STAGE_POSITION[2] + local.z * VACUUM_STAGE_SCALE,
  )
}

function setVacuumLocalDirectionAsWorld(target: THREE.Vector3, local: THREE.Vector3) {
  target.set(local.x, local.y, local.z).normalize()
}

function pushCircleOutOfFootprint(
  point: THREE.Vector3,
  footprint: { minX: number; maxX: number; minZ: number; maxZ: number },
  radius: number,
) {
  const nearestX = clamp(point.x, footprint.minX, footprint.maxX)
  const nearestZ = clamp(point.z, footprint.minZ, footprint.maxZ)
  const dx = point.x - nearestX
  const dz = point.z - nearestZ
  const distanceSq = dx * dx + dz * dz
  const minDistanceSq = radius * radius

  if (distanceSq >= minDistanceSq) return

  if (distanceSq > 0.000001) {
    const distance = Math.sqrt(distanceSq)
    const push = radius - distance
    point.x += (dx / distance) * push
    point.z += (dz / distance) * push
    return
  }

  const left = Math.abs(point.x - footprint.minX)
  const right = Math.abs(footprint.maxX - point.x)
  const back = Math.abs(point.z - footprint.minZ)
  const front = Math.abs(footprint.maxZ - point.z)
  const smallest = Math.min(left, right, back, front)

  if (smallest === left) point.x = footprint.minX - radius
  else if (smallest === right) point.x = footprint.maxX + radius
  else if (smallest === back) point.z = footprint.minZ - radius
  else point.z = footprint.maxZ + radius
}

function keepVacuumBodyClearOfSolids(scratch: VacuumPoseScratch) {
  setVacuumLocalAsWorld(scratch.collisionWorld, scratch.localPosition)
  pushCircleOutOfFootprint(scratch.collisionWorld, TABLE_COLLIDER, VACUUM_BODY_COLLISION_RADIUS)
  pushCircleOutOfFootprint(scratch.collisionWorld, CONVEYOR_COLLIDER, VACUUM_BODY_COLLISION_RADIUS)
  setWorldAsVacuumLocal(scratch.localPosition, scratch.collisionWorld)
}

function isInsideFootprint(point: THREE.Vector3, footprint: { minX: number; maxX: number; minZ: number; maxZ: number }, pad = 0) {
  return point.x >= footprint.minX - pad
    && point.x <= footprint.maxX + pad
    && point.z >= footprint.minZ - pad
    && point.z <= footprint.maxZ + pad
}

function keepBoxAboveSolidSurfaces(pose: BoxPoseSample) {
  if (!pose.visible) return

  if (isInsideFootprint(pose.position, TABLE_COLLIDER, 0.12)) {
    pose.position.y = Math.max(
      pose.position.y,
      getBoxSurfaceRestY(
        TABLE_TOP_Y,
        pose.scale.y,
        pose.rotation.x,
        pose.rotation.y,
        pose.rotation.z,
        pose.scale.x,
        pose.scale.z,
      ),
    )
  }

  if (isInsideFootprint(pose.position, CONVEYOR_COLLIDER, 0.08)) {
    pose.position.y = Math.max(
      pose.position.y,
      getBoxSurfaceRestY(
        CONVEYOR_BELT_TOP_Y,
        pose.scale.y,
        pose.rotation.x,
        pose.rotation.y,
        pose.rotation.z,
        pose.scale.x,
        pose.scale.z,
      ),
    )
  }
}

function getBoxReleaseAmount(elapsed: number) {
  return smooth01((elapsed - BOX_CONVEYOR_PLACE_TIME) / 0.3)
}

function getBoxSuctionAmount(elapsed: number) {
  return smooth01((elapsed - BOX_SUCTION_START_TIME) / 0.34) * (1 - getBoxReleaseAmount(elapsed))
}

function getBoxPullAmount(elapsed: number) {
  return smooth01((elapsed - BOX_PULL_START_TIME) / (BOX_SUCTION_LATCH_TIME - BOX_PULL_START_TIME))
}

function getBoxLatchAmount(elapsed: number) {
  return smooth01((elapsed - BOX_SUCTION_LATCH_TIME) / 0.26) * (1 - getBoxReleaseAmount(elapsed))
}

function getBoxPlaceAmount(elapsed: number) {
  return smooth01((elapsed - BOX_CARRY_POSE_TIME) / (BOX_CONVEYOR_PLACE_TIME - BOX_CARRY_POSE_TIME))
}

function getBoxConveyorAmount(elapsed: number) {
  return clamp01((elapsed - BOX_CONVEYOR_START_TIME) / (BOX_CONVEYOR_END_TIME - BOX_CONVEYOR_START_TIME))
}

function getBoxConveyorMotionAmount(elapsed: number) {
  return movingEase01(getBoxConveyorAmount(elapsed))
}

function getBoxFireDropAmount(elapsed: number) {
  return clamp01((elapsed - BOX_FIRE_DROP_START_TIME) / (BOX_FIRE_DISAPPEAR_TIME - BOX_FIRE_DROP_START_TIME))
}

function getBoxBurnVanishAmount(elapsed: number) {
  return smoother01((getBoxFireDropAmount(elapsed) - 0.72) / 0.18)
}

function getVacuumPreIdleAmount(elapsed: number) {
  return 1 - smoother01((elapsed - (BOX_DROP_RELEASE_TIME + 0.08)) / 0.82)
}

function getVacuumPostIdleAmount(elapsed: number) {
  return smoother01((elapsed - (BOX_FIRE_DISAPPEAR_TIME + 0.16)) / 0.58)
}

function getCycleReturnAmount(elapsed: number) {
  return smoother01((elapsed - (BOX_FIRE_DISAPPEAR_TIME + 0.08)) / 0.58)
}

function getGroundTrapdoorOpenAmount(elapsed: number) {
  if (elapsed <= 0.001) return 0

  const cycleDuration = 1.34
  const phase = ((elapsed + 0.42) % cycleDuration) / cycleDuration
  const openRamp = smooth01(phase / 0.2)
  const closeRamp = smooth01((phase - 0.6) / 0.23)
  const jawCycle = openRamp * (1 - closeRamp)
  const openStopBounce = Math.max(0, 1 - Math.abs(phase - 0.22) / 0.08) ** 2 * 0.052
  const closeClack = Math.max(0, 1 - Math.abs(phase - 0.85) / 0.08) ** 2 * -0.04
  const preheatWake = smooth01((elapsed - (BOX_SUCTION_START_TIME - 0.08)) / 0.62)
    * (1 - smooth01((elapsed - (BOX_FIRE_DROP_START_TIME - 0.16)) / 0.4))
  const preheatPeek = jawCycle * 0.24 * preheatWake
  const burnOpen = smooth01((elapsed - (BOX_FIRE_DROP_START_TIME - 0.52)) / 0.22)
    * (1 - smooth01((elapsed - (BOX_FIRE_DISAPPEAR_TIME + 0.44)) / 0.34))
  const idleChatter = Math.max(0, Math.sin(elapsed * 9.4 + 1.8)) ** 8 * 0.012 * preheatWake
  const opening = Math.max(preheatPeek, burnOpen)

  return clamp(opening + openStopBounce * opening + closeClack * opening + idleChatter, 0, 1.12)
}

function getFurnaceEnergy(elapsed: number) {
  const opening = getGroundTrapdoorOpenAmount(elapsed)
  const doorGlow = smooth01((opening - 0.1) / 0.34)
  const burnWake = smooth01((getBoxFireDropAmount(elapsed) - 0.05) / 0.5)
  const vanishPunch = getBoxBurnVanishAmount(elapsed)

  return clamp01(doorGlow * 0.48 + burnWake * 0.2 + vanishPunch * 0.62)
}

function writeVacuumPose(
  elapsed: number,
  clockTime: number,
  scratch: VacuumPoseScratch,
  pickupSlot: TableBoxSlot,
  loopFromConveyor = false,
) {
  const suctionAmount = getBoxSuctionAmount(elapsed)
  const latchAmount = getBoxLatchAmount(elapsed)
  const preIdleAmount = getVacuumPreIdleAmount(elapsed)
  const postIdleAmount = getVacuumPostIdleAmount(elapsed)
  const returnAmount = getCycleReturnAmount(elapsed)
  const actionAmount = 1 - returnAmount
  const quietIdleAmount = Math.max(preIdleAmount, postIdleAmount)
  const idleHoseSide = Math.sin(clockTime * 1.35 + 0.4) * 0.04 + Math.sin(clockTime * 3.7) * 0.008
  const idleHoseLift = Math.sin(clockTime * 1.9) * 0.034 + Math.sin(clockTime * 4.7 + 0.3) * 0.007
  const idleHoseDepth = Math.cos(clockTime * 1.7 + 0.6) * 0.024
  const idleBodySide = Math.sin(clockTime * 1.2) * 0.04 + Math.sin(clockTime * 2.9 + 0.4) * 0.012
  const idleBodyDepth = Math.cos(clockTime * 1.5 + 0.8) * 0.026
  const approachStart = BOX_DROP_IMPACT_TIME - 0.5
  const hoseApproachAmount = smoother01((elapsed - (approachStart - 0.12)) / (BOX_SUCTION_START_TIME - approachStart + 0.12))
  const bodyApproachAmount = smoother01((elapsed - (approachStart + 0.02)) / (BOX_SUCTION_START_TIME - approachStart + 0.24))
  const travelStart = BOX_SUCTION_LATCH_TIME + 0.1
  const hoseTravelAmount = smoother01((elapsed - travelStart) / (BOX_CONVEYOR_PLACE_TIME - travelStart - 0.04))
  const bodyTravelAmount = smoother01((elapsed - (travelStart + 0.08)) / (BOX_CONVEYOR_PLACE_TIME - travelStart + 0.08))
  const releaseBlend = getBoxReleaseAmount(elapsed)
  const suctionAnticipation = roundedPulse(elapsed, BOX_SUCTION_START_TIME - 0.32, 0.58)
  const latchSnap = dampedPulse(elapsed, BOX_SUCTION_LATCH_TIME, 0.58, 2.6)
  const hoseSearch = Math.sin(elapsed * 7.4) * suctionAmount * (1 - latchAmount) * (1 - hoseTravelAmount)
  const carryArc = Math.sin(hoseTravelAmount * Math.PI)
  const bodyCarryArc = Math.sin(bodyTravelAmount * Math.PI)
  const carryLift = carryArc * 0.19 + latchAmount * (1 - releaseBlend) * 0.025 + latchSnap * 0.02
  const suctionSettle = Math.sin(suctionAmount * Math.PI) * 0.018
  const idleHoseBob = Math.sin(clockTime * 1.55) * 0.018 * quietIdleAmount * (1 - hoseApproachAmount * actionAmount)
  const idleHoseX = VACUUM_IDLE_BODY_WORLD[0] + VACUUM_MOUTH_ROOT_OFFSET[0] * VACUUM_STAGE_SCALE
    + quietIdleAmount * idleHoseSide
  const idleHoseY = VACUUM_IDLE_BODY_WORLD[1] + (VACUUM_MOUTH_ROOT_OFFSET[1] + VACUUM_IDLE_HOSE_LIFT) * VACUUM_STAGE_SCALE + idleHoseBob
    + quietIdleAmount * idleHoseLift
  const idleHoseZ = VACUUM_IDLE_BODY_WORLD[2] + VACUUM_MOUTH_ROOT_OFFSET[2] * VACUUM_STAGE_SCALE
    + quietIdleAmount * idleHoseDepth
  const loopStartAmount = loopFromConveyor
    ? 1 - smoother01((elapsed - (BOX_SUCTION_START_TIME + 0.12)) / 0.36)
    : 0
  const loopReturnEase = loopStartAmount > 0 ? smoother01((elapsed - BOX_RUN_START_TIME) / (BOX_SUCTION_START_TIME - BOX_RUN_START_TIME + 0.24)) : 1
  const hosePathAmount = hoseApproachAmount * actionAmount
  const bodyPathAmount = bodyApproachAmount * actionAmount
  const loopReturnHoseArc = Math.sin(hosePathAmount * Math.PI) * loopStartAmount
  const loopReturnBodyArc = Math.sin(bodyPathAmount * Math.PI) * loopStartAmount
  const loopReturnSway = Math.sin(hosePathAmount * Math.PI * 2.1 + 0.45) * loopReturnHoseArc
  const hoseStartX = loopStartAmount > 0
    ? CONVEYOR_HOSE_TARGET[0] + Math.sin(clockTime * 1.45) * 0.012 * (1 - loopReturnEase)
    : idleHoseX
  const hoseStartY = loopStartAmount > 0
    ? CONVEYOR_HOSE_TARGET[1] + 0.08 * (1 - loopReturnEase) + Math.sin(clockTime * 1.65 + 0.2) * 0.01 * (1 - loopReturnEase)
    : idleHoseY
  const hoseStartZ = loopStartAmount > 0
    ? CONVEYOR_HOSE_TARGET[2] - 0.04 * (1 - loopReturnEase)
    : idleHoseZ
  const pickupHoseTargetX = getPickupHoseTargetX(pickupSlot)
  const pickupHoseTargetY = getPickupHoseTargetY()
  const pickupHoseTargetZ = getPickupHoseTargetZ(pickupSlot)
  const pickupBodyX = getPickupBodyWorldX(pickupSlot)
  const pickupBodyZ = getPickupBodyWorldZ(pickupSlot)
  const activeHoseX = pickupHoseTargetX
    + (CONVEYOR_HOSE_TARGET[0] - pickupHoseTargetX) * hoseTravelAmount
    + hoseSearch * 0.025
    + carryArc * 0.045
    + postIdleAmount * idleHoseSide * 0.82
  const activeHoseY = pickupHoseTargetY
    + (CONVEYOR_HOSE_TARGET[1] - pickupHoseTargetY) * hoseTravelAmount
    + carryLift
    + suctionAnticipation * 0.055
    + postIdleAmount * idleHoseLift * 0.9
  const activeHoseZ = pickupHoseTargetZ
    + (CONVEYOR_HOSE_TARGET[2] - pickupHoseTargetZ) * hoseTravelAmount
    + suctionSettle
    + Math.cos(elapsed * 5.8) * suctionAmount * (1 - latchAmount) * 0.018
    - suctionAnticipation * 0.024
    + postIdleAmount * idleHoseDepth * 0.82
  scratch.aimWorld.set(
    hoseStartX + (activeHoseX - hoseStartX) * hosePathAmount
      - loopReturnHoseArc * 0.08
      + loopReturnSway * 0.018,
    hoseStartY + (activeHoseY - hoseStartY) * hosePathAmount
      + loopReturnHoseArc * 0.17
      + Math.abs(loopReturnSway) * 0.028,
    hoseStartZ + (activeHoseZ - hoseStartZ) * hosePathAmount
      - loopReturnHoseArc * 0.07
      + loopReturnSway * 0.012,
  )

  const activeBodyX = pickupBodyX + (VACUUM_CONVEYOR_BODY_WORLD[0] - pickupBodyX) * bodyTravelAmount
  const activeBodyZ = pickupBodyZ + (VACUUM_CONVEYOR_BODY_WORLD[2] - pickupBodyZ) * bodyTravelAmount
  const bodyStartX = loopStartAmount > 0
    ? VACUUM_CONVEYOR_BODY_WORLD[0] + Math.sin(clockTime * 1.25 + 0.5) * 0.012 * (1 - loopReturnEase)
    : VACUUM_IDLE_BODY_WORLD[0]
  const bodyStartZ = loopStartAmount > 0
    ? VACUUM_CONVEYOR_BODY_WORLD[2] - 0.06 * (1 - loopReturnEase) + Math.cos(clockTime * 1.35 + 0.4) * 0.014 * (1 - loopReturnEase)
    : VACUUM_IDLE_BODY_WORLD[2]
  const bodySway = Math.sin(elapsed * 3.1 + bodyTravelAmount * 2.6) * 0.018 * (0.25 + bodyApproachAmount)
  const carrySway = Math.sin(bodyTravelAmount * Math.PI * 1.55) * bodyCarryArc * 0.052
  const inhaleLean = suctionAnticipation * 0.05 - latchSnap * 0.028
  const bodyWorldX = bodyStartX
    + (activeBodyX - bodyStartX) * bodyPathAmount
    + carrySway * actionAmount
    - loopReturnBodyArc * 0.055
    - inhaleLean * actionAmount
    + quietIdleAmount * idleBodySide
  const bodyWorldZ = bodyStartZ
    + (activeBodyZ - bodyStartZ) * bodyPathAmount
    + bodySway * actionAmount
    + loopReturnBodyArc * 0.12
    - suctionAnticipation * 0.032 * actionAmount
    + latchSnap * 0.018 * actionAmount
    + quietIdleAmount * idleBodyDepth
  scratch.localPosition.set(
    (bodyWorldX - VACUUM_STAGE_POSITION[0]) / VACUUM_STAGE_SCALE,
    VACUUM_GROUNDED_LOCAL_Y,
    (bodyWorldZ - VACUUM_STAGE_POSITION[2]) / VACUUM_STAGE_SCALE,
  )
  keepVacuumBodyClearOfSolids(scratch)

  setWorldAsVacuumLocal(scratch.aimLocal, scratch.aimWorld)
  scratch.hoseLift = clamp(
    scratch.aimLocal.y - (scratch.localPosition.y + VACUUM_MOUTH_ROOT_OFFSET[1]),
    0,
    1.35,
  )
  scratch.forward.set(VACUUM_FIXED_FORWARD[0], VACUUM_FIXED_FORWARD[1], VACUUM_FIXED_FORWARD[2])
  scratch.mouthLocal.copy(scratch.aimLocal)
}

function writeVacuumRuntimeState(
  elapsed: number,
  clockTime: number,
  scratch: VacuumPoseScratch,
  state: VacuumRuntime,
  pickupSlot: TableBoxSlot,
  loopFromConveyor = false,
) {
  const suctionAmount = getBoxSuctionAmount(elapsed)
  const pullAmount = getBoxPullAmount(elapsed)
  const latchAmount = getBoxLatchAmount(elapsed)
  const latchSnap = dampedPulse(elapsed, BOX_SUCTION_LATCH_TIME, 0.56, 2.7)
  const placeSnap = dampedPulse(elapsed, BOX_CONVEYOR_PLACE_TIME, 0.46, 2.8)
  const burnReaction = dampedPulse(elapsed, BOX_FIRE_DISAPPEAR_TIME - 0.12, 0.78, 2.4)
  const preIdleAmount = getVacuumPreIdleAmount(elapsed)
  const postIdleAmount = getVacuumPostIdleAmount(elapsed)
  const returnAmount = getCycleReturnAmount(elapsed)
  const actionAmount = 1 - returnAmount
  const quietIdleAmount = Math.max(preIdleAmount, postIdleAmount)
  const idleBreath = (Math.sin(clockTime * 1.9 + 0.2) + 1) * 0.5
  const idleSniff = Math.max(0, Math.sin(clockTime * 2.55 + 0.5))
  const idleWiggle = Math.sin(clockTime * 1.18 + postIdleAmount * 1.4)
  const suctionBagInflate = smoother01((elapsed - BOX_PULL_START_TIME) / 0.38)
    * (1 - smoother01((elapsed - BOX_CONVEYOR_PLACE_TIME) / 0.72))
  const latchBagPuff = roundedPulse(elapsed, BOX_SUCTION_LATCH_TIME - 0.08, 0.64)
  const placeBagBounce = roundedPulse(elapsed, BOX_CONVEYOR_PLACE_TIME - 0.12, 0.48)
  const burnBagJolt = roundedPulse(elapsed, BOX_FIRE_DISAPPEAR_TIME - 0.24, 0.58)
  const bagPuff = Math.min(1.28, suctionBagInflate * 0.34 + latchBagPuff * 0.94 + placeBagBounce * 0.26 + burnBagJolt * 0.2)
  const tableAim = smoother01((elapsed - (BOX_DROP_RELEASE_TIME + 0.22)) / (BOX_SUCTION_START_TIME - BOX_DROP_RELEASE_TIME - 0.22))
    * (1 - smoother01((elapsed - (BOX_SUCTION_LATCH_TIME + 0.45)) / 0.7))
  const attentionGather = roundedPulse(elapsed, BOX_SUCTION_START_TIME - 0.38, 0.7)
  const carryFlow = smoother01((elapsed - (BOX_SUCTION_LATCH_TIME - 0.1)) / (BOX_CONVEYOR_PLACE_TIME - BOX_SUCTION_LATCH_TIME + 0.1))
    * (1 - getBoxReleaseAmount(elapsed))
  const carrySway = Math.sin(carryFlow * Math.PI * 1.55) * Math.sin(carryFlow * Math.PI)
  const liveQuiver = Math.sin(clockTime * 2.1 + carryFlow * 1.4) * (0.25 + suctionAmount + carryFlow * 0.65)
  const loopStartAmount = loopFromConveyor
    ? 1 - smoother01((elapsed - (BOX_SUCTION_START_TIME + 0.12)) / 0.36)
    : 0
  const loopReturnEase = loopStartAmount > 0 ? smoother01((elapsed - BOX_RUN_START_TIME) / (BOX_SUCTION_START_TIME - BOX_RUN_START_TIME + 0.24)) : 1
  const loopReturnArc = Math.sin(loopReturnEase * Math.PI) * loopStartAmount
  const loopReturnSettle = (1 - loopReturnEase) * loopReturnArc

  writeVacuumPose(elapsed, clockTime, scratch, pickupSlot, loopFromConveyor)
  state.position.copy(scratch.localPosition)
  state.target.copy(scratch.aimLocal)
  state.forward.copy(scratch.forward)
  state.hoseLift = scratch.hoseLift
  state.yaw = CAMERA_FACING_VACUUM_YAW
    - tableAim * 0.56 * actionAmount
    + Math.sin(clockTime * 0.48) * 0.014
    - suctionAmount * 0.045 * actionAmount
    + latchSnap * 0.035 * actionAmount
    + attentionGather * 0.035 * actionAmount
    + carrySway * 0.028 * actionAmount
    + liveQuiver * 0.012 * actionAmount
    + loopReturnArc * 0.052 * actionAmount
    - loopReturnSettle * 0.035 * actionAmount
    + quietIdleAmount * (idleWiggle * 0.045 + Math.sin(clockTime * 2.9 + 0.7) * 0.012)
  state.bagPuff = bagPuff
  state.pulse = 0.58
    + Math.sin(clockTime * 1.35) * 0.045
    + suctionAmount * 0.24
    + latchAmount * 0.04
    + placeSnap * 0.08
    + burnReaction * 0.08
    + bagPuff * 0.18
    + attentionGather * 0.08
    + Math.abs(carrySway) * 0.04
    + loopReturnArc * 0.035
    + quietIdleAmount * (0.04 + idleBreath * 0.11)
  state.recoil = Math.max(0, Math.sin(clockTime * 0.75 - 0.9)) * 0.016
    + suctionAmount * 0.04
    + latchSnap * 0.1
    + placeSnap * 0.08
    + burnReaction * 0.14
    + bagPuff * 0.07
    + attentionGather * 0.035
    + Math.max(0, carrySway) * 0.04
    + loopReturnArc * 0.024
    + quietIdleAmount * idleSniff * 0.026
  state.flash = Math.max(0, Math.sin(clockTime * 1.05 + 0.4)) * 0.024
    + pullAmount * 0.12
    + latchSnap * 0.36
    + placeSnap * 0.2
    + burnReaction * 0.3
    + bagPuff * 0.16
    + attentionGather * 0.06
    + Math.max(0, -carrySway) * 0.045
    + loopReturnSettle * 0.035
    + quietIdleAmount * (idleSniff * 0.018 + idleBreath * 0.012)
  state.gulpFlow = suctionAmount > 0.02
    ? 0.18 + pullAmount * 0.58 + latchSnap * 0.42 + bagPuff * 0.5 + attentionGather * 0.08
    : bagPuff * 0.28
  state.gulpAge = suctionAmount > 0.02 ? ((elapsed - BOX_SUCTION_START_TIME) * 1.42) % 0.58 : 9
  state.active = true
  state.pointerDown = suctionAmount > 0.04
}

function writeVacuumMouthWorld(
  elapsed: number,
  clockTime: number,
  scratch: VacuumPoseScratch,
  mouthWorld: THREE.Vector3,
  mouthForward: THREE.Vector3,
  pickupSlot: TableBoxSlot,
  loopFromConveyor = false,
) {
  writeVacuumRuntimeState(elapsed, clockTime, scratch, scratch.runtime, pickupSlot, loopFromConveyor)
  setNozzleMouthPoint(scratch.mouthLocal, mouthForward, scratch.runtime, clockTime, scratch.nozzle)
  setVacuumLocalAsWorld(mouthWorld, scratch.mouthLocal)
  setVacuumLocalDirectionAsWorld(mouthForward, mouthForward)
}

function sampleBoxPose(
  elapsed: number,
  clockTime: number,
  pose: BoxPoseSample,
  vacuumScratch: VacuumPoseScratch,
  pickupSlot: TableBoxSlot,
  loopFromConveyor = false,
  slotIndex = 0,
) {
  const pickupX = pickupSlot[0]
  const pickupZ = pickupSlot[1]
  const pickupYaw = pickupSlot[2]
  const restRotationX = getTableBoxRestRotationX()
  const restRotationZ = getTableBoxRestRotationZ()
  const yScale = 1
  const tableAttention = smoother01((elapsed - (BOX_RUN_START_TIME + 0.08)) / 0.58)
    * (1 - smoother01((elapsed - BOX_SUCTION_START_TIME) / 0.34))
  const suctionAmount = getBoxSuctionAmount(elapsed)
  const pullAmount = getBoxPullAmount(elapsed)
  const latchAmount = getBoxLatchAmount(elapsed)
  const placeAmount = getBoxPlaceAmount(elapsed)
  const conveyorAmount = getBoxConveyorAmount(elapsed)
  const fireDropAmount = getBoxFireDropAmount(elapsed)
  const burnVanishAmount = getBoxBurnVanishAmount(elapsed)

  pose.visible = elapsed > 0.001
  pose.shadowVisible = pose.visible && latchAmount < 0.82
  pose.suctionAmount = suctionAmount
  pose.pullAmount = pullAmount
  pose.latchAmount = latchAmount
  pose.position.set(pickupX, BOX_POSITION[1], pickupZ)
  pose.rotation.set(
    restRotationX,
    pickupYaw,
    restRotationZ,
  )
  pose.scale.set(1, yScale, 1)
  pose.position.y = getBoxSurfaceRestY(
	        TABLE_TOP_Y,
	        pose.scale.y,
	        pose.rotation.x,
        pose.rotation.y,
        pose.rotation.z,
        pose.scale.x,
	        pose.scale.z,
	      )
  pose.shadowScale.set(
    0.34 + tableAttention * 0.04,
    0.18 + tableAttention * 0.025,
    1,
  )

  if (pullAmount <= 0) {
    if (suctionAmount > 0.02 && pose.visible) {
      writeVacuumMouthWorld(elapsed, clockTime, vacuumScratch, pose.mouthWorld, pose.mouthForward, pickupSlot, loopFromConveyor)
      const preTug = smooth01((elapsed - BOX_SUCTION_START_TIME) / (BOX_PULL_START_TIME - BOX_SUCTION_START_TIME))
      const inhale = preTug * 0.018
      pose.scale.set(1 + inhale * 0.55, yScale, 1 + inhale * 0.36)
      pose.position.y = getBoxSurfaceRestY(
        TABLE_TOP_Y,
        pose.scale.y,
        pose.rotation.x,
	        pose.rotation.y,
	        pose.rotation.z,
	        pose.scale.x,
        pose.scale.z,
      )
    }
    const tableIdleJiggle = (1 - smoother01((elapsed - (BOX_SUCTION_START_TIME - 0.16)) / 0.44))
      * (1 - suctionAmount * 0.64)
    applyTableBoxIdleJiggle(pose, clockTime, slotIndex, tableIdleJiggle, TABLE_TOP_Y)
    keepBoxAboveSolidSurfaces(pose)
    return
  }

  writeVacuumMouthWorld(elapsed, clockTime, vacuumScratch, pose.mouthWorld, pose.mouthForward, pickupSlot, loopFromConveyor)
  pose.source.set(pickupX, pose.position.y, pickupZ)
  const sealAmount = smooth01((elapsed - BOX_SUCTION_LATCH_TIME) / 0.22) * (1 - getBoxReleaseAmount(elapsed))
  const sealPlaneOffset = getHoseSealPlaneOffset(elapsed, sealAmount)
  pose.target.copy(pose.mouthWorld)
    .addScaledVector(pose.mouthForward, BOX_HOSE_CONTACT_RADIUS + sealPlaneOffset)
  pose.target.y += BOX_HOSE_CONTACT_LIFT - BOX_HOSE_CONTACT_LOCAL_Y
  pose.direction.copy(pose.target).sub(pose.source)
  pose.direction.y = 0
  if (pose.direction.lengthSq() > 0.001) {
    pose.direction.normalize()
    pose.source.addScaledVector(pose.direction, 0.006 + pullAmount * 0.012)
  }
  pose.direction.copy(pose.target).sub(pose.source)
  pose.right.set(-pose.direction.z, 0, pose.direction.x)
  if (pose.right.lengthSq() < 0.001) pose.right.set(1, 0, 0)
  pose.right.normalize()

  const creepAmount = smoother01(pullAmount / 0.48) * 0.052
  const drawAmount = smoother01(Math.max(0, pullAmount - 0.14) / 0.86)
  const slideAmount = clamp01(creepAmount + drawAmount * 0.82)
  const liftAmount = smoother01(Math.max(0, pullAmount - BOX_SUCTION_LIFT_START_AMOUNT) / (1 - BOX_SUCTION_LIFT_START_AMOUNT))
  const sealLockAmount = smoother01(Math.max(0, pullAmount - BOX_SUCTION_SEAL_LOCK_START_AMOUNT) / (1 - BOX_SUCTION_SEAL_LOCK_START_AMOUNT))
  const looseSuctionAmount = 1 - sealLockAmount
  const rush = clamp01(slideAmount + liftAmount * 0.08)
  const tableContactAmount = 1 - liftAmount
  const tableSkim = Math.sin(slideAmount * Math.PI) * tableContactAmount * 0.001
  const floatArc = Math.sin(liftAmount * Math.PI) * 0.074 * looseSuctionAmount
  const crossTug = Math.sin(rush * Math.PI * 2.1 + 0.3) * (1 - rush) * 0.034 * looseSuctionAmount
  const attachedWiggle = latchAmount * Math.sin(clockTime * 9.2) * 0.003
  const liftTargetY = pose.target.y + floatArc + attachedWiggle
  const dragPoseAmount = smoother01(Math.max(0, pullAmount - 0.04) / 0.66)
  pose.position.lerpVectors(pose.source, pose.target, rush)
  pose.position.y = (pose.source.y + tableSkim) * tableContactAmount
    + liftTargetY * liftAmount
  pose.position.addScaledVector(pose.right, crossTug * (1 - liftAmount * 0.25) * dragPoseAmount)

  const slideScrape = Math.sin(drawAmount * Math.PI) * (1 - liftAmount)
  const stretch = Math.sin(rush * Math.PI)
  const latchSnap = dampedPulse(elapsed, BOX_SUCTION_LATCH_TIME, 0.54, 2.8)
  const sealSquash = sealAmount * 0.08 + latchSnap * 0.08
  const dragRotationX = 0.08 + slideScrape * 0.16 - stretch * 0.2 + latchSnap * 0.16
  const dragRotationY = Math.atan2(pose.mouthForward.x, pose.mouthForward.z) + slideAmount * 0.12 + stretch * 0.22
  const dragRotationZ = -0.08 + slideScrape * 0.16 + crossTug * 0.9 - latchSnap * 0.22
  pose.rotation.set(
    restRotationX + (dragRotationX - restRotationX) * liftAmount,
    pickupYaw + (dragRotationY - pickupYaw) * drawAmount,
    restRotationZ + (dragRotationZ - restRotationZ) * liftAmount,
  )
  const airborneDeform = clamp01(liftAmount * 1.25 + sealAmount * 0.75 + latchAmount * 0.35)
  const dragScaleX = 1 + slideScrape * 0.16 + stretch * 0.2 + latchSnap * 0.08 + sealSquash * 0.35
  const dragScaleY = 1 - (slideScrape * 0.04 + stretch * 0.14 + latchSnap * 0.06 + sealSquash * 0.42) * airborneDeform
  const dragScaleZ = 1 + slideScrape * 0.1 + stretch * 0.08 - sealSquash * 0.25
  pose.scale.set(
    1 + (dragScaleX - 1) * drawAmount,
    1 + (dragScaleY - 1) * drawAmount,
    1 + (dragScaleZ - 1) * drawAmount,
  )
  if (tableContactAmount > 0.001) {
    const contactY = getBoxSurfaceRestY(
      TABLE_TOP_Y,
      pose.scale.y,
      pose.rotation.x,
      pose.rotation.y,
      pose.rotation.z,
      pose.scale.x,
      pose.scale.z,
    )
    pose.position.y = contactY * tableContactAmount + liftTargetY * liftAmount
  }
  const contactLockAmount = sealLockAmount * liftAmount
  if (contactLockAmount > 0.001) {
    pose.position.lerp(pose.target, smoother01(contactLockAmount) * (0.48 + latchAmount * 0.18))
  }
  pose.shadowScale.multiplyScalar(Math.max(0.08, 1 - rush * 0.78))

  if (placeAmount > 0) {
    const placeOvershoot = Math.max(0, easeOutBack01(placeAmount) - 1) * 0.28
    const releaseLift = BOX_CONVEYOR_DROP_RELEASE_HEIGHT * smoother01((placeAmount - 0.34) / 0.66)
    const handoffArc = Math.sin(placeAmount * Math.PI) * 0.035
    const placeSquash = Math.sin(placeAmount * Math.PI) * 0.12
    const releasePop = dampedPulse(elapsed, BOX_CONVEYOR_PLACE_TIME - 0.04, 0.42, 2.4)
    const placeDropReadiness = smoother01((placeAmount - 0.46) / 0.54)
    const placeRotationX = -0.08 * placeDropReadiness
    const placeRotationY = 0.16 + placeOvershoot * 0.12
    const placeRotationZ = 0.035 * placeDropReadiness
    const placeScaleX = (1 + stretch * 0.2) * (1 + placeSquash * 0.4 + placeOvershoot * 0.08)
    const placeScaleY = (1 - stretch * 0.1) * (1 - placeSquash - placeOvershoot * 0.06)
    const placeScaleZ = (1 + stretch * 0.06) * (1 + placeSquash * 0.25 + placeOvershoot * 0.06)
    const placeContactY = getBoxSurfaceRestY(
      CONVEYOR_BELT_TOP_Y,
      placeScaleY,
      placeRotationX,
      placeRotationY,
      placeRotationZ,
      placeScaleX,
      placeScaleZ,
    )
    pose.position.set(
      pose.position.x * (1 - placeAmount) + BOX_CONVEYOR_START_POSITION[0] * placeAmount,
      pose.position.y * (1 - placeAmount) + (placeContactY + handoffArc + releaseLift) * placeAmount,
      pose.position.z * (1 - placeAmount) + BOX_CONVEYOR_START_POSITION[2] * placeAmount,
    )
    pose.position.addScaledVector(pose.mouthForward, releasePop * 0.016 + placeOvershoot * 0.01)
    pose.rotation.set(
      pose.rotation.x * (1 - placeAmount) + placeRotationX * placeAmount,
      pose.rotation.y * (1 - placeAmount) + placeRotationY * placeAmount,
      pose.rotation.z * (1 - placeAmount) + placeRotationZ * placeAmount,
    )
    pose.scale.set(placeScaleX, placeScaleY, placeScaleZ)
    pose.shadowScale.set(0.32, 0.18, 1)
  }

  if (elapsed >= BOX_CONVEYOR_PLACE_TIME) {
    const beltSettle = clamp01((elapsed - BOX_CONVEYOR_PLACE_TIME) / 0.42)
    const dropElapsed = elapsed - BOX_CONVEYOR_PLACE_TIME
    const conveyorDropAmount = clamp01(dropElapsed / BOX_CONVEYOR_DROP_DURATION)
    const conveyorDropHeight = (1 - conveyorDropAmount) * (1 - conveyorDropAmount) * BOX_CONVEYOR_DROP_RELEASE_HEIGHT
    const bounceT = clamp01((dropElapsed - BOX_CONVEYOR_DROP_DURATION * 0.62) / 0.46)
    const landingBounce = Math.max(0, Math.sin(bounceT * Math.PI * 2.25))
      * Math.exp(-bounceT * 3.35)
      * BOX_CONVEYOR_DROP_BOUNCE_HEIGHT
    const landingImpact = dampedPulse(
      elapsed,
      BOX_CONVEYOR_PLACE_TIME + BOX_CONVEYOR_DROP_DURATION * 0.72,
      0.36,
      2.8,
    )
    const beltMotionAmount = getBoxConveyorMotionAmount(elapsed)
    const beltLife = Math.sin(conveyorAmount * Math.PI)
    const beltWobble = (Math.sin(conveyorAmount * Math.PI * 2.9 + 0.35) * beltLife * 0.012
      + landingImpact * 0.01)
      * (1 - fireDropAmount * 0.75)
    const beltWeightSquash = (
      Math.sin(beltSettle * Math.PI) * 0.12 * (1 - conveyorAmount * 0.5)
      + landingImpact * 0.1
    ) * (1 - fireDropAmount * 0.85)
    const handoffFade = 1 - smoother01((elapsed - BOX_CONVEYOR_PLACE_TIME) / 0.18)
    const releasePopCarry = dampedPulse(elapsed, BOX_CONVEYOR_PLACE_TIME - 0.04, 0.42, 2.4) * handoffFade
    const beltScaleY = 1 - beltWeightSquash
    const beltRotationX = beltWobble * 0.42
    const beltRotationY = 0.16 + beltMotionAmount * 0.22
    const beltRotationZ = -beltWobble
    const beltScaleX = 1 + beltWeightSquash * 0.35
    const beltScaleZ = 1 + beltWeightSquash * 0.24
    const beltContactY = getBoxSurfaceRestY(
      CONVEYOR_BELT_TOP_Y,
      beltScaleY,
      beltRotationX,
      beltRotationY,
      beltRotationZ,
      beltScaleX,
      beltScaleZ,
    )
    pose.position.set(
      BOX_CONVEYOR_START_POSITION[0] + (BOX_CONVEYOR_END_POSITION[0] - BOX_CONVEYOR_START_POSITION[0]) * beltMotionAmount,
      beltContactY + conveyorDropHeight + landingBounce,
      BOX_CONVEYOR_START_POSITION[2] + (BOX_CONVEYOR_END_POSITION[2] - BOX_CONVEYOR_START_POSITION[2]) * beltMotionAmount,
    )
    pose.position.addScaledVector(pose.mouthForward, releasePopCarry * 0.014)
    pose.rotation.set(
      beltRotationX,
      beltRotationY,
      beltRotationZ,
    )
    pose.scale.set(beltScaleX, beltScaleY, beltScaleZ)
    pose.shadowVisible = pose.visible && fireDropAmount < 0.65
    pose.shadowScale.set(0.31 + conveyorDropAmount * 0.035 + landingImpact * 0.035, 0.16 + conveyorDropAmount * 0.02 + landingImpact * 0.02, 1)
  }

  keepBoxAboveSolidSurfaces(pose)

  if (fireDropAmount > 0) {
    const forwardAmount = fireDropAmount * 0.72 + smoother01(fireDropAmount) * 0.28
    const gravityAmount = fireDropAmount * fireDropAmount * (0.74 + fireDropAmount * 0.26)
    const lipLift = Math.sin(clamp01(fireDropAmount / 0.34) * Math.PI) * 0.076 * (1 - fireDropAmount * 0.52)
    const edgeTip = smoother01((fireDropAmount - 0.04) / 0.28)
    const tumble = smoother01((fireDropAmount - 0.08) / 0.52)
    const airborneWobble = Math.sin(fireDropAmount * Math.PI * 5.2 + 0.25) * (1 - fireDropAmount) * 0.024
    const rimSlide = Math.sin(fireDropAmount * Math.PI) * 0.028
    const vanishScale = Math.max(0.02, 1 - burnVanishAmount * 0.96)
    const squashPop = Math.sin(fireDropAmount * Math.PI) * (1 - burnVanishAmount) * 0.1
    pose.position.set(
      BOX_FIRE_DROP_START_POSITION[0]
        + (BOX_FIRE_DIVE_TARGET[0] - BOX_FIRE_DROP_START_POSITION[0]) * forwardAmount
        + rimSlide,
      BOX_FIRE_DROP_START_POSITION[1]
        + (BOX_FIRE_DIVE_TARGET[1] - BOX_FIRE_DROP_START_POSITION[1]) * gravityAmount
        + lipLift
        - edgeTip * 0.012,
      BOX_FIRE_DROP_START_POSITION[2]
        + (BOX_FIRE_DIVE_TARGET[2] - BOX_FIRE_DROP_START_POSITION[2]) * forwardAmount,
    )
    pose.rotation.set(
      BOX_FIRE_DROP_START_ROTATION_X + forwardAmount * 0.48 + tumble * 1.72 + airborneWobble,
      BOX_FIRE_DROP_START_ROTATION_Y + forwardAmount * 0.34 + tumble * 0.52,
      BOX_FIRE_DROP_START_ROTATION_Z - edgeTip * 0.46 - tumble * 0.92 + airborneWobble * 1.4,
    )
    pose.scale.set(
      vanishScale * (1 + edgeTip * 0.32 + squashPop * 0.42),
      vanishScale * (1 - edgeTip * 0.16 - squashPop * 0.65),
      vanishScale * (1 + edgeTip * 0.18 + squashPop * 0.3),
    )
    pose.visible = pose.visible && burnVanishAmount < 0.98
    pose.shadowVisible = fireDropAmount < 0.74 && burnVanishAmount < 0.35
    pose.shadowScale.set(0.28 * (1 - forwardAmount * 0.42), 0.15 * (1 - forwardAmount * 0.34), 1)
  }
}

function getSequenceElapsed(clockTime: number, sequenceStart?: DropSequenceStart) {
  if (!sequenceStart || !('current' in sequenceStart)) return 0
  if (sequenceStart.current === null) return 0
  return clockTime - sequenceStart.current
}

function shouldStartFromConveyor(sequenceStart: DropSequenceStart, activeBoxIndex: number, runStartIndex: number) {
  return sequenceStart.current !== null && activeBoxIndex > runStartIndex
}

function pruneCarryoverBoxSequences(clockTime: number, carryoverSequencesRef: CarryoverBoxSequencesRef) {
  carryoverSequencesRef.current = carryoverSequencesRef.current.filter(({ sequenceStart }) => clockTime - sequenceStart < BOX_DROP_DURATION + 0.18)
}

function getCarryoverFireSample(clockTime: number, carryoverSequencesRef?: CarryoverBoxSequencesRef) {
  let elapsed = 0
  let opening = 0
  let furnaceEnergy = 0
  let burnVanish = 0

  if (!carryoverSequencesRef) return { elapsed, opening, furnaceEnergy, burnVanish }

  carryoverSequencesRef.current.forEach(({ sequenceStart }) => {
    const sampleElapsed = Math.min(BOX_DROP_DURATION, Math.max(0, clockTime - sequenceStart))
    const sampleOpening = getGroundTrapdoorOpenAmount(sampleElapsed)
    const sampleEnergy = getFurnaceEnergy(sampleElapsed)
    const sampleVanish = getBoxBurnVanishAmount(sampleElapsed)
    const sampleStrength = sampleOpening + sampleEnergy + sampleVanish
    const currentStrength = opening + furnaceEnergy + burnVanish

    if (sampleStrength > currentStrength) {
      elapsed = sampleElapsed
      opening = sampleOpening
      furnaceEnergy = sampleEnergy
      burnVanish = sampleVanish
    }
  })

  return { elapsed, opening, furnaceEnergy, burnVanish }
}

function dampedPulse(elapsed: number, start: number, duration: number, frequency: number) {
  const t = clamp01((elapsed - start) / duration)
  if (t <= 0 || t >= 1) return 0
  return Math.sin(t * Math.PI * frequency) * (1 - t) * (1 - t)
}

function roundedPulse(elapsed: number, start: number, duration: number) {
  const t = clamp01((elapsed - start) / duration)
  if (t <= 0 || t >= 1) return 0
  return Math.sin(t * Math.PI)
}

function getCeilingTrapdoorOpenAmount(elapsed: number) {
  const opening = smooth01((elapsed - 0.2) / 0.46)
  const closing = smooth01((elapsed - 2.46) / 0.58)
  const hardStopBounce = dampedPulse(elapsed, 0.58, 0.42, 3.4) * 0.12
  const closeShudder = dampedPulse(elapsed, 2.76, 0.38, 2.6) * -0.05

  return Math.min(1.1, Math.max(0, opening * (1 - closing) + hardStopBounce + closeShudder))
}

function getWalletDropTrapdoorOpenAmount(elapsed: number) {
  const opening = smooth01((elapsed - 0.06) / 0.28)
  const closing = smooth01((elapsed - 2.36) / 0.42)
  const hingeBounce = dampedPulse(elapsed, 0.34, 0.42, 3.2) * 0.08

  return Math.min(1.08, Math.max(0, opening * (1 - closing) + hingeBounce))
}

function seededWave(seed: number, offset: number) {
  return Math.sin(seed * 12.9898 + offset * 78.233)
}

function createFlameTongueGeometry(seed: number) {
  const sideCount = 6
  const bendX = seededWave(seed, 2) * 0.27
  const bendZ = seededWave(seed, 5) * 0.16
  const rings = [
    { y: 0, rx: 0.34, rz: 0.25, ox: 0, oz: 0, twist: seed * 0.18 },
    { y: 0.16, rx: 0.48, rz: 0.34, ox: bendX * -0.2, oz: bendZ * 0.14, twist: seed * 0.29 + 0.22 },
    { y: 0.38, rx: 0.34, rz: 0.24, ox: bendX * 0.3, oz: bendZ * -0.2, twist: seed * 0.37 + 0.48 },
    { y: 0.62, rx: 0.2, rz: 0.145, ox: bendX * 0.78, oz: bendZ * 0.42, twist: seed * 0.24 + 0.78 },
    { y: 0.84, rx: 0.075, rz: 0.055, ox: bendX * 1.12, oz: bendZ * 0.86, twist: seed * 0.46 + 1.04 },
  ] as const
  const positions: number[] = []
  const indices: number[] = []

  rings.forEach((ring, ringIndex) => {
    for (let side = 0; side < sideCount; side += 1) {
      const angle = (side / sideCount) * Math.PI * 2 + ring.twist
      const wobble = 1 + seededWave(seed + ringIndex * 0.71, side) * 0.11
      positions.push(ring.ox + Math.cos(angle) * ring.rx * wobble, ring.y, ring.oz + Math.sin(angle) * ring.rz * wobble)
    }
  })

  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let side = 0; side < sideCount; side += 1) {
      const nextSide = (side + 1) % sideCount
      const a = ring * sideCount + side
      const b = ring * sideCount + nextSide
      const c = (ring + 1) * sideCount + side
      const d = (ring + 1) * sideCount + nextSide
      indices.push(a, c, b, b, c, d)
    }
  }

  const baseCenter = positions.length / 3
  positions.push(0, 0, 0)
  for (let side = 0; side < sideCount; side += 1) {
    indices.push(baseCenter, (side + 1) % sideCount, side)
  }
  const tip = rings[rings.length - 1]
  const tipStart = (rings.length - 1) * sideCount
  const tipCenter = positions.length / 3
  positions.push(tip.ox + bendX * 0.5, tip.y + 0.2, tip.oz + bendZ * 0.34)
  for (let side = 0; side < sideCount; side += 1) {
    indices.push(tipCenter, tipStart + side, tipStart + ((side + 1) % sideCount))
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function InspectionCamera() {
  const { camera, size } = useThree()

  useEffect(() => {
    const narrow = size.width / Math.max(1, size.height) < 0.72
    camera.position.set(narrow ? 1.14 : 1.45, narrow ? 6.4 : 6.1, narrow ? 15.0 : 12.5)
    camera.lookAt(...BOX_TARGET)
    camera.updateProjectionMatrix()
  }, [camera, size.height, size.width])

  return null
}

function KeyboardCameraControls({
  controlsRef,
}: {
  controlsRef: MutableRefObject<OrbitControlsImpl | null>
}) {
  const { camera } = useThree()
  const keys = useRef({
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
    ShiftLeft: false,
    ShiftRight: false,
  })
  const forward = useMemo(() => new THREE.Vector3(), [])
  const right = useMemo(() => new THREE.Vector3(), [])
  const delta = useMemo(() => new THREE.Vector3(), [])
  const targetBefore = useMemo(() => new THREE.Vector3(), [])
  const clampedTarget = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    function setKey(event: KeyboardEvent, pressed: boolean) {
      if (!(event.code in keys.current)) return
      keys.current[event.code as keyof typeof keys.current] = pressed
      event.preventDefault()
    }

    function onKeyDown(event: KeyboardEvent) {
      setKey(event, true)
    }

    function onKeyUp(event: KeyboardEvent) {
      setKey(event, false)
    }

    window.addEventListener('keydown', onKeyDown, { passive: false })
    window.addEventListener('keyup', onKeyUp, { passive: false })

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  useFrame((_, dt) => {
    const state = keys.current
    const xInput = (state.ArrowRight ? 1 : 0) - (state.ArrowLeft ? 1 : 0)
    const zInput = (state.ArrowUp ? 1 : 0) - (state.ArrowDown ? 1 : 0)
    if (xInput === 0 && zInput === 0) return

    camera.getWorldDirection(forward)
    forward.y = 0
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1)
    forward.normalize()
    right.set(forward.z, 0, -forward.x).normalize()

    delta.set(0, 0, 0)
    delta.addScaledVector(forward, zInput)
    delta.addScaledVector(right, xInput)
    if (delta.lengthSq() < 0.0001) return
    delta.normalize().multiplyScalar(Math.min(dt, 0.04) * (state.ShiftLeft || state.ShiftRight ? 4.2 : 2.25))

    const controls = controlsRef.current
    if (controls) {
      targetBefore.copy(controls.target)
      clampedTarget.copy(controls.target).add(delta)
      clampedTarget.x = clamp(clampedTarget.x, ROOM_LEFT_X + 1.05, ROOM_RIGHT_X - 1.05)
      clampedTarget.z = clamp(clampedTarget.z, ROOM_BACK_Z + 0.65, ROOM_FRONT_Z - 0.65)
      delta.copy(clampedTarget).sub(targetBefore)
      controls.target.copy(clampedTarget)
      camera.position.add(delta)
      controls.update()
      return
    }

    camera.position.add(delta)
  })

  return null
}

function InspectionPose({
  runtime,
  sequenceStart,
  activeBoxIndexRef,
  runStartIndex,
}: {
  runtime: MutableRefObject<VacuumRuntime>
  sequenceStart: DropSequenceStart
  activeBoxIndexRef: MutableRefObject<number>
  runStartIndex: number
}) {
  const vacuumPose = useMemo(() => createVacuumPoseScratch(), [])

  useFrame(({ clock }, dt) => {
    const state = runtime.current
    const t = clock.elapsedTime
    const elapsed = Math.min(BOX_DROP_DURATION, getSequenceElapsed(t, sequenceStart))
    const cappedDt = Math.min(dt, 0.04)
    const activeBoxIndex = activeBoxIndexRef.current
    const pickupSlot = getTableBoxSlot(activeBoxIndex)
    const loopFromConveyor = shouldStartFromConveyor(sequenceStart, activeBoxIndex, runStartIndex)

    writeVacuumRuntimeState(elapsed, t, vacuumPose, state, pickupSlot, loopFromConveyor)
    if (elapsed >= BOX_PULL_START_TIME + 0.08 && elapsed < BOX_CONVEYOR_PLACE_TIME + 0.2) {
      state.swallowCycles = Math.max(state.swallowCycles, activeBoxIndex + 1)
    }
    state.velocity.multiplyScalar(Math.exp(-8 * cappedDt))
    setNozzleEntryPoint(state.mouth, null, state, t, vacuumPose.nozzle)
  })

  return null
}

function VacuumBagSuctionGlow({ runtime }: { runtime: MutableRefObject<VacuumRuntime> }) {
  const root = useRef<THREE.Group>(null)
  const bagGlow = useRef<THREE.Group>(null)
  const outerAura = useRef<THREE.Mesh>(null)
  const innerAura = useRef<THREE.Mesh>(null)
  const rimGlow = useRef<THREE.Mesh>(null)
  const floorSpill = useRef<THREE.Mesh>(null)
  const bagLight = useRef<THREE.PointLight>(null)
  const glowAmount = useRef(0)
  const bagPopAmount = useRef(0)
  const floorOffset = useMemo(() => new THREE.Vector3(), [])
  const cyan = useMemo(() => new THREE.Color('#74f0ff'), [])
  const rose = useMemo(() => new THREE.Color('#ff84e8'), [])
  const gold = useMemo(() => new THREE.Color('#ffe17a'), [])
  const mint = useMemo(() => new THREE.Color('#9dffc7'), [])
  const outerMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: cyan,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    side: THREE.BackSide,
    blending: THREE.NormalBlending,
    toneMapped: false,
  }), [cyan])
  const innerMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: rose,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    side: THREE.BackSide,
    blending: THREE.NormalBlending,
    toneMapped: false,
  }), [rose])
  const rimMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: gold,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    toneMapped: false,
  }), [gold])
  const floorMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: cyan,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    toneMapped: false,
  }), [cyan])

  useEffect(() => () => {
    outerMaterial.dispose()
    innerMaterial.dispose()
    rimMaterial.dispose()
    floorMaterial.dispose()
  }, [floorMaterial, innerMaterial, outerMaterial, rimMaterial])

  useFrame(({ clock }, dt) => {
    const state = runtime.current
    const rootGroup = root.current
    const cappedDt = Math.min(dt, 0.04)
    const t = clock.elapsedTime
    const suction = state.pulse + state.flash * 0.55
    const gulpFade = state.gulpFlow * Math.max(0, 1 - state.gulpAge / 0.95)
    const intakeHit = state.gulpFlow * Math.exp(-((state.gulpAge - 0.05) ** 2) * 120)
    const bodyHit = state.gulpFlow * Math.exp(-((state.gulpAge - 0.22) ** 2) * 44)
    const pointerGlow = state.pointerDown ? 0.62 : 0
    const targetGlow = clamp01(
      pointerGlow
      + clamp01((state.pulse - 0.62) / 0.58) * 0.24
      + clamp01(state.gulpFlow * 0.58)
      + clamp01(state.bagPuff * 0.72)
      + clamp01(state.flash * 0.52),
    )

    glowAmount.current = dampValue(glowAmount.current, targetGlow, targetGlow > glowAmount.current ? 7.2 : 3.1, cappedDt)
    bagPopAmount.current = dampValue(
      bagPopAmount.current,
      clamp01(state.bagPuff * 0.78 + state.gulpFlow * 0.36 + (state.pointerDown ? 0.18 : 0)),
      6.5,
      cappedDt,
    )

    const glow = glowAmount.current
    const bagPop = bagPopAmount.current
    const visible = glow > 0.018
    const breathing = 0.88 + Math.sin(t * 5.1) * 0.08 + Math.sin(t * 9.4 + 0.7) * 0.035
    const colorWave = (Math.sin(t * 2.15 + glow * 1.7) + 1) * 0.5
    const secondaryWave = (Math.sin(t * 3.1 + 1.8) + 1) * 0.5

    outerMaterial.color.copy(cyan).lerp(rose, colorWave * 0.62)
    innerMaterial.color.copy(gold).lerp(mint, secondaryWave * 0.72)
    rimMaterial.color.copy(rose).lerp(gold, 0.42 + secondaryWave * 0.34)
    floorMaterial.color.copy(outerMaterial.color).lerp(gold, 0.18)
    outerMaterial.opacity = visible ? Math.min(0.09, glow * 0.06 + bagPop * 0.028) * breathing : 0
    innerMaterial.opacity = visible ? Math.min(0.07, glow * 0.045 + bagPop * 0.026) * (0.9 + secondaryWave * 0.2) : 0
    rimMaterial.opacity = visible ? Math.min(0.12, glow * 0.065 + bagPop * 0.07) : 0
    floorMaterial.opacity = visible ? Math.min(0.1, glow * 0.062 + bagPop * 0.026) : 0

    if (rootGroup) {
      rootGroup.visible = visible
      rootGroup.position.copy(state.position)
      rootGroup.position.addScaledVector(state.forward, -(intakeHit * 0.045 + bodyHit * 0.035))
      rootGroup.position.y += Math.sin(t * 4.8) * 0.023 + state.recoil * 0.012 + bodyHit * 0.018
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
    }

    if (bagGlow.current) {
      bagGlow.current.position.set(
        VACUUM_BAG_GLOW_LOCAL_POSITION[0] + Math.sin(t * 2.35) * 0.012 * glow,
        VACUUM_BAG_GLOW_LOCAL_POSITION[1] + bagPop * 0.074,
        VACUUM_BAG_GLOW_LOCAL_POSITION[2] + bagPop * 0.052,
      )
      bagGlow.current.rotation.set(
        -0.24 - bagPop * 0.09 + Math.sin(t * 3.2) * 0.018 * glow,
        Math.sin(t * 2.35) * 0.016 * glow + bagPop * 0.035,
        Math.sin(t * 5.1) * 0.018 * glow + Math.sin(t * 12) * bagPop * 0.026,
      )
    }

    if (outerAura.current) {
      outerAura.current.visible = visible
      outerAura.current.scale.set(
        0.73 + glow * 0.16 + bagPop * 0.2,
        1.02 + glow * 0.2 + bagPop * 0.28,
        0.6 + glow * 0.12 + bagPop * 0.16,
      )
      outerAura.current.renderOrder = 34
    }

    if (innerAura.current) {
      innerAura.current.visible = visible
      innerAura.current.position.set(
        Math.sin(t * 2.8) * 0.05 * glow,
        0.03 + Math.sin(t * 3.6 + 0.4) * 0.024 * glow,
        -0.02,
      )
      innerAura.current.scale.set(
        0.5 + glow * 0.12 + bagPop * 0.1,
        0.72 + glow * 0.14 + bagPop * 0.16,
        0.4 + glow * 0.08,
      )
      innerAura.current.renderOrder = 35
    }

    if (rimGlow.current) {
      rimGlow.current.visible = visible
      rimGlow.current.position.set(0, -0.01 + Math.sin(t * 4.7) * 0.01 * glow, -0.46)
      rimGlow.current.rotation.set(Math.PI / 2, 0, Math.sin(t * 3.2) * 0.08 * glow)
      rimGlow.current.scale.set(
        0.22 + glow * 0.045 + bagPop * 0.06,
        0.22 + glow * 0.045 + bagPop * 0.06,
        0.1,
      )
      rimGlow.current.renderOrder = 36
    }

    if (floorSpill.current) {
      floorSpill.current.visible = visible
      if (rootGroup) {
        floorOffset.set(0, 0, VACUUM_BAG_GLOW_LOCAL_POSITION[2]).applyEuler(rootGroup.rotation)
        floorSpill.current.position.set(
          rootGroup.position.x + floorOffset.x,
          VACUUM_STAGE_FLOOR_LOCAL_Y + 0.012,
          rootGroup.position.z + floorOffset.z,
        )
      }
      floorSpill.current.rotation.set(-Math.PI / 2, 0, -0.1 + Math.sin(t * 1.7) * 0.045)
      floorSpill.current.scale.set(0.78 + glow * 0.38, 0.36 + glow * 0.18, 1)
      floorSpill.current.renderOrder = 4
    }

    if (bagLight.current) {
      bagLight.current.intensity = glow * (0.34 + bagPop * 0.42) * (0.9 + secondaryWave * 0.2)
      bagLight.current.color.copy(outerMaterial.color).lerp(innerMaterial.color, 0.34 + secondaryWave * 0.22)
    }
  })

  return (
    <>
      <group ref={root} visible={false}>
        <group ref={bagGlow} position={VACUUM_BAG_GLOW_LOCAL_POSITION}>
          <pointLight ref={bagLight} position={[0, 0.02, 0]} color="#74f0ff" intensity={0} distance={2.15} decay={2} />
          <mesh ref={outerAura} frustumCulled={false}>
            <sphereGeometry args={[1, 22, 14]} />
            <primitive object={outerMaterial} attach="material" />
          </mesh>
          <mesh ref={innerAura} frustumCulled={false}>
            <sphereGeometry args={[1, 18, 12]} />
            <primitive object={innerMaterial} attach="material" />
          </mesh>
          <mesh ref={rimGlow} frustumCulled={false}>
            <torusGeometry args={[1, 0.12, 8, 22]} />
            <primitive object={rimMaterial} attach="material" />
          </mesh>
        </group>
      </group>
      <mesh ref={floorSpill} rotation={[-Math.PI / 2, 0, 0]} visible={false} frustumCulled={false}>
        <circleGeometry args={[1, 32]} />
        <primitive object={floorMaterial} attach="material" />
      </mesh>
    </>
  )
}

function RitualPolishFx({
  sequenceStart,
  carryoverSequencesRef,
  activeBoxIndexRef,
}: {
  sequenceStart: DropSequenceStart
  carryoverSequencesRef: CarryoverBoxSequencesRef
  activeBoxIndexRef: MutableRefObject<number>
}) {
  const suctionHalo = useRef<THREE.Mesh>(null)
  const conveyorHalo = useRef<THREE.Mesh>(null)
  const furnaceHalo = useRef<THREE.Mesh>(null)
  const furnaceColumnGlow = useRef<THREE.Mesh>(null)
  const furnaceLongSpill = useRef<THREE.Mesh>(null)
  const suctionLight = useRef<THREE.PointLight>(null)
  const furnaceLight = useRef<THREE.PointLight>(null)
  const furnaceRimLight = useRef<THREE.PointLight>(null)
  const glints = useRef<THREE.Mesh[]>([])

  useFrame(({ clock }) => {
    const elapsed = Math.min(BOX_DROP_DURATION, getSequenceElapsed(clock.elapsedTime, sequenceStart))
    const carryoverFire = getCarryoverFireSample(clock.elapsedTime, carryoverSequencesRef)
    const suction = getBoxSuctionAmount(elapsed)
    const pull = getBoxPullAmount(elapsed)
    const latchPulse = dampedPulse(elapsed, BOX_SUCTION_LATCH_TIME, 0.5, 2.8)
    const placePulse = roundedPulse(elapsed, BOX_CONVEYOR_PLACE_TIME - 0.08, 0.56)
    const fireEnergy = Math.max(getFurnaceEnergy(elapsed), carryoverFire.furnaceEnergy)
    const trapOpening = Math.max(getGroundTrapdoorOpenAmount(elapsed), carryoverFire.opening)
    const apertureGlow = fireEnergy * smoother01((trapOpening - 0.24) / 0.48)
    const fireFlicker = 0.88 + Math.max(0, Math.sin(clock.elapsedTime * 8.2 + 0.4)) * 0.22
    const activePickupSlot = getTableBoxSlot(activeBoxIndexRef.current)

    if (suctionHalo.current) {
      const material = suctionHalo.current.material as THREE.MeshBasicMaterial
      const haloLive = suction > 0.02 && elapsed < BOX_CONVEYOR_PLACE_TIME
      suctionHalo.current.visible = haloLive
      material.opacity = haloLive ? Math.min(0.18, suction * 0.08 + pull * 0.08 + latchPulse * 0.06) : 0
      suctionHalo.current.position.set(activePickupSlot[0], TABLE_TOP_Y + 0.014, activePickupSlot[1])
      suctionHalo.current.scale.set(
        0.44 + suction * 0.18 + pull * 0.14 + latchPulse * 0.08,
        0.2 + suction * 0.07 + pull * 0.08,
        1,
      )
      suctionHalo.current.rotation.z = -0.16 + Math.sin(clock.elapsedTime * 3.4) * 0.025
      suctionHalo.current.renderOrder = 8
    }

    if (conveyorHalo.current) {
      const material = conveyorHalo.current.material as THREE.MeshBasicMaterial
      const active = placePulse > 0.02
      conveyorHalo.current.visible = active
      material.opacity = active ? placePulse * 0.2 : 0
      conveyorHalo.current.scale.set(0.2 + placePulse * 0.68, 0.09 + placePulse * 0.28, 1)
      conveyorHalo.current.rotation.z = -0.1 + placePulse * 0.22
      conveyorHalo.current.renderOrder = 10
    }

    if (furnaceHalo.current) {
      const material = furnaceHalo.current.material as THREE.MeshBasicMaterial
      const active = apertureGlow > 0.025
      furnaceHalo.current.visible = active
      material.opacity = active ? Math.min(0.28, apertureGlow * 0.22 * fireFlicker) : 0
      furnaceHalo.current.scale.set(0.44 + apertureGlow * 0.4, 0.28 + apertureGlow * 0.26, 1)
      furnaceHalo.current.rotation.z = Math.sin(clock.elapsedTime * 2.1) * 0.04
      furnaceHalo.current.renderOrder = 6
    }

    if (furnaceColumnGlow.current) {
      const material = furnaceColumnGlow.current.material as THREE.MeshBasicMaterial
      const active = apertureGlow > 0.025
      furnaceColumnGlow.current.visible = active
      material.opacity = active ? Math.min(0.28, apertureGlow * 0.22 * fireFlicker) : 0
      furnaceColumnGlow.current.scale.set(0.34 + apertureGlow * 0.34, 0.24 + apertureGlow * 0.24, 1)
      furnaceColumnGlow.current.position.y = ROOM_FLOOR_Y + 0.028
      furnaceColumnGlow.current.rotation.z = Math.sin(clock.elapsedTime * 2.2) * 0.045
      furnaceColumnGlow.current.renderOrder = 5
    }

    if (furnaceLongSpill.current) {
      const material = furnaceLongSpill.current.material as THREE.MeshBasicMaterial
      const active = apertureGlow > 0.04
      furnaceLongSpill.current.visible = active
      material.opacity = active ? Math.min(0.13, apertureGlow * 0.09 * fireFlicker) : 0
      furnaceLongSpill.current.scale.set(0.58 + apertureGlow * 0.34, 0.26 + apertureGlow * 0.12, 1)
      furnaceLongSpill.current.rotation.z = -0.1 + Math.sin(clock.elapsedTime * 1.8) * 0.035
      furnaceLongSpill.current.renderOrder = 5
    }

    glints.current.forEach((glint, index) => {
      const material = glint.material as THREE.MeshBasicMaterial
      const pop = Math.max(0, Math.sin(placePulse * Math.PI + index * 0.42)) * placePulse
      glint.visible = pop > 0.025
      material.opacity = pop * 0.55
      glint.position.y = CONVEYOR_BELT_TOP_Y + 0.035 + pop * (0.08 + index * 0.015)
      glint.rotation.set(0.42, -0.3 + index * 0.32, clock.elapsedTime * 0.75 + index * 0.9)
      glint.scale.set(0.018 + pop * 0.012, 0.08 + pop * 0.08, 0.018)
      glint.renderOrder = 26 + index
    })

    if (suctionLight.current) {
      suctionLight.current.position.set(activePickupSlot[0] + 0.16, TABLE_TOP_Y + 0.48, activePickupSlot[1] - 0.1)
      suctionLight.current.intensity = suction * 0.35 + pull * 0.32 + latchPulse * 0.42
    }

    if (furnaceLight.current) {
      furnaceLight.current.intensity = apertureGlow * fireFlicker * 2.25
    }

    if (furnaceRimLight.current) {
      furnaceRimLight.current.intensity = apertureGlow * fireFlicker * 1.25
    }
  })

  return (
    <>
      <pointLight ref={suctionLight} position={[BOX_POSITION[0], TABLE_TOP_Y + 0.48, BOX_POSITION[2]]} color="#7ee8ff" intensity={0} distance={2.6} />
      <pointLight ref={furnaceLight} position={[TRAPDOOR_POSITION[0] - 0.05, ROOM_FLOOR_Y + 0.08, TRAPDOOR_POSITION[2]]} color="#ffb73a" intensity={0} distance={3.2} decay={2} />
      <pointLight ref={furnaceRimLight} position={[TRAPDOOR_POSITION[0] - 0.14, ROOM_FLOOR_Y + 0.065, TRAPDOOR_POSITION[2] - 0.08]} color="#fff0a0" intensity={0} distance={1.85} decay={2} />
      <mesh ref={suctionHalo} position={[BOX_POSITION[0], TABLE_TOP_Y + 0.014, BOX_POSITION[2]]} rotation={[-Math.PI / 2, 0, -0.16]} visible={false}>
        <circleGeometry args={[1, 26]} />
        {ritualCoolGlowMaterial()}
      </mesh>
      <mesh ref={conveyorHalo} position={[BOX_CONVEYOR_START_POSITION[0], CONVEYOR_BELT_TOP_Y + 0.014, BOX_CONVEYOR_START_POSITION[2]]} rotation={[-Math.PI / 2, 0, -0.1]} visible={false}>
        <circleGeometry args={[1, 22]} />
        {ritualCoolGlowMaterial()}
      </mesh>
      <mesh ref={furnaceHalo} position={[TRAPDOOR_POSITION[0] - 0.02, ROOM_FLOOR_Y + 0.014, TRAPDOOR_POSITION[2]]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <circleGeometry args={[1, 28]} />
        {ritualWarmGlowMaterial()}
      </mesh>
      <mesh ref={furnaceLongSpill} position={[TRAPDOOR_POSITION[0] - 0.08, ROOM_FLOOR_Y + 0.017, TRAPDOOR_POSITION[2] - 0.06]} rotation={[-Math.PI / 2, 0, -0.1]} visible={false}>
        <circleGeometry args={[1, 30]} />
        {trapdoorLightSpillMaterial()}
      </mesh>
      <mesh ref={furnaceColumnGlow} position={[TRAPDOOR_POSITION[0] - 0.04, ROOM_FLOOR_Y + 0.028, TRAPDOOR_POSITION[2]]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <circleGeometry args={[1, 30]} />
        {trapdoorLightSpillMaterial()}
      </mesh>
      {[-0.12, 0.02, 0.15].map((x, index) => (
        <mesh
          key={`conveyor-place-glint-${index}`}
          ref={(node) => {
            if (node) glints.current[index] = node
          }}
          position={[BOX_CONVEYOR_START_POSITION[0] + x, CONVEYOR_BELT_TOP_Y + 0.035, BOX_CONVEYOR_START_POSITION[2] - 0.05 + index * 0.05]}
          visible={false}
        >
          <boxGeometry args={[1, 1, 1]} />
          {impactGlintMaterial()}
        </mesh>
      ))}
    </>
  )
}

function McmSunburstClock({
  position,
  scale = 1,
}: {
  position: [number, number, number]
  scale?: number
}) {
  const root = useRef<THREE.Group>(null)
  const secondHand = useRef<THREE.Group>(null)
  const minuteHand = useRef<THREE.Group>(null)
  const rays = useMemo(() => Array.from({ length: 24 }, (_, index) => {
    const angle = (index / 24) * Math.PI * 2
    const cardinal = index % 6 === 0
    const long = index % 3 === 0

    return {
      angle,
      length: cardinal ? 0.42 : long ? 0.34 : 0.24,
      radius: cardinal ? 0.51 : long ? 0.47 : 0.42,
      width: cardinal ? 0.028 : long ? 0.022 : 0.016,
    }
  }), [])
  const ticks = useMemo(() => Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * Math.PI * 2
    const cardinal = index % 3 === 0

    return {
      angle,
      cardinal,
      length: cardinal ? 0.095 : 0.052,
      width: cardinal ? 0.026 : 0.014,
      radius: cardinal ? 0.31 : 0.325,
    }
  }), [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime

    if (root.current) {
      const breathe = Math.sin(t * 0.82 + 0.4) * 0.004
      root.current.scale.setScalar(scale * (1 + breathe))
    }

    if (minuteHand.current) {
      minuteHand.current.rotation.z = 0.72 + Math.sin(t * 0.36) * 0.01
    }

    if (secondHand.current) {
      const tick = Math.floor(t * 1.6)
      const tickT = t * 1.6 - tick
      const easedTick = tick + easeOutBack01(tickT) * 0.86
      secondHand.current.rotation.z = -0.34 - easedTick * 0.105
    }
  })

  return (
    <group ref={root} position={position} scale={scale}>
      <mesh position={[0.045, -0.05, -0.008]} scale={[0.72, 0.72, 1]}>
        <circleGeometry args={[1, 32]} />
        {roomClockShadowMaterial()}
      </mesh>
      {rays.map(({ angle, length, radius, width }, index) => (
        <group
          key={`clock-ray-${angle}`}
          position={[Math.cos(angle) * radius, Math.sin(angle) * radius, 0.012 + (index % 2) * 0.002]}
          rotation={[0, 0, angle]}
        >
          <RoundedBox args={[length, width, 0.026]} radius={width * 0.48} smoothness={3}>
            {index % 2 === 0 ? mcmPanelBrassMaterial() : roomClockWalnutMaterial()}
          </RoundedBox>
        </group>
      ))}
      <mesh position={[0, 0, 0.014]} scale={[0.72, 0.72, 1]}>
        <circleGeometry args={[1, 36]} />
        {mcmPanelInkMaterial()}
      </mesh>
      <mesh position={[0, 0, 0.02]} scale={[0.65, 0.65, 1]}>
        <circleGeometry args={[1, 36]} />
        {roomClockWalnutMaterial()}
      </mesh>
      <mesh position={[0, 0, 0.026]} scale={[0.56, 0.56, 1]}>
        <circleGeometry args={[1, 36]} />
        {roomClockRimMaterial()}
      </mesh>
      <mesh position={[0, 0, 0.034]} scale={[0.47, 0.47, 1]}>
        <circleGeometry args={[1, 36]} />
        {roomClockFaceMaterial()}
      </mesh>
      <mesh position={[0, 0, 0.038]} scale={[0.36, 0.36, 1]}>
        <circleGeometry args={[1, 32]} />
        {roomClockInnerFaceMaterial()}
      </mesh>
      <mesh position={[0, 0, 0.043]}>
        <torusGeometry args={[0.39, 0.008, 8, 36]} />
        {mcmPanelInkMaterial()}
      </mesh>
      <mesh position={[0, 0, 0.046]}>
        <torusGeometry args={[0.252, 0.006, 8, 32]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      {ticks.map(({ angle, cardinal, length, radius, width }) => (
        <mesh
          key={`clock-tick-${angle}`}
          position={[Math.sin(angle) * radius, Math.cos(angle) * radius, 0.052]}
          rotation={[0, 0, -angle]}
          scale={[width, length, 0.01]}
        >
          <boxGeometry args={[1, 1, 1]} />
          {cardinal ? mcmPanelBrassMaterial() : roomClockHandMaterial()}
        </mesh>
      ))}
      <group rotation={[0, 0, -0.74]}>
        <RoundedBox args={[0.042, 0.23, 0.018]} radius={0.012} smoothness={3} position={[0, 0.09, 0.064]}>
          {roomClockHandMaterial()}
        </RoundedBox>
        <mesh position={[0, -0.038, 0.066]} scale={[0.026, 0.026, 1]}>
          <circleGeometry args={[1, 12]} />
          {roomClockHandMaterial()}
        </mesh>
      </group>
      <group ref={minuteHand} rotation={[0, 0, 0.72]}>
        <RoundedBox args={[0.03, 0.33, 0.017]} radius={0.01} smoothness={3} position={[0, 0.13, 0.068]}>
          {roomClockHandMaterial()}
        </RoundedBox>
      </group>
      <group ref={secondHand} rotation={[0, 0, -0.34]}>
        <mesh position={[0, 0.16, 0.073]} scale={[0.012, 0.34, 0.009]}>
          <boxGeometry args={[1, 1, 1]} />
          {roomClockSecondHandMaterial()}
        </mesh>
        <mesh position={[0, -0.075, 0.074]} scale={[0.025, 0.025, 1]}>
          <circleGeometry args={[1, 10]} />
          {roomClockSecondHandMaterial()}
        </mesh>
      </group>
      <mesh position={[0, 0, 0.079]} scale={[0.062, 0.062, 1]}>
        <circleGeometry args={[1, 16]} />
        {mcmPanelInkMaterial()}
      </mesh>
      <mesh position={[0, 0, 0.086]} rotation={[Math.PI / 2, 0, 0]} scale={[0.048, 0.048, 0.018]}>
        <cylinderGeometry args={[1, 1, 1, 14]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      <mesh position={[-0.11, 0.13, 0.09]} rotation={[0, 0, -0.38]} scale={[0.15, 0.055, 1]}>
        <circleGeometry args={[1, 18]} />
        {roomClockGlassHighlightMaterial()}
      </mesh>
    </group>
  )
}

function McmWallSconce({
  position,
  flip = 1,
}: {
  position: [number, number, number]
  flip?: 1 | -1
}) {
  const shade = useRef<THREE.Group>(null)
  const wallHalo = useRef<THREE.Mesh>(null)
  const lowerWash = useRef<THREE.Mesh>(null)
  const coreGlow = useRef<THREE.Mesh>(null)
  const floorPool = useRef<THREE.Mesh>(null)
  const lampLight = useRef<THREE.PointLight>(null)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const pulse = 0.9 + Math.sin(t * 1.65 + position[0]) * 0.045 + Math.sin(t * 3.7 + position[1]) * 0.018
    const warmFlicker = 0.92 + Math.sin(t * 5.4 + position[0] * 0.7) * 0.035
    if (shade.current) {
      shade.current.rotation.z = flip * (0.022 + Math.sin(t * 1.08 + position[0]) * 0.006)
      shade.current.position.y = -0.105 + Math.sin(t * 1.32 + position[0]) * 0.0025
    }
    if (wallHalo.current) {
      const material = wallHalo.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.072 + pulse * 0.035
      wallHalo.current.scale.set(0.72 * pulse, 1.02 * pulse, 1)
    }
    if (lowerWash.current) {
      const material = lowerWash.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.055 + pulse * 0.03
      lowerWash.current.scale.set(0.48 * warmFlicker, 1.22 * pulse, 1)
    }
    if (coreGlow.current) {
      const material = coreGlow.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.2 + warmFlicker * 0.075
      coreGlow.current.scale.set(0.2 * warmFlicker, 0.145 * warmFlicker, 1)
    }
    if (floorPool.current) {
      const material = floorPool.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.05 + pulse * 0.026
      floorPool.current.scale.set(0.72 * pulse, 0.38 * warmFlicker, 1)
    }
    if (lampLight.current) {
      lampLight.current.intensity = 1.02 + pulse * 0.3 + warmFlicker * 0.12
    }
  })

  return (
    <group position={position}>
      <pointLight ref={lampLight} position={[0, -0.18, 0.42]} color="#ffd982" intensity={1.12} distance={3.2} decay={2} />
      <mesh ref={wallHalo} position={[0, -0.12, 0.024]} scale={[0.72, 1.02, 1]} renderOrder={3}>
        <circleGeometry args={[1, 28]} />
        {roomLampWallWashMaterial({ color: '#f5c15f', opacity: 0.098 })}
      </mesh>
      <mesh ref={lowerWash} position={[0, -0.58, 0.028]} scale={[0.48, 1.22, 1]} renderOrder={3}>
        <circleGeometry args={[1, 28]} />
        {roomLampWallWashMaterial({ color: '#d98b3c', opacity: 0.076 })}
      </mesh>
      <mesh ref={floorPool} position={[0, ROOM_FLOOR_Y - position[1] + 0.026, 0.78]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.72, 0.38, 1]} renderOrder={3}>
        <circleGeometry args={[1, 28]} />
        {roomLampFloorPoolMaterial()}
      </mesh>
      <mesh ref={coreGlow} position={[0, -0.16, 0.055]} scale={[0.2, 0.145, 1]} renderOrder={4}>
        <circleGeometry args={[1, 22]} />
        {roomLampGlowMaterial()}
      </mesh>
      <OutlineMesh
        position={[0, 0.018, 0.044]}
        scale={[0.18, 0.42, 0.045]}
        outlineWidth={0.018}
        outlineColor="#211827"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={mcmPanelDarkWalnutMaterial()}
      />
      <mesh position={[0, 0.018, 0.074]} scale={[0.03, 0.32, 0.014]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      <mesh position={[0, 0.215, 0.08]} scale={[0.13, 0.022, 0.014]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      <mesh position={[0, -0.178, 0.08]} scale={[0.13, 0.022, 0.014]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      <mesh position={[0, -0.105, 0.12]} rotation={[Math.PI / 2, 0, 0]} scale={[0.038, 0.038, 0.26]}>
        <cylinderGeometry args={[1, 1, 1, 10]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      <group ref={shade} position={[0, -0.105, 0.265]}>
        <OutlineMesh
          rotation={[Math.PI / 2, 0, 0]}
          scale={[1, 1, 1]}
          outlineWidth={0.018}
          outlineColor="#211827"
          geometry={<cylinderGeometry args={[0.09, 0.23, 0.26, 12, 1]} />}
          material={roomLampShadeMaterial()}
        />
        <mesh position={[0, -0.006, 0.148]} scale={[0.16, 0.105, 1]}>
          <circleGeometry args={[1, 18]} />
          {roomLampInnerMaterial()}
        </mesh>
        <mesh position={[0, -0.004, 0.155]} scale={[0.18, 0.118, 0.02]}>
          <torusGeometry args={[1, 0.07, 6, 20]} />
          {mcmPanelBrassMaterial()}
        </mesh>
      </group>
    </group>
  )
}

function McmStandingLamp({
  position,
}: {
  position: [number, number, number]
}) {
  const shade = useRef<THREE.Group>(null)
  const wallWash = useRef<THREE.Mesh>(null)
  const floorPool = useRef<THREE.Mesh>(null)
  const innerGlow = useRef<THREE.Mesh>(null)
  const lampLight = useRef<THREE.PointLight>(null)
  const wallWashZ = ROOM_BACK_Z + 0.082 - position[2]
  const shadeFrontRibs = useMemo(() => [-0.28, -0.14, 0, 0.14, 0.28].map((x) => ({
    x,
    z: 0.385 - Math.abs(x) * 0.18,
    height: 0.3 - Math.abs(x) * 0.16,
  })), [])
  const pullChainLinks = useMemo(() => Array.from({ length: 4 }, (_, index) => ({
    y: 1.22 - index * 0.075,
    x: -0.18 + Math.sin(index * 0.9) * 0.012,
    z: 0.28,
  })), [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const pulse = 0.94 + Math.sin(t * 1.42 + 0.4) * 0.035 + Math.sin(t * 3.15) * 0.012
    if (shade.current) {
      shade.current.rotation.z = Math.sin(t * 1.06 + 0.9) * 0.01
      shade.current.position.y = 1.43 + Math.sin(t * 1.28 + 1.8) * 0.003
    }
    if (wallWash.current) {
      const material = wallWash.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.09 + pulse * 0.045
      wallWash.current.scale.set(1.02 * pulse, 1.32 * pulse, 1)
    }
    if (floorPool.current) {
      const material = floorPool.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.07 + pulse * 0.036
      floorPool.current.scale.set(1.16 * pulse, 0.68 * pulse, 1)
    }
    if (innerGlow.current) {
      const material = innerGlow.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.27 + pulse * 0.07
      innerGlow.current.scale.set(0.44 * pulse, 0.35 * pulse, 1)
    }
    if (lampLight.current) {
      lampLight.current.intensity = 1.36 + pulse * 0.44
    }
  })

  return (
    <group position={position}>
      <pointLight ref={lampLight} position={[0, 1.28, 0.08]} color="#ffd174" intensity={1.52} distance={4.35} decay={2} />
      <mesh ref={wallWash} position={[0, 1.22, wallWashZ]} scale={[1.02, 1.32, 1]} renderOrder={3}>
        <circleGeometry args={[1, 30]} />
        {roomLampWallWashMaterial({ color: '#d89b4a', opacity: 0.12 })}
      </mesh>
      <mesh ref={floorPool} position={[0, 0.012, 0.12]} rotation={[-Math.PI / 2, 0, -0.18]} scale={[1.16, 0.68, 1]} renderOrder={3}>
        <circleGeometry args={[1, 30]} />
        {roomLampFloorPoolMaterial()}
      </mesh>
      <OutlineMesh
        position={[0, 0.035, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[0.34, 0.045, 0.26]}
        outlineWidth={0.014}
        outlineColor="#211827"
        geometry={<cylinderGeometry args={[1, 1, 1, 14]} />}
        material={mcmPanelDarkWalnutMaterial()}
      />
      <mesh position={[0, 0.088, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[0.22, 0.024, 0.17]}>
        <cylinderGeometry args={[1, 1, 1, 14]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((angle) => (
        <OutlineMesh
          key={`standing-lamp-leg-${angle}`}
          position={[Math.cos(angle) * 0.17, 0.18, Math.sin(angle) * 0.17]}
          rotation={[Math.sin(angle) * -0.22, angle, Math.cos(angle) * 0.18]}
          scale={[0.032, 0.36, 0.032]}
          outlineWidth={0.012}
          outlineColor="#211827"
          geometry={<boxGeometry args={[1, 1, 1]} />}
          material={mcmPanelDarkWalnutMaterial()}
        />
      ))}
      {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((angle) => (
        <mesh
          key={`standing-lamp-foot-${angle}`}
          position={[Math.cos(angle) * 0.29, 0.035, Math.sin(angle) * 0.22]}
          rotation={[0, angle, 0]}
          scale={[0.14, 0.024, 0.045]}
        >
          <boxGeometry args={[1, 1, 1]} />
          {mcmPanelBrassMaterial()}
        </mesh>
      ))}
      <mesh position={[0, 0.68, 0]} scale={[0.024, 1.16, 0.024]}>
        <cylinderGeometry args={[1, 1, 1, 12]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      <mesh position={[0, 0.68, 0.005]} scale={[0.052, 0.56, 0.052]}>
        <cylinderGeometry args={[1, 1, 1, 10]} />
        {mcmPanelDarkWalnutMaterial()}
      </mesh>
      <mesh position={[0, 1.08, 0]} scale={[0.078, 0.078, 0.078]}>
        <sphereGeometry args={[1, 10, 8]} />
        {mcmPanelDarkWalnutMaterial()}
      </mesh>
      <group ref={shade} position={[0, 1.43, 0]}>
        <OutlineMesh
          position={[0, 0, 0]}
          scale={[1, 1, 1]}
          outlineWidth={0.024}
          outlineColor="#211827"
          geometry={<cylinderGeometry args={[0.22, 0.54, 0.48, 14, 1]} />}
          material={roomStandingLampShadeMaterial()}
        />
        <mesh position={[0, -0.02, 0.012]} scale={[0.76, 0.76, 0.76]}>
          <cylinderGeometry args={[0.21, 0.52, 0.43, 14, 1, true]} />
          {roomStandingLampPanelMaterial()}
        </mesh>
        <mesh position={[0, 0.255, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[0.24, 0.026, 0.24]}>
          <cylinderGeometry args={[1, 1, 1, 14]} />
          {mcmPanelBrassMaterial()}
        </mesh>
        <mesh position={[0, 0.306, 0]} scale={[0.034, 0.07, 0.034]}>
          <cylinderGeometry args={[1, 1, 1, 10]} />
          {mcmPanelBrassMaterial()}
        </mesh>
        <mesh position={[0, 0.365, 0]} scale={[0.052, 0.052, 0.052]}>
          <sphereGeometry args={[1, 10, 8]} />
          {mcmPanelDarkWalnutMaterial()}
        </mesh>
        <mesh position={[0.16, 0.02, 0.392]} rotation={[0, 0, -0.12]} scale={[0.1, 0.24, 1]} renderOrder={5}>
          <circleGeometry args={[1, 18]} />
          {roomStandingLampShadeHighlightMaterial()}
        </mesh>
        {shadeFrontRibs.map(({ x, z, height }) => (
          <mesh
            key={`standing-lamp-shade-rib-${x}`}
            position={[x, -0.025, z]}
            rotation={[0, x * -0.24, x * -0.06]}
            scale={[0.012, height, 0.01]}
          >
            <boxGeometry args={[1, 1, 1]} />
            {mcmPanelBrassMaterial()}
          </mesh>
        ))}
        <mesh ref={innerGlow} position={[0, -0.235, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.44, 0.35, 1]} renderOrder={4}>
          <circleGeometry args={[1, 20]} />
          {roomLampGlowMaterial()}
        </mesh>
        <mesh position={[0, -0.245, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.5, 0.4, 0.02]}>
          <torusGeometry args={[1, 0.055, 6, 24]} />
          {mcmPanelBrassMaterial()}
        </mesh>
        <mesh position={[0, -0.176, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.44, 0.34, 0.02]}>
          <torusGeometry args={[1, 0.03, 6, 24]} />
          {roomStandingLampTrimMaterial()}
        </mesh>
      </group>
      <group>
        {pullChainLinks.map(({ x, y, z }, index) => (
          <mesh key={`standing-lamp-pull-chain-${index}`} position={[x, y, z]} scale={[0.015, 0.026, 0.015]}>
            <sphereGeometry args={[1, 8, 6]} />
            {roomLampPullChainMaterial()}
          </mesh>
        ))}
        <mesh position={[-0.182, 0.88, 0.28]} scale={[0.032, 0.06, 0.018]}>
          <sphereGeometry args={[1, 8, 6]} />
          {mcmPanelDarkWalnutMaterial()}
        </mesh>
      </group>
    </group>
  )
}


function BurnCounterPlaque({ wallFaceZ }: { wallFaceZ: number }) {
  const { burn2Remaining, burn1Open } = React.useContext(BurnStatusContext)

  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 320
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // Background
    ctx.fillStyle = '#f4ecd0'
    ctx.fillRect(0, 0, 640, 320)

    // Top brass rail
    ctx.fillStyle = '#d6b55b'
    ctx.fillRect(24, 18, 592, 6)

    // Gold Seal row
    ctx.font = 'bold 52px Arial Black, Georgia, serif'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#8a5a24'
    ctx.textAlign = 'left'
    ctx.fillText('GOLD SEAL', 32, 90)
    ctx.textAlign = 'right'
    ctx.fillStyle = burn2Remaining > 0 ? '#8a5a24' : '#c43426'
    ctx.fillText(`${burn2Remaining} / 5`, 608, 90)

    // Mid divider
    ctx.strokeStyle = '#d6b55b'
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(24, 126); ctx.lineTo(616, 126); ctx.stroke()

    // Museum Tag row
    ctx.font = 'bold 52px Arial Black, Georgia, serif'
    ctx.fillStyle = '#2f7168'
    ctx.textAlign = 'left'
    ctx.fillText('MUSEUM TAG', 32, 192)
    ctx.textAlign = 'right'
    ctx.fillStyle = burn1Open ? '#2f7168' : '#c43426'
    ctx.fillText(burn1Open ? 'OPEN' : 'CLOSED', 608, 192)

    // Bottom divider
    ctx.strokeStyle = '#d6b55b'
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(24, 228); ctx.lineTo(616, 228); ctx.stroke()

    // Burns left label
    ctx.font = '900 32px Arial Black, Georgia, serif'
    ctx.fillStyle = '#5c4a2a'
    ctx.textAlign = 'center'
    ctx.letterSpacing = '0.2em'
    ctx.fillText('BURNS LEFT', 320, 278)

    // Bottom brass rail
    ctx.fillStyle = '#d6b55b'
    ctx.fillRect(24, 296, 592, 6)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    return tex
  }, [burn2Remaining, burn1Open])

  useEffect(() => () => { texture?.dispose() }, [texture])
  if (!texture) return null

  const x = ROOM_CENTER_X + 0.14
  const y = 1.52
  const z = wallFaceZ + 0.066

  return (
    <group position={[x, y, z]}>
      {/* Drop shadow */}
      <mesh position={[0.06, -0.052, -0.018]} scale={[1.72, 0.78, 0.014]}>
        <boxGeometry args={[1, 1, 1]} />
        {galleryShadowMaterial()}
      </mesh>
      {/* Walnut outer frame */}
      <OutlineMesh
        position={[0, 0, 0]}
        scale={[1.58, 0.68, 0.044]}
        outlineWidth={0.018}
        outlineColor="#17121f"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={galleryFrameMaterial()}
      />
      {/* Cream mat */}
      <mesh position={[0, 0, 0.028]} scale={[1.4, 0.52, 0.018]}>
        <boxGeometry args={[1, 1, 1]} />
        {galleryCreamMaterial()}
      </mesh>
      {/* Counter texture */}
      <mesh position={[0, 0, 0.055]}>
        <planeGeometry args={[1.28, 0.46]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      {/* Top brass strip */}
      <mesh position={[0, 0.31, 0.072]} scale={[1.26, 0.016, 0.01]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      {/* Bottom brass strip */}
      <mesh position={[0, -0.31, 0.072]} scale={[1.26, 0.016, 0.01]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelBrassMaterial()}
      </mesh>
    </group>
  )
}

function MuseumWallAccessories({ wallFaceZ }: { wallFaceZ: number }) {
  return (
    <group>
      <MuseumBackWallRhythm wallFaceZ={wallFaceZ} />
      <McmSunburstClock position={[ROOM_LEFT_X + 1.3, 1.74, wallFaceZ + 0.042]} scale={0.78} />
      <McmWallSconce position={[ROOM_LEFT_X + 3.22, 1.76, wallFaceZ + 0.05]} flip={1} />
      <BurnCounterPlaque wallFaceZ={wallFaceZ} />
      <McmWallSconce position={[ROOM_RIGHT_X - 3.28, 1.76, wallFaceZ + 0.05]} flip={-1} />
      <McmStandingLamp position={[ROOM_RIGHT_X - 1.18, ROOM_FLOOR_Y + 0.02, ROOM_BACK_Z + 0.58]} />
    </group>
  )
}

function MuseumBackWallArt({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0.06, -0.048, -0.016]} scale={[1.66, 0.72, 0.014]}>
        <boxGeometry args={[1, 1, 1]} />
        {galleryShadowMaterial()}
      </mesh>
      <OutlineMesh
        position={[0, 0, 0]}
        scale={[1.54, 0.66, 0.042]}
        outlineWidth={0.018}
        outlineColor="#17121f"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={galleryFrameMaterial()}
      />
      <mesh position={[0, 0, 0.03]} scale={[1.35, 0.49, 0.018]}>
        <boxGeometry args={[1, 1, 1]} />
        {galleryMatMaterial()}
      </mesh>
      <mesh position={[0, 0, 0.052]} scale={[1.06, 0.34, 0.012]}>
        <boxGeometry args={[1, 1, 1]} />
        {galleryCreamMaterial()}
      </mesh>
      <mesh position={[-0.34, -0.005, 0.068]} scale={[0.34, 0.25, 0.014]}>
        <boxGeometry args={[1, 1, 1]} />
        {galleryTealMaterial()}
      </mesh>
      <mesh position={[0.18, 0.08, 0.072]} rotation={[0, 0, -0.08]} scale={[0.56, 0.042, 0.014]}>
        <boxGeometry args={[1, 1, 1]} />
        {galleryGoldMaterial()}
      </mesh>
      <mesh position={[0.2, -0.095, 0.074]} rotation={[0, 0, 0.05]} scale={[0.64, 0.038, 0.014]}>
        <boxGeometry args={[1, 1, 1]} />
        {galleryRustMaterial()}
      </mesh>
      <mesh position={[0.5, -0.012, 0.078]} scale={[0.135, 0.135, 1]}>
        <circleGeometry args={[1, 20]} />
        {galleryGoldMaterial()}
      </mesh>
      <mesh position={[-0.56, 0.11, 0.078]} rotation={[0, 0, 0.04]} scale={[0.26, 0.034, 0.012]}>
        <boxGeometry args={[1, 1, 1]} />
        {galleryGoldMaterial()}
      </mesh>
    </group>
  )
}

function MuseumBackWallRhythm({
  wallFaceZ,
}: {
  wallFaceZ: number
}) {
  const datumY = 1.22
  const railZ = wallFaceZ + 0.072
  const railEndX = ROOM_CENTER_X - 0.04 + (ROOM_RIGHT_X - ROOM_LEFT_X - 2.32) / 2
  const clockClearX = ROOM_LEFT_X + 2.18
  const railSegments = [
    [clockClearX, railEndX],
  ] as const
  const inkStartX = ROOM_CENTER_X - 0.04 - (ROOM_RIGHT_X - ROOM_LEFT_X - 2.64) / 2
  const inkEndX = ROOM_CENTER_X - 0.04 + (ROOM_RIGHT_X - ROOM_LEFT_X - 2.64) / 2
  const inkSegments = [
    [Math.max(clockClearX + 0.04, inkStartX), inkEndX],
  ] as const

  return (
    <group>
      {railSegments.map(([startX, endX]) => (
        <mesh key={`back-wall-brass-rail-${startX}-${endX}`} position={[(startX + endX) / 2, datumY, railZ]} scale={[endX - startX, 0.016, 0.014]}>
          <boxGeometry args={[1, 1, 1]} />
          {mcmPanelBrassMaterial()}
        </mesh>
      ))}
      {inkSegments.map(([startX, endX]) => (
        <mesh key={`back-wall-ink-rail-${startX}-${endX}`} position={[(startX + endX) / 2, datumY - 0.044, railZ + 0.004]} scale={[endX - startX, 0.012, 0.012]}>
          <boxGeometry args={[1, 1, 1]} />
          {mcmPanelInkMaterial()}
        </mesh>
      ))}
    </group>
  )
}

function MuseumStageBackdrop() {
  const roomWidth = ROOM_RIGHT_X - ROOM_LEFT_X
  const roomDepth = ROOM_FRONT_Z - ROOM_BACK_Z
  const stageCenterX = ROOM_CENTER_X
  const stageCenterZ = ROOM_CENTER_Z + 0.12
  const backdropZ = ROOM_BACK_Z - 0.44
  const plinthY = ROOM_FLOOR_Y - 0.16

  return (
    <group>
      <mesh position={[stageCenterX + 0.22, ROOM_FLOOR_Y - 0.245, stageCenterZ + 0.42]} rotation={[-Math.PI / 2, 0, -0.03]} scale={[6.8, 4.35, 1]} renderOrder={0}>
        <circleGeometry args={[1, 42]} />
        {stageGroundShadowMaterial()}
      </mesh>
      <OutlineMesh
        position={[stageCenterX, plinthY, stageCenterZ]}
        scale={[roomWidth + 1.1, 0.24, roomDepth + 0.82]}
        outlineWidth={0.028}
        outlineColor="#17121f"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={stagePlinthMaterial()}
      />
      <mesh position={[stageCenterX, plinthY - 0.02, ROOM_FRONT_Z + 0.54]} scale={[roomWidth + 1.08, 0.24, 0.14]}>
        <boxGeometry args={[1, 1, 1]} />
        {stagePlinthFaceMaterial()}
      </mesh>
      <mesh position={[stageCenterX, plinthY + 0.13, ROOM_FRONT_Z + 0.47]} scale={[roomWidth + 0.88, 0.035, 0.035]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      <mesh position={[stageCenterX, plinthY + 0.03, ROOM_FRONT_Z + 0.505]} scale={[roomWidth + 0.78, 0.03, 0.03]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelInkMaterial()}
      </mesh>
      <OutlineMesh
        position={[stageCenterX, 1.58, backdropZ]}
        scale={[roomWidth + 2.35, 3.58, 0.06]}
        outlineWidth={0.018}
        outlineColor="#17121f"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={stageBackdropMaterial()}
      />
      <mesh position={[stageCenterX, 3.14, backdropZ + 0.036]} scale={[roomWidth + 2.08, 0.5, 0.032]}>
        <boxGeometry args={[1, 1, 1]} />
        {stageBackdropUpperMaterial()}
      </mesh>
      <mesh position={[stageCenterX, 2.86, backdropZ + 0.06]} scale={[roomWidth + 1.92, 0.042, 0.028]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelInkMaterial()}
      </mesh>
      <mesh position={[ROOM_LEFT_X - 0.6, 1.38, ROOM_CENTER_Z - 0.16]} scale={[0.56, 3.18, roomDepth + 0.58]}>
        <boxGeometry args={[1, 1, 1]} />
        {stageBackdropSideMaterial()}
      </mesh>
      <mesh position={[ROOM_RIGHT_X + 0.6, 1.38, ROOM_CENTER_Z - 0.16]} scale={[0.56, 3.18, roomDepth + 0.58]}>
        <boxGeometry args={[1, 1, 1]} />
        {stageBackdropSideMaterial()}
      </mesh>
      <mesh position={[ROOM_LEFT_X - 0.3, 1.44, ROOM_BACK_Z - 0.06]} scale={[0.16, 3.28, 0.22]}>
        <boxGeometry args={[1, 1, 1]} />
        {stagePlinthFaceMaterial()}
      </mesh>
      <mesh position={[ROOM_RIGHT_X + 0.3, 1.44, ROOM_BACK_Z - 0.06]} scale={[0.16, 3.28, 0.22]}>
        <boxGeometry args={[1, 1, 1]} />
        {stagePlinthFaceMaterial()}
      </mesh>
      {[-3.4, -1.2, 1.0, 3.2].map((x, index) => (
        <mesh key={`backdrop-brass-step-${x}`} position={[stageCenterX + x, 2.98 + (index % 2) * 0.055, backdropZ + 0.082]} scale={[0.72, 0.038, 0.026]}>
          <boxGeometry args={[1, 1, 1]} />
          {mcmPanelBrassMaterial()}
        </mesh>
      ))}
    </group>
  )
}

function McmSideWallPaneling({
  wallFaceX,
  side,
  doorZ,
  panelCenterY,
  panelHeight,
  panelTopY,
  panelBottomY,
  roomDepth,
}: {
  wallFaceX: number
  side: 'left' | 'right'
  doorZ: number
  panelCenterY: number
  panelHeight: number
  panelTopY: number
  panelBottomY: number
  roomDepth: number
}) {
  const face = side === 'left' ? 1 : -1
  const x = wallFaceX + face * 0.014
  const sidePanelHeight = panelHeight * 0.58
  const sidePanelCenterY = panelBottomY + sidePanelHeight / 2
  const sidePanelTopY = sidePanelCenterY + sidePanelHeight / 2
  const sidePanelBottomY = sidePanelCenterY - sidePanelHeight / 2
  const panelCenters = [
    ROOM_BACK_Z + 0.92,
    doorZ + (side === 'left' ? 1.18 : -1.18),
    ROOM_FRONT_Z - 0.92,
  ] as const

  return (
    <group>
      <mesh position={[wallFaceX, sidePanelCenterY, ROOM_CENTER_Z]} scale={[0.032, sidePanelHeight, roomDepth - 1.18]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelWalnutMaterial()}
      </mesh>
      <mesh position={[wallFaceX + face * 0.012, sidePanelTopY, ROOM_CENTER_Z]} scale={[0.018, 0.042, roomDepth - 1.04]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      <mesh position={[wallFaceX + face * 0.01, sidePanelBottomY, ROOM_CENTER_Z]} scale={[0.018, 0.04, roomDepth - 1.04]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelInkMaterial()}
      </mesh>
      {panelCenters.map((z) => (
        <mesh key={`${side}-mcm-panel-quiet-seam-${z}`} position={[x + face * 0.004, sidePanelCenterY, z]} scale={[0.014, sidePanelHeight - 0.07, 0.018]}>
          <boxGeometry args={[1, 1, 1]} />
          {mcmPanelInkMaterial()}
        </mesh>
      ))}
      {panelCenters.map((z, index) => (
        <mesh key={`${side}-mcm-panel-brass-cap-${z}`} position={[x + face * 0.014, sidePanelTopY - 0.09, z]} scale={[0.012, 0.016, index === 1 ? 0.46 : 0.38]}>
          <boxGeometry args={[1, 1, 1]} />
          {mcmPanelBrassMaterial()}
        </mesh>
      ))}
      <mesh position={[x + face * 0.016, sidePanelTopY + 0.12, ROOM_CENTER_Z]} scale={[0.012, 0.022, roomDepth - 1.22]}>
        <boxGeometry args={[1, 1, 1]} />
        {roomUpperWallLineMaterial()}
      </mesh>
    </group>
  )
}

function McmServiceDoor({
  wallFaceX,
  side,
  z,
}: {
  wallFaceX: number
  side: 'left' | 'right'
  z: number
}) {
  const face = side === 'left' ? 1 : -1
  const handleZ = side === 'left' ? -0.32 : 0.32
  const hingeZ = -handleZ

  return (
    <group position={[wallFaceX + face * 0.018, ROOM_FLOOR_Y + 0.94, z]}>
      <mesh position={[face * -0.014, 0.02, 0]} scale={[0.018, 1.98, 1.1]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelInkMaterial()}
      </mesh>
      <OutlineMesh
        position={[0, 0, 0]}
        scale={[0.052, 1.88, 0.96]}
        outlineWidth={0.018}
        outlineColor="#17121f"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={mcmPanelWalnutMaterial()}
      />
      <OutlineMesh
        position={[face * 0.016, -0.02, 0]}
        scale={[0.038, 1.66, 0.72]}
        outlineWidth={0.012}
        outlineColor="#17121f"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={stageDoorMaterial()}
      />
      <mesh position={[face * 0.037, 0.62, 0]} scale={[0.012, 0.034, 0.62]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      <mesh position={[face * 0.037, -0.56, 0]} scale={[0.012, 0.16, 0.62]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      <RoundedBox args={[0.018, 0.7, 0.36]} radius={0.035} smoothness={4} position={[face * 0.04, 0.18, 0]}>
        {stageDoorInsetMaterial()}
      </RoundedBox>
      <mesh position={[face * 0.052, 0.18, 0]} scale={[0.009, 0.62, 0.38]}>
        <boxGeometry args={[1, 1, 1]} />
        {stageDoorGlowMaterial()}
      </mesh>
      <mesh position={[face * 0.056, 0.18, 0]} scale={[0.009, 0.014, 0.3]}>
        <boxGeometry args={[1, 1, 1]} />
        {stageDoorGlassLineMaterial()}
      </mesh>
      <RoundedBox args={[0.016, 0.32, 0.62]} radius={0.026} smoothness={4} position={[face * 0.04, -0.48, 0]}>
        {stageDoorPanelMaterial()}
      </RoundedBox>
      <mesh position={[face * 0.052, -0.78, 0]} scale={[0.014, 0.12, 0.68]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      <mesh position={[face * 0.058, -0.78, 0]} scale={[0.01, 0.042, 0.58]}>
        <boxGeometry args={[1, 1, 1]} />
        {stageDoorBrassShadowMaterial()}
      </mesh>
      <mesh position={[face * 0.058, -0.08, handleZ]} rotation={[0, 0, Math.PI / 2]} scale={[0.034, 0.034, 0.024]}>
        <cylinderGeometry args={[1, 1, 1, 12]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      <mesh position={[face * 0.063, -0.08, handleZ * 0.52]} scale={[0.012, 0.035, 0.24]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      {[0.58, -0.52].map((y) => (
        <group key={`${side}-door-hinge-${y}`} position={[face * 0.058, y, hingeZ]}>
          <mesh scale={[0.012, 0.16, 0.064]}>
            <boxGeometry args={[1, 1, 1]} />
            {mcmPanelBrassMaterial()}
          </mesh>
          <mesh position={[face * 0.008, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.016, 0.016, 0.076]}>
            <cylinderGeometry args={[1, 1, 1, 10]} />
            {stageDoorBrassShadowMaterial()}
          </mesh>
        </group>
      ))}
      <mesh position={[face * -0.004, -0.93, 0]} scale={[0.066, 0.03, 1.02]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelInkMaterial()}
      </mesh>
    </group>
  )
}

function McmDoorCarpet({
  x,
  z,
  side,
}: {
  x: number
  z: number
  side: 'left' | 'right'
}) {
  const face = side === 'left' ? 1 : -1

  return (
    <group position={[x, ROOM_FLOOR_Y + 0.018, z]} rotation={[0, face * -0.018, 0]}>
      <mesh position={[0.02 * face, -0.004, 0.02]} rotation={[-Math.PI / 2, 0, face * 0.025]} scale={[0.42, 0.56, 1]} renderOrder={2}>
        <circleGeometry args={[1, 32]} />
        {mcmDoorMatShadowMaterial()}
      </mesh>
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <planeGeometry args={[0.68, 0.82]} />
        {mcmDoorMatBaseMaterial()}
      </mesh>
      <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}>
        <planeGeometry args={[0.48, 0.58]} />
        {mcmDoorMatInsetMaterial()}
      </mesh>
      <mesh position={[0, 0.006, -0.22]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={8}>
        <planeGeometry args={[0.5, 0.032]} />
        {mcmDoorMatGoldMaterial()}
      </mesh>
      <mesh position={[0, 0.007, 0.22]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={8}>
        <planeGeometry args={[0.5, 0.032]} />
        {mcmDoorMatGoldMaterial()}
      </mesh>
      <mesh position={[0.18 * face, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={9}>
        <planeGeometry args={[0.038, 0.54]} />
        {mcmDoorMatTealMaterial()}
      </mesh>
      <mesh position={[-0.12 * face, 0.009, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={9}>
        <planeGeometry args={[0.025, 0.48]} />
        {mcmDoorMatCreamMaterial()}
      </mesh>
    </group>
  )
}

function MuseumSideWallArt({
  wallFaceX,
  side,
  z,
}: {
  wallFaceX: number
  side: 'left' | 'right'
  z: number
}) {
  const face = side === 'left' ? 1 : -1

  return (
    <group position={[wallFaceX + face * 0.05, 1.74, z]}>
      {side === 'left' ? <McmFeatureWallGallery face={face} /> : <MuseumSideGeometricPrint face={face} />}
    </group>
  )
}

function McmFeatureWallGallery({ face }: { face: 1 | -1 }) {
  return (
    <group>
      <mesh position={[face * 0.024, 0.49, 0.08]} scale={[0.016, 0.022, 1.12]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      {[-0.44, 0.6].map((z) => (
        <mesh key={`left-gallery-rail-cap-${z}`} position={[face * 0.044, 0.49, z]} rotation={[Math.PI / 2, 0, 0]} scale={[0.032, 0.032, 0.07]}>
          <cylinderGeometry args={[1, 1, 1, 10]} />
          {mcmPanelBrassMaterial()}
        </mesh>
      ))}
      <group position={[0, 0.025, 0.08]}>
        <McmPunchNeedleTapestry face={face} />
      </group>
    </group>
  )
}

function MuseumSideGeometricPrint({ face }: { face: 1 | -1 }) {
  return (
    <group position={[face * -0.01, -0.02, 0]}>
      <mesh position={[face * -0.018, -0.048, 0.052]} scale={[0.014, 0.82, 0.62]}>
        <boxGeometry args={[1, 1, 1]} />
        {galleryShadowMaterial()}
      </mesh>
      <OutlineMesh
        position={[0, 0, 0]}
        scale={[0.052, 0.78, 0.58]}
        outlineWidth={0.014}
        outlineColor="#17121f"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={galleryFrameMaterial()}
      />
      <mesh position={[face * 0.018, 0, 0]} scale={[0.024, 0.6, 0.42]}>
        <boxGeometry args={[1, 1, 1]} />
        {galleryMatMaterial()}
      </mesh>
      <mesh position={[face * 0.034, 0.08, -0.09]} scale={[0.012, 0.32, 0.13]}>
        <boxGeometry args={[1, 1, 1]} />
        {galleryTealMaterial()}
      </mesh>
      <mesh position={[face * 0.037, -0.15, 0.08]} scale={[0.012, 0.16, 0.26]}>
        <boxGeometry args={[1, 1, 1]} />
        {galleryCreamMaterial()}
      </mesh>
      <mesh position={[face * 0.04, 0.245, 0.1]} rotation={[face * 0.02, 0, 0]} scale={[0.012, 0.034, 0.26]}>
        <boxGeometry args={[1, 1, 1]} />
        {galleryGoldMaterial()}
      </mesh>
      <mesh position={[face * 0.041, -0.28, -0.12]} rotation={[face * -0.03, 0, 0]} scale={[0.012, 0.034, 0.24]}>
        <boxGeometry args={[1, 1, 1]} />
        {galleryRustMaterial()}
      </mesh>
      <mesh position={[face * 0.042, 0.015, 0.12]} scale={[0.012, 0.2, 0.034]}>
        <boxGeometry args={[1, 1, 1]} />
        {galleryGoldMaterial()}
      </mesh>
    </group>
  )
}

function TapestryYarnBar({
  face,
  position,
  scale,
  color = 'teal',
  rotationZ = 0,
}: {
  face: 1 | -1
  position: [number, number, number]
  scale: [number, number, number]
  color?: 'teal' | 'rust' | 'gold' | 'cream' | 'dark'
  rotationZ?: number
}) {
  const material = color === 'rust'
    ? tapestryRustYarnMaterial()
    : color === 'gold'
    ? tapestryGoldYarnMaterial()
    : color === 'cream'
    ? tapestryCreamYarnMaterial()
    : color === 'dark'
    ? tapestryDarkYarnMaterial()
    : tapestryTealYarnMaterial()

  return (
    <RoundedBox args={scale} radius={0.018} smoothness={4} position={position} rotation={[rotationZ, face * 0.01, 0]}>
      {material}
    </RoundedBox>
  )
}

function TapestryStitch({
  face,
  y,
  z,
  color = 'cream',
  scale = 1,
}: {
  face: 1 | -1
  y: number
  z: number
  color?: 'teal' | 'rust' | 'gold' | 'cream' | 'dark'
  scale?: number
}) {
  const material = color === 'teal'
    ? tapestryTealYarnMaterial()
    : color === 'rust'
    ? tapestryRustYarnMaterial()
    : color === 'gold'
    ? tapestryGoldYarnMaterial()
    : color === 'dark'
    ? tapestryDarkYarnMaterial()
    : tapestryCreamYarnMaterial()

  return (
    <mesh position={[face * 0.05, y, z]} rotation={[0, 0, Math.PI / 2]} scale={[0.024 * scale, 0.024 * scale, 0.014 * scale]}>
      <cylinderGeometry args={[1, 1, 1, 10]} />
      {material}
    </mesh>
  )
}

function TapestryLetterGM({ face }: { face: 1 | -1 }) {
  const gStitches = [
    [-0.12, -0.18], [-0.05, -0.25], [0.05, -0.25], [0.13, -0.2],
    [0.18, -0.08], [0.18, 0.06], [0.12, 0.18], [0.02, 0.24],
    [-0.09, 0.22], [-0.17, 0.13], [-0.2, 0.01], [-0.18, -0.1],
    [0.02, -0.02], [0.11, -0.02], [0.11, -0.1],
  ] as const
  const mBars = [
    { y: 0.0, z: 0.1, sy: 0.38, sz: 0.045, r: 0 },
    { y: 0.0, z: 0.42, sy: 0.38, sz: 0.045, r: 0 },
    { y: 0.08, z: 0.2, sy: 0.23, sz: 0.042, r: -0.46 },
    { y: 0.08, z: 0.32, sy: 0.23, sz: 0.042, r: 0.46 },
  ] as const

  return (
    <group>
      {gStitches.map(([y, z], index) => (
        <TapestryStitch
          key={`gm-g-stitch-${index}`}
          face={face}
          y={y}
          z={z - 0.16}
          color={index % 4 === 0 ? 'gold' : 'cream'}
          scale={index % 3 === 0 ? 1.08 : 1}
        />
      ))}
      {mBars.map((bar, index) => (
        <TapestryYarnBar
          key={`gm-m-bar-${index}`}
          face={face}
          position={[face * 0.052, bar.y, bar.z]}
          scale={[0.025, bar.sy, bar.sz]}
          color={index < 2 ? 'cream' : 'gold'}
          rotationZ={bar.r}
        />
      ))}
    </group>
  )
}

function McmPunchNeedleTapestry({ face }: { face: 1 | -1 }) {
  const fringeZ = [-0.34, -0.24, -0.14, -0.04, 0.06, 0.16, 0.26, 0.36] as const
  const pileSpots = [
    [-0.2, -0.28, 'teal'], [-0.03, -0.28, 'gold'], [0.16, -0.3, 'rust'],
    [-0.24, 0.0, 'cream'], [-0.06, 0.0, 'gold'], [0.14, 0.02, 'teal'],
    [-0.18, 0.28, 'rust'], [0.02, 0.28, 'cream'], [0.2, 0.25, 'gold'],
  ] as const

  return (
    <group>
      <mesh position={[face * -0.021, -0.058, 0.054]} rotation={[0, face * Math.PI / 2, 0]} scale={[1, 1, 1]}>
        <planeGeometry args={[0.76, 0.88]} />
        {galleryShadowMaterial()}
      </mesh>
      <mesh position={[face * 0.034, -0.02, 0]} rotation={[0, face * Math.PI / 2, 0]}>
        <planeGeometry args={[0.72, 0.82]} />
        {mcmPanelInkMaterial()}
      </mesh>
      <mesh position={[face * 0.043, -0.02, 0]} rotation={[0, face * Math.PI / 2, 0]}>
        <planeGeometry args={[0.66, 0.76]} />
        {tapestryFabricMaterial()}
      </mesh>
      <mesh position={[face * 0.052, -0.02, 0]} rotation={[0, face * Math.PI / 2, 0]}>
        <planeGeometry args={[0.54, 0.64]} />
        {tapestryFabricInsetMaterial()}
      </mesh>
      {[-0.28, 0.28].map((z) => (
        <group key={`gm-tapestry-rod-loop-${z}`}>
          <RoundedBox args={[0.024, 0.21, 0.058]} radius={0.014} smoothness={4} position={[face * 0.056, 0.39, z]}>
            {tapestryCreamYarnMaterial()}
          </RoundedBox>
          <RoundedBox args={[0.03, 0.052, 0.092]} radius={0.015} smoothness={4} position={[face * 0.058, 0.48, z]}>
            {tapestryCreamYarnMaterial()}
          </RoundedBox>
          <mesh position={[face * 0.063, 0.292, z]} rotation={[Math.PI / 2, 0, 0]} scale={[0.026, 0.026, 0.014]}>
            <cylinderGeometry args={[1, 1, 1, 10]} />
            {tapestryGoldYarnMaterial()}
          </mesh>
        </group>
      ))}
      <TapestryYarnBar face={face} position={[face * 0.046, 0.19, -0.12]} scale={[0.02, 0.13, 0.46]} color="teal" rotationZ={-0.16} />
      <TapestryYarnBar face={face} position={[face * 0.049, -0.22, 0.18]} scale={[0.02, 0.12, 0.34]} color="rust" rotationZ={0.18} />
      <TapestryYarnBar face={face} position={[face * 0.05, 0.19, 0.26]} scale={[0.02, 0.07, 0.19]} color="gold" rotationZ={0.04} />
      <mesh position={[face * 0.052, -0.22, -0.26]} rotation={[0, 0, Math.PI / 2]} scale={[0.16, 0.012, 0.16]}>
        <cylinderGeometry args={[1, 1, 1, 20]} />
        {tapestryRustYarnMaterial()}
      </mesh>
      <mesh position={[face * 0.053, 0.22, 0.0]} rotation={[0, 0, Math.PI / 2]} scale={[0.12, 0.012, 0.12]}>
        <cylinderGeometry args={[1, 1, 1, 18]} />
        {tapestryGoldYarnMaterial()}
      </mesh>
      <TapestryLetterGM face={face} />
      {pileSpots.map(([y, zSpot, color], index) => (
        <TapestryStitch key={`tapestry-pile-dot-${index}`} face={face} y={y} z={zSpot} color={color} scale={0.58} />
      ))}
      {fringeZ.map((fringe, index) => (
        <mesh
          key={`gm-tapestry-fringe-${fringe}`}
          position={[face * 0.053, -0.46 - (index % 2) * 0.018, fringe]}
          rotation={[0.03 * (index % 2 === 0 ? 1 : -1), 0, 0]}
          scale={[0.01, 0.14 + (index % 3) * 0.018, 0.012]}
        >
          <boxGeometry args={[1, 1, 1]} />
          {index % 3 === 0 ? tapestryGoldYarnMaterial() : tapestryCreamYarnMaterial()}
        </mesh>
      ))}
    </group>
  )
}

function RitualStagePool({
  position,
  scale,
  color,
  opacity,
  rotation = 0,
}: {
  position: readonly [number, number]
  scale: readonly [number, number]
  color: string
  opacity: number
  rotation?: number
}) {
  return (
    <mesh position={[position[0], ROOM_FLOOR_Y + 0.021, position[1]]} rotation={[-Math.PI / 2, 0, rotation]} scale={[scale[0], scale[1], 1]} renderOrder={3}>
      <circleGeometry args={[1, 34]} />
      {ritualStagePoolMaterial({ color, opacity })}
    </mesh>
  )
}

function RitualFloorInlay() {
  return (
    <group>
      <RitualStagePool
        position={[1.08, 0.14]}
        scale={[3.3, 0.76]}
        color="#fff0a6"
        opacity={0.028}
        rotation={-0.16}
      />
      <RitualStagePool
        position={[TABLE_POSITION[0] + 0.1, TABLE_POSITION[2] + 0.08]}
        scale={[2.05, 1.18]}
        color="#fff0a6"
        opacity={0.044}
        rotation={-0.05}
      />
      <RitualStagePool
        position={[VACUUM_IDLE_BODY_WORLD[0] - 0.08, VACUUM_IDLE_BODY_WORLD[2] + 0.18]}
        scale={[0.88, 0.54]}
        color="#7ee8ff"
        opacity={0.038}
        rotation={0.16}
      />
      <RitualStagePool
        position={[CONVEYOR_POSITION[0] + 0.5, CONVEYOR_POSITION[2] + 0.02]}
        scale={[1.48, 0.62]}
        color="#ffb73a"
        opacity={0.044}
        rotation={-0.08}
      />
    </group>
  )
}

function McmIncineratorNook() {
  const trimSegments = [
    { position: [0, 0.038, -0.51] as const, scale: [1.54, 0.02, 0.026] as const },
    { position: [0, 0.038, 0.51] as const, scale: [1.54, 0.02, 0.026] as const },
    { position: [-0.79, 0.038, 0] as const, scale: [0.026, 0.02, 0.96] as const },
    { position: [0.79, 0.038, 0] as const, scale: [0.026, 0.02, 0.96] as const },
  ] as const
  const hatchMarks = [-0.45, -0.24, -0.03, 0.18, 0.39] as const

  return (
    <group position={[TRAPDOOR_POSITION[0], ROOM_FLOOR_Y + 0.016, TRAPDOOR_POSITION[2]]}>
      <mesh position={[-0.08, 0.005, 0]} rotation={[-Math.PI / 2, 0, -0.08]} scale={[1.22, 0.7, 1]} renderOrder={3}>
        <circleGeometry args={[1, 34]} />
        {mcmHearthHeatPoolMaterial()}
      </mesh>
      <OutlineMesh
        position={[0, 0, 0]}
        scale={[1.58, 0.026, 1.02]}
        outlineWidth={0.014}
        outlineColor="#211827"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={mcmHearthTileMaterial()}
      />
      <OutlineMesh
        position={[-0.05, 0.021, 0]}
        scale={[1.12, 0.018, 0.72]}
        outlineWidth={0.01}
        outlineColor="#211827"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={mcmHearthInsetMaterial()}
      />
      {[-0.34, 0, 0.34].map((offset) => (
        <mesh key={`incinerator-nook-tile-seam-${offset}`} position={[offset, 0.036, 0]} scale={[0.014, 0.008, 0.86]}>
          <boxGeometry args={[1, 1, 1]} />
          {mcmHearthLineMaterial()}
        </mesh>
      ))}
      {trimSegments.map(({ position, scale }) => (
        <mesh key={`incinerator-nook-trim-${position.join('-')}`} position={position} scale={scale}>
          <boxGeometry args={[1, 1, 1]} />
          {mcmHearthBrassMaterial()}
        </mesh>
      ))}
      {hatchMarks.map((x, index) => (
        <mesh
          key={`incinerator-warning-hatch-${x}`}
          position={[x, 0.044, 0.43]}
          rotation={[0, index % 2 === 0 ? 0.08 : -0.08, 0]}
          scale={[0.12, 0.012, 0.018]}
        >
          <boxGeometry args={[1, 1, 1]} />
          {index % 2 === 0 ? mcmHearthBrassMaterial() : trapWoodGrainMaterial()}
        </mesh>
      ))}
    </group>
  )
}

function ToonRoomShell() {
  const roomWidth = ROOM_RIGHT_X - ROOM_LEFT_X
  const roomDepth = ROOM_FRONT_Z - ROOM_BACK_Z
  const floorWidth = roomWidth + 0.32
  const floorDepth = roomDepth + 0.28
  const floorGridX = Array.from({ length: 5 }, (_, index) => ROOM_LEFT_X + 1.42 + index * 1.95)
  const floorGridZ = [ROOM_BACK_Z + 1.72, ROOM_FRONT_Z - 1.58] as const
  const backSlats = [ROOM_LEFT_X + 2.32, ROOM_CENTER_X + 0.24, ROOM_RIGHT_X - 2.32] as const
  const upperBackSeams = [ROOM_LEFT_X + roomWidth * 0.33, ROOM_LEFT_X + roomWidth * 0.66] as const
  const floorDetailY = ROOM_FLOOR_Y + 0.008
  const wallFaceZ = ROOM_BACK_Z + 0.065
  const leftWallFaceX = ROOM_LEFT_X + 0.065
  const rightWallFaceX = ROOM_RIGHT_X - 0.065
  const panelCenterY = 0.58
  const panelHeight = 0.72
  const panelTopY = panelCenterY + panelHeight / 2
  const panelBottomY = panelCenterY - panelHeight / 2
  const baseboardY = ROOM_FLOOR_Y + 0.09
  const frontWallZ = ROOM_FRONT_Z - 0.12
  const leftServiceDoorZ = ROOM_BACK_Z + 1.22
  const rightServiceDoorZ = ROOM_FRONT_Z - 1.3
  const clockRailClearX = ROOM_LEFT_X + 2.18
  const backPanelCapEndX = ROOM_CENTER_X + (roomWidth - 1.02) / 2
  const backPanelCapWidth = backPanelCapEndX - clockRailClearX

  return (
    <group>
      <OutlineMesh
        position={[ROOM_CENTER_X, ROOM_FLOOR_Y - 0.025, ROOM_CENTER_Z]}
        scale={[floorWidth, 0.05, floorDepth]}
        outlineWidth={0.018}
        outlineColor="#211827"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={roomFloorMaterial()}
      />
      {floorGridX.map((x) => (
        <mesh key={`room-floor-calm-grid-x-${x}`} position={[x, floorDetailY, ROOM_CENTER_Z]} scale={[0.014, 0.01, roomDepth - 0.36]}>
          <boxGeometry args={[1, 1, 1]} />
          {roomFloorLineMaterial()}
        </mesh>
      ))}
      {floorGridZ.map((z) => (
        <mesh key={`room-floor-calm-grid-z-${z}`} position={[ROOM_CENTER_X, floorDetailY + 0.002, z]} scale={[roomWidth - 0.62, 0.01, 0.014]}>
          <boxGeometry args={[1, 1, 1]} />
          {roomFloorLineMaterial()}
        </mesh>
      ))}
      <RitualFloorInlay />
      <McmIncineratorNook />
      <OutlineMesh
        position={[ROOM_CENTER_X, 1.16, ROOM_BACK_Z]}
        scale={[roomWidth, 3.02, 0.08]}
        outlineWidth={0.02}
        outlineColor="#211827"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={roomWallMaterial()}
      />
      <OutlineMesh
        position={[ROOM_LEFT_X, 1.16, ROOM_CENTER_Z]}
        scale={[0.08, 3.02, roomDepth]}
        outlineWidth={0.02}
        outlineColor="#211827"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={roomSideWallMaterial()}
      />
      <OutlineMesh
        position={[ROOM_RIGHT_X, 1.16, ROOM_CENTER_Z]}
        scale={[0.08, 3.02, roomDepth]}
        outlineWidth={0.02}
        outlineColor="#211827"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={roomSideWallMaterial()}
      />
      <mesh position={[ROOM_CENTER_X, ROOM_FLOOR_Y + 0.012, ROOM_BACK_Z + 0.22]} scale={[roomWidth - 0.34, 0.008, 0.28]} renderOrder={2}>
        <boxGeometry args={[1, 1, 1]} />
        {roomWallContactShadowMaterial()}
      </mesh>
      <mesh position={[ROOM_LEFT_X + 0.22, ROOM_FLOOR_Y + 0.013, ROOM_CENTER_Z]} scale={[0.26, 0.008, roomDepth - 0.56]} renderOrder={2}>
        <boxGeometry args={[1, 1, 1]} />
        {roomWallContactShadowMaterial()}
      </mesh>
      <mesh position={[ROOM_RIGHT_X - 0.22, ROOM_FLOOR_Y + 0.013, ROOM_CENTER_Z]} scale={[0.26, 0.008, roomDepth - 0.56]} renderOrder={2}>
        <boxGeometry args={[1, 1, 1]} />
        {roomWallContactShadowMaterial()}
      </mesh>
      <mesh position={[0.72, ROOM_FLOOR_Y + 0.019, 0.16]} rotation={[-Math.PI / 2, 0, -0.03]} scale={[4.35, 2.08, 1]} renderOrder={2}>
        <circleGeometry args={[1, 28]} />
        {roomStageContactShadowMaterial()}
      </mesh>
      <mesh position={[ROOM_CENTER_X, baseboardY, ROOM_BACK_Z + 0.088]} scale={[roomWidth - 0.28, 0.13, 0.052]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelDarkWalnutMaterial()}
      </mesh>
      <mesh position={[ROOM_LEFT_X + 0.088, baseboardY, ROOM_CENTER_Z]} scale={[0.052, 0.13, roomDepth - 0.4]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelDarkWalnutMaterial()}
      </mesh>
      <mesh position={[ROOM_RIGHT_X - 0.088, baseboardY, ROOM_CENTER_Z]} scale={[0.052, 0.13, roomDepth - 0.4]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelDarkWalnutMaterial()}
      </mesh>
      <mesh position={[ROOM_CENTER_X, baseboardY + 0.08, ROOM_BACK_Z + 0.118]} scale={[roomWidth - 0.32, 0.024, 0.02]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      <mesh position={[ROOM_LEFT_X + 0.118, baseboardY + 0.08, ROOM_CENTER_Z]} scale={[0.02, 0.024, roomDepth - 0.48]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      <mesh position={[ROOM_RIGHT_X - 0.118, baseboardY + 0.08, ROOM_CENTER_Z]} scale={[0.02, 0.024, roomDepth - 0.48]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      {upperBackSeams.map((x) => (
        <mesh key={`upper-back-wall-seam-${x}`} position={[x, 2.04, wallFaceZ + 0.004]} scale={[0.018, 0.96, 0.012]}>
          <boxGeometry args={[1, 1, 1]} />
          {roomUpperWallLineMaterial()}
        </mesh>
      ))}
      <mesh position={[ROOM_CENTER_X, 2.46, wallFaceZ + 0.004]} scale={[roomWidth - 0.48, 0.018, 0.012]}>
        <boxGeometry args={[1, 1, 1]} />
        {roomUpperWallLineMaterial()}
      </mesh>
      {[
        [ROOM_LEFT_X + 0.08, ROOM_BACK_Z + 0.08],
        [ROOM_RIGHT_X - 0.08, ROOM_BACK_Z + 0.08],
        [ROOM_LEFT_X + 0.08, frontWallZ],
        [ROOM_RIGHT_X - 0.08, frontWallZ],
      ].map(([x, z]) => (
        <mesh key={`room-open-corner-post-${x}-${z}`} position={[x, 1.16, z]} scale={[0.105, 2.98, 0.105]}>
          <boxGeometry args={[1, 1, 1]} />
          {mcmPanelDarkWalnutMaterial()}
        </mesh>
      ))}
      <mesh position={[ROOM_CENTER_X, 2.69, ROOM_BACK_Z + 0.08]} scale={[roomWidth - 0.1, 0.07, 0.105]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelDarkWalnutMaterial()}
      </mesh>
      <mesh position={[ROOM_LEFT_X + 0.08, 2.69, ROOM_CENTER_Z]} scale={[0.105, 0.07, roomDepth - 0.14]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelDarkWalnutMaterial()}
      </mesh>
      <mesh position={[ROOM_RIGHT_X - 0.08, 2.69, ROOM_CENTER_Z]} scale={[0.105, 0.07, roomDepth - 0.14]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelDarkWalnutMaterial()}
      </mesh>
      <mesh position={[ROOM_CENTER_X, panelCenterY, wallFaceZ]} scale={[roomWidth - 1.18, panelHeight, 0.032]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelWalnutMaterial()}
      </mesh>
      <mesh position={[ROOM_CENTER_X, panelBottomY, wallFaceZ + 0.01]} scale={[roomWidth - 1.02, 0.052, 0.018]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelInkMaterial()}
      </mesh>
      <mesh position={[(clockRailClearX + backPanelCapEndX) / 2, panelTopY, wallFaceZ + 0.012]} scale={[backPanelCapWidth, 0.058, 0.018]}>
        <boxGeometry args={[1, 1, 1]} />
        {mcmPanelBrassMaterial()}
      </mesh>
      {backSlats.map((x) => (
        <mesh key={`back-mcm-slat-${x}`} position={[x, panelCenterY, wallFaceZ + 0.018]} scale={[0.022, panelHeight + 0.04, 0.018]}>
          <boxGeometry args={[1, 1, 1]} />
          {mcmPanelInkMaterial()}
        </mesh>
      ))}
      {[-3.72, -2.12, -0.52, 1.08].map((x) => (
        <mesh key={`back-walnut-grain-${x}`} position={[x, panelCenterY + 0.03, wallFaceZ + 0.022]} rotation={[0, 0, -0.05]} scale={[0.62, 0.02, 0.012]}>
          <boxGeometry args={[1, 1, 1]} />
          {roomWoodGrainMaterial()}
        </mesh>
      ))}
      <McmSideWallPaneling
        wallFaceX={leftWallFaceX}
        side="left"
        doorZ={leftServiceDoorZ}
        panelCenterY={panelCenterY}
        panelHeight={panelHeight}
        panelTopY={panelTopY}
        panelBottomY={panelBottomY}
        roomDepth={roomDepth}
      />
      <McmSideWallPaneling
        wallFaceX={rightWallFaceX}
        side="right"
        doorZ={rightServiceDoorZ}
        panelCenterY={panelCenterY}
        panelHeight={panelHeight}
        panelTopY={panelTopY}
        panelBottomY={panelBottomY}
        roomDepth={roomDepth}
      />
      <McmServiceDoor wallFaceX={leftWallFaceX} side="left" z={leftServiceDoorZ} />
      <McmServiceDoor wallFaceX={rightWallFaceX} side="right" z={rightServiceDoorZ} />
      <McmDoorCarpet x={leftWallFaceX + 0.46} z={leftServiceDoorZ} side="left" />
      <McmDoorCarpet x={rightWallFaceX - 0.46} z={rightServiceDoorZ} side="right" />
      <MuseumSideWallArt wallFaceX={leftWallFaceX} side="left" z={ROOM_CENTER_Z + 0.68} />
      <MuseumSideWallArt wallFaceX={rightWallFaceX} side="right" z={ROOM_CENTER_Z - 0.68} />
      <MuseumWallAccessories wallFaceZ={wallFaceZ} />

      <mesh position={[ROOM_CENTER_X, ROOM_FLOOR_Y + 0.015, ROOM_BACK_Z + 0.055]} scale={[roomWidth - 0.1, 0.035, 0.035]}>
        <boxGeometry args={[1, 1, 1]} />
        {roomTrimMaterial()}
      </mesh>
      <mesh position={[ROOM_LEFT_X + 0.055, ROOM_FLOOR_Y + 0.015, ROOM_CENTER_Z]} scale={[0.035, 0.035, roomDepth - 0.1]}>
        <boxGeometry args={[1, 1, 1]} />
        {roomTrimMaterial()}
      </mesh>
      <mesh position={[ROOM_RIGHT_X - 0.055, ROOM_FLOOR_Y + 0.015, ROOM_CENTER_Z]} scale={[0.035, 0.035, roomDepth - 0.1]}>
        <boxGeometry args={[1, 1, 1]} />
        {roomTrimMaterial()}
      </mesh>
      <mesh position={[ROOM_LEFT_X + 0.08, 1.16, ROOM_BACK_Z + 0.065]} scale={[0.045, 2.9, 0.045]}>
        <boxGeometry args={[1, 1, 1]} />
        {roomTrimMaterial()}
      </mesh>
      <mesh position={[ROOM_RIGHT_X - 0.08, 1.16, ROOM_BACK_Z + 0.065]} scale={[0.045, 2.9, 0.045]}>
        <boxGeometry args={[1, 1, 1]} />
        {roomTrimMaterial()}
      </mesh>
    </group>
  )
}

function FourLeggedTable() {
  const legPositions = [
    [-1.78, 0.06, -1.28],
    [1.78, 0.06, -1.28],
    [-1.78, 0.06, 1.28],
    [1.78, 0.06, 1.28],
    [0, 0.045, -1.28],
    [0, 0.045, 1.28],
  ] as const

  return (
    <group position={TABLE_POSITION}>
      <OutlineMesh
        position={[0, 0.376, 0]}
        scale={[3.9, 0.12, 2.9]}
        outlineWidth={0.04}
        outlineColor="#030208"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={tableTopMaterial()}
      />
      {[-1.47, 1.47].map((z) => (
        <mesh key={`table-brass-long-edge-${z}`} position={[0, 0.448, z]} scale={[3.72, 0.028, 0.026]}>
          <boxGeometry args={[1, 1, 1]} />
          {tableBrassEdgeMaterial()}
        </mesh>
      ))}
      {[-1.98, 1.98].map((x) => (
        <mesh key={`table-brass-short-edge-${x}`} position={[x, 0.448, 0]} scale={[0.026, 0.028, 2.68]}>
          <boxGeometry args={[1, 1, 1]} />
          {tableBrassEdgeMaterial()}
        </mesh>
      ))}
      {[-0.94, 0.18, 1.18].map((z, index) => (
        <mesh key={`table-subtle-grain-${z}`} position={[-0.26 + index * 0.18, 0.452, z]} rotation={[0, index % 2 === 0 ? -0.04 : 0.035, 0]} scale={[2.62 - index * 0.32, 0.012, 0.022]}>
          <boxGeometry args={[1, 1, 1]} />
          {tableSubtleGrainMaterial()}
        </mesh>
      ))}
      <OutlineMesh
        position={[0, 0.29, -1.23]}
        scale={[3.72, 0.07, 0.1]}
        outlineWidth={0.03}
        outlineColor="#030208"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={tableUndersideMaterial()}
      />
      <OutlineMesh
        position={[0, 0.29, 1.23]}
        scale={[3.72, 0.07, 0.1]}
        outlineWidth={0.03}
        outlineColor="#030208"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={tableUndersideMaterial()}
      />
      {[-1.72, 1.72].map((x) => (
        <OutlineMesh
          key={`table-dark-cross-brace-${x}`}
          position={[x, 0.21, 0]}
          scale={[0.08, 0.06, 2.44]}
          outlineWidth={0.02}
          outlineColor="#030208"
          geometry={<boxGeometry args={[1, 1, 1]} />}
          material={tableUndersideMaterial()}
        />
      ))}
      {legPositions.map(([x, y, z]) => (
        <OutlineMesh
          key={`${x}-${z}`}
          position={[x, y, z]}
          rotation={[z > 0 ? -0.08 : 0.08, 0, x > 0 ? -0.07 : 0.07]}
          scale={[0.13, 0.6, 0.13]}
          outlineWidth={0.035}
          outlineColor="#030208"
          geometry={<boxGeometry args={[1, 1, 1]} />}
          material={tableLegMaterial()}
        />
      ))}
    </group>
  )
}

function ConveyorBeltBuild({ sequenceStart }: { sequenceStart: DropSequenceStart }) {
  const conveyor = useRef<THREE.Group>(null)
  const treads = useRef<THREE.Mesh[]>([])
  const legPositions = [
    [-0.5, 0.06, -0.24],
    [0.5, 0.06, -0.24],
    [-0.5, 0.06, 0.24],
    [0.5, 0.06, 0.24],
  ] as const
  const treadPositions = [-0.36, -0.18, 0, 0.18, 0.36] as const
  const boltPositions = [
    [-0.62, 0.37, -0.34],
    [0.62, 0.37, -0.34],
    [-0.62, 0.37, 0.34],
    [0.62, 0.37, 0.34],
  ] as const

  useFrame(({ clock }) => {
    const elapsed = Math.min(BOX_DROP_DURATION, getSequenceElapsed(clock.elapsedTime, sequenceStart))
    const beltMainDrive = smooth01((elapsed - (BOX_CONVEYOR_PLACE_TIME - 0.22)) / 0.34)
    const beltActive = (0.62 + beltMainDrive * 0.38) * (1 - smooth01((elapsed - (BOX_FIRE_DISAPPEAR_TIME + 0.35)) / 0.6))
    const beltLoadPulse = dampedPulse(elapsed, BOX_CONVEYOR_PLACE_TIME, 0.5, 2.6)
    const beltExitPulse = dampedPulse(elapsed, BOX_FIRE_DROP_START_TIME, 0.5, 2.2)
    const beltTravelDistance = BOX_CONVEYOR_END_POSITION[0] - BOX_CONVEYOR_START_POSITION[0]
    const conveyorMotionAmount = getBoxConveyorMotionAmount(elapsed)
    const syncOn = smooth01((elapsed - (BOX_CONVEYOR_PLACE_TIME - 0.08)) / 0.18)
      * (1 - smooth01((elapsed - (BOX_FIRE_DROP_START_TIME + 0.08)) / 0.32))
    const idleTravel = clock.elapsedTime * 0.24 * beltActive
    const syncedTravel = conveyorMotionAmount * beltTravelDistance
    const travel = idleTravel * (1 - syncOn) + syncedTravel * syncOn
    const span = 0.9

    if (conveyor.current) {
      const idleWobble = Math.sin(clock.elapsedTime * 2.2) * 0.0025 * beltActive
      conveyor.current.position.y = CONVEYOR_POSITION[1] + idleWobble - beltLoadPulse * 0.005 + beltExitPulse * 0.003
      conveyor.current.rotation.z = -beltLoadPulse * 0.006 + beltExitPulse * 0.004
      conveyor.current.rotation.x = beltLoadPulse * 0.004 - beltExitPulse * 0.003
    }

    treads.current.forEach((tread, index) => {
      const base = treadPositions[index]
      if (base === undefined) return
      const wrappedX = (((base + travel + span / 2) % span) + span) % span - span / 2
      tread.position.x = wrappedX
      tread.position.y = 0.422
        + 0.0025 * Math.sin(clock.elapsedTime * 4.4 + index * 1.7)
        + beltActive * (1 - syncOn * 0.72) * 0.008 * Math.sin(clock.elapsedTime * 16 + index * 0.8)
        - beltLoadPulse * 0.006
        + beltExitPulse * 0.004
      tread.scale.y = 0.004 + beltActive * 0.0018 + beltLoadPulse * 0.001 + syncOn * 0.0006
    })
  })

  return (
    <group ref={conveyor} position={CONVEYOR_POSITION}>
      <OutlineMesh
        position={[0, 0.285, 0]}
        scale={[1.28, 0.16, 0.64]}
        outlineWidth={0.04}
        outlineColor="#030208"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={legMaterial()}
      />
      <OutlineMesh
        position={[0, 0.376, 0]}
        scale={[1.18, 0.08, 0.54]}
        outlineWidth={0.04}
        outlineColor="#030208"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={beltMaterial()}
      />
      {treadPositions.map((x, index) => (
        <mesh
          key={x}
          ref={(node) => {
            if (node) treads.current[index] = node
          }}
          position={[x, 0.422, 0]}
          scale={[0.018, 0.004, 0.46]}
        >
          <boxGeometry args={[1, 1, 1]} />
          {beltStripeMaterial()}
        </mesh>
      ))}
      <OutlineMesh
        position={[0, 0.436, -0.36]}
        scale={[1.42, 0.08, 0.08]}
        outlineWidth={0.035}
        outlineColor="#030208"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={railMaterial()}
      />
      <OutlineMesh
        position={[0, 0.436, 0.36]}
        scale={[1.42, 0.08, 0.08]}
        outlineWidth={0.035}
        outlineColor="#030208"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={railMaterial()}
      />
      {legPositions.map(([x, y, z]) => (
        <OutlineMesh
          key={`${x}-${z}`}
          position={[x, y - 0.04, z]}
          rotation={[z > 0 ? -0.06 : 0.06, 0, x > 0 ? -0.08 : 0.08]}
          scale={[0.1, 0.56, 0.1]}
          outlineWidth={0.035}
          outlineColor="#030208"
          geometry={<boxGeometry args={[1, 1, 1]} />}
          material={legMaterial()}
        />
      ))}
      {boltPositions.map(([x, y, z]) => (
        <mesh key={`${x}-${z}`} position={[x, y - 0.044, z]} rotation={[Math.PI / 2, 0, 0]} scale={[0.035, 0.035, 0.012]}>
          <cylinderGeometry args={[1, 1, 1, 8]} />
          {brassBoltMaterial()}
        </mesh>
      ))}
    </group>
  )
}

function CeilingTrapdoor({
  replayKey,
  sequenceStart,
  walletConnected,
}: {
  replayKey: number
  sequenceStart: DropSequenceStart
  walletConnected: boolean
}) {
  const leftDoor = useRef<THREE.Group>(null)
  const rightDoor = useRef<THREE.Group>(null)
  const walletDropStart = useRef<number | null>(null)
  const cornerBolts = [
    [-1.8, -0.09, -1.28],
    [1.8, -0.09, -1.28],
    [-1.8, -0.09, 1.28],
    [1.8, -0.09, 1.28],
    [0, -0.09, -1.28],
    [0, -0.09, 1.28],
  ] as const
  const strapPositions = [
    [-1.78, 0.09, -1.22],
    [1.78, 0.09, -1.22],
    [-1.78, 0.09, 1.22],
    [1.78, 0.09, 1.22],
    [0, 0.09, -1.22],
    [0, 0.09, 1.22],
  ] as const

  useEffect(() => {
    sequenceStart.current = null
  }, [replayKey, sequenceStart])

  useFrame(({ clock }) => {
    if (walletConnected && walletDropStart.current === null) walletDropStart.current = clock.elapsedTime
    if (!walletConnected) walletDropStart.current = null

    const elapsed = getSequenceElapsed(clock.elapsedTime, sequenceStart)
    const walletDropElapsed = walletDropStart.current === null ? 0 : clock.elapsedTime - walletDropStart.current
    const dropElapsed = walletConnected ? walletDropElapsed : elapsed
    const openAmount = Math.max(
      walletConnected ? 0 : getCeilingTrapdoorOpenAmount(elapsed),
      walletConnected ? getWalletDropTrapdoorOpenAmount(walletDropElapsed) : 0,
    )
    const angle = openAmount * CEILING_TRAPDOOR_OPEN_ANGLE
    const hingeJolt = dampedPulse(dropElapsed, 0.62, 0.52, 4.8) * 0.025 + dampedPulse(dropElapsed, 2.72, 0.36, 4.2) * -0.015
    const idleHinge = (Math.sin(clock.elapsedTime * 1.48 + 0.6) * 0.006 + Math.sin(clock.elapsedTime * 2.33 + 2.1) * 0.004) * (1 - openAmount * 0.35)

    if (leftDoor.current) leftDoor.current.rotation.z = -0.045 - angle + hingeJolt - idleHinge
    if (rightDoor.current) rightDoor.current.rotation.z = 0.045 + angle - hingeJolt + idleHinge
  })

  return (
    <group position={[CEILING_TRAPDOOR_POSITION[0], CEILING_TRAPDOOR_POSITION[1] + 0.03, CEILING_TRAPDOOR_POSITION[2]]} scale={[0.74, 1, 0.68]}>
      <OutlineMesh
        position={[0, 0.04, 0]}
        scale={[4.1, 0.08, 3.1]}
        outlineWidth={0.035}
        outlineColor="#030208"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={ceilingTrapFrameMaterial()}
      />
      <mesh position={[0, -0.002, 0]} scale={[3.25, 0.018, 2.36]}>
        <boxGeometry args={[1, 1, 1]} />
        {ceilingTrapRailMaterial()}
      </mesh>
      <group ref={leftDoor} position={[-1.6, -0.052, 0]} rotation={[0, 0, -0.045]}>
        <OutlineMesh
          position={[0.78, 0, 0]}
          scale={[1.56, 0.042, 2.34]}
          outlineWidth={0.022}
          outlineColor="#030208"
          geometry={<boxGeometry args={[1, 1, 1]} />}
          material={ceilingTrapDoorMaterial()}
        />
      </group>
      <group ref={rightDoor} position={[1.6, -0.052, 0]} rotation={[0, 0, 0.045]}>
        <OutlineMesh
          position={[-0.78, 0, 0]}
          scale={[1.56, 0.042, 2.34]}
          outlineWidth={0.022}
          outlineColor="#030208"
          geometry={<boxGeometry args={[1, 1, 1]} />}
          material={ceilingTrapDoorMaterial()}
        />
      </group>
      <mesh position={[0, -0.084, 0]} scale={[0.022, 0.012, 2.34]}>
        <boxGeometry args={[1, 1, 1]} />
        {ceilingTrapRailMaterial()}
      </mesh>
      {[-1.72, 1.72].map((x) => (
        <mesh key={`ceiling-hinge-${x}`} position={[x, -0.096, 0]} scale={[0.055, 0.022, 2.46]}>
          <boxGeometry args={[1, 1, 1]} />
          {ceilingTrapRailMaterial()}
        </mesh>
      ))}
      {cornerBolts.map(([x, y, z]) => (
        <mesh key={`ceiling-bolt-${x}-${z}`} position={[x, y, z]} rotation={[Math.PI / 2, 0, 0]} scale={[0.045, 0.045, 0.014]}>
          <cylinderGeometry args={[1, 1, 1, 8]} />
          {brassBoltMaterial()}
        </mesh>
      ))}
      {strapPositions.map(([x, y, z]) => (
        <OutlineMesh
          key={`ceiling-strap-${x}-${z}`}
          position={[x, y, z]}
          scale={[0.12, 0.3, 0.12]}
          outlineWidth={0.024}
          outlineColor="#030208"
          geometry={<boxGeometry args={[1, 1, 1]} />}
          material={ceilingTrapStrapMaterial()}
        />
      ))}
    </group>
  )
}

function DropReactiveTable({
  replayKey,
  sequenceStart,
  impactEnabled,
  walletConnected,
}: {
  replayKey: number
  sequenceStart: DropSequenceStart
  impactEnabled: boolean
  walletConnected: boolean
}) {
  const table = useRef<THREE.Group>(null)
  const walletDropStart = useRef<number | null>(null)

  useEffect(() => {
    if (table.current) {
      table.current.position.set(0, 0, 0)
      table.current.rotation.set(0, 0, 0)
    }
  }, [replayKey])

  useFrame(({ clock }) => {
    const tableNode = table.current
    if (!tableNode) return

    const elapsed = getSequenceElapsed(clock.elapsedTime, sequenceStart)
    if (walletConnected && walletDropStart.current === null) walletDropStart.current = clock.elapsedTime
    if (!walletConnected) walletDropStart.current = null
    const walletElapsed = walletDropStart.current === null ? -1 : clock.elapsedTime - walletDropStart.current
    const impactT = elapsed - BOX_DROP_IMPACT_TIME
    const impactPulse = impactEnabled && impactT >= 0 && impactT < 0.54 ? Math.sin(impactT * 38) * Math.exp(-impactT * 7.2) : 0
    const settlePulse = impactEnabled && impactT >= 0 && impactT < 0.82 ? Math.abs(Math.sin(impactT * 22)) * Math.exp(-impactT * 5.8) : 0
    let walletImpact = 0
    let walletRoll = 0
    let walletPitch = 0
    TABLE_BOX_SLOTS.forEach(([slotX, slotZ], index) => {
      const localElapsed = walletElapsed - index * WALLET_BOX_DROP_STAGGER
      if (localElapsed < 0) return
      const flightTime = WALLET_BOX_DROP_FLIGHT_TIME + (index % 2) * 0.045
      const pulse = Math.max(0, dampedPulse(localElapsed, flightTime, 0.48, 2.05))
      if (pulse <= 0) return
      walletImpact += pulse
      walletRoll += pulse * clamp((slotX - BOX_POSITION[0]) * 0.012, -0.008, 0.008)
      walletPitch += pulse * clamp((slotZ - BOX_POSITION[2]) * -0.012, -0.008, 0.008)
    })
    const suctionTug = roundedPulse(elapsed, BOX_PULL_START_TIME - 0.04, 0.78)
    const latchKnock = dampedPulse(elapsed, BOX_SUCTION_LATCH_TIME - 0.02, 0.42, 2.8)

    tableNode.position.set(
      impactPulse * 0.012 + suctionTug * 0.01 + latchKnock * 0.006,
      settlePulse * 0.014 + walletImpact * 0.01 - suctionTug * 0.003,
      (impactT >= 0 && impactEnabled ? Math.sin(impactT * 29) * Math.exp(-impactT * 6) * 0.01 : 0) - suctionTug * 0.006,
    )
    tableNode.rotation.set(
      impactPulse * 0.004 + walletPitch + latchKnock * 0.004,
      0,
      impactPulse * -0.007 + walletRoll - suctionTug * 0.004 + latchKnock * 0.003,
    )
  })

  return (
    <group ref={table}>
      <FourLeggedTable />
    </group>
  )
}

function DropImpactFx({
  replayKey,
  sequenceStart,
  impactEnabled,
}: {
  replayKey: number
  sequenceStart: DropSequenceStart
  impactEnabled: boolean
}) {
  const ring = useRef<THREE.Mesh>(null)
  const puffs = useRef<THREE.Mesh[]>([])
  const glints = useRef<THREE.Mesh[]>([])
  const puffSpecs = [
    [-0.34, -0.18, 0.08, 0.18, 0.58],
    [0.31, -0.12, 0.07, 0.14, 1.2],
    [-0.18, 0.24, 0.055, 0.16, 2.4],
    [0.22, 0.2, 0.052, 0.15, 3.1],
    [0.02, -0.28, 0.05, 0.13, 4.4],
  ] as const
  const glintSpecs = [
    [-0.26, -0.06, 0.018, 0.13, -0.54],
    [0.25, 0.02, 0.016, 0.12, 0.62],
    [-0.04, 0.26, 0.015, 0.11, 0.12],
    [0.12, -0.22, 0.014, 0.1, -0.18],
  ] as const

  useEffect(() => {
    if (ring.current) ring.current.visible = false
    puffs.current.forEach((puff) => {
      puff.visible = false
    })
    glints.current.forEach((glint) => {
      glint.visible = false
    })
  }, [replayKey])

  useFrame(({ clock }) => {
    if (!impactEnabled) {
      if (ring.current) ring.current.visible = false
      puffs.current.forEach((puff) => {
        puff.visible = false
      })
      glints.current.forEach((glint) => {
        glint.visible = false
      })
      return
    }

    const elapsed = getSequenceElapsed(clock.elapsedTime, sequenceStart)
    const impactT = elapsed - BOX_DROP_IMPACT_TIME
    const active = impactT >= 0 && impactT < 0.86
    const t = clamp01(impactT / 0.86)
    const punch = Math.sin(t * Math.PI) * (1 - t * 0.35)

    if (ring.current) {
      ring.current.visible = active
      ring.current.scale.set(0.28 + t * 1.05, 0.16 + t * 0.56, 1)
    }

    puffs.current.forEach((puff, index) => {
      const spec = puffSpecs[index]
      if (!spec) return
      const drift = smooth01(t)
      puff.visible = active
      puff.position.set(spec[0] * drift, 0.02 + spec[3] * punch, spec[1] * drift)
      puff.scale.setScalar(spec[2] * (0.45 + punch * 1.45))
    })

    glints.current.forEach((glint, index) => {
      const spec = glintSpecs[index]
      if (!spec) return
      const pop = Math.max(0, Math.sin(t * Math.PI * 1.15))
      glint.visible = active && t < 0.64
      glint.position.set(spec[0] * smooth01(t), 0.044 + pop * 0.12, spec[1] * smooth01(t))
      glint.rotation.set(0.18, spec[4], spec[4] * 0.4 + t * 1.8)
      glint.scale.set(spec[2] * (0.8 + pop * 1.5), spec[3] * (0.7 + pop * 1.2), spec[2])
    })
  })

  return (
    <group position={[BOX_POSITION[0], TABLE_TOP_Y + 0.018, BOX_POSITION[2]]}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} scale={[0.28, 0.16, 1]} visible={false}>
        <circleGeometry args={[1, 22]} />
        {impactRingMaterial()}
      </mesh>
      {puffSpecs.map(([x, z, size], index) => (
        <mesh
          key={`drop-puff-${x}-${z}`}
          ref={(node) => {
            if (node) puffs.current[index] = node
          }}
          position={[x, 0.02, z]}
          scale={[size, size, size]}
          visible={false}
        >
          <sphereGeometry args={[1, 6, 4]} />
          {impactDustMaterial()}
        </mesh>
      ))}
      {glintSpecs.map(([x, z, width, height, rotation], index) => (
        <mesh
          key={`drop-glint-${x}-${z}`}
          ref={(node) => {
            if (node) glints.current[index] = node
          }}
          position={[x, 0.044, z]}
          rotation={[0.18, rotation, rotation * 0.4]}
          scale={[width, height, width]}
          visible={false}
        >
          <boxGeometry args={[1, 1, 1]} />
          {impactGlintMaterial()}
        </mesh>
      ))}
    </group>
  )
}

function AnimatedDropBox({
  replayKey,
  sequenceStart,
  activeBoxIndexRef,
  runStartIndex,
}: {
  replayKey: number
  sequenceStart: DropSequenceStart
  activeBoxIndexRef: MutableRefObject<number>
  runStartIndex: number
}) {
  const box = useRef<THREE.Group>(null)
  const shadow = useRef<THREE.Mesh>(null)
  const spotlight = useRef<THREE.Mesh>(null)
  const boxPose = useMemo(() => createBoxPoseSample(), [])
  const vacuumPose = useMemo(() => createVacuumPoseScratch(), [])

  useEffect(() => {
    if (box.current) box.current.visible = false
    if (shadow.current) shadow.current.visible = false
    if (spotlight.current) spotlight.current.visible = false
  }, [replayKey])

  useFrame(({ clock }) => {
    const elapsed = Math.min(BOX_DROP_DURATION, getSequenceElapsed(clock.elapsedTime, sequenceStart))
    const boxNode = box.current
    const shadowNode = shadow.current
    if (!boxNode) return

    const activeBoxIndex = activeBoxIndexRef.current
    sampleBoxPose(
      elapsed,
      clock.elapsedTime,
      boxPose,
      vacuumPose,
      getTableBoxSlot(activeBoxIndex),
      shouldStartFromConveyor(sequenceStart, activeBoxIndex, runStartIndex),
      activeBoxIndex,
    )
    boxNode.visible = boxPose.visible

    if (shadowNode) {
      shadowNode.visible = boxPose.shadowVisible
      shadowNode.position.set(
        boxPose.position.x,
        elapsed >= BOX_CONVEYOR_PLACE_TIME ? CONVEYOR_BELT_TOP_Y + 0.006 : TABLE_TOP_Y + 0.006,
        boxPose.position.z,
      )
      shadowNode.scale.set(boxPose.shadowScale.x * 0.72, boxPose.shadowScale.y * 0.68, 1)
    }

    if (spotlight.current) {
      const material = spotlight.current.material as THREE.MeshBasicMaterial
      const spotlightFade = 1 - smoother01((elapsed - BOX_SUCTION_LATCH_TIME) / 0.48)
      const spotlightLive = boxPose.visible && elapsed < BOX_CONVEYOR_PLACE_TIME && spotlightFade > 0.01
      spotlight.current.visible = spotlightLive
      material.opacity = spotlightLive ? (0.15 + Math.sin(clock.elapsedTime * 2.2 + activeBoxIndex) * 0.025) * spotlightFade : 0
      spotlight.current.position.set(boxPose.position.x, TABLE_TOP_Y + 0.009, boxPose.position.z)
      spotlight.current.scale.set(boxPose.shadowScale.x * 1.36, boxPose.shadowScale.y * 1.28, 1)
      spotlight.current.rotation.z = boxPose.rotation.y * 0.38 + Math.sin(clock.elapsedTime * 1.4 + activeBoxIndex) * 0.018
      spotlight.current.renderOrder = 3
    }

    boxNode.position.copy(boxPose.position)
    boxNode.rotation.copy(boxPose.rotation)
    boxNode.scale.copy(boxPose.scale)
  })

  return (
    <>
      <mesh ref={shadow} position={[BOX_POSITION[0], TABLE_TOP_Y + 0.006, BOX_POSITION[2]]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.14, 0.09, 1]}>
        <circleGeometry args={[1, 18]} />
        {dropShadowMaterial()}
      </mesh>
      <mesh ref={spotlight} position={[BOX_POSITION[0], TABLE_TOP_Y + 0.009, BOX_POSITION[2]]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.42, 0.24, 1]} visible={false}>
        <circleGeometry args={[1, 26]} />
        {tablePickupSpotlightMaterial()}
      </mesh>
      <group ref={box}>
        <VacuumStylePurpleBox />
      </group>
    </>
  )
}

function ConveyorBurnCarryoverBoxes({
  carryoverSequencesRef,
}: {
  carryoverSequencesRef: CarryoverBoxSequencesRef
}) {
  const boxes = useRef<THREE.Group[]>([])
  const shadows = useRef<THREE.Mesh[]>([])
  const boxPoses = useMemo(() => Array.from({ length: DEMO_WALLET_BOX_COUNT }, () => createBoxPoseSample()), [])
  const vacuumPoses = useMemo(() => Array.from({ length: DEMO_WALLET_BOX_COUNT }, () => createVacuumPoseScratch()), [])

  useFrame(({ clock }) => {
    pruneCarryoverBoxSequences(clock.elapsedTime, carryoverSequencesRef)

    boxes.current.forEach((box) => {
      box.visible = false
    })
    shadows.current.forEach((shadow) => {
      shadow.visible = false
    })

    carryoverSequencesRef.current.forEach(({ sequenceStart, slotIndex }, index) => {
      const box = boxes.current[index]
      const shadow = shadows.current[index]
      const pose = boxPoses[index]
      const vacuumPose = vacuumPoses[index]
      if (!box || !shadow || !pose || !vacuumPose) return

      const elapsed = Math.min(BOX_DROP_DURATION, Math.max(0, clock.elapsedTime - sequenceStart))
      if (elapsed < BOX_NEXT_PICKUP_RESTART_TIME - 0.02 || elapsed > BOX_DROP_DURATION) return

      sampleBoxPose(elapsed, clock.elapsedTime, pose, vacuumPose, getTableBoxSlot(slotIndex), slotIndex > 0, slotIndex)
      box.visible = pose.visible
      box.position.copy(pose.position)
      box.rotation.copy(pose.rotation)
      box.scale.copy(pose.scale)

      shadow.visible = pose.shadowVisible
      shadow.position.set(
        pose.position.x,
        elapsed >= BOX_CONVEYOR_PLACE_TIME ? CONVEYOR_BELT_TOP_Y + 0.006 : TABLE_TOP_Y + 0.006,
        pose.position.z,
      )
      shadow.scale.copy(pose.shadowScale)
    })
  })

  return (
    <>
      {Array.from({ length: DEMO_WALLET_BOX_COUNT }, (_, index) => (
        <group key={`carryover-box-${index}`}>
          <mesh
            ref={(node) => {
              if (node) shadows.current[index] = node
            }}
            rotation={[-Math.PI / 2, 0, 0]}
            visible={false}
          >
            <circleGeometry args={[1, 18]} />
            {dropShadowMaterial()}
          </mesh>
          <group
            ref={(node) => {
              if (node) boxes.current[index] = node
            }}
            visible={false}
          >
            <VacuumStylePurpleBox />
          </group>
        </group>
      ))}
    </>
  )
}

function RoyalBoxIdleSparkles({ index }: { index: number }) {
  const aura = useRef<THREE.Mesh>(null)
  const sparkles = useRef<THREE.Group[]>([])
  const crownPips = useRef<THREE.Mesh[]>([])
  const sparkleSpecs = useMemo(() => [
    { x: -0.16, y: 0.76, z: -0.12, phase: 0.08, rate: 0.72, size: 0.86, warm: false },
    { x: 0.18, y: 0.8, z: 0.06, phase: 0.36, rate: 0.82, size: 0.72, warm: true },
    { x: -0.03, y: 0.92, z: 0.15, phase: 0.64, rate: 0.66, size: 0.78, warm: false },
    { x: 0.1, y: 0.66, z: -0.2, phase: 0.82, rate: 0.9, size: 0.56, warm: true },
  ], [])
  const pipSpecs = useMemo(() => [
    { x: -0.14, y: 0.72, z: 0.12, phase: 0.16, size: 0.028 },
    { x: 0.0, y: 0.77, z: 0.14, phase: 0.48, size: 0.034 },
    { x: 0.14, y: 0.72, z: 0.12, phase: 0.78, size: 0.028 },
  ], [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const seed = index * 1.473
    const royalPulse = softLoopingPulse(t, 0.72 + (index % 3) * 0.035, seed * 0.17 + 0.12, 0.34)
    const softGlow = 0.5 + Math.sin(t * 2.1 + seed) * 0.5

    if (aura.current) {
      const material = aura.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.035 + royalPulse * 0.18 + softGlow * 0.025
      aura.current.position.set(Math.sin(t * 1.4 + seed) * 0.008, 0.49 + royalPulse * 0.018, Math.cos(t * 1.1 + seed) * 0.008)
      aura.current.rotation.z = t * 0.38 + seed
      aura.current.scale.set(0.36 + royalPulse * 0.1, 0.22 + royalPulse * 0.08, 1)
    }

    sparkles.current.forEach((sparkle, sparkleIndex) => {
      const spec = sparkleSpecs[sparkleIndex]
      if (!sparkle || !spec) return
      const cycle = loop01(t * spec.rate + spec.phase + seed * 0.09)
      const pop = cycle < 0.58 ? Math.sin((cycle / 0.58) * Math.PI) : 0
      const shimmer = pop * (0.82 + royalPulse * 0.35)
      const drift = smooth01(cycle)
      sparkle.visible = shimmer > 0.02
      sparkle.position.set(
        spec.x + Math.sin(t * 2.4 + spec.phase + seed) * 0.018 + drift * 0.018,
        spec.y + pop * 0.11 - drift * 0.018,
        spec.z + Math.cos(t * 2.1 + spec.phase + seed) * 0.018,
      )
      sparkle.rotation.set(0.22 + pop * 0.18, t * 0.8 + spec.phase, t * 1.7 + spec.phase * 3.1)
      sparkle.scale.setScalar(spec.size * (0.45 + shimmer * 1.15))
      sparkle.traverse((child) => {
        if (child instanceof THREE.Mesh) setMeshOpacity(child, Math.min(0.92, shimmer * 0.78))
      })
    })

    crownPips.current.forEach((pip, pipIndex) => {
      const spec = pipSpecs[pipIndex]
      if (!pip || !spec) return
      const pipPulse = softLoopingPulse(t, 0.86, spec.phase + seed * 0.08, 0.46)
      const material = pip.material as THREE.MeshBasicMaterial
      pip.visible = pipPulse > 0.01 || royalPulse > 0.08
      material.opacity = Math.min(0.88, 0.16 + pipPulse * 0.64 + royalPulse * 0.28)
      pip.position.set(
        spec.x + Math.sin(t * 2.1 + spec.phase) * 0.01,
        spec.y + pipPulse * 0.07,
        spec.z + Math.cos(t * 1.8 + spec.phase) * 0.008,
      )
      pip.scale.setScalar(spec.size * (0.85 + pipPulse * 0.55 + royalPulse * 0.24))
    })
  })

  return (
    <group position={[0, -0.02, 0]} frustumCulled={false}>
      <mesh ref={aura} position={[0, 0.49, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.36, 0.22, 1]} renderOrder={8}>
        <circleGeometry args={[1, 30]} />
        {royalBoxAuraMaterial()}
      </mesh>
      {sparkleSpecs.map((spec, sparkleIndex) => (
        <group
          key={`royal-box-sparkle-${index}-${sparkleIndex}`}
          ref={(node) => {
            if (node) sparkles.current[sparkleIndex] = node
          }}
          position={[spec.x, spec.y, spec.z]}
          visible={false}
        >
          <mesh scale={[0.018, 0.105, 0.018]}>
            <boxGeometry args={[1, 1, 1]} />
            {spec.warm ? royalBoxSparkleWarmMaterial() : royalBoxSparkleMaterial()}
          </mesh>
          <mesh scale={[0.09, 0.018, 0.018]}>
            <boxGeometry args={[1, 1, 1]} />
            {spec.warm ? royalBoxSparkleWarmMaterial() : royalBoxSparkleMaterial()}
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 4]} scale={[0.014, 0.075, 0.014]}>
            <boxGeometry args={[1, 1, 1]} />
            {royalBoxSparkleMaterial()}
          </mesh>
        </group>
      ))}
      {pipSpecs.map((spec, pipIndex) => (
        <mesh
          key={`royal-box-crown-pip-${index}-${pipIndex}`}
          ref={(node) => {
            if (node) crownPips.current[pipIndex] = node
          }}
          position={[spec.x, spec.y, spec.z]}
          scale={[spec.size, spec.size, spec.size]}
        >
          <sphereGeometry args={[1, 8, 5]} />
          {royalBoxSparkleWarmMaterial()}
        </mesh>
      ))}
    </group>
  )
}

function WalletAssetTableBoxes({
  walletConnected,
  hiddenCount,
  runActive,
  activeBoxIndexRef,
  sequenceStart,
}: {
  walletConnected: boolean
  hiddenCount: number
  runActive: boolean
  activeBoxIndexRef: MutableRefObject<number>
  sequenceStart: DropSequenceStart
}) {
  const boxes = useRef<THREE.Group[]>([])
  const shadows = useRef<THREE.Mesh[]>([])
  const spotlights = useRef<THREE.Mesh[]>([])
  const dropStart = useRef<number | null>(null)
  const boxPoses = useMemo(() => Array.from({ length: TABLE_BOX_SLOTS.length }, () => createBoxPoseSample()), [])

  useEffect(() => {
    if (walletConnected) return
    dropStart.current = null
    boxes.current.forEach((box) => {
      box.visible = false
    })
    shadows.current.forEach((shadow) => {
      shadow.visible = false
    })
    spotlights.current.forEach((spotlight) => {
      spotlight.visible = false
    })
  }, [walletConnected])

  useFrame(({ clock }) => {
    if (!walletConnected) return
    if (dropStart.current === null) dropStart.current = clock.elapsedTime

    const elapsed = clock.elapsedTime - dropStart.current
    const activeLoopHiddenCount = runActive ? activeBoxIndexRef.current + 1 : 0
    const runElapsed = runActive ? getSequenceElapsed(clock.elapsedTime, sequenceStart) : 0
    const activePickupOwnsSpotlight = runActive && runElapsed < BOX_SUCTION_LATCH_TIME + 0.16
    const nextPickupIndex = activePickupOwnsSpotlight
      ? -1
      : Math.min(
          TABLE_BOX_SLOTS.length - 1,
          Math.max(hiddenCount, activeLoopHiddenCount),
        )
    TABLE_BOX_SLOTS.forEach((slot, index) => {
      const box = boxes.current[index]
      const shadow = shadows.current[index]
      const spotlight = spotlights.current[index]
      const pose = boxPoses[index]
      if (!box || !shadow || !spotlight || !pose) return

      const isVisible = index >= Math.max(hiddenCount, activeLoopHiddenCount)
      if (!isVisible) {
        box.visible = false
        shadow.visible = false
        spotlight.visible = false
        return
      }

      sampleWalletTableBoxDropPose(elapsed, clock.elapsedTime, index, slot, pose)
      box.visible = pose.visible
      const isNextPickup = index === nextPickupIndex
      const shadowMaterial = shadow.material as THREE.MeshBasicMaterial
      const spotlightMaterial = spotlight.material as THREE.MeshBasicMaterial
      shadow.visible = pose.shadowVisible
      shadowMaterial.opacity = isNextPickup ? 0.16 : 0.09
      spotlight.visible = pose.visible && isNextPickup
      spotlightMaterial.opacity = pose.visible ? 0.15 + Math.sin(clock.elapsedTime * 2.2) * 0.025 : 0
      if (!pose.visible) return

      box.position.copy(pose.position)
      box.rotation.copy(pose.rotation)
      box.scale.copy(pose.scale)

      shadow.position.set(pose.position.x, TABLE_TOP_Y + 0.007, pose.position.z)
      shadow.scale.set(
        pose.shadowScale.x * (isNextPickup ? 0.72 : 0.44),
        pose.shadowScale.y * (isNextPickup ? 0.68 : 0.42),
        1,
      )
      spotlight.position.set(pose.position.x, TABLE_TOP_Y + 0.009, pose.position.z)
      spotlight.scale.set(
        pose.shadowScale.x * 1.36,
        pose.shadowScale.y * 1.28,
        1,
      )
      spotlight.rotation.z = slot[2] * 0.38 + Math.sin(clock.elapsedTime * 1.4 + index) * 0.018
      spotlight.renderOrder = 3
    })
  })

  return (
    <>
      {TABLE_BOX_SLOTS.map(([targetX, targetZ], index) => (
        <group key={`wallet-table-box-${index}`}>
          <mesh
            ref={(node) => {
              if (node) shadows.current[index] = node
            }}
            position={[targetX, TABLE_TOP_Y + 0.007, targetZ]}
            rotation={[-Math.PI / 2, 0, 0]}
            scale={[0.14, 0.09, 1]}
            visible={false}
          >
            <circleGeometry args={[1, 18]} />
            {dropShadowMaterial()}
          </mesh>
          <mesh
            ref={(node) => {
              if (node) spotlights.current[index] = node
            }}
            position={[targetX, TABLE_TOP_Y + 0.009, targetZ]}
            rotation={[-Math.PI / 2, 0, 0]}
            scale={[0.42, 0.24, 1]}
            visible={false}
          >
            <circleGeometry args={[1, 26]} />
            {tablePickupSpotlightMaterial()}
          </mesh>
          <group
            ref={(node) => {
              if (node) boxes.current[index] = node
            }}
            visible={false}
          >
            <VacuumStylePurpleBox />
            <RoyalBoxIdleSparkles index={index} />
          </group>
        </group>
      ))}
    </>
  )
}

function BoxSuctionRibbons({
  replayKey,
  sequenceStart,
  activeBoxIndexRef,
  runStartIndex,
}: {
  replayKey: number
  sequenceStart: DropSequenceStart
  activeBoxIndexRef: MutableRefObject<number>
  runStartIndex: number
}) {
  const ribbons = useRef<THREE.Mesh[]>([])
  const latchRing = useRef<THREE.Mesh>(null)
  const boxPose = useMemo(() => createBoxPoseSample(), [])
  const vacuumPose = useMemo(() => createVacuumPoseScratch(), [])
  const boxContact = useMemo(() => new THREE.Vector3(), [])
  const line = useMemo(() => new THREE.Vector3(), [])
  const ribbonCenter = useMemo(() => new THREE.Vector3(), [])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const zAxis = useMemo(() => new THREE.Vector3(0, 0, 1), [])
  const materials = useMemo(
    () =>
      ['#fff2a3', '#6bd8ff', '#f47bdc', '#b9efc8', '#fff0b6'].map((color) =>
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
  const latchMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#fff2a3',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    [],
  )
  const ribbonSpecs = [
    { side: -0.14, lift: 0.02, width: 0.018, phase: 0.08 },
    { side: 0.12, lift: 0.06, width: 0.014, phase: 0.31 },
    { side: -0.04, lift: -0.03, width: 0.012, phase: 0.57 },
    { side: 0.03, lift: 0.1, width: 0.016, phase: 0.74 },
    { side: 0.18, lift: -0.01, width: 0.01, phase: 0.9 },
  ] as const

  useEffect(() => {
    ribbons.current.forEach((ribbon) => {
      ribbon.visible = false
    })
    if (latchRing.current) latchRing.current.visible = false
    materials.forEach((material) => {
      material.opacity = 0
    })
    latchMaterial.opacity = 0
  }, [latchMaterial, materials, replayKey])

  useFrame(({ clock }) => {
    const elapsed = Math.min(BOX_DROP_DURATION, getSequenceElapsed(clock.elapsedTime, sequenceStart))
    const activeBoxIndex = activeBoxIndexRef.current
    sampleBoxPose(
      elapsed,
      clock.elapsedTime,
      boxPose,
      vacuumPose,
      getTableBoxSlot(activeBoxIndex),
      shouldStartFromConveyor(sequenceStart, activeBoxIndex, runStartIndex),
      activeBoxIndex,
    )
    const carryGrip = boxPose.latchAmount
      * smooth01((elapsed - BOX_SUCTION_LATCH_TIME) / 0.24)
      * (1 - smooth01((elapsed - BOX_CONVEYOR_PLACE_TIME) / 0.24))
    const active = boxPose.visible && boxPose.suctionAmount > 0.04 && elapsed < BOX_CONVEYOR_PLACE_TIME + 0.04

    writeBoxHoseContactPoint(boxContact, boxPose)
    line.copy(boxPose.mouthWorld).sub(boxContact)
    const length = line.length()
    if (length > 0.001) line.normalize()

    ribbonSpecs.forEach((spec, index) => {
      const ribbon = ribbons.current[index]
      const material = materials[index]
      if (!ribbon || !material) return
      ribbon.visible = active
      material.opacity = active
        ? (0.2 + boxPose.suctionAmount * 0.16 + boxPose.pullAmount * 0.36) * (1 - boxPose.latchAmount * 0.44) + carryGrip * 0.08
        : 0
      if (!active) return

      const flow = (clock.elapsedTime * (1.45 + index * 0.21) + spec.phase) % 1
      const ribbonLength = Math.max(0.035, length * (0.72 + boxPose.suctionAmount * 0.12 + boxPose.pullAmount * 0.16 + carryGrip * 0.16 + flow * 0.08))
      const centerT = clamp01(0.24 + flow * 0.52 + boxPose.pullAmount * 0.22)
      const sidePulse = Math.sin(clock.elapsedTime * (7.8 + index) + spec.phase * 8) * 0.038 * (1 - boxPose.latchAmount)
      ribbonCenter.copy(boxContact).lerp(boxPose.mouthWorld, centerT)
      ribbonCenter.addScaledVector(boxPose.right, spec.side * (1 - boxPose.latchAmount * 0.45) + sidePulse)
      ribbonCenter.addScaledVector(up, spec.lift + Math.sin(flow * Math.PI) * (0.06 + boxPose.pullAmount * 0.025))
      ribbon.position.copy(ribbonCenter)
      ribbon.quaternion.setFromUnitVectors(zAxis, line)
      ribbon.scale.set(spec.width * (1.1 + boxPose.suctionAmount * 0.4 + boxPose.pullAmount * 1.1), 0.012, Math.max(0.08, ribbonLength))
      ribbon.renderOrder = 18 + index
    })

    if (latchRing.current) {
      const latchSnap = dampedPulse(elapsed, BOX_SUCTION_LATCH_TIME, 0.62, 2.8)
      const ringLive = boxPose.visible && boxPose.latchAmount > 0.02 && elapsed < BOX_CONVEYOR_PLACE_TIME + 0.05
      latchRing.current.visible = ringLive
      latchMaterial.opacity = ringLive ? Math.min(0.78, boxPose.latchAmount * 0.55 + latchSnap * 0.34) : 0
      if (ringLive) {
        writeBoxHoseContactPoint(boxContact, boxPose, latchSnap * 0.014)
        latchRing.current.position.copy(boxContact).addScaledVector(boxPose.mouthForward, 0.012)
        latchRing.current.quaternion.setFromUnitVectors(zAxis, boxPose.mouthForward)
        latchRing.current.scale.setScalar(0.18 + boxPose.latchAmount * 0.08 + latchSnap * 0.08)
        latchRing.current.renderOrder = 28
      }
    }
  })

  return (
    <>
      {ribbonSpecs.map((spec, index) => (
        <mesh
          key={`box-suction-ribbon-${spec.phase}`}
          ref={(node) => {
            if (node) ribbons.current[index] = node
          }}
          material={materials[index]}
          visible={false}
          frustumCulled={false}
        >
          <boxGeometry args={[1, 1, 1]} />
        </mesh>
      ))}
      <mesh ref={latchRing} material={latchMaterial} visible={false} frustumCulled={false}>
        <torusGeometry args={[1, 0.055, 6, 18]} />
      </mesh>
    </>
  )
}

function BoxHoseContactSeal({
  replayKey,
  sequenceStart,
  activeBoxIndexRef,
  runStartIndex,
}: {
  replayKey: number
  sequenceStart: DropSequenceStart
  activeBoxIndexRef: MutableRefObject<number>
  runStartIndex: number
}) {
  const contactSleeveOutline = useRef<THREE.Mesh>(null)
  const contactSleeve = useRef<THREE.Mesh>(null)
  const contactShadow = useRef<THREE.Mesh>(null)
  const contactLip = useRef<THREE.Mesh>(null)
  const contactGlint = useRef<THREE.Mesh>(null)
  const boxPose = useMemo(() => createBoxPoseSample(), [])
  const vacuumPose = useMemo(() => createVacuumPoseScratch(), [])
  const zAxis = useMemo(() => new THREE.Vector3(0, 0, 1), [])
  const yAxis = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const contactPoint = useMemo(() => new THREE.Vector3(), [])
  const mouthPoint = useMemo(() => new THREE.Vector3(), [])
  const bridgeCenter = useMemo(() => new THREE.Vector3(), [])
  const bridgeLine = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    ;[contactSleeveOutline.current, contactSleeve.current, contactShadow.current, contactLip.current, contactGlint.current].forEach((node) => {
      if (node) node.visible = false
    })
  }, [replayKey])

  useFrame(({ clock }) => {
    const elapsed = Math.min(BOX_DROP_DURATION, getSequenceElapsed(clock.elapsedTime, sequenceStart))
    const activeBoxIndex = activeBoxIndexRef.current
    sampleBoxPose(
      elapsed,
      clock.elapsedTime,
      boxPose,
      vacuumPose,
      getTableBoxSlot(activeBoxIndex),
      shouldStartFromConveyor(sequenceStart, activeBoxIndex, runStartIndex),
      activeBoxIndex,
    )
    const sealIn = smooth01((elapsed - BOX_SUCTION_LATCH_TIME) / 0.2)
    const releaseOut = smooth01((elapsed - (BOX_CONVEYOR_PLACE_TIME + 0.04)) / 0.24)
    const carrySeal = boxPose.latchAmount
      * smooth01((elapsed - BOX_CARRY_POSE_TIME) / 0.42)
      * (1 - releaseOut)
    const preSeal = smooth01(
      (boxPose.pullAmount - BOX_SUCTION_PRESEAL_START_AMOUNT)
      / (BOX_SUCTION_SEAL_LOCK_START_AMOUNT - BOX_SUCTION_PRESEAL_START_AMOUNT),
    ) * (1 - releaseOut)
    const sealAmount = boxPose.visible && elapsed < BOX_CONVEYOR_PLACE_TIME + 0.24 ? Math.max(preSeal * 0.58, sealIn, carrySeal) * (1 - releaseOut) : 0
    const latchPulse = dampedPulse(elapsed, BOX_SUCTION_LATCH_TIME, 0.44, 3.0)
    const releaseSnap = dampedPulse(elapsed, BOX_CONVEYOR_PLACE_TIME, 0.36, 2.5)
    const active = sealAmount > 0.025 || carrySeal > 0.04 || releaseSnap > 0.02

    writeBoxHoseContactPoint(contactPoint, boxPose, releaseSnap * 0.024)
    mouthPoint.copy(boxPose.mouthWorld).addScaledVector(boxPose.mouthForward, 0.008 + latchPulse * 0.01)
    bridgeLine.copy(contactPoint).sub(mouthPoint)
    const bridgeLength = bridgeLine.length()
    if (bridgeLength > 0.001) bridgeLine.multiplyScalar(1 / bridgeLength)

    ;[contactSleeveOutline.current, contactSleeve.current].forEach((node) => {
      if (!node) return
      node.visible = active
      if (!active) return
      bridgeCenter.copy(mouthPoint).lerp(contactPoint, 0.5)
      node.position.copy(bridgeCenter)
      node.quaternion.setFromUnitVectors(yAxis, bridgeLine.lengthSq() > 0.001 ? bridgeLine : boxPose.mouthForward)
      node.renderOrder = 36
    })

    ;[contactShadow.current, contactLip.current, contactGlint.current].forEach((node) => {
      if (!node) return
      node.visible = active
      if (!active) return
      node.position.copy(contactPoint)
      node.quaternion.setFromUnitVectors(zAxis, boxPose.mouthForward)
      node.renderOrder = 38
    })

    const shadowMaterial = contactShadow.current?.material as THREE.MeshBasicMaterial | undefined
    const lipMaterial = contactLip.current?.material as THREE.MeshBasicMaterial | undefined
    const glintMaterial = contactGlint.current?.material as THREE.MeshBasicMaterial | undefined
    const sleeveOutlineMaterial = contactSleeveOutline.current?.material as THREE.MeshBasicMaterial | undefined
    const sleeveMaterial = contactSleeve.current?.material as THREE.MeshBasicMaterial | undefined

    if (contactSleeveOutline.current && sleeveOutlineMaterial) {
      sleeveOutlineMaterial.opacity = active ? 0.12 + sealAmount * 0.12 + carrySeal * 0.08 + latchPulse * 0.1 : 0
      contactSleeveOutline.current.scale.set(
        0.114 + sealAmount * 0.026 + carrySeal * 0.02 + latchPulse * 0.018,
        Math.max(0.035, bridgeLength),
        0.084 + sealAmount * 0.018 + carrySeal * 0.012,
      )
    }
    if (contactSleeve.current && sleeveMaterial) {
      sleeveMaterial.opacity = active ? 0.2 + sealAmount * 0.3 + carrySeal * 0.18 + latchPulse * 0.18 - releaseSnap * 0.12 : 0
      contactSleeve.current.scale.set(
        0.088 + sealAmount * 0.024 + carrySeal * 0.018 + latchPulse * 0.018,
        Math.max(0.032, bridgeLength * 0.96),
        0.062 + sealAmount * 0.014 + carrySeal * 0.01,
      )
    }

    if (contactShadow.current && shadowMaterial) {
      shadowMaterial.opacity = active ? 0.18 + sealAmount * 0.28 + carrySeal * 0.12 + latchPulse * 0.12 : 0
      contactShadow.current.scale.set(0.12 + sealAmount * 0.064 + carrySeal * 0.028 + latchPulse * 0.03, 0.088 + sealAmount * 0.04 + carrySeal * 0.018, 1)
    }
    if (contactLip.current && lipMaterial) {
      lipMaterial.opacity = active ? 0.28 + sealAmount * 0.58 + carrySeal * 0.18 + latchPulse * 0.2 - releaseSnap * 0.18 : 0
      contactLip.current.scale.set(0.135 + sealAmount * 0.052 + carrySeal * 0.026 + latchPulse * 0.024, 0.094 + sealAmount * 0.03 + carrySeal * 0.014, 1)
      contactLip.current.rotateZ(Math.sin(clock.elapsedTime * 11.5) * sealAmount * 0.08)
    }
    if (contactGlint.current && glintMaterial) {
      glintMaterial.opacity = active ? 0.12 + latchPulse * 0.58 + releaseSnap * 0.42 : 0
      contactGlint.current.position.addScaledVector(boxPose.mouthForward, 0.006)
      contactGlint.current.rotation.z += 0.72
      contactGlint.current.scale.set(0.018 + latchPulse * 0.018 + releaseSnap * 0.022, 0.07 + sealAmount * 0.035, 0.018)
    }
  })

  return (
    <>
      <mesh ref={contactSleeveOutline} visible={false} frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 12]} />
        {hoseContactSleeveOutlineMaterial()}
      </mesh>
      <mesh ref={contactSleeve} visible={false} frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 12]} />
        {hoseContactSleeveMaterial()}
      </mesh>
      <mesh ref={contactShadow} visible={false} frustumCulled={false}>
        <circleGeometry args={[1, 18]} />
        {hoseContactShadowMaterial()}
      </mesh>
      <mesh ref={contactLip} visible={false} frustumCulled={false}>
        <torusGeometry args={[1, 0.11, 7, 22]} />
        {hoseContactGlintMaterial()}
      </mesh>
      <mesh ref={contactGlint} visible={false} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        {hoseContactGlintMaterial()}
      </mesh>
    </>
  )
}

function BoxBurnVanishFx({
  replayKey,
  sequenceStart,
  carryoverSequencesRef,
}: {
  replayKey: number
  sequenceStart: DropSequenceStart
  carryoverSequencesRef: CarryoverBoxSequencesRef
}) {
  const burstGroup = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const puffs = useRef<THREE.Mesh[]>([])
  const embers = useRef<THREE.Mesh[]>([])
  const puffSpecs = [
    [-0.24, -0.08, 0.08, 0.28, 0.4],
    [0.24, -0.04, 0.07, 0.24, 1.1],
    [-0.12, 0.18, 0.06, 0.22, 2.2],
    [0.14, 0.16, 0.055, 0.2, 3.3],
  ] as const
  const emberSpecs = [
    [-0.18, 0.02, 0.018, 0.26, 0.2],
    [0.16, -0.04, 0.016, 0.23, 1.3],
    [-0.04, 0.16, 0.014, 0.2, 2.4],
    [0.08, 0.11, 0.012, 0.18, 3.1],
    [-0.22, 0.12, 0.011, 0.16, 4.2],
    [0.22, 0.1, 0.011, 0.16, 5.2],
  ] as const

  useEffect(() => {
    if (burstGroup.current) burstGroup.current.visible = false
    if (ring.current) ring.current.visible = false
    puffs.current.forEach((puff) => {
      puff.visible = false
    })
    embers.current.forEach((ember) => {
      ember.visible = false
    })
  }, [replayKey])

  useFrame(({ clock }) => {
    const elapsed = Math.min(BOX_DROP_DURATION, getSequenceElapsed(clock.elapsedTime, sequenceStart))
    const carryoverFire = getCarryoverFireSample(clock.elapsedTime, carryoverSequencesRef)
    const activeElapsed = carryoverFire.burnVanish > getBoxBurnVanishAmount(elapsed) ? carryoverFire.elapsed : elapsed
    const burstT = clamp01((activeElapsed - (BOX_FIRE_DISAPPEAR_TIME - 0.28)) / 0.86)
    const active = burstT > 0 && burstT < 1
    const punch = Math.sin(burstT * Math.PI)
    const drift = smooth01(burstT)

    if (burstGroup.current) {
      burstGroup.current.visible = active
      burstGroup.current.position.y = TRAPDOOR_POSITION[1] + 0.11 + punch * 0.08
    }

    if (ring.current) {
      ring.current.visible = active
      ring.current.scale.set(0.14 + drift * 0.7, 0.09 + drift * 0.46, 1)
      ring.current.rotation.z = clock.elapsedTime * 0.2
    }

    puffs.current.forEach((puff, index) => {
      const spec = puffSpecs[index]
      if (!spec) return
      puff.visible = active
      puff.position.set(spec[0] * drift, 0.02 + spec[3] * punch, spec[1] * drift)
      puff.scale.setScalar(spec[2] * (0.45 + punch * 1.7 + drift * 0.4))
    })

    embers.current.forEach((ember, index) => {
      const spec = emberSpecs[index]
      if (!spec) return
      const twinkle = 0.68 + Math.max(0, Math.sin(clock.elapsedTime * 9 + spec[4])) * 0.62
      ember.visible = active && burstT < 0.88
      ember.position.set(spec[0] * drift, 0.04 + spec[3] * punch + drift * 0.08, spec[1] * drift)
      ember.rotation.set(0.4 + burstT, spec[4] + clock.elapsedTime * 0.9, burstT * 1.8)
      ember.scale.setScalar(spec[2] * twinkle * (1 - burstT * 0.28))
    })
  })

  return (
    <group ref={burstGroup} position={[TRAPDOOR_POSITION[0], TRAPDOOR_POSITION[1] + 0.11, TRAPDOOR_POSITION[2]]} visible={false}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <circleGeometry args={[1, 18]} />
        {impactGlintMaterial()}
      </mesh>
      {puffSpecs.map(([x, z, size], index) => (
        <mesh
          key={`burn-puff-${x}-${z}`}
          ref={(node) => {
            if (node) puffs.current[index] = node
          }}
          position={[x, 0.02, z]}
          scale={[size, size, size]}
          visible={false}
        >
          <sphereGeometry args={[1, 6, 4]} />
          {smokePuffMaterial()}
        </mesh>
      ))}
      {emberSpecs.map(([x, z, size], index) => (
        <mesh
          key={`burn-ember-${x}-${z}`}
          ref={(node) => {
            if (node) embers.current[index] = node
          }}
          position={[x, 0.04, z]}
          scale={[size, size, size]}
          visible={false}
        >
          <boxGeometry args={[1, 1, 1]} />
          {index % 2 === 0 ? emberHotMaterial() : flameMidMaterial()}
        </mesh>
      ))}
    </group>
  )
}

function TrapdoorFlameBurst({
  flameRef,
  sequenceStart,
  carryoverSequencesRef,
}: {
  flameRef: MutableRefObject<THREE.Group | null>
  sequenceStart: DropSequenceStart
  carryoverSequencesRef: CarryoverBoxSequencesRef
}) {
  const flameTongues = useRef<THREE.Group[]>([])
  const emberFlecks = useRef<THREE.Mesh[]>([])
  const smokePuffs = useRef<THREE.Mesh[]>([])
  const sparkSlashes = useRef<THREE.Mesh[]>([])
  const heatWisps = useRef<THREE.Mesh[]>([])
  const heatBed = useRef<THREE.Group>(null)

  const tongues = [
    { x: 0, z: -0.03, height: 0.9, width: 0.34, depth: 0.25, lean: -0.03, yaw: 0.04, phase: 0.2, action: 'outer', outline: true, material: flameOuterMaterial },
    { x: 0.08, z: 0.015, height: 0.66, width: 0.23, depth: 0.18, lean: 0.11, yaw: 0.28, phase: 1.1, action: 'outer', outline: true, material: flameRedMaterial },
    { x: -0.09, z: 0.02, height: 0.68, width: 0.23, depth: 0.18, lean: -0.12, yaw: -0.26, phase: 2.2, action: 'lick', outline: true, material: flameRedMaterial },
    { x: 0.02, z: 0.08, height: 0.78, width: 0.19, depth: 0.14, lean: 0.03, yaw: 0.02, phase: 0.8, action: 'core', outline: false, material: flameMidMaterial },
    { x: -0.015, z: 0.14, height: 0.67, width: 0.11, depth: 0.085, lean: -0.05, yaw: -0.1, phase: 2.8, action: 'core', outline: false, material: flameCoreMaterial },
    { x: 0.035, z: 0.18, height: 0.43, width: 0.052, depth: 0.046, lean: 0.06, yaw: 0.15, phase: 4.4, action: 'core', outline: false, material: flameWhiteCoreMaterial },
    { x: -0.16, z: -0.06, height: 0.42, width: 0.11, depth: 0.095, lean: -0.22, yaw: -0.44, phase: 3.7, action: 'lick', outline: true, material: flameOuterMaterial },
    { x: 0.16, z: -0.05, height: 0.4, width: 0.105, depth: 0.09, lean: 0.22, yaw: 0.48, phase: 5.1, action: 'lick', outline: true, material: flameOuterMaterial },
    { x: -0.04, z: -0.14, height: 0.38, width: 0.11, depth: 0.095, lean: -0.06, yaw: -0.72, phase: 6.2, action: 'burst', outline: false, material: flameMidMaterial },
    { x: 0.08, z: -0.14, height: 0.34, width: 0.09, depth: 0.078, lean: 0.11, yaw: 0.76, phase: 7.3, action: 'burst', outline: false, material: flameRedMaterial },
    { x: -0.13, z: 0.14, height: 0.3, width: 0.074, depth: 0.064, lean: -0.2, yaw: -0.16, phase: 5.9, action: 'lick', outline: false, material: flameMidMaterial },
    { x: 0.14, z: 0.13, height: 0.29, width: 0.068, depth: 0.06, lean: 0.18, yaw: 0.18, phase: 6.8, action: 'lick', outline: false, material: flameCoreMaterial },
    { x: -0.16, z: 0.18, height: 0.42, width: 0.074, depth: 0.06, lean: -0.28, yaw: -0.22, phase: 8.1, action: 'lick', outline: false, material: flameCoreMaterial },
    { x: 0.16, z: 0.18, height: 0.44, width: 0.078, depth: 0.062, lean: 0.3, yaw: 0.24, phase: 8.9, action: 'lick', outline: false, material: flameMidMaterial },
    { x: 0.01, z: 0.21, height: 0.28, width: 0.056, depth: 0.045, lean: -0.05, yaw: -0.08, phase: 9.4, action: 'burst', outline: false, material: flameWhiteCoreMaterial },
  ] as const
  const flameGeometries = useMemo(() => Array.from({ length: tongues.length }, (_, index) => createFlameTongueGeometry(index + 1)), [tongues.length])
  const embers = [
    [-0.24, 0.045, -0.18, 0.035, 0.2],
    [0.23, 0.06, 0.16, 0.028, 1.4],
    [-0.09, 0.095, 0.21, 0.022, 2.3],
    [0.12, 0.09, -0.2, 0.026, 3.1],
    [0.01, 0.13, 0.04, 0.02, 4.2],
    [-0.28, 0.08, 0.08, 0.018, 5.1],
    [0.29, 0.11, -0.08, 0.016, 5.9],
    [-0.02, 0.15, -0.17, 0.014, 6.4],
    [-0.32, 0.055, -0.03, 0.017, 7.1],
    [0.34, 0.06, 0.03, 0.016, 7.7],
  ] as const
  const puffs = [
    [-0.34, 0.055, -0.02, 0.075, 0.6],
    [0.33, 0.055, 0.03, 0.07, 1.9],
    [-0.08, 0.08, 0.25, 0.06, 3.4],
    [0.04, 0.08, -0.26, 0.055, 4.3],
  ] as const
  const coals = [
    [-0.22, 0.033, 0.09, 0.08, 0.05, 0.04, 0.2],
    [0.19, 0.035, -0.08, 0.07, 0.055, 0.035, -0.5],
    [0.02, 0.04, 0.18, 0.095, 0.05, 0.045, 0.8],
    [-0.02, 0.035, -0.17, 0.075, 0.04, 0.035, -0.9],
    [-0.33, 0.03, -0.04, 0.06, 0.035, 0.03, 0.55],
    [0.33, 0.03, 0.04, 0.055, 0.035, 0.03, -0.35],
  ] as const
  const sparks = [
    [-0.18, 0.14, -0.04, 0.016, 0.07, 0.2],
    [0.19, 0.15, 0.04, 0.014, 0.065, 1.4],
    [0.02, 0.22, 0.12, 0.012, 0.06, 2.3],
    [-0.06, 0.19, -0.16, 0.011, 0.056, 3.2],
    [0.26, 0.12, -0.13, 0.013, 0.052, 4.3],
    [-0.29, 0.12, 0.14, 0.011, 0.05, 5.3],
    [0.04, 0.27, -0.04, 0.012, 0.062, 6.2],
  ] as const
  const wisps = [
    [-0.18, 0.055, -0.2, 0.36, 0.06, 0.5],
    [0.2, 0.065, 0.2, 0.32, -0.04, 1.8],
    [0.02, 0.08, 0.02, 0.46, 0.02, 3.1],
    [-0.02, 0.065, -0.04, 0.28, -0.18, 4.4],
  ] as const

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const elapsed = Math.min(BOX_DROP_DURATION, getSequenceElapsed(clock.elapsedTime, sequenceStart))
    const carryoverFire = getCarryoverFireSample(clock.elapsedTime, carryoverSequencesRef)
    const activeElapsed = carryoverFire.burnVanish > getBoxBurnVanishAmount(elapsed) ? carryoverFire.elapsed : elapsed
    const burnT = clamp01((activeElapsed - (BOX_FIRE_DISAPPEAR_TIME - 0.24)) / 0.72)
    const burnGulp = burnT > 0 && burnT < 1 ? Math.sin(burnT * Math.PI) * (1 - burnT * 0.18) : 0
    const centralBeat = Math.max(0, Math.sin(t * 4.9 + 0.35))
    const snapBeat = centralBeat ** 6
    if (heatBed.current) {
      const heatPulse = 1 + Math.sin(t * 7.5) * 0.045 + centralBeat * 0.14 + snapBeat * 0.1 + burnGulp * 0.22
      heatBed.current.scale.set(heatPulse, 0.9 + Math.sin(t * 5.4 + 0.8) * 0.035 + centralBeat * 0.1 + burnGulp * 0.16, 1)
      heatBed.current.rotation.y = Math.sin(t * 2.1) * 0.04 + centralBeat * 0.045 + burnGulp * 0.08
    }
    flameTongues.current.forEach((tongue, index) => {
      const spec = tongues[index]
      if (!spec) return
      const baseWave = Math.sin(t * (7.1 + index * 0.55) + spec.phase)
      const lick = spec.action === 'lick' ? Math.max(0, Math.sin(t * (2.65 + index * 0.16) + spec.phase)) : 0
      const burst = spec.action === 'burst' ? Math.max(0, Math.sin(t * (5.25 + index * 0.33) + spec.phase)) ** 7 : 0
      const core = spec.action === 'core' ? centralBeat ** 2 : 0
      const outer = spec.action === 'outer' ? Math.max(0, Math.sin(t * (2.35 + index * 0.1) + spec.phase)) : 0
      const gulpBoost = burnGulp * (spec.action === 'core' ? 0.68 : spec.action === 'burst' ? 0.58 : 0.28)
      const flicker = 1 + baseWave * 0.07 + lick * 0.42 + burst * 0.74 + core * 0.38 + outer * 0.12 + snapBeat * (spec.action === 'core' ? 0.34 : 0.08) + gulpBoost
      const sideTwitch = Math.sin(t * (4.8 + index * 0.42) + spec.phase) * (spec.action === 'lick' ? 0.055 : spec.action === 'outer' ? 0.028 : 0.02)
      tongue.position.set(
        spec.x + sideTwitch + burst * 0.026 * Math.sign(spec.x || 1),
        0.026 + Math.sin(t * 6.4 + spec.phase) * 0.004 + burst * 0.034 + core * 0.018 + lick * 0.018 + outer * 0.01 + burnGulp * (spec.action === 'core' ? 0.09 : 0.04),
        spec.z + Math.sin(t * 1.7 + spec.phase) * (spec.action === 'core' ? 0.006 : 0.014),
      )
      tongue.rotation.set(
        spec.lean * 0.18 + lick * 0.08 + burst * 0.06 + burnGulp * 0.04,
        spec.yaw + Math.sin(t * 2.8 + spec.phase) * (spec.action === 'lick' ? 0.13 : 0.055) + burst * 0.18 + burnGulp * 0.08,
        spec.lean + sideTwitch * 0.8 - burst * 0.1 + snapBeat * (spec.action === 'core' ? 0.055 : 0) + burnGulp * 0.05,
      )
      tongue.scale.set(
        spec.width * (1.02 - lick * 0.08 - burst * 0.12 + core * 0.08 + outer * 0.04),
        spec.height * flicker,
        spec.depth * (0.96 + Math.sin(t * 5.4 + spec.phase) * 0.04 + burst * 0.16 + core * 0.1 + outer * 0.04),
      )
    })
    emberFlecks.current.forEach((ember, index) => {
      const spec = embers[index]
      if (!spec) return
      const lift = (Math.sin(t * 3.3 + spec[4]) + 1) * 0.5
      const blink = 0.72 + lift * 0.5
      ember.position.set(spec[0] + Math.sin(t * 2.1 + spec[4]) * 0.02, spec[1] + lift * 0.07, spec[2])
      ember.scale.setScalar(spec[3] * blink)
      ember.rotation.y = t * (1.8 + index * 0.2)
    })
    smokePuffs.current.forEach((puff, index) => {
      const spec = puffs[index]
      if (!spec) return
      const drift = (Math.sin(t * 1.5 + spec[4]) + 1) * 0.5
      puff.position.set(spec[0] + Math.sin(t * 1.3 + spec[4]) * 0.02, spec[1] + drift * 0.04, spec[2])
      puff.scale.set(spec[3] * (1.05 + drift * 0.18), spec[3] * (0.72 + drift * 0.16), spec[3] * (1.05 + drift * 0.18))
    })
    sparkSlashes.current.forEach((spark, index) => {
      const spec = sparks[index]
      if (!spec) return
      const lift = (Math.sin(t * 5.2 + spec[5]) + 1) * 0.5
      const pop = Math.max(0, Math.sin(t * 5.1 + spec[5])) ** 4
      spark.position.set(spec[0] + Math.sin(t * 2.6 + spec[5]) * 0.035, spec[1] + lift * 0.13 + pop * 0.08, spec[2])
      spark.rotation.set(0.55 + lift * 0.5 + pop * 0.35, spec[5] + t * 0.75, 0.4 + Math.sin(t * 4 + spec[5]) * 0.45)
      spark.scale.set(spec[3] * (0.8 + lift * 0.4 + pop * 0.9), spec[4] * (0.65 + lift * 0.55 + pop * 1.25), spec[3] * 0.7)
    })
    heatWisps.current.forEach((wisp, index) => {
      const spec = wisps[index]
      if (!spec) return
      const pulse = 0.82 + (Math.sin(t * 3 + spec[5]) + 1) * 0.14
      wisp.position.set(spec[0] + Math.sin(t * 1.7 + spec[5]) * 0.015, spec[1], spec[2])
      wisp.rotation.set(Math.PI / 2, spec[4], spec[5] + Math.sin(t * 1.9 + spec[5]) * 0.14)
      wisp.scale.set(spec[3] * pulse, spec[3] * 0.16, spec[3] * 0.05)
    })
  })

  return (
    <group ref={flameRef} position={[0, 0.03, 0]} visible={false}>
      <group ref={heatBed} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <mesh scale={[0.54, 0.38, 1]}>
          <circleGeometry args={[1, 18]} />
          {flameBedMaterial()}
        </mesh>
        <mesh scale={[0.38, 0.26, 1]} position={[0.02, 0.01, 0.002]}>
          <circleGeometry args={[1, 14]} />
          {flameMidMaterial()}
        </mesh>
        <mesh scale={[0.2, 0.15, 1]} position={[-0.08, -0.08, 0.004]}>
          <circleGeometry args={[1, 10]} />
          {flameCoreMaterial()}
        </mesh>
        <mesh scale={[0.16, 0.12, 1]} position={[0.13, 0.07, 0.006]}>
          <circleGeometry args={[1, 10]} />
          {flameCoreMaterial()}
        </mesh>
      </group>
      {puffs.map(([x, y, z, size], index) => (
        <mesh
          key={`smoke-${x}-${z}`}
          ref={(node) => {
            if (node) smokePuffs.current[index] = node
          }}
          position={[x, y, z]}
          scale={[size, size * 0.75, size]}
        >
          <sphereGeometry args={[1, 6, 4]} />
          {smokePuffMaterial()}
        </mesh>
      ))}
      {coals.map(([x, y, z, sx, sy, sz, rotation], index) => (
        <mesh key={`coal-${x}-${z}`} position={[x, y, z]} rotation={[0.18, rotation, -0.08]} scale={[sx, sy, sz]}>
          <sphereGeometry args={[1, 7, 5]} />
          {index % 2 === 0 ? coalMaterial() : emberWarmMaterial()}
        </mesh>
      ))}
      {wisps.map(([x, y, z, size, rotation, phase], index) => (
        <mesh
          key={`wisp-${x}-${z}`}
          ref={(node) => {
            if (node) heatWisps.current[index] = node
          }}
          position={[x, y, z]}
          rotation={[Math.PI / 2, rotation, phase]}
          scale={[size, size * 0.16, size * 0.05]}
        >
          <torusGeometry args={[1, 0.035, 4, 16, Math.PI * 0.72]} />
          {heatWispMaterial()}
        </mesh>
      ))}
      {tongues.map((tongue, index) => (
        <group
          key={`tongue-${tongue.x}-${tongue.z}`}
          ref={(node) => {
            if (node) flameTongues.current[index] = node
          }}
          position={[tongue.x, 0.03, tongue.z]}
          scale={[tongue.width, tongue.height, tongue.depth]}
        >
          {tongue.outline ? (
            <mesh position={[0, -0.004, 0]} scale={[1.16, 1.06, 1.16]}>
              <primitive object={flameGeometries[index]} attach="geometry" />
              {flameOutlineMaterial()}
            </mesh>
          ) : null}
          <mesh position={[0, 0.004, 0]}>
            <primitive object={flameGeometries[index]} attach="geometry" />
            {tongue.material()}
          </mesh>
        </group>
      ))}
      {embers.map(([x, y, z, size], index) => (
        <mesh
          key={`ember-${x}-${z}`}
          ref={(node) => {
            if (node) emberFlecks.current[index] = node
          }}
          position={[x, y, z]}
          scale={[size, size, size]}
        >
          <sphereGeometry args={[1, 5, 4]} />
          {index % 2 === 0 ? emberHotMaterial() : emberWarmMaterial()}
        </mesh>
      ))}
      {sparks.map(([x, y, z, width, height, phase], index) => (
        <mesh
          key={`spark-${x}-${z}`}
          ref={(node) => {
            if (node) sparkSlashes.current[index] = node
          }}
          position={[x, y, z]}
          rotation={[0.55, phase, 0.4]}
          scale={[width, height, width * 0.7]}
        >
          <boxGeometry args={[1, 1, 1]} />
          {index % 2 === 0 ? emberHotMaterial() : flameMidMaterial()}
        </mesh>
      ))}
    </group>
  )
}

function GroundTrapdoor({
  replayKey,
  sequenceStart,
  carryoverSequencesRef,
}: {
  replayKey: number
  sequenceStart: DropSequenceStart
  carryoverSequencesRef: CarryoverBoxSequencesRef
}) {
  const leftDoor = useRef<THREE.Group>(null)
  const rightDoor = useRef<THREE.Group>(null)
  const flame = useRef<THREE.Group>(null)
  const wellGlow = useRef<THREE.Mesh>(null)
  const coreGlow = useRef<THREE.Mesh>(null)
  const doorSpill = useRef<THREE.Mesh>(null)
  const leftDoorEdgeGlow = useRef<THREE.Mesh>(null)
  const rightDoorEdgeGlow = useRef<THREE.Mesh>(null)
  const doorLight = useRef<THREE.PointLight>(null)
  const woodGrainMarks = [
    [-0.25, -0.36, 0.24],
    [0.24, -0.34, -0.18],
    [-0.36, 0.34, -0.16],
    [0.32, 0.34, 0.18],
  ] as const

  useEffect(() => {
    if (leftDoor.current) leftDoor.current.rotation.z = 0
    if (rightDoor.current) rightDoor.current.rotation.z = 0
    if (flame.current) {
      flame.current.visible = false
      flame.current.scale.set(0.94, 0.36, 0.92)
      flame.current.position.y = -0.026
    }
    const glowNodes = [wellGlow.current, coreGlow.current, doorSpill.current, leftDoorEdgeGlow.current, rightDoorEdgeGlow.current]
    glowNodes.forEach((glow) => {
      if (!glow) return
      glow.visible = false
      const material = glow.material as THREE.MeshBasicMaterial
      material.opacity = 0
    })
    if (doorLight.current) doorLight.current.intensity = 0
  }, [replayKey])

  useFrame(({ clock }) => {
    const elapsed = Math.min(BOX_DROP_DURATION, getSequenceElapsed(clock.elapsedTime, sequenceStart))
    const carryoverFire = getCarryoverFireSample(clock.elapsedTime, carryoverSequencesRef)
    const currentOpening = getGroundTrapdoorOpenAmount(elapsed)
    const opening = Math.max(currentOpening, carryoverFire.opening)
    const fireElapsed = carryoverFire.opening > currentOpening ? carryoverFire.elapsed : elapsed
    const doorAngle = opening * MAX_TRAPDOOR_OPEN_ANGLE

    if (leftDoor.current) leftDoor.current.rotation.z = doorAngle
    if (rightDoor.current) rightDoor.current.rotation.z = -doorAngle
    if (flame.current) {
      const vanishPunch = getBoxBurnVanishAmount(fireElapsed)
      const doorGate = smooth01((opening - 0.1) / 0.22)
      const burnGate = smooth01((opening - 0.68) / 0.28)
      const furnaceEnergy = Math.max(getFurnaceEnergy(elapsed), carryoverFire.furnaceEnergy)
      const furnaceBreath = 0.76 + Math.max(0, Math.sin(clock.elapsedTime * 4.7 + 0.3)) ** 2 * 0.18
      const emberSpit = Math.max(0, Math.sin(clock.elapsedTime * 9.5 + 1.1)) ** 6 * 0.08
      const flameAmount = Math.min(1.45, doorGate * (furnaceBreath * 0.55 + emberSpit + burnGate * 0.52) + vanishPunch * 0.42 + furnaceEnergy * 0.12)
      const flicker = 0.95
        + Math.sin(clock.elapsedTime * 14) * 0.05
        + Math.sin(clock.elapsedTime * 7.1 + 1.2) * 0.035
      flame.current.visible = doorGate > 0.035 || vanishPunch > 0.02
      flame.current.scale.set(
        0.84 + flameAmount * 0.2,
        (0.055 + flameAmount * 0.42) * flicker * Math.max(doorGate, vanishPunch),
        0.82 + flameAmount * 0.2,
      )
      flame.current.position.y = -0.104 + doorGate * 0.056 + flameAmount * 0.012

      const lightAmount = Math.min(1, doorGate * 0.72 + furnaceEnergy * 0.42 + vanishPunch * 0.45)
      const glowFlicker = 0.82
        + Math.max(0, Math.sin(clock.elapsedTime * 10.6 + 0.7)) ** 2 * 0.18
        + Math.sin(clock.elapsedTime * 17.1) * 0.035
      if (wellGlow.current) {
        const material = wellGlow.current.material as THREE.MeshBasicMaterial
        wellGlow.current.visible = lightAmount > 0.025
        material.opacity = Math.min(0.42, lightAmount * 0.34 * glowFlicker)
        wellGlow.current.scale.set(0.42 + lightAmount * 0.2, 0.28 + lightAmount * 0.16, 1)
        wellGlow.current.rotation.z = Math.sin(clock.elapsedTime * 1.8) * 0.06
        wellGlow.current.renderOrder = 16
      }
      if (coreGlow.current) {
        const material = coreGlow.current.material as THREE.MeshBasicMaterial
        coreGlow.current.visible = lightAmount > 0.04
        material.opacity = Math.min(0.56, lightAmount * 0.42 * glowFlicker)
        coreGlow.current.scale.set(0.26 + lightAmount * 0.16, 0.17 + lightAmount * 0.11, 1)
        coreGlow.current.renderOrder = 18
      }
      if (doorSpill.current) {
        const material = doorSpill.current.material as THREE.MeshBasicMaterial
        doorSpill.current.visible = lightAmount > 0.035
        material.opacity = Math.min(0.18, lightAmount * 0.14 * glowFlicker)
        doorSpill.current.scale.set(0.58 + lightAmount * 0.24, 0.32 + lightAmount * 0.12, 1)
        doorSpill.current.rotation.z = Math.sin(clock.elapsedTime * 2.4) * 0.05
        doorSpill.current.renderOrder = 8
      }
      const edgeGlowNodes = [leftDoorEdgeGlow.current, rightDoorEdgeGlow.current]
      edgeGlowNodes.forEach((glow) => {
        if (!glow) return
        const material = glow.material as THREE.MeshBasicMaterial
        glow.visible = lightAmount > 0.045
        material.opacity = Math.min(0.44, lightAmount * 0.3 * glowFlicker)
      })
      if (doorLight.current) {
        doorLight.current.intensity = lightAmount * glowFlicker * 1.35
      }
    }
  })

  return (
    <group position={TRAPDOOR_POSITION}>
      <pointLight ref={doorLight} position={[0, 0.085, 0]} color="#ffb341" intensity={0} distance={2.25} decay={2} />
      <mesh ref={doorSpill} position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.58, 0.32, 1]} visible={false}>
        <circleGeometry args={[1, 30]} />
        {trapdoorLightSpillMaterial()}
      </mesh>
      <OutlineMesh
        position={[0, 0, 0]}
        scale={[0.86, 0.045, 0.72]}
        outlineWidth={0.035}
        outlineColor="#030208"
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={trapFrameMaterial()}
      />
      {woodGrainMarks.map(([x, z, rotation]) => (
        <mesh key={`${x}-${z}`} position={[x, 0.027, z]} rotation={[0, rotation, 0]} scale={[0.18, 0.006, 0.012]}>
          <boxGeometry args={[1, 1, 1]} />
          {trapWoodGrainMaterial()}
        </mesh>
      ))}
      <mesh position={[0, 0.035, 0]} scale={[0.68, 0.018, 0.54]}>
        <boxGeometry args={[1, 1, 1]} />
        {trapDarkMaterial()}
      </mesh>
      <mesh ref={wellGlow} position={[0, 0.051, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.42, 0.28, 1]} visible={false}>
        <circleGeometry args={[1, 28]} />
        {trapdoorLightSpillMaterial()}
      </mesh>
      <mesh ref={coreGlow} position={[0, 0.064, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.26, 0.17, 1]} visible={false}>
        <circleGeometry args={[1, 24]} />
        {trapdoorCoreGlowMaterial()}
      </mesh>
      <TrapdoorFlameBurst flameRef={flame} sequenceStart={sequenceStart} carryoverSequencesRef={carryoverSequencesRef} />
      <group ref={leftDoor} position={[-0.34, 0.055, 0]}>
        <OutlineMesh
          position={[0.17, 0, 0]}
          scale={[0.32, 0.035, 0.56]}
          outlineWidth={0.025}
          outlineColor="#030208"
          geometry={<boxGeometry args={[1, 1, 1]} />}
          material={trapDoorMaterial()}
        />
        <mesh ref={leftDoorEdgeGlow} position={[0.17, 0.022, 0]} scale={[0.24, 0.01, 0.46]} visible={false}>
          <boxGeometry args={[1, 1, 1]} />
          {trapdoorCoreGlowMaterial()}
        </mesh>
      </group>
      <group ref={rightDoor} position={[0.34, 0.055, 0]}>
        <OutlineMesh
          position={[-0.17, 0, 0]}
          scale={[0.32, 0.035, 0.56]}
          outlineWidth={0.025}
          outlineColor="#030208"
          geometry={<boxGeometry args={[1, 1, 1]} />}
          material={trapDoorMaterial()}
        />
        <mesh ref={rightDoorEdgeGlow} position={[-0.17, 0.022, 0]} scale={[0.24, 0.01, 0.46]} visible={false}>
          <boxGeometry args={[1, 1, 1]} />
          {trapdoorCoreGlowMaterial()}
        </mesh>
      </group>
      <mesh position={[0, 0.078, 0]} scale={[0.012, 0.01, 0.56]}>
        <boxGeometry args={[1, 1, 1]} />
        {trapDarkMaterial()}
      </mesh>
      {[-0.32, 0.32].map((x) => (
        <mesh key={x} position={[x, 0.085, -0.31]} rotation={[Math.PI / 2, 0, 0]} scale={[0.034, 0.034, 0.012]}>
          <cylinderGeometry args={[1, 1, 1, 8]} />
          {brassBoltMaterial()}
        </mesh>
      ))}
    </group>
  )
}

function CursorJuiceSparkle({
  position,
  phase,
  scale = 1,
  color = '#fff1a2',
}: {
  position: [number, number, number]
  phase: number
  scale?: number
  color?: string
}) {
  const root = useRef<THREE.Group>(null)

  useFrame(({ clock }) => {
    const rootNode = root.current
    if (!rootNode) return

    const t = clock.elapsedTime + phase
    const pulse = (Math.sin(t * 5.4) + 1) * 0.5
    rootNode.position.set(position[0] + Math.sin(t * 2.8) * 0.012, position[1] + Math.cos(t * 3.2) * 0.014, position[2])
    rootNode.rotation.set(0, 0, t * 1.45)
    rootNode.scale.setScalar(scale * (0.56 + pulse * 0.5))
    rootNode.visible = pulse > 0.12
  })

  return (
    <group ref={root} position={position} renderOrder={103}>
      <RoundedBox args={[0.018, 0.112, 0.018]} radius={0.006} smoothness={3}>
        {cursorGlowMaterial({ color, opacity: 0.86 })}
      </RoundedBox>
      <RoundedBox args={[0.112, 0.018, 0.018]} radius={0.006} smoothness={3}>
        {cursorGlowMaterial({ color, opacity: 0.86 })}
      </RoundedBox>
      <RoundedBox args={[0.052, 0.052, 0.016]} radius={0.012} smoothness={3} rotation={[0, 0, Math.PI / 4]}>
        {cursorBrassMaterial()}
      </RoundedBox>
    </group>
  )
}

function MuseumToonCursor() {
  const root = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const tipGlow = useRef<THREE.Mesh>(null)
  const trailA = useRef<THREE.Mesh>(null)
  const trailB = useRef<THREE.Mesh>(null)
  const clickRing = useRef<THREE.Mesh>(null)
  const { camera, gl, pointer, size } = useThree()
  const cameraForward = useMemo(() => new THREE.Vector3(), [])
  const cameraRight = useMemo(() => new THREE.Vector3(), [])
  const cameraUp = useMemo(() => new THREE.Vector3(), [])
  const targetPosition = useMemo(() => new THREE.Vector3(), [])
  const smoothedPointer = useRef(new THREE.Vector2(-0.18, -0.18))
  const previousPointer = useRef(new THREE.Vector2(-0.18, -0.18))
  const pointerVisible = useRef(0)
  const hoverAmount = useRef(0)
  const pressAmount = useRef(0)
  const clickPulse = useRef(0)
  const isPressed = useRef(false)
  const hasPointer = useRef(false)
  const cursorGeometry = useMemo(() => {
    const shape = new THREE.Shape()
    shape.moveTo(0.035, 0.142)
    shape.bezierCurveTo(0.018, 0.164, -0.022, 0.16, -0.044, 0.116)
    shape.lineTo(-0.112, -0.016)
    shape.bezierCurveTo(-0.076, -0.014, -0.038, -0.01, -0.006, -0.002)
    shape.lineTo(-0.071, -0.216)
    shape.bezierCurveTo(-0.08, -0.248, -0.136, -0.236, -0.128, -0.202)
    shape.lineTo(-0.191, -0.18)
    shape.lineTo(-0.135, -0.026)
    shape.lineTo(-0.272, -0.054)
    shape.bezierCurveTo(-0.326, -0.064, -0.34, -0.01, -0.286, 0.011)
    shape.lineTo(-0.094, 0.094)
    shape.bezierCurveTo(-0.048, 0.116, -0.006, 0.132, 0.035, 0.142)
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.052,
      bevelEnabled: true,
      bevelThickness: 0.014,
      bevelSize: 0.012,
      bevelSegments: 3,
    })
    geometry.translate(0, 0, -0.026)
    geometry.computeVertexNormals()
    return geometry
  }, [])

  useEffect(() => {
    const canvas = gl.domElement
    const showCursor = () => {
      hasPointer.current = true
      pointerVisible.current = Math.max(pointerVisible.current, 0.45)
      canvas.style.cursor = 'none'
    }
    const hideCursor = () => {
      hasPointer.current = false
      isPressed.current = false
    }
    const pressCursor = () => {
      isPressed.current = true
      clickPulse.current = 1
    }
    const releaseCursor = () => {
      isPressed.current = false
      clickPulse.current = Math.max(clickPulse.current, 0.82)
    }

    canvas.style.cursor = 'none'
    canvas.addEventListener('pointerenter', showCursor)
    canvas.addEventListener('pointermove', showCursor)
    canvas.addEventListener('pointerleave', hideCursor)
    canvas.addEventListener('pointerdown', pressCursor)
    window.addEventListener('pointerup', releaseCursor)

    return () => {
      canvas.removeEventListener('pointerenter', showCursor)
      canvas.removeEventListener('pointermove', showCursor)
      canvas.removeEventListener('pointerleave', hideCursor)
      canvas.removeEventListener('pointerdown', pressCursor)
      window.removeEventListener('pointerup', releaseCursor)
      canvas.style.cursor = ''
    }
  }, [gl])

  useEffect(() => {
    const rootNode = root.current
    if (!rootNode) return
    rootNode.traverse((object) => {
      object.frustumCulled = false
      object.raycast = () => undefined
    })
  }, [])

  useEffect(() => {
    return () => {
      cursorGeometry.dispose()
    }
  }, [cursorGeometry])

  useFrame(({ clock }, dt) => {
    const rootNode = root.current
    const bodyNode = body.current
    if (!rootNode || !bodyNode) return

    gl.domElement.style.cursor = 'none'

    const follow = 1 - Math.exp(-22 * dt)
    previousPointer.current.copy(smoothedPointer.current)
    smoothedPointer.current.lerp(pointer, follow)
    const pointerSpeed = smoothedPointer.current.distanceTo(previousPointer.current) / Math.max(dt, 0.001)

    const hotUi =
      pointer.x > 0.12 && pointer.y > 0.5
      || pointer.x < -0.42 && pointer.y < -0.48
      || (Math.abs(pointer.x) < 0.48 && Math.abs(pointer.y) < 0.34)
    hoverAmount.current += ((hotUi ? 1 : 0) - hoverAmount.current) * (1 - Math.exp(-12 * dt))
    pressAmount.current += ((isPressed.current ? 1 : 0) - pressAmount.current) * (1 - Math.exp(-28 * dt))
    clickPulse.current = Math.max(0, clickPulse.current - dt * 2.9)
    pointerVisible.current += ((hasPointer.current ? 1 : 0) - pointerVisible.current) * (1 - Math.exp(-10 * dt))

    const cameraDistance = size.width < 620 ? 3.45 : 4.35
    const perspectiveCamera = camera as THREE.PerspectiveCamera
    const fov = perspectiveCamera.isPerspectiveCamera ? THREE.MathUtils.degToRad(perspectiveCamera.fov) : 0.72
    const viewHeight = 2 * Math.tan(fov / 2) * cameraDistance
    const viewWidth = viewHeight * (size.width / size.height)
    camera.getWorldDirection(cameraForward).normalize()
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    targetPosition.copy(camera.position)
      .addScaledVector(cameraForward, cameraDistance)
      .addScaledVector(cameraRight, viewWidth * smoothedPointer.current.x * 0.5)
      .addScaledVector(cameraUp, viewHeight * smoothedPointer.current.y * 0.5)

    rootNode.visible = pointerVisible.current > 0.025
    rootNode.position.copy(targetPosition)
    rootNode.quaternion.copy(camera.quaternion)
    rootNode.scale.setScalar(size.width < 620 ? 0.56 : 0.68)

    const t = clock.elapsedTime
    const clickBounce = clickPulse.current > 0 ? Math.sin((1 - clickPulse.current) * Math.PI) * clickPulse.current : 0
    const hover = hoverAmount.current
    const press = pressAmount.current
    const movementSquash = Math.min(0.14, pointerSpeed * 0.028)
    const idleWiggle = Math.sin(t * 5.6) * 0.012 + Math.sin(t * 9.3) * 0.006
    bodyNode.position.set(-0.018 + Math.sin(t * 2.4) * 0.006, -0.022 + Math.cos(t * 2.1) * 0.006, 0)
    bodyNode.rotation.set(
      0,
      0,
      -0.24 + idleWiggle + hover * -0.08 + press * 0.1 + clickBounce * -0.16 + Math.min(0.18, pointerSpeed * 0.012),
    )
    bodyNode.scale.set(
      1 + hover * 0.08 + clickBounce * 0.16 + movementSquash,
      1 + hover * 0.045 - press * 0.15 - movementSquash * 0.55 + clickBounce * 0.05,
      1 + hover * 0.04 + press * 0.1,
    )

    const trailOpacity = Math.min(0.34, 0.08 + pointerSpeed * 0.05 + hover * 0.08 + clickBounce * 0.2)
    if (trailA.current) {
      trailA.current.position.set(-0.16 - pointerSpeed * 0.016, -0.1, -0.055)
      trailA.current.scale.set(0.16 + pointerSpeed * 0.01, 0.072 + hover * 0.02, 1)
      const material = trailA.current.material as THREE.MeshBasicMaterial
      material.opacity = trailOpacity
    }
    if (trailB.current) {
      trailB.current.position.set(-0.24 - pointerSpeed * 0.02, -0.04, -0.06)
      trailB.current.scale.set(0.12 + pointerSpeed * 0.008, 0.046 + hover * 0.012, 1)
      const material = trailB.current.material as THREE.MeshBasicMaterial
      material.opacity = trailOpacity * 0.6
    }
    if (tipGlow.current) {
      tipGlow.current.scale.setScalar(0.052 + hover * 0.028 + clickBounce * 0.07)
      const material = tipGlow.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.16 + hover * 0.2 + clickBounce * 0.35
    }
    if (clickRing.current) {
      const ringT = 1 - clickPulse.current
      clickRing.current.visible = clickPulse.current > 0.02
      clickRing.current.scale.setScalar(0.12 + ringT * 0.56)
      const material = clickRing.current.material as THREE.MeshBasicMaterial
      material.opacity = Math.max(0, clickPulse.current * 0.42)
    }
  })

  return (
    <group ref={root} visible={false} renderOrder={100}>
      <group ref={body}>
        <mesh ref={trailA} position={[-0.18, -0.1, -0.055]} rotation={[0, 0, 0.15]} renderOrder={96}>
          <circleGeometry args={[1, 28]} />
          {cursorGlowMaterial({ color: '#ffe58a', opacity: 0.18 })}
        </mesh>
        <mesh ref={trailB} position={[-0.28, -0.04, -0.06]} rotation={[0, 0, -0.18]} renderOrder={95}>
          <circleGeometry args={[1, 24]} />
          {cursorGlowMaterial({ color: '#9fd7cc', opacity: 0.08 })}
        </mesh>
        <mesh geometry={cursorGeometry} scale={[1.2, 1.2, 1.12]} position={[0, 0, -0.026]} renderOrder={98}>
          {cursorInkMaterial()}
        </mesh>
        <mesh geometry={cursorGeometry} renderOrder={101}>
          {cursorGloveMaterial()}
        </mesh>
        <mesh geometry={cursorGeometry} scale={[0.58, 0.44, 1]} position={[-0.15, -0.102, 0.03]} rotation={[0, 0, 0.06]} renderOrder={102}>
          {cursorGloveShadeMaterial()}
        </mesh>
        <mesh ref={tipGlow} position={[0.018, 0.127, 0.054]} renderOrder={105}>
          <circleGeometry args={[1, 28]} />
          {cursorGlowMaterial({ color: '#fff7b8', opacity: 0.22 })}
        </mesh>
        <mesh ref={clickRing} position={[0.018, 0.127, 0.036]} renderOrder={104} visible={false}>
          <ringGeometry args={[0.68, 1, 42]} />
          {cursorGlowMaterial({ color: '#fff1a2', opacity: 0.28 })}
        </mesh>
        <RoundedBox args={[0.21, 0.13, 0.08]} radius={0.04} smoothness={5} position={[-0.203, -0.23, 0.006]} rotation={[0, 0, -0.34]} renderOrder={101}>
          {cursorInkMaterial()}
        </RoundedBox>
        <RoundedBox args={[0.18, 0.1, 0.075]} radius={0.034} smoothness={5} position={[-0.204, -0.228, 0.045]} rotation={[0, 0, -0.34]} renderOrder={102}>
          {cursorCuffMaterial()}
        </RoundedBox>
        <RoundedBox args={[0.12, 0.04, 0.082]} radius={0.018} smoothness={4} position={[-0.186, -0.197, 0.087]} rotation={[0, 0, -0.34]} renderOrder={103}>
          {cursorCuffInsetMaterial()}
        </RoundedBox>
        <RoundedBox args={[0.235, 0.035, 0.09]} radius={0.015} smoothness={4} position={[-0.215, -0.157, 0.088]} rotation={[0, 0, -0.34]} renderOrder={104}>
          {cursorBrassMaterial()}
        </RoundedBox>
        <CursorJuiceSparkle position={[-0.29, 0.12, 0.07]} phase={0.2} scale={0.72} color="#fff1a2" />
        <CursorJuiceSparkle position={[-0.38, -0.13, 0.072]} phase={1.5} scale={0.48} color="#9fd7cc" />
        <CursorJuiceSparkle position={[0.04, -0.16, 0.074]} phase={2.6} scale={0.54} color="#ffd47a" />
      </group>
    </group>
  )
}

function MuseumWalletConnectButton({
  connected,
  onConnect,
}: {
  connected: boolean
  onConnect: () => void
}) {
  const root = useRef<THREE.Group>(null)
  const plaque = useRef<THREE.Group>(null)
  const glow = useRef<THREE.Mesh>(null)
  const pressTarget = useRef(0)
  const pressAmount = useRef(0)
  const hoverTarget = useRef(0)
  const hoverAmount = useRef(0)
  const clickPulse = useRef(0)
  const [hovered, setHovered] = useState(false)
  const { camera, gl, size } = useThree()
  const cameraForward = useMemo(() => new THREE.Vector3(), [])
  const cameraRight = useMemo(() => new THREE.Vector3(), [])
  const cameraUp = useMemo(() => new THREE.Vector3(), [])
  const targetPosition = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    if (!hovered) return undefined
    const canvas = gl.domElement
    const previousCursor = canvas.style.cursor
    canvas.style.cursor = 'pointer'

    return () => {
      canvas.style.cursor = previousCursor
    }
  }, [gl, hovered])

  useFrame(({ clock }, dt) => {
    const rootNode = root.current
    const plaqueNode = plaque.current
    if (!rootNode || !plaqueNode) return

    const t = clock.elapsedTime
    const cameraDistance = size.width < 620 ? 7.4 : 8.4
    const perspectiveCamera = camera as THREE.PerspectiveCamera
    const fov = perspectiveCamera.isPerspectiveCamera ? THREE.MathUtils.degToRad(perspectiveCamera.fov) : 0.7
    const viewHeight = 2 * Math.tan(fov / 2) * cameraDistance
    const viewWidth = viewHeight * (size.width / size.height)
    const xAnchor = size.width < 620 ? 0.13 : 0.245
    const yAnchor = size.width < 620 ? 0.3 : 0.31

    camera.getWorldDirection(cameraForward).normalize()
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    targetPosition.copy(camera.position)
      .addScaledVector(cameraForward, cameraDistance)
      .addScaledVector(cameraRight, viewWidth * xAnchor)
      .addScaledVector(cameraUp, viewHeight * yAnchor)

    rootNode.position.lerp(targetPosition, 1 - Math.exp(-24 * dt))
    rootNode.quaternion.copy(camera.quaternion)
    rootNode.scale.setScalar(size.width < 620 ? 0.58 : 0.76)

    pressAmount.current += (pressTarget.current - pressAmount.current) * (1 - Math.exp(-18 * dt))
    hoverAmount.current += (hoverTarget.current - hoverAmount.current) * (1 - Math.exp(-16 * dt))
    clickPulse.current = Math.max(0, clickPulse.current - dt * 2.45)

    const clickT = 1 - clickPulse.current
    const clickBounce = clickPulse.current > 0 ? Math.sin(clickT * Math.PI) * clickPulse.current : 0
    const idleBob = Math.sin(t * 1.24) * 0.034 + Math.sin(t * 2.05 + 0.8) * 0.012
    const hover = hoverAmount.current
    const hoverLift = hover * 0.024
    const connectedHum = connected ? Math.sin(t * 2.3) * 0.018 : 0
    const press = pressAmount.current
    const baseScale = 1 + hover * 0.034 + clickBounce * 0.12 + (connected ? 0.014 : 0)

    plaqueNode.position.set(0, idleBob + hoverLift + clickBounce * 0.04 + connectedHum, -press * 0.045 + clickBounce * 0.035)
    plaqueNode.rotation.set(
      -0.045 + Math.sin(t * 1.1 + 0.4) * 0.016 - press * 0.035,
      Math.sin(t * 0.8) * 0.018,
      Math.sin(t * 1.36 + 0.7) * 0.02 + clickBounce * 0.04,
    )
    plaqueNode.scale.set(
      baseScale * (1 + press * 0.02),
      baseScale * (1 - press * 0.09 + clickBounce * 0.04),
      baseScale * (1 - press * 0.02),
    )

    if (glow.current) {
      const glowPulse = connected ? 0.08 + (Math.sin(t * 2.6) + 1) * 0.04 : 0.18 + (Math.sin(t * 2.25) + 1) * 0.05 + hover * 0.12
      glow.current.scale.set(1 + glowPulse + clickBounce * 0.3, 1 + glowPulse * 0.65 + clickBounce * 0.2, 1)
    }
  })

  return (
    <group
      ref={root}
      renderOrder={20}
    >
      <mesh
        position={[0, 0, 0.31]}
        onPointerDown={(event) => {
          event.stopPropagation()
          pressTarget.current = 1
        }}
        onPointerUp={(event) => {
          event.stopPropagation()
          pressTarget.current = 0
          clickPulse.current = 1
          onConnect()
        }}
        onPointerCancel={(event) => {
          event.stopPropagation()
          pressTarget.current = 0
        }}
        onPointerOver={(event) => {
          event.stopPropagation()
          hoverTarget.current = 1
          setHovered(true)
        }}
        onPointerOut={(event) => {
          event.stopPropagation()
          pressTarget.current = 0
          hoverTarget.current = 0
          setHovered(false)
        }}
      >
        <planeGeometry args={[3.08, 1.18]} />
        {pointerHitAreaMaterial()}
      </mesh>
      <group ref={plaque}>
        <mesh position={[0.1, -0.15, -0.13]} rotation={[0, 0, -0.025]} scale={[1.48, 0.45, 1]}>
          <circleGeometry args={[1, 28]} />
          {walletPlaqueShadowMaterial()}
        </mesh>
        <RoundedBox args={[2.74, 1, 0.22]} radius={0.2} smoothness={8} position={[0, -0.02, -0.05]}>
          {walletPlaqueOutlineMaterial()}
        </RoundedBox>
        <RoundedBox args={[2.52, 0.8, 0.19]} radius={0.16} smoothness={8} position={[0, 0, 0.02]}>
          {walletConnectActionFrameMaterial({ connected, hovered })}
        </RoundedBox>
        <RoundedBox args={[1.9, 0.52, 0.16]} radius={0.12} smoothness={7} position={[0.2, 0.005, 0.12]}>
          {walletConnectActionFaceMaterial({ connected, hovered })}
        </RoundedBox>
        <mesh ref={glow} position={[0.2, 0.025, 0.205]} scale={[1, 1, 1]}>
          <planeGeometry args={[1.8, 0.38]} />
          {walletConnectActionGlowMaterial({ connected, hovered })}
        </mesh>
        <RoundedBox args={[0.48, 0.56, 0.16]} radius={0.1} smoothness={6} position={[-0.94, 0.005, 0.13]}>
          {walletPlaqueInsetMaterial({ connected })}
        </RoundedBox>
        <mesh position={[-0.94, 0.075, 0.225]} scale={[0.15, 0.08, 0.018]}>
          <boxGeometry args={[1, 1, 1]} />
          {walletPlaqueBrassMaterial()}
        </mesh>
        <mesh position={[-0.915, -0.055, 0.23]} rotation={[Math.PI / 2, 0, 0]} scale={[0.058, 0.058, 0.018]}>
          <cylinderGeometry args={[1, 1, 1, 12]} />
          {walletPlaqueBrassMaterial()}
        </mesh>
        {[
          [-1, 0.22],
          [1, 0.22],
          [-1, -0.22],
          [1, -0.22],
        ].map(([x, y]) => (
          <group key={`wallet-bolt-${x}-${y}`} position={[x * 1.17, y * 1.34, 0.18]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} scale={[0.044, 0.044, 0.016]}>
              <cylinderGeometry args={[1, 1, 1, 10]} />
              {walletPlaqueOutlineMaterial()}
            </mesh>
            <mesh position={[0, 0, 0.012]} rotation={[Math.PI / 2, 0, 0]} scale={[0.032, 0.032, 0.014]}>
              <cylinderGeometry args={[1, 1, 1, 10]} />
              {walletPlaqueBrassMaterial()}
            </mesh>
          </group>
        ))}
        <MuseumWalletPlaqueLabel connected={connected} />
      </group>
    </group>
  )
}

function MuseumWalletPlaqueLabel({ connected }: { connected: boolean }) {
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null

    const canvas = document.createElement('canvas')
    canvas.width = 1152
    canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) return null

    context.clearRect(0, 0, canvas.width, canvas.height)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = connected ? '#245c5b' : '#6f2c1f'
    context.font = '900 34px Arial Black, Georgia, serif'
    context.fillText(connected ? 'MUSEUM PASS' : 'MUSEUM PASS', canvas.width / 2, 56)
    const walletText = connected ? 'WALLET READY' : 'CONNECT WALLET'
    let walletFontSize = connected ? 78 : 84
    context.font = `900 ${walletFontSize}px Arial Black, Impact, sans-serif`
    const maxWalletTextWidth = canvas.width * 0.84
    const measuredWalletTextWidth = context.measureText(walletText).width
    if (measuredWalletTextWidth > maxWalletTextWidth) {
      walletFontSize *= maxWalletTextWidth / measuredWalletTextWidth
      context.font = `900 ${walletFontSize}px Arial Black, Impact, sans-serif`
    }
    if (!connected) {
      context.lineJoin = 'round'
      context.strokeStyle = '#17121f'
      context.lineWidth = 8
      context.strokeText(walletText, canvas.width / 2, 154)
    }
    context.fillStyle = connected ? '#17121f' : '#fff0a8'
    context.fillText(walletText, canvas.width / 2, 156)

    const labelTexture = new THREE.CanvasTexture(canvas)
    labelTexture.colorSpace = THREE.SRGBColorSpace
    labelTexture.needsUpdate = true
    return labelTexture
  }, [connected])

  useEffect(() => {
    return () => {
      texture?.dispose()
    }
  }, [texture])

  if (!texture) return null

  return (
    <mesh position={[0.2, 0.008, 0.235]}>
      <planeGeometry args={[1.72, 0.42]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

function MuseumBurnLaunchButton({
  onOpen,
}: {
  onOpen: () => void
}) {
  const root = useRef<THREE.Group>(null)
  const plaque = useRef<THREE.Group>(null)
  const glow = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const hoverTarget = useRef(0)
  const hoverAmount = useRef(0)
  const clickPulse = useRef(0)
  const { camera, gl, size } = useThree()
  const cameraForward = useMemo(() => new THREE.Vector3(), [])
  const cameraRight = useMemo(() => new THREE.Vector3(), [])
  const cameraUp = useMemo(() => new THREE.Vector3(), [])
  const targetPosition = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    if (!hovered) return undefined
    const canvas = gl.domElement
    const previousCursor = canvas.style.cursor
    canvas.style.cursor = 'pointer'

    return () => {
      canvas.style.cursor = previousCursor
    }
  }, [gl, hovered])

  useFrame(({ clock }, dt) => {
    const rootNode = root.current
    const plaqueNode = plaque.current
    if (!rootNode || !plaqueNode) return

    const t = clock.elapsedTime
    const cameraDistance = size.width < 620 ? 7.35 : 8.4
    const perspectiveCamera = camera as THREE.PerspectiveCamera
    const fov = perspectiveCamera.isPerspectiveCamera ? THREE.MathUtils.degToRad(perspectiveCamera.fov) : 0.7
    const viewHeight = 2 * Math.tan(fov / 2) * cameraDistance
    const viewWidth = viewHeight * (size.width / size.height)
    const xAnchor = size.width < 620 ? -0.03 : -0.29
    const yAnchor = size.width < 620 ? -0.32 : -0.31

    camera.getWorldDirection(cameraForward).normalize()
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    targetPosition.copy(camera.position)
      .addScaledVector(cameraForward, cameraDistance)
      .addScaledVector(cameraRight, viewWidth * xAnchor)
      .addScaledVector(cameraUp, viewHeight * yAnchor)

    rootNode.position.lerp(targetPosition, 1 - Math.exp(-24 * dt))
    rootNode.quaternion.copy(camera.quaternion)
    rootNode.scale.setScalar(size.width < 620 ? 0.6 : 0.84)

    hoverAmount.current += (hoverTarget.current - hoverAmount.current) * (1 - Math.exp(-16 * dt))
    clickPulse.current = Math.max(0, clickPulse.current - dt * 2.6)
    const clickT = 1 - clickPulse.current
    const clickBounce = clickPulse.current > 0 ? Math.sin(clickT * Math.PI) * clickPulse.current : 0
    const press = pressed ? 1 : 0
    const idleBob = Math.sin(t * 1.26) * 0.035 + Math.sin(t * 2.1 + 0.5) * 0.014
    const hover = hoverAmount.current
    const hoverScale = hover * 0.04
    const baseScale = 1 + hoverScale + clickBounce * 0.16

    plaqueNode.position.set(0, idleBob + hover * 0.018 + clickBounce * 0.06, -press * 0.05 + clickBounce * 0.05)
    plaqueNode.rotation.set(
      -0.055 + Math.sin(t * 1.06) * 0.018 - press * 0.03,
      Math.sin(t * 0.82 + 0.4) * 0.018,
      Math.sin(t * 1.42 + 0.6) * 0.022 + clickBounce * 0.06,
    )
    plaqueNode.scale.set(
      baseScale * (1 + press * 0.015),
      baseScale * (1 - press * 0.08 + clickBounce * 0.06),
      baseScale,
    )

    if (glow.current) {
      const glowPulse = 0.22 + (Math.sin(t * 2.6) + 1) * 0.08 + hover * 0.14 + clickBounce * 0.34
      glow.current.scale.set(1 + glowPulse, 1 + glowPulse * 0.62, 1)
      glow.current.rotation.z = Math.sin(t * 0.8) * 0.04
    }
  })

  return (
    <group
      ref={root}
      renderOrder={22}
    >
      <mesh
        position={[0, 0, 0.34]}
        onPointerDown={(event) => {
          event.stopPropagation()
          setPressed(true)
        }}
        onPointerUp={(event) => {
          event.stopPropagation()
          setPressed(false)
          clickPulse.current = 1
          onOpen()
        }}
        onPointerCancel={(event) => {
          event.stopPropagation()
          setPressed(false)
        }}
        onPointerOver={(event) => {
          event.stopPropagation()
          hoverTarget.current = 1
          setHovered(true)
        }}
        onPointerOut={(event) => {
          event.stopPropagation()
          hoverTarget.current = 0
          setHovered(false)
          setPressed(false)
        }}
      >
        <planeGeometry args={[3.08, 1.38]} />
        {pointerHitAreaMaterial()}
      </mesh>
      <group ref={plaque}>
        <mesh ref={glow} position={[0.03, -0.02, -0.13]} scale={[1, 1, 1]}>
          <circleGeometry args={[1.46, 40]} />
          {burnLaunchHotMaterial()}
        </mesh>
        <mesh position={[0.14, -0.18, -0.18]} rotation={[0, 0, -0.04]} scale={[1.52, 0.52, 1]}>
          <circleGeometry args={[1, 32]} />
          {walletPlaqueShadowMaterial()}
        </mesh>
        <RoundedBox args={[2.62, 1.04, 0.24]} radius={0.22} smoothness={8} position={[0, -0.02, -0.05]}>
          {walletPlaqueOutlineMaterial()}
        </RoundedBox>
        <RoundedBox args={[2.42, 0.82, 0.2]} radius={0.18} smoothness={8} position={[0, 0, 0.04]}>
          {burnLaunchRedMaterial({ hovered })}
        </RoundedBox>
        <RoundedBox args={[2.12, 0.55, 0.18]} radius={0.15} smoothness={8} position={[0.02, 0.03, 0.13]}>
          {burnLaunchFaceMaterial({ hovered })}
        </RoundedBox>
        <mesh position={[0.02, 0.065, 0.235]} scale={[1.04, 0.22, 1]}>
          <planeGeometry args={[1.78, 0.55]} />
          <meshBasicMaterial color="#fff1a2" transparent opacity={hovered ? 0.24 : 0.14} toneMapped={false} depthWrite={false} />
        </mesh>
        {[
          [-1.12, 0.31],
          [1.12, 0.31],
          [-1.12, -0.31],
          [1.12, -0.31],
        ].map(([x, y]) => (
          <group key={`burn-launch-bolt-${x}-${y}`} position={[x, y, 0.19]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} scale={[0.055, 0.055, 0.018]}>
              <cylinderGeometry args={[1, 1, 1, 10]} />
              {walletPlaqueOutlineMaterial()}
            </mesh>
            <mesh position={[0, 0, 0.014]} rotation={[Math.PI / 2, 0, 0]} scale={[0.038, 0.038, 0.014]}>
              <cylinderGeometry args={[1, 1, 1, 10]} />
              {walletPlaqueBrassMaterial()}
            </mesh>
          </group>
        ))}
        <BurnLaunchButtonLabel hovered={hovered} />
      </group>
    </group>
  )
}

function BurnLaunchButtonLabel({ hovered }: { hovered: boolean }) {
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null

    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 430
    const context = canvas.getContext('2d')
    if (!context) return null

    context.clearRect(0, 0, canvas.width, canvas.height)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = '900 245px Arial Black, Impact, sans-serif'
    context.lineJoin = 'round'
    context.strokeStyle = '#17121f'
    context.lineWidth = 24
    context.strokeText('BURN!', canvas.width / 2, 222)
    context.fillStyle = hovered ? '#fff6b7' : '#fff0a8'
    context.fillText('BURN!', canvas.width / 2, 222)
    context.fillStyle = '#c43426'
    context.globalAlpha = hovered ? 0.5 : 0.34
    context.fillText('BURN!', canvas.width / 2 + 10, 238)
    context.globalAlpha = 1
    context.fillStyle = '#17121f'
    context.font = '900 32px Arial Black, Georgia, serif'
    context.fillText(' ', canvas.width / 2, 360)

    const labelTexture = new THREE.CanvasTexture(canvas)
    labelTexture.colorSpace = THREE.SRGBColorSpace
    labelTexture.needsUpdate = true
    return labelTexture
  }, [hovered])

  useEffect(() => {
    return () => {
      texture?.dispose()
    }
  }, [texture])

  if (!texture) return null

  return (
    <mesh position={[0.02, 0.035, 0.255]}>
      <planeGeometry args={[1.9, 0.66]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

function MuseumBurnCatalogSelector({
  selectedItemId,
  availableBoxCount,
  soldOutItemIds,
  onSelect,
}: {
  selectedItemId: BurnCatalogItemId
  availableBoxCount: number
  soldOutItemIds: readonly BurnCatalogItemId[]
  onSelect: (item: BurnCatalogItem) => void
}) {
  const root = useRef<THREE.Group>(null)
  const plaque = useRef<THREE.Group>(null)
  const [hoveredOption, setHoveredOption] = useState<BurnCatalogItemId | null>(null)
  const [pressedOption, setPressedOption] = useState<BurnCatalogItemId | null>(null)
  const clickPulse = useRef(0)
  const { camera, gl, size } = useThree()
  const cameraForward = useMemo(() => new THREE.Vector3(), [])
  const cameraRight = useMemo(() => new THREE.Vector3(), [])
  const cameraUp = useMemo(() => new THREE.Vector3(), [])
  const targetPosition = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    if (hoveredOption === null) return undefined
    const canvas = gl.domElement
    const previousCursor = canvas.style.cursor
    canvas.style.cursor = 'pointer'

    return () => {
      canvas.style.cursor = previousCursor
    }
  }, [gl, hoveredOption])

  useFrame(({ clock }, dt) => {
    const rootNode = root.current
    const plaqueNode = plaque.current
    if (!rootNode || !plaqueNode) return

    const t = clock.elapsedTime
    const cameraDistance = size.width < 620 ? 7.4 : 8.4
    const perspectiveCamera = camera as THREE.PerspectiveCamera
    const fov = perspectiveCamera.isPerspectiveCamera ? THREE.MathUtils.degToRad(perspectiveCamera.fov) : 0.7
    const viewHeight = 2 * Math.tan(fov / 2) * cameraDistance
    const viewWidth = viewHeight * (size.width / size.height)
    const xAnchor = size.width < 620 ? -0.02 : -0.29
    const yAnchor = size.width < 620 ? -0.32 : -0.3

    camera.getWorldDirection(cameraForward).normalize()
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    targetPosition.copy(camera.position)
      .addScaledVector(cameraForward, cameraDistance)
      .addScaledVector(cameraRight, viewWidth * xAnchor)
      .addScaledVector(cameraUp, viewHeight * yAnchor)

    rootNode.position.lerp(targetPosition, 1 - Math.exp(-24 * dt))
    rootNode.quaternion.copy(camera.quaternion)
    rootNode.scale.setScalar(size.width < 620 ? 0.56 : 0.88)

    clickPulse.current = Math.max(0, clickPulse.current - dt * 2.8)
    const appear = 1 - Math.exp(-7.5 * t)
    const clickT = 1 - clickPulse.current
    const clickBounce = clickPulse.current > 0 ? Math.sin(clickT * Math.PI) * clickPulse.current : 0
    const idleBob = Math.sin(t * 1.18 + 0.7) * 0.028 + Math.sin(t * 2.08) * 0.01
    const hoverLift = hoveredOption === null ? 0 : 0.02
    const baseScale = appear * (1 + clickBounce * 0.08 + hoverLift)

    plaqueNode.position.set(0, idleBob + clickBounce * 0.03, clickBounce * 0.025)
    plaqueNode.rotation.set(
      -0.03 + Math.sin(t * 0.92) * 0.014,
      Math.sin(t * 0.74 + 0.6) * 0.016,
      Math.sin(t * 1.42 + 0.2) * 0.018,
    )
    plaqueNode.scale.set(baseScale, baseScale * (1 + clickBounce * 0.035), baseScale)
  })

  return (
    <group ref={root} renderOrder={21}>
      <group ref={plaque}>
        <mesh position={[0.1, -0.12, -0.12]} rotation={[0, 0, -0.025]} scale={[1.72, 0.47, 1]}>
          <circleGeometry args={[1, 28]} />
          {walletPlaqueShadowMaterial()}
        </mesh>
        <RoundedBox args={[3.54, 1.44, 0.18]} radius={0.16} smoothness={6} position={[0, -0.02, -0.035]}>
          {walletPlaqueOutlineMaterial()}
        </RoundedBox>
        <RoundedBox args={[3.32, 1.24, 0.16]} radius={0.14} smoothness={6} position={[0, 0, 0]}>
          {walletPlaqueWalnutMaterial()}
        </RoundedBox>
        {BURN_CATALOG_ITEMS.map((item, index) => (
          <MuseumBurnCatalogOption
            key={item.id}
            item={item}
            selected={selectedItemId === item.id}
            hovered={hoveredOption === item.id}
            pressed={pressedOption === item.id}
            availableBoxCount={availableBoxCount}
            soldOut={soldOutItemIds.includes(item.id)}
            x={index === 0 ? -0.84 : 0.84}
            y={0}
            onSelect={() => {
              clickPulse.current = 1
              onSelect(item)
            }}
            onPressStart={() => {
              setPressedOption(item.id)
            }}
            onPressEnd={() => {
              setPressedOption(null)
            }}
            onHoverStart={() => {
              setHoveredOption(item.id)
            }}
            onHoverEnd={() => {
              if (hoveredOption === item.id) setHoveredOption(null)
              setPressedOption(null)
            }}
          />
        ))}
        <MuseumBurnCatalogRail y={0.56} width={2.6} quiet />
        <MuseumBurnCatalogRail y={-0.6} width={2.6} quiet />
        {[
          [-1.5, 0.56],
          [1.5, 0.56],
          [-1.5, -0.6],
          [1.5, -0.6],
        ].map(([x, y]) => (
          <mesh key={`burn-catalog-bolt-${x}-${y}`} position={[x, y, 0.12]} rotation={[Math.PI / 2, 0, 0]} scale={[0.038, 0.038, 0.014]}>
            <cylinderGeometry args={[1, 1, 1, 10]} />
            {walletPlaqueBrassMaterial()}
          </mesh>
        ))}
      </group>
    </group>
  )
}

function MuseumBurnCatalogRail({
  y,
  width,
  quiet = false,
}: {
  y: number
  width: number
  quiet?: boolean
}) {
  return (
    <group position={[0, y, 0.12]}>
      <mesh position={[0, -0.003, -0.006]} scale={[width * 0.5, quiet ? 0.011 : 0.015, 0.006]}>
        <boxGeometry args={[1, 1, 1]} />
        {walletPlaqueOutlineMaterial()}
      </mesh>
      <mesh position={[0, 0.003, 0.004]} scale={[width * 0.47, quiet ? 0.005 : 0.007, 0.006]}>
        <boxGeometry args={[1, 1, 1]} />
        {walletPlaqueBrassMaterial()}
      </mesh>
    </group>
  )
}

function MuseumBurnCatalogOption({
  item,
  selected,
  hovered,
  pressed,
  availableBoxCount,
  soldOut,
  x,
  y,
  onSelect,
  onPressStart,
  onPressEnd,
  onHoverStart,
  onHoverEnd,
}: {
  item: BurnCatalogItem
  selected: boolean
  hovered: boolean
  pressed: boolean
  availableBoxCount: number
  soldOut: boolean
  x: number
  y: number
  onSelect: () => void
  onPressStart: () => void
  onPressEnd: () => void
  onHoverStart: () => void
  onHoverEnd: () => void
}) {
  const missingBoxCount = Math.max(0, item.boxCost - availableBoxCount)
  const unavailable = soldOut || missingBoxCount > 0
  const lift = selected ? 0.014 : hovered ? 0.016 : 0
  const pressDepth = pressed ? -0.035 : 0
  const scale = selected ? 1.026 : hovered ? 1.014 : 1

  return (
    <group
      position={[x, y + lift, pressDepth]}
      scale={[scale, scale, scale]}
      onPointerDown={(event) => {
        event.stopPropagation()
        onPressStart()
      }}
      onPointerUp={(event) => {
        event.stopPropagation()
        onPressEnd()
        onSelect()
      }}
      onPointerCancel={(event) => {
        event.stopPropagation()
        onPressEnd()
      }}
      onPointerOver={(event) => {
        event.stopPropagation()
        onHoverStart()
      }}
      onPointerOut={(event) => {
        event.stopPropagation()
        onHoverEnd()
      }}
    >
      <RoundedBox args={[1.54, 0.9, 0.14]} radius={0.13} smoothness={6} position={[0, -0.006, -0.02]}>
        {walletPlaqueOutlineMaterial()}
      </RoundedBox>
      <RoundedBox args={[1.36, 0.72, 0.13]} radius={0.11} smoothness={6} position={[0, 0, 0.05]}>
        {museumCatalogTileFaceMaterial({ item, selected, hovered, unavailable })}
      </RoundedBox>
      <mesh position={[0, 0, 0.116]} scale={[selected ? 1.02 : 1, selected ? 1.06 : 1, 1]}>
        <planeGeometry args={[1.15, 0.5]} />
        {walletPlaqueOptionGlowMaterial({ selected })}
      </mesh>
      <mesh position={[-0.66, 0, 0.13]} scale={[0.03, 0.62, 0.012]}>
        <boxGeometry args={[1, 1, 1]} />
        {walletPlaqueBrassMaterial()}
      </mesh>
      <MuseumCatalogItemLabel item={item} selected={selected} />
      <MuseumCatalogBoxCostGlyph item={item} selected={selected} hovered={hovered} availableBoxCount={availableBoxCount} />
      {soldOut ? (
        <MuseumSoldOutStamp compact position={[0, 0.08, 0.245]} rotationZ={-0.18} scale={0.78} />
      ) : unavailable ? (
        <MuseumCatalogShortageBadge missingBoxCount={missingBoxCount} />
      ) : null}
    </group>
  )
}

function MuseumCatalogShortageBadge({ missingBoxCount }: { missingBoxCount: number }) {
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null

    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 220
    const context = canvas.getContext('2d')
    if (!context) return null

    const label = `NEED ${missingBoxCount} MORE`
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#17121f'
    context.font = '900 92px Arial Black, Georgia, serif'
    context.fillText(label, canvas.width / 2, 112)

    const labelTexture = new THREE.CanvasTexture(canvas)
    labelTexture.colorSpace = THREE.SRGBColorSpace
    labelTexture.needsUpdate = true
    return labelTexture
  }, [missingBoxCount])

  useEffect(() => {
    return () => {
      texture?.dispose()
    }
  }, [texture])

  if (!texture) return null

  return (
    <group position={[0.36, 0.325, 0.17]}>
      <RoundedBox args={[0.78, 0.19, 0.06]} radius={0.045} smoothness={4} position={[0, 0, -0.012]}>
        {walletPlaqueOutlineMaterial()}
      </RoundedBox>
      <RoundedBox args={[0.69, 0.13, 0.052]} radius={0.035} smoothness={4} position={[0, 0, 0.028]}>
        {burnDetailDisabledButtonInsetMaterial({ hovered: true })}
      </RoundedBox>
      <mesh position={[0, 0, 0.062]}>
        <planeGeometry args={[0.62, 0.115]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  )
}

function MuseumSoldOutStamp({
  compact = false,
  position = [0, 0, 0],
  rotationZ = -0.16,
  scale = 1,
}: {
  compact?: boolean
  position?: [number, number, number]
  rotationZ?: number
  scale?: number
}) {
  const stampWidth = compact ? 1.06 : 1.62
  const stampHeight = compact ? 0.34 : 0.48

  return (
    <group position={position} rotation={[0, 0, rotationZ]} scale={scale} renderOrder={45}>
      <mesh position={[0.05, -0.045, -0.035]} scale={[stampWidth * 0.54, stampHeight * 0.72, 1]} renderOrder={44}>
        <circleGeometry args={[1, 32]} />
        {soldOutStampShadowMaterial()}
      </mesh>
      <RoundedBox args={[stampWidth, stampHeight, 0.09]} radius={compact ? 0.075 : 0.105} smoothness={5} position={[0, 0, 0]} renderOrder={45}>
        {walletPlaqueOutlineMaterial()}
      </RoundedBox>
      <RoundedBox args={[stampWidth - 0.11, stampHeight - 0.1, 0.072]} radius={compact ? 0.055 : 0.08} smoothness={5} position={[0, 0, 0.046]} renderOrder={46}>
        {soldOutStampFaceMaterial()}
      </RoundedBox>
      <RoundedBox args={[stampWidth - 0.3, compact ? 0.045 : 0.06, 0.035]} radius={0.02} smoothness={3} position={[0, compact ? 0.115 : 0.165, 0.092]} renderOrder={47}>
        {soldOutStampInsetMaterial()}
      </RoundedBox>
      <RoundedBox args={[stampWidth - 0.3, compact ? 0.045 : 0.06, 0.035]} radius={0.02} smoothness={3} position={[0, compact ? -0.115 : -0.165, 0.092]} renderOrder={47}>
        {soldOutStampInsetMaterial()}
      </RoundedBox>
      <MuseumSoldOutStampLabel compact={compact} width={stampWidth - 0.2} />
    </group>
  )
}

function MuseumSoldOutStampLabel({
  compact,
  width,
}: {
  compact: boolean
  width: number
}) {
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null

    const canvas = document.createElement('canvas')
    canvas.width = 1100
    canvas.height = 320
    const context = canvas.getContext('2d')
    if (!context) return null

    context.clearRect(0, 0, canvas.width, canvas.height)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineJoin = 'round'
    context.font = `900 ${compact ? 134 : 154}px Arial Black, Impact, sans-serif`
    context.strokeStyle = '#17121f'
    context.lineWidth = compact ? 16 : 18
    context.strokeText('SOLD OUT', canvas.width / 2, canvas.height / 2 + 6)
    context.fillStyle = '#fff0a8'
    context.fillText('SOLD OUT', canvas.width / 2, canvas.height / 2 + 6)

    const stampTexture = new THREE.CanvasTexture(canvas)
    stampTexture.colorSpace = THREE.SRGBColorSpace
    stampTexture.needsUpdate = true
    return stampTexture
  }, [compact])

  useEffect(() => {
    return () => {
      texture?.dispose()
    }
  }, [texture])

  if (!texture) return null

  return (
    <mesh position={[0, 0, 0.125]} renderOrder={48}>
      <planeGeometry args={[width, compact ? 0.18 : 0.23]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} depthTest={false} toneMapped={false} />
    </mesh>
  )
}

function MuseumCatalogItemLabel({
  item,
  selected,
}: {
  item: BurnCatalogItem
  selected: boolean
}) {
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null

    const canvas = document.createElement('canvas')
    canvas.width = 960
    canvas.height = 225
    const context = canvas.getContext('2d')
    if (!context) return null

    context.clearRect(0, 0, canvas.width, canvas.height)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = selected ? '#123a3b' : '#17121f'
    let fontSize = 112
    context.font = `900 ${fontSize}px Arial Black, Georgia, serif`
    const maxTitleWidth = canvas.width * 0.9
    const measuredTitleWidth = context.measureText(item.title).width
    if (measuredTitleWidth > maxTitleWidth) {
      fontSize *= maxTitleWidth / measuredTitleWidth
      context.font = `900 ${fontSize}px Arial Black, Georgia, serif`
    }
    context.fillText(item.title, canvas.width / 2, 116)

    const labelTexture = new THREE.CanvasTexture(canvas)
    labelTexture.colorSpace = THREE.SRGBColorSpace
    labelTexture.needsUpdate = true
    return labelTexture
  }, [item, selected])

  useEffect(() => {
    return () => {
      texture?.dispose()
    }
  }, [texture])

  if (!texture) return null

  return (
    <mesh position={[0, -0.22, 0.158]}>
      <planeGeometry args={[1.18, 0.265]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

function MuseumCatalogBoxCostGlyph({
  item,
  selected,
  hovered,
  availableBoxCount,
}: {
  item: BurnCatalogItem
  selected: boolean
  hovered: boolean
  availableBoxCount: number
}) {
  const boxes = useRef<THREE.Group[]>([])
  const rings = useRef<THREE.Mesh[]>([])
  const count = Math.min(item.boxCost, 2)
  const missingBoxCount = Math.max(0, item.boxCost - availableBoxCount)
  const unavailable = missingBoxCount > 0

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    boxes.current.forEach((box, index) => {
      if (!box) return
      const phase = index * Math.PI + (selected ? 0.4 : 0)
      const wideOffset = count === 2 ? -0.28 + index * 0.56 : 0
      const float = Math.sin(t * 2.05 + phase) * 0.035
      const orbit = Math.sin(t * 1.35 + phase) * 0.035
      const depth = Math.cos(t * 1.35 + phase) * 0.03
      box.position.set(wideOffset + orbit, 0.055 + float, 0.14 + depth + index * 0.02)
      box.rotation.set(
        0.18 + Math.sin(t * 1.8 + phase) * 0.1,
        t * 1.1 + phase,
        Math.sin(t * 2.1 + phase) * 0.09,
      )
      const missing = index >= availableBoxCount
      const scale = (missing ? 0.82 : 1) + Math.sin(t * 2.4 + phase) * (hovered || selected ? 0.04 : 0.018)
      box.scale.setScalar(scale)
    })

    rings.current.forEach((ring, index) => {
      if (!ring) return
      const phase = index * Math.PI
      const pulse = 1 + Math.sin(t * 1.8 + phase) * 0.08
      ring.scale.set(0.5 * pulse, 0.13 * (1 / pulse), 1)
      ring.rotation.z = Math.sin(t * 0.75 + phase) * 0.08
    })
  })

  return (
    <group position={[0, 0.2, 0.152]}>
      <mesh
        ref={(node) => {
          if (node) rings.current[0] = node
        }}
        position={[0, -0.11, 0.035]}
      >
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial color="#fff0a8" transparent opacity={selected || hovered ? 0.3 : 0.18} toneMapped={false} depthWrite={false} />
      </mesh>
      {unavailable ? (
        <mesh position={[0.28, 0.1, 0.075]} rotation={[0, 0, -0.32]} scale={[0.28, 0.035, 0.012]} renderOrder={23}>
          <boxGeometry args={[1, 1, 1]} />
          {burnDetailDisabledButtonMaterial({ hovered: true })}
        </mesh>
      ) : null}
      <mesh
        ref={(node) => {
          if (node) rings.current[1] = node
        }}
        position={[0, -0.108, 0.04]}
      >
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial color={item.accent} transparent opacity={selected || hovered ? 0.16 : 0.1} toneMapped={false} depthWrite={false} />
      </mesh>
      {Array.from({ length: count }).map((_, index) => (
        <group
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          ref={(node) => {
            if (node) boxes.current[index] = node
          }}
          scale={count === 2 ? 0.34 : 0.42}
        >
          <group position={[0, -0.54, 0]}>
            <VacuumStylePurpleBox />
          </group>
        </group>
      ))}
    </group>
  )
}

function MuseumBurnDetailWindow({
  item,
  availableBoxCount,
  soldOut,
  onClose,
  onBurn,
}: {
  item: BurnCatalogItem | null
  availableBoxCount: number
  soldOut: boolean
  onClose: () => void
  onBurn: (item: BurnCatalogItem) => void
}) {
  const root = useRef<THREE.Group>(null)
  const previewPanel = useRef<THREE.Group>(null)
  const burnChargeStart = useRef<number | null>(null)
  const burnChargeTimeout = useRef<number | null>(null)
  const burnChargeItem = useRef<BurnCatalogItem | null>(null)
  const chargePressureShadow = useRef<THREE.Mesh>(null)
  const chargeSnapFlash = useRef<THREE.Mesh>(null)
  const chargeActionMarks = useRef<THREE.Mesh[]>([])
  const chargeDustPuffs = useRef<THREE.Mesh[]>([])
  const chargeSmears = useRef<THREE.Mesh[]>([])
  const chargeArcMarks = useRef<THREE.Mesh[]>([])
  const [backHovered, setBackHovered] = useState(false)
  const [backPressed, setBackPressed] = useState(false)
  const [burnHovered, setBurnHovered] = useState(false)
  const [burnPressed, setBurnPressed] = useState(false)
  const [burnCharging, setBurnCharging] = useState(false)
  const { camera, gl, size } = useThree()
  const cameraForward = useMemo(() => new THREE.Vector3(), [])
  const cameraUp = useMemo(() => new THREE.Vector3(), [])
  const targetPosition = useMemo(() => new THREE.Vector3(), [])
  const missingBoxCount = item === null ? 0 : Math.max(0, item.boxCost - availableBoxCount)
  const burnUnavailable = soldOut || missingBoxCount > 0
  const chargeActionMarkSpecs = useMemo(() => [
    { x: -1.48, y: 0.58, outX: -0.18, outY: 0.12, width: 0.34, height: 0.036, phase: 0.1, delay: 0, rotation: -0.62, color: '#211827' },
    { x: 1.42, y: 0.48, outX: 0.19, outY: 0.09, width: 0.38, height: 0.034, phase: 1.4, delay: 0.06, rotation: 0.56, color: '#211827' },
    { x: -1.28, y: -0.78, outX: -0.16, outY: -0.12, width: 0.3, height: 0.032, phase: 2.1, delay: 0.13, rotation: 0.72, color: '#6c5542' },
    { x: 1.26, y: -0.76, outX: 0.17, outY: -0.13, width: 0.32, height: 0.032, phase: 2.8, delay: 0.1, rotation: -0.7, color: '#6c5542' },
    { x: -0.48, y: 1.16, outX: -0.06, outY: 0.19, width: 0.34, height: 0.034, phase: 3.5, delay: 0.18, rotation: -0.16, color: '#f2d389' },
    { x: 0.54, y: -1.22, outX: 0.08, outY: -0.19, width: 0.36, height: 0.034, phase: 4.2, delay: 0.2, rotation: 0.18, color: '#f2d389' },
    { x: -1.62, y: -0.08, outX: -0.16, outY: -0.01, width: 0.24, height: 0.03, phase: 5.1, delay: 0.25, rotation: -0.04, color: '#211827' },
    { x: 1.58, y: -0.06, outX: 0.16, outY: 0.01, width: 0.24, height: 0.03, phase: 5.8, delay: 0.28, rotation: 0.04, color: '#211827' },
  ], [])
  const chargeDustPuffSpecs = useMemo(() => [
    { x: -1.23, y: -1.05, outX: -0.11, outY: -0.06, radius: 0.085, phase: 0.2, delay: 0, warm: false },
    { x: -0.8, y: -1.14, outX: -0.04, outY: -0.1, radius: 0.062, phase: 1.1, delay: 0.1, warm: true },
    { x: 1.18, y: -1.05, outX: 0.1, outY: -0.06, radius: 0.08, phase: 2.2, delay: 0.06, warm: false },
    { x: 0.82, y: -1.15, outX: 0.04, outY: -0.11, radius: 0.056, phase: 3.2, delay: 0.16, warm: true },
    { x: -1.32, y: 0.9, outX: -0.08, outY: 0.08, radius: 0.052, phase: 4.1, delay: 0.22, warm: false },
    { x: 1.3, y: 0.86, outX: 0.08, outY: 0.08, radius: 0.052, phase: 4.8, delay: 0.24, warm: false },
  ], [])
  const chargeSmearSpecs = useMemo(() => [
    { x: -0.78, y: 1.18, width: 0.48, height: 0.035, phase: 0.2, rotation: -0.05, delay: 0.04 },
    { x: 0.82, y: 1.14, width: 0.42, height: 0.032, phase: 1.1, rotation: 0.06, delay: 0.08 },
    { x: -0.88, y: -1.22, width: 0.5, height: 0.036, phase: 2.4, rotation: 0.04, delay: 0.12 },
    { x: 0.88, y: -1.2, width: 0.46, height: 0.034, phase: 3.2, rotation: -0.05, delay: 0.16 },
  ], [])
  const chargeArcSpecs = useMemo(() => [
    { x: -1.42, y: 0.06, radius: 0.23, phase: 0.1, delay: 0.02, rotation: 1.52, color: '#211827' },
    { x: 1.42, y: 0.08, radius: 0.24, phase: 1.2, delay: 0.08, rotation: -1.68, color: '#211827' },
    { x: -0.08, y: 1.19, radius: 0.2, phase: 2.3, delay: 0.16, rotation: 3.08, color: '#6c5542' },
    { x: 0.1, y: -1.22, radius: 0.22, phase: 3.4, delay: 0.2, rotation: -0.02, color: '#6c5542' },
    { x: -1.34, y: -0.92, radius: 0.16, phase: 4.4, delay: 0.25, rotation: 0.82, color: '#f5dfaa' },
    { x: 1.34, y: -0.88, radius: 0.16, phase: 5.2, delay: 0.25, rotation: -0.92, color: '#f5dfaa' },
  ], [])

  useEffect(() => {
    if (burnChargeTimeout.current !== null) {
      window.clearTimeout(burnChargeTimeout.current)
      burnChargeTimeout.current = null
    }

    burnChargeStart.current = null
    burnChargeItem.current = null
    setBurnCharging(false)

    return () => {
      if (burnChargeTimeout.current !== null) {
        window.clearTimeout(burnChargeTimeout.current)
        burnChargeTimeout.current = null
      }
    }
  }, [item?.id])

  useEffect(() => {
    if (!backHovered && !burnHovered) return undefined
    const canvas = gl.domElement
    const previousCursor = canvas.style.cursor
    canvas.style.cursor = burnHovered && burnUnavailable ? 'not-allowed' : 'pointer'

    return () => {
      canvas.style.cursor = previousCursor
    }
  }, [backHovered, burnHovered, burnUnavailable, gl])

  useFrame(({ clock }, dt) => {
    const rootNode = root.current
    const panelNode = previewPanel.current
    if (!rootNode || !panelNode || !item) return

    const t = clock.elapsedTime
    const cameraDistance = size.width < 620 ? 5.8 : 6.2
    camera.getWorldDirection(cameraForward).normalize()
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    targetPosition.copy(camera.position)
      .addScaledVector(cameraForward, cameraDistance)
      .addScaledVector(cameraUp, size.width < 620 ? 0.12 : 0.08)

    rootNode.position.lerp(targetPosition, 1 - Math.exp(-24 * dt))
    rootNode.quaternion.copy(camera.quaternion)
    rootNode.scale.setScalar(size.width < 620 ? 0.5 : 0.94)

    if (burnCharging && burnChargeStart.current === null) {
      burnChargeStart.current = t
    }

    const chargeElapsed = burnCharging && burnChargeStart.current !== null ? t - burnChargeStart.current : 0
    const charge = burnCharging ? clamp01(chargeElapsed / BURN_DETAIL_CHARGE_DURATION) : 0
    const chargeAttack = smoother01(charge / 0.34)
    const chargeRelease = smoother01((charge - 0.78) / 0.22)
    const windup = burnCharging ? Math.sin(clamp01(charge / 0.72) * Math.PI * 0.5) : 0
    const compressionPulse = burnCharging ? Math.sin(clamp01(charge / 0.36) * Math.PI) : 0
    const anticipationStretch = burnCharging ? Math.sin(clamp01((charge - 0.36) / 0.38) * Math.PI) : 0
    const snapPulse = burnCharging ? Math.sin(clamp01((charge - 0.68) / 0.22) * Math.PI) : 0
    const afterBounce = burnCharging ? Math.sin(clamp01((charge - 0.84) / 0.16) * Math.PI) : 0
    const exitAmount = burnCharging ? clamp01((charge - BURN_DETAIL_EXIT_START) / (1 - BURN_DETAIL_EXIT_START)) : 0
    const exitEase = burnCharging ? smoother01(exitAmount) : 0
    const exitOvershoot = burnCharging ? easeOutBack01(exitAmount) : 0
    const exitPoof = burnCharging ? Math.sin(exitAmount * Math.PI) : 0
    const exitTuck = burnCharging ? smoother01((charge - 0.88) / 0.12) : 0
    const rubberBeat = burnCharging ? Math.sin(charge * Math.PI * 8.5) * (1 - chargeRelease * 0.88) : 0
    const cartoonRattle = burnCharging ? Math.sin(t * 20.5 + charge * 7.2) * Math.sin(t * 13.2 + 0.7) : 0
    const shakeEnvelope = burnCharging ? (0.006 + windup * 0.03 + snapPulse * 0.026 + exitPoof * 0.014) * (1 - exitTuck * 0.52) : 0
    const shakeX = (Math.sin(t * 26.5 + 0.4) * 0.62 + Math.sin(t * 15.2 + 1.8) * 0.42 + rubberBeat * 0.95 + cartoonRattle * 0.22) * shakeEnvelope
    const shakeY = (Math.cos(t * 22.8 + 0.9) * 0.5 + Math.sin(t * 12.6 + 2.2) * 0.36 - rubberBeat * 0.42 + cartoonRattle * 0.14) * shakeEnvelope
    const breathe = Math.sin(t * 1.4) * 0.008
    const press = backPressed || burnPressed ? -0.02 : 0
    const chargeDepth = burnCharging ? -0.058 * chargeAttack + 0.052 * afterBounce + exitEase * 0.18 : 0
    const exitStretchX = 1 + exitPoof * 0.16 - exitTuck * 0.52
    const exitStretchY = 1 - exitPoof * 0.18 - exitTuck * 0.44
    const exitStretchZ = 1 + exitPoof * 0.08 - exitTuck * 0.32
    const squashX = burnCharging ? 1 + compressionPulse * 0.044 - anticipationStretch * 0.028 + snapPulse * 0.135 - afterBounce * 0.048 : 1
    const squashY = burnCharging ? 1 - compressionPulse * 0.034 + anticipationStretch * 0.064 - snapPulse * 0.12 + afterBounce * 0.048 : 1
    const squashZ = burnCharging ? 1 - compressionPulse * 0.095 + snapPulse * 0.078 + afterBounce * 0.034 : 1
    panelNode.position.set(
      shakeX + exitOvershoot * 0.52,
      shakeY - exitOvershoot * 0.34 + exitPoof * 0.1,
      press + chargeDepth,
    )
    panelNode.scale.set(squashX * exitStretchX, squashY * exitStretchY, squashZ * exitStretchZ)
    panelNode.rotation.set(
      -0.018 + breathe + shakeY * 1.15 + snapPulse * 0.042 - afterBounce * 0.026 + exitPoof * 0.12,
      Math.sin(t * 0.7) * 0.012 + shakeX * 0.9 - afterBounce * 0.034 - exitPoof * 0.08,
      Math.sin(t * 0.92) * 0.01 + rubberBeat * 0.035 + Math.sin(t * 16.5 + charge * 4.2) * shakeEnvelope * 1.7 - exitOvershoot * 0.22,
    )

    setMeshOpacity(chargePressureShadow.current, burnCharging ? (0.08 + windup * 0.22 + snapPulse * 0.18 + exitPoof * 0.18) * (1 - exitTuck * 0.86) : 0)
    setMeshOpacity(chargeSnapFlash.current, burnCharging ? snapPulse * 0.42 + afterBounce * 0.16 + exitPoof * 0.42 : 0)

    if (chargePressureShadow.current) {
      chargePressureShadow.current.scale.set(
        1.56 + compressionPulse * 0.22 + snapPulse * 0.34 + exitPoof * 0.42,
        0.36 + compressionPulse * 0.08 + snapPulse * 0.16 + exitPoof * 0.12,
        1,
      )
      chargePressureShadow.current.position.set(-0.02 + shakeX * 0.28 + exitOvershoot * 0.2, -1.08 + shakeY * 0.2 - exitOvershoot * 0.06, 0.215)
      chargePressureShadow.current.rotation.z = -0.04 + Math.sin(t * 4.6) * 0.012 - exitOvershoot * 0.08
    }

    if (chargeSnapFlash.current) {
      chargeSnapFlash.current.position.set(exitOvershoot * 0.16, -0.08 - exitOvershoot * 0.09, 0.255)
      chargeSnapFlash.current.scale.set(0.62 + snapPulse * 1.05 + afterBounce * 0.3 + exitPoof * 1.15, 0.14 + snapPulse * 0.42 + afterBounce * 0.16 + exitPoof * 0.5, 1)
      chargeSnapFlash.current.rotation.z = -0.08 + Math.sin(t * 10.5) * 0.018 - exitOvershoot * 0.24
    }

    chargeActionMarks.current.forEach((mark, index) => {
      const spec = chargeActionMarkSpecs[index]
      if (!mark || !spec) return
      const markIn = smoother01((charge - spec.delay) / 0.36)
      const markOut = smoother01((charge - 0.74 - spec.delay * 0.2) / 0.2)
      const flutter = Math.sin(t * 13 + spec.phase) * 0.5 + Math.sin(t * 7.1 + spec.phase) * 0.3
      const exitSide = Math.sign(spec.outX || (index % 2 === 0 ? -1 : 1))
      const pop = Math.max(0, markIn - markOut) * (0.55 + windup * 0.28) + snapPulse * 0.5 + exitPoof * 0.72
      setMeshOpacity(mark, burnCharging ? Math.min(0.92, pop * (0.42 + snapPulse * 0.4 + exitPoof * 0.24)) * (1 - exitTuck * 0.42) : 0)
      mark.position.set(
        spec.x + spec.outX * (markIn * 0.54 + snapPulse * 1.35) + exitSide * exitOvershoot * 0.16 + flutter * 0.008,
        spec.y + spec.outY * (markIn * 0.54 + snapPulse * 1.15) - exitOvershoot * 0.08 + Math.sin(t * 9 + spec.phase) * 0.006,
        0.25,
      )
      mark.rotation.z = spec.rotation + flutter * 0.045 + snapPulse * 0.09 * Math.sign(spec.outX || 1) - exitOvershoot * 0.16
      mark.scale.set(1 + windup * 0.18 + snapPulse * 0.72 + exitPoof * 0.76, 1 + compressionPulse * 0.22 + snapPulse * 0.28 + exitPoof * 0.32, 1)
    })

    chargeSmears.current.forEach((smear, index) => {
      const spec = chargeSmearSpecs[index]
      if (!smear || !spec) return
      const smearIn = smoother01((charge - spec.delay) / 0.32)
      const smearOut = smoother01((charge - 0.72 - spec.delay * 0.1) / 0.24)
      const smearStrength = Math.max(0, smearIn - smearOut) * (0.42 + windup * 0.28) + snapPulse * 0.35 + exitPoof * 0.66
      setMeshOpacity(smear, burnCharging ? Math.min(0.34, smearStrength * 0.34) : 0)
      smear.position.set(
        spec.x + Math.sin(t * 10 + spec.phase) * 0.01 + rubberBeat * 0.018 + exitOvershoot * 0.18,
        spec.y + Math.cos(t * 8 + spec.phase) * 0.008 - exitOvershoot * 0.1,
        0.242,
      )
      smear.rotation.z = spec.rotation + rubberBeat * 0.06 + Math.sin(t * 7.5 + spec.phase) * 0.025 - exitOvershoot * 0.18
      smear.scale.set(1 + windup * 0.24 + snapPulse * 1.1 + exitPoof * 1.2, 1 + compressionPulse * 0.25 + snapPulse * 0.42 + exitPoof * 0.44, 1)
    })

    chargeArcMarks.current.forEach((arc, index) => {
      const spec = chargeArcSpecs[index]
      if (!arc || !spec) return
      const arcIn = smoother01((charge - spec.delay) / 0.28)
      const arcOut = smoother01((charge - 0.7 - spec.delay * 0.12) / 0.22)
      const arcStrength = Math.max(0, arcIn - arcOut) * (0.5 + windup * 0.22) + snapPulse * 0.58 + exitPoof * 0.72
      setMeshOpacity(arc, burnCharging ? Math.min(0.82, arcStrength * 0.66) * (1 - exitTuck * 0.34) : 0)
      const push = arcIn * 0.08 + snapPulse * 0.16 + exitPoof * 0.18
      arc.position.set(
        spec.x + Math.cos(spec.rotation) * push + exitOvershoot * 0.1 + Math.sin(t * 8.4 + spec.phase) * 0.008,
        spec.y + Math.sin(spec.rotation) * push - exitOvershoot * 0.08 + Math.cos(t * 7.2 + spec.phase) * 0.008,
        0.252,
      )
      arc.rotation.z = spec.rotation + rubberBeat * 0.1 + snapPulse * 0.24 * Math.sign(Math.sin(spec.phase)) - exitOvershoot * 0.18
      const arcScale = spec.radius * (1 + windup * 0.16 + snapPulse * 0.54 + exitPoof * 0.72)
      arc.scale.set(arcScale * (1 + rubberBeat * 0.08), arcScale * (1 - rubberBeat * 0.05), 1)
    })

    chargeDustPuffs.current.forEach((puff, index) => {
      const spec = chargeDustPuffSpecs[index]
      if (!puff || !spec) return
      const puffIn = smoother01((charge - 0.1 - spec.delay) / 0.3)
      const puffOut = smoother01((charge - 0.76 - spec.delay * 0.16) / 0.24)
      const snapKick = snapPulse * (0.42 + index * 0.035) + exitPoof * (0.52 + index * 0.04)
      const active = Math.max(0, puffIn - puffOut) + snapKick
      setMeshOpacity(puff, burnCharging ? Math.min(0.52, active * 0.26 + snapKick * 0.22) * (1 - exitTuck * 0.38) : 0)
      puff.position.set(
        spec.x + spec.outX * (puffIn * 0.72 + snapPulse * 1.2 + exitPoof * 1.1) + exitOvershoot * 0.12 + Math.sin(t * 7.6 + spec.phase) * 0.006,
        spec.y + spec.outY * (puffIn * 0.74 + snapPulse * 1.2 + exitPoof * 1.1) - exitOvershoot * 0.1 + Math.cos(t * 6.4 + spec.phase) * 0.005,
        0.245,
      )
      const puffScale = spec.radius * (1 + puffIn * 1.2 + snapPulse * 1.8 + exitPoof * 2.1)
      puff.scale.set(puffScale * (1.22 + Math.sin(t * 5 + spec.phase) * 0.08), puffScale * (0.82 + Math.cos(t * 4.7 + spec.phase) * 0.06), 1)
      puff.rotation.z = Math.sin(t * 4.4 + spec.phase) * 0.2
    })

  })

  if (!item) return null

  return (
    <group ref={root} renderOrder={30}>
      <group ref={previewPanel}>
        <mesh ref={chargePressureShadow} position={[0, -1.08, 0.215]} renderOrder={34}>
          <circleGeometry args={[1, 48]} />
          {burnDetailPressureShadowMaterial()}
        </mesh>
        <mesh ref={chargeSnapFlash} position={[0, -0.08, 0.255]} renderOrder={37}>
          <circleGeometry args={[1, 48]} />
          {burnDetailSnapFlashMaterial()}
        </mesh>
        {chargeSmearSpecs.map((spec, index) => (
          <mesh
            key={`burn-detail-smear-${spec.phase}`}
            ref={(node) => {
              if (node) chargeSmears.current[index] = node
            }}
            position={[spec.x, spec.y, 0.242]}
            rotation={[0, 0, spec.rotation]}
            renderOrder={36}
          >
            <boxGeometry args={[spec.width, spec.height, 0.014]} />
            {burnDetailSmearMaterial()}
          </mesh>
        ))}
        {chargeArcSpecs.map((spec, index) => (
          <mesh
            key={`burn-detail-arc-${spec.phase}`}
            ref={(node) => {
              if (node) chargeArcMarks.current[index] = node
            }}
            position={[spec.x, spec.y, 0.252]}
            rotation={[0, 0, spec.rotation]}
            renderOrder={38}
          >
            <torusGeometry args={[1, 0.024, 6, 30, Math.PI * 0.72]} />
            <meshBasicMaterial color={spec.color} transparent opacity={0} depthWrite={false} depthTest={false} toneMapped={false} />
          </mesh>
        ))}
        {chargeDustPuffSpecs.map((spec, index) => (
          <mesh
            key={`burn-detail-dust-puff-${spec.phase}`}
            ref={(node) => {
              if (node) chargeDustPuffs.current[index] = node
            }}
            position={[spec.x, spec.y, 0.245]}
            renderOrder={36}
          >
            <circleGeometry args={[1, 18]} />
            {burnDetailDustPuffMaterial({ warm: spec.warm })}
          </mesh>
        ))}
        {chargeActionMarkSpecs.map((spec, index) => (
          <mesh
            key={`burn-detail-action-mark-${spec.phase}`}
            ref={(node) => {
              if (node) chargeActionMarks.current[index] = node
            }}
            position={[spec.x, spec.y, 0.25]}
            rotation={[0, 0, spec.rotation]}
            renderOrder={38}
          >
            <boxGeometry args={[spec.width, spec.height, 0.018]} />
            <meshBasicMaterial color={spec.color} transparent opacity={0} depthWrite={false} depthTest={false} toneMapped={false} />
          </mesh>
        ))}
        <mesh position={[0.1, -0.1, -0.16]} rotation={[0, 0, -0.025]} scale={[1.98, 1.45, 1]}>
          <circleGeometry args={[1, 32]} />
          {walletPlaqueShadowMaterial()}
        </mesh>
        <RoundedBox args={[3.34, 2.62, 0.18]} radius={0.17} smoothness={7} position={[0, 0, -0.035]}>
          {walletPlaqueOutlineMaterial()}
        </RoundedBox>
        <RoundedBox args={[3.12, 2.4, 0.16]} radius={0.14} smoothness={7} position={[0, 0, 0]}>
          {walletPlaqueWalnutMaterial()}
        </RoundedBox>
        <RoundedBox args={[2.32, 0.34, 0.1]} radius={0.08} smoothness={5} position={[0, 0.99, 0.075]}>
          {walletPlaqueFaceMaterial({ connected: true })}
        </RoundedBox>
        <MuseumBurnDetailTitle item={item} />
        <MuseumBurnBoxCostDisplay item={item} availableBoxCount={availableBoxCount} />
        {!soldOut && missingBoxCount > 0 ? <MuseumBurnShortageNotice missingBoxCount={missingBoxCount} availableBoxCount={availableBoxCount} requiredBoxCount={item.boxCost} /> : null}
        <RoundedBox args={[0.035, 1.42, 0.06]} radius={0.018} smoothness={3} position={[-0.12, -0.16, 0.13]}>
          {walletPlaqueBrassMaterial()}
        </RoundedBox>
        <RoundedBox args={[1.62, 1.5, 0.11]} radius={0.08} smoothness={5} position={[0.7, -0.16, 0.065]}>
          {walletPlaqueOutlineMaterial()}
        </RoundedBox>
        <RoundedBox args={[1.47, 1.35, 0.1]} radius={0.065} smoothness={5} position={[0.7, -0.16, 0.095]}>
          {walletPlaqueFaceMaterial({ connected: true })}
        </RoundedBox>
        <mesh position={[0.7, -0.16, 0.14]} scale={[0.88, 0.8, 1]}>
          <circleGeometry args={[1, 40]} />
          <meshBasicMaterial color={item.accent} transparent opacity={0.12} toneMapped={false} depthWrite={false} />
        </mesh>
        <group position={[0.7, -0.16, 0]} scale={[0.9, 0.9, 1]}>
          <MuseumArtPreviewImage item={item} />
        </group>
        {soldOut ? <MuseumSoldOutStamp position={[0.7, -0.16, 0.34]} rotationZ={-0.15} scale={1.06} /> : null}
        <MuseumBurnDetailButton
          label="BACK"
          width={0.98}
          position={[-0.58, -1.08, 0]}
          hovered={backHovered}
          pressed={backPressed}
          onPressStart={() => {
            setBackPressed(true)
          }}
          onPressEnd={() => {
            setBackPressed(false)
          }}
          onHoverStart={() => {
            setBackHovered(true)
          }}
          onHoverEnd={() => {
            setBackHovered(false)
            setBackPressed(false)
          }}
          onClick={() => {
            if (!burnCharging) onClose()
          }}
        />
        <MuseumBurnDetailButton
          label={soldOut ? 'SOLD OUT' : burnUnavailable ? `NEED ${missingBoxCount} MORE` : 'BURN'}
          width={1.54}
          position={[0.62, -1.08, 0]}
          variant="burn"
          disabled={burnUnavailable}
          charging={burnCharging}
          hovered={burnHovered}
          pressed={burnPressed}
          onPressStart={() => {
            setBurnPressed(true)
          }}
          onPressEnd={() => {
            setBurnPressed(false)
          }}
          onHoverStart={() => {
            setBurnHovered(true)
          }}
          onHoverEnd={() => {
            setBurnHovered(false)
            setBurnPressed(false)
          }}
          onClick={() => {
            if (burnCharging) return
            if (burnUnavailable) return
            burnChargeItem.current = item
            burnChargeStart.current = null
            if (burnChargeTimeout.current !== null) {
              window.clearTimeout(burnChargeTimeout.current)
            }
            setBackPressed(false)
            setBurnPressed(false)
            setBurnCharging(true)
            burnChargeTimeout.current = window.setTimeout(() => {
              burnChargeTimeout.current = null
              onBurn(burnChargeItem.current ?? item)
            }, BURN_DETAIL_CHARGE_DURATION * 1000)
          }}
        />
      </group>
    </group>
  )
}

function MuseumBurnDetailTitle({ item }: { item: BurnCatalogItem }) {
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null

    const canvas = document.createElement('canvas')
    canvas.width = 1400
    canvas.height = 220
    const context = canvas.getContext('2d')
    if (!context) return null

    context.clearRect(0, 0, canvas.width, canvas.height)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#17121f'
    context.font = '900 106px Arial Black, Georgia, serif'
    context.fillText(item.title, canvas.width / 2, 112)

    const titleTexture = new THREE.CanvasTexture(canvas)
    titleTexture.colorSpace = THREE.SRGBColorSpace
    titleTexture.needsUpdate = true
    return titleTexture
  }, [item])

  useEffect(() => {
    return () => {
      texture?.dispose()
    }
  }, [texture])

  if (!texture) return null

  return (
    <mesh position={[0, 0.99, 0.132]}>
      <planeGeometry args={[2.02, 0.25]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

function MuseumBurnShortageNotice({
  missingBoxCount,
  availableBoxCount,
  requiredBoxCount,
}: {
  missingBoxCount: number
  availableBoxCount: number
  requiredBoxCount: number
}) {
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null

    const canvas = document.createElement('canvas')
    canvas.width = 1300
    canvas.height = 260
    const context = canvas.getContext('2d')
    if (!context) return null

    const label = `${availableBoxCount} / ${requiredBoxCount} BOXES - NEED ${missingBoxCount} MORE`
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#17121f'
    context.font = '900 78px Arial Black, Georgia, serif'
    context.fillText(label, canvas.width / 2, 132)

    const labelTexture = new THREE.CanvasTexture(canvas)
    labelTexture.colorSpace = THREE.SRGBColorSpace
    labelTexture.needsUpdate = true
    return labelTexture
  }, [availableBoxCount, missingBoxCount, requiredBoxCount])

  useEffect(() => {
    return () => {
      texture?.dispose()
    }
  }, [texture])

  if (!texture) return null

  return (
    <group position={[0.62, -0.79, 0.148]}>
      <RoundedBox args={[1.54, 0.25, 0.07]} radius={0.06} smoothness={5} position={[0, 0, -0.012]}>
        {walletPlaqueOutlineMaterial()}
      </RoundedBox>
      <RoundedBox args={[1.42, 0.16, 0.058]} radius={0.045} smoothness={5} position={[0, 0, 0.03]}>
        {burnDetailDisabledButtonInsetMaterial({ hovered: true })}
      </RoundedBox>
      <mesh position={[0, 0, 0.066]}>
        <planeGeometry args={[1.28, 0.15]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  )
}

function MuseumBurnBoxCostDisplay({ item, availableBoxCount }: { item: BurnCatalogItem; availableBoxCount: number }) {
  const boxRefs = useRef<THREE.Group[]>([])
  const ringRefs = useRef<THREE.Mesh[]>([])
  const boxCount = Math.min(item.boxCost, 2)
  const missingBoxCount = Math.max(0, item.boxCost - availableBoxCount)
  const unavailable = missingBoxCount > 0

  useFrame(({ clock }) => {
    const t = clock.elapsedTime

    boxRefs.current.forEach((box, index) => {
      if (!box) return
      const twoBoxOffset = boxCount === 2 ? (index === 0 ? -0.24 : 0.24) : 0
      const phase = index * Math.PI + (item.id === 'gilded-seal' ? 0.3 : 0)
      const orbit = Math.sin(t * 1.35 + phase) * 0.052
      const bob = Math.sin(t * 2.15 + phase) * 0.044
      const depth = Math.cos(t * 1.35 + phase) * 0.06

      box.position.set(twoBoxOffset + orbit, 0.03 + bob, 0.205 + depth)
      box.rotation.set(
        0.16 + Math.sin(t * 1.95 + phase) * 0.09,
        t * 1.28 + phase,
        Math.sin(t * 1.55 + phase) * 0.12,
      )
      const missing = index >= availableBoxCount
      const pulse = (missing ? 0.82 : 1) + Math.sin(t * 2.35 + phase) * 0.025
      box.scale.setScalar(pulse)
    })

    ringRefs.current.forEach((ring, index) => {
      if (!ring) return
      const phase = index * Math.PI
      const pulse = 1 + Math.sin(t * 2 + phase) * 0.08
      ring.scale.set(0.42 * pulse, 0.13 * (1 / pulse), 1)
      ring.rotation.z = Math.sin(t * 0.72 + phase) * 0.08
    })
  })

  return (
    <group position={[-0.84, -0.16, 0]}>
      <RoundedBox args={[1.16, 1.5, 0.11]} radius={0.08} smoothness={5} position={[0, 0, 0.065]}>
        {walletPlaqueOutlineMaterial()}
      </RoundedBox>
      <RoundedBox args={[1.02, 1.36, 0.1]} radius={0.065} smoothness={5} position={[0, 0, 0.095]}>
        {walletPlaqueFaceMaterial({ connected: true })}
      </RoundedBox>
      <RoundedBox args={[0.72, 0.07, 0.055]} radius={0.03} smoothness={4} position={[0, 0.565, 0.145]}>
        {walletPlaqueBrassMaterial()}
      </RoundedBox>
      <group position={[0, -0.02, 0.16]}>
        <mesh
          ref={(node) => {
            if (node) ringRefs.current[0] = node
          }}
          position={[0, -0.43, 0.018]}
        >
          <circleGeometry args={[1, 40]} />
        <meshBasicMaterial color="#fff0a8" transparent opacity={0.2} toneMapped={false} depthWrite={false} />
      </mesh>
      {unavailable ? (
        <mesh position={[0.24, -0.06, 0.072]} rotation={[0, 0, -0.34]} scale={[0.34, 0.04, 0.014]} renderOrder={32}>
          <boxGeometry args={[1, 1, 1]} />
          {burnDetailDisabledButtonMaterial({ hovered: true })}
        </mesh>
      ) : null}
      <mesh
          ref={(node) => {
            if (node) ringRefs.current[1] = node
          }}
          position={[0, -0.422, 0.026]}
        >
          <circleGeometry args={[1, 36]} />
          <meshBasicMaterial color={item.accent} transparent opacity={0.15} toneMapped={false} depthWrite={false} />
        </mesh>
        {Array.from({ length: boxCount }).map((_, index) => (
          <group
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            ref={(node) => {
              if (node) boxRefs.current[index] = node
            }}
            scale={boxCount === 2 ? 0.68 : 0.86}
          >
            <group position={[0, -0.54, 0]}>
              <VacuumStylePurpleBox />
            </group>
          </group>
        ))}
      </group>
      <RoundedBox args={[0.72, 0.07, 0.055]} radius={0.03} smoothness={4} position={[0, -0.595, 0.145]}>
        {walletPlaqueBrassMaterial()}
      </RoundedBox>
    </group>
  )
}

function MuseumArtPreviewImage({ item }: { item: BurnCatalogItem }) {
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null

    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 1024
    const context = canvas.getContext('2d')
    if (!context) return null

    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = item.id === 'gilded-seal' ? '#241723' : '#efe5c7'
    context.fillRect(0, 0, canvas.width, canvas.height)

    if (item.id === 'gilded-seal') {
      for (let index = 0; index < 18; index += 1) {
        context.save()
        context.translate(512, 520)
        context.rotate((index / 18) * Math.PI * 2)
        context.fillStyle = index % 2 === 0 ? '#6f4c12' : '#8a5a24'
        context.beginPath()
        context.moveTo(0, 0)
        context.lineTo(54, -470)
        context.lineTo(-54, -470)
        context.closePath()
        context.fill()
        context.restore()
      }
      context.fillStyle = '#17121f'
      context.beginPath()
      context.arc(512, 518, 292, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#d6b55b'
      context.beginPath()
      context.arc(512, 518, 258, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#fff1a2'
      context.beginPath()
      context.arc(452, 448, 92, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#8a5a24'
      context.beginPath()
      context.arc(512, 518, 158, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#17121f'
      context.font = '900 116px Arial Black, Georgia, serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText('VH', 512, 520)
      context.fillStyle = '#c6efe1'
      context.fillRect(304, 770, 416, 54)
      context.fillStyle = '#17121f'
      context.font = '900 42px Arial Black, Georgia, serif'
      context.fillText('GOLD SEAL', 512, 798)
    } else {
      context.fillStyle = '#17121f'
      context.fillRect(138, 132, 748, 762)
      context.fillStyle = '#c6efe1'
      context.fillRect(178, 166, 668, 692)
      context.fillStyle = '#2f7168'
      context.fillRect(220, 218, 220, 590)
      context.fillStyle = '#d6b55b'
      context.fillRect(254, 262, 124, 34)
      context.fillRect(254, 330, 124, 34)
      context.fillStyle = '#efe5c7'
      context.fillRect(484, 236, 298, 58)
      context.fillRect(484, 340, 258, 34)
      context.fillRect(484, 414, 308, 34)
      context.fillRect(484, 488, 226, 34)
      context.strokeStyle = '#17121f'
      context.lineWidth = 20
      context.strokeRect(210, 208, 596, 612)
      context.fillStyle = '#17121f'
      context.font = '900 76px Arial Black, Georgia, serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText('MUSEUM TAG', 512, 710)
      context.fillStyle = '#d6b55b'
      context.beginPath()
      context.arc(690, 594, 78, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#17121f'
      context.font = '900 52px Arial Black, Georgia, serif'
      context.fillText('01', 690, 596)
    }

    const artTexture = new THREE.CanvasTexture(canvas)
    artTexture.colorSpace = THREE.SRGBColorSpace
    artTexture.needsUpdate = true
    return artTexture
  }, [item])

  useEffect(() => {
    return () => {
      texture?.dispose()
    }
  }, [texture])

  if (!texture) return null

  return (
    <mesh position={[0, -0.04, 0.158]}>
      <planeGeometry args={[1.38, 1.22]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

function MuseumBurnDetailButton({
  label,
  width,
  position,
  variant = 'quiet',
  disabled = false,
  charging = false,
  hovered,
  pressed,
  onClick,
  onPressStart,
  onPressEnd,
  onHoverStart,
  onHoverEnd,
}: {
  label: string
  width: number
  position: [number, number, number]
  variant?: 'quiet' | 'burn'
  disabled?: boolean
  charging?: boolean
  hovered: boolean
  pressed: boolean
  onClick: () => void
  onPressStart: () => void
  onPressEnd: () => void
  onHoverStart: () => void
  onHoverEnd: () => void
}) {
  const button = useRef<THREE.Group>(null)
  const deniedPulse = useRef(0)

  useFrame(({ clock }, dt) => {
    const buttonNode = button.current
    if (!buttonNode) return

    deniedPulse.current = Math.max(0, deniedPulse.current - dt * 3.6)
    const denied = deniedPulse.current
    const rejectShake = disabled && denied > 0 ? Math.sin(clock.elapsedTime * 78) * denied * 0.026 : 0
    const rejectLift = disabled && denied > 0 ? Math.sin((1 - denied) * Math.PI) * 0.025 : 0
    const hoverScale = hovered && !disabled ? 1.04 : hovered ? 1.012 : 1
    const rejectScale = disabled && denied > 0 ? 1 + Math.sin((1 - denied) * Math.PI) * 0.035 : 1
    const chargeWobble = charging && !disabled ? Math.sin(clock.elapsedTime * 18.5) * 0.013 + Math.sin(clock.elapsedTime * 9.2) * 0.008 : 0
    const chargeLift = charging && !disabled ? Math.cos(clock.elapsedTime * 13.4) * 0.01 : 0
    const chargeScaleX = charging && !disabled ? 1.03 + Math.sin(clock.elapsedTime * 12.5) * 0.026 : 1
    const chargeScaleY = charging && !disabled ? 0.975 + Math.cos(clock.elapsedTime * 12.5) * 0.018 : 1
    const pressDepth = pressed && !disabled ? -0.035 : 0

    buttonNode.position.set(position[0] + rejectShake + chargeWobble, position[1] + rejectLift + chargeLift, position[2] + pressDepth)
    buttonNode.scale.set(hoverScale * rejectScale * chargeScaleX, hoverScale * rejectScale * chargeScaleY, hoverScale * rejectScale)
  })

  return (
    <group
      ref={button}
      position={position}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (disabled) {
          deniedPulse.current = 1
          return
        }
        onPressStart()
      }}
      onPointerUp={(event) => {
        event.stopPropagation()
        if (disabled) {
          deniedPulse.current = 1
          onPressEnd()
          return
        }
        onPressEnd()
        onClick()
      }}
      onPointerCancel={(event) => {
        event.stopPropagation()
        onPressEnd()
      }}
      onPointerOver={(event) => {
        event.stopPropagation()
        onHoverStart()
      }}
      onPointerOut={(event) => {
        event.stopPropagation()
        onHoverEnd()
      }}
    >
      <RoundedBox args={[width, 0.34, 0.12]} radius={0.082} smoothness={5} position={[0, -0.006, -0.018]}>
        {walletPlaqueOutlineMaterial()}
      </RoundedBox>
      <RoundedBox args={[width - 0.14, 0.245, 0.1]} radius={0.065} smoothness={5} position={[0, 0, 0.052]}>
        {disabled
          ? hovered ? burnDetailDisabledButtonInsetMaterial({ hovered }) : burnDetailDisabledButtonMaterial({ hovered })
          : variant === 'burn'
          ? hovered ? walletPlaqueFaceMaterial({ connected: true }) : walletPlaqueBrassMaterial()
          : hovered ? walletPlaqueInsetMaterial({ connected: true }) : walletPlaqueFaceMaterial({ connected: true })}
      </RoundedBox>
      <MuseumBurnDetailButtonLabel label={label} width={width - 0.2} />
    </group>
  )
}

function MuseumBurnDetailButtonLabel({
  label,
  width,
}: {
  label: string
  width: number
}) {
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null

    const canvas = document.createElement('canvas')
    canvas.width = 760
    canvas.height = 200
    const context = canvas.getContext('2d')
    if (!context) return null

    context.clearRect(0, 0, canvas.width, canvas.height)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#17121f'
    let fontSize = 92
    context.font = `900 ${fontSize}px Arial Black, Georgia, serif`
    const maxTextWidth = canvas.width * 0.84
    const measuredTextWidth = context.measureText(label).width
    if (measuredTextWidth > maxTextWidth) {
      fontSize *= maxTextWidth / measuredTextWidth
      context.font = `900 ${fontSize}px Arial Black, Georgia, serif`
    }
    context.fillText(label, canvas.width / 2, canvas.height / 2)

    const labelTexture = new THREE.CanvasTexture(canvas)
    labelTexture.colorSpace = THREE.SRGBColorSpace
    labelTexture.needsUpdate = true
    return labelTexture
  }, [label])

  useEffect(() => {
    return () => {
      texture?.dispose()
    }
  }, [texture])

  if (!texture) return null

  return (
    <mesh position={[0, 0, 0.116]}>
      <planeGeometry args={[width, 0.215]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

function RitualRunController({
  sequenceStart,
  activeBoxIndexRef,
  carryoverSequencesRef,
  runActive,
  runNonce,
  startIndex,
  targetCount,
  completedCount,
  onCycleComplete,
  onRunComplete,
}: {
  sequenceStart: DropSequenceStart
  activeBoxIndexRef: MutableRefObject<number>
  carryoverSequencesRef: CarryoverBoxSequencesRef
  runActive: boolean
  runNonce: number
  startIndex: number
  targetCount: number
  completedCount: number
  onCycleComplete: (completedCount: number) => void
  onRunComplete: () => void
}) {
  const lastRunNonce = useRef(runNonce)
  const completedCountRef = useRef(completedCount)
  const cycleLocked = useRef(false)
  const finalSettleUntil = useRef<number | null>(null)

  useEffect(() => {
    completedCountRef.current = completedCount
  }, [completedCount])

  useEffect(() => {
    if (lastRunNonce.current === runNonce) return
    lastRunNonce.current = runNonce
    activeBoxIndexRef.current = startIndex
    carryoverSequencesRef.current = []
    completedCountRef.current = 0
    cycleLocked.current = false
    finalSettleUntil.current = null
    sequenceStart.current = null
  }, [activeBoxIndexRef, carryoverSequencesRef, runNonce, sequenceStart, startIndex])

  useFrame(({ clock }) => {
    if (!runActive || targetCount <= 0) {
      if (finalSettleUntil.current !== null && clock.elapsedTime < finalSettleUntil.current) {
        return
      }
      finalSettleUntil.current = null
      sequenceStart.current = null
      activeBoxIndexRef.current = startIndex
      carryoverSequencesRef.current = []
      cycleLocked.current = false
      return
    }

    pruneCarryoverBoxSequences(clock.elapsedTime, carryoverSequencesRef)

    if (sequenceStart.current === null) {
      sequenceStart.current = clock.elapsedTime - BOX_RUN_START_TIME
      cycleLocked.current = false
    }

    const elapsed = getSequenceElapsed(clock.elapsedTime, sequenceStart)
    const nextCompletedCount = completedCountRef.current + 1
    const finalCycle = nextCompletedCount >= targetCount
    const cycleEndTime = finalCycle ? BOX_DROP_DURATION : BOX_NEXT_PICKUP_RESTART_TIME

    if (elapsed < cycleEndTime - 0.001) {
      cycleLocked.current = false
      return
    }

    if (cycleLocked.current) return
    cycleLocked.current = true

    completedCountRef.current = nextCompletedCount
    onCycleComplete(nextCompletedCount)

    if (finalCycle) {
      carryoverSequencesRef.current = []
      finalSettleUntil.current = clock.elapsedTime + BOX_FINAL_RUN_SETTLE_TIME
      onRunComplete()
      return
    }

    if (sequenceStart.current !== null) {
      carryoverSequencesRef.current = [
        ...carryoverSequencesRef.current,
        {
          sequenceStart: sequenceStart.current,
          slotIndex: activeBoxIndexRef.current,
        },
      ]
    }

    activeBoxIndexRef.current = startIndex + nextCompletedCount
    sequenceStart.current = clock.elapsedTime - BOX_RUN_START_TIME
    cycleLocked.current = false
  }, -10)

  return null
}

export function VacuumBurnRoomExperience({
  walletConnected: controlledWalletConnected,
  availableBoxCount: controlledAvailableBoxCount,
  soldOutItemIds: controlledSoldOutItemIds,
  showDevSoldOutSwitch = true,
  onConnectWallet,
  onBurnRequested,
  burn2Remaining = 5,
  burn1Open = true,
}: VacuumBurnRoomExperienceProps = {}) {
  const runtime = useRef(createRuntime())
  const dropSequenceStart = useRef<number | null>(null)
  const activeBoxIndexRef = useRef(0)
  const carryoverSequencesRef = useRef<CarryoverBoxSequence[]>([])
  const pendingBurnItemRef = useRef<BurnCatalogItem | null>(null)
  const previousControlledAvailableBoxCount = useRef(controlledAvailableBoxCount)
  const orbitControlsRef = useRef<OrbitControlsImpl | null>(null)
  const boxDropReplayKey = 0
  const [demoWalletConnected, setDemoWalletConnected] = useState(false)
  const [selectedBurnItemId, setSelectedBurnItemId] = useState<BurnCatalogItemId>(DEFAULT_BURN_CATALOG_ITEM_ID)
  const [burnDetailItemId, setBurnDetailItemId] = useState<BurnCatalogItemId | null>(null)
  const [burnPickerOpen, setBurnPickerOpen] = useState(false)
  const [devSoldOut, setDevSoldOut] = useState(false)
  const [runActive, setRunActive] = useState(false)
  const [runTargetCount, setRunTargetCount] = useState(0)
  const [burnedWalletBoxCount, setBurnedWalletBoxCount] = useState(0)
  const [runCompletedBurnCount, setRunCompletedBurnCount] = useState(0)
  const [runNonce, setRunNonce] = useState(0)
  const walletConnected = controlledWalletConnected ?? demoWalletConnected
  const controlledVisibleBoxCount =
    controlledAvailableBoxCount === undefined
      ? DEMO_WALLET_BOX_COUNT
      : Math.max(0, Math.min(DEMO_WALLET_BOX_COUNT, Math.floor(controlledAvailableBoxCount)))
  const externalHiddenWalletBoxCount =
    controlledAvailableBoxCount === undefined ? 0 : DEMO_WALLET_BOX_COUNT - controlledVisibleBoxCount
  const committedHiddenWalletBoxCount = Math.min(DEMO_WALLET_BOX_COUNT, externalHiddenWalletBoxCount + burnedWalletBoxCount)
  const soldOutItemIds = controlledSoldOutItemIds ?? (devSoldOut ? BURN_CATALOG_ITEMS.map((item) => item.id) : [])
  const hiddenWalletBoxCount = Math.min(DEMO_WALLET_BOX_COUNT, committedHiddenWalletBoxCount + runCompletedBurnCount)
  const availableWalletBoxCount = Math.max(0, DEMO_WALLET_BOX_COUNT - hiddenWalletBoxCount)

  useEffect(() => {
    if (previousControlledAvailableBoxCount.current === controlledAvailableBoxCount) return
    previousControlledAvailableBoxCount.current = controlledAvailableBoxCount
    setBurnedWalletBoxCount(0)
    setRunCompletedBurnCount(0)
  }, [controlledAvailableBoxCount])

  function startBurnRun(item: BurnCatalogItem) {
    const count = item.boxCost
    const remainingBoxes = Math.max(0, availableWalletBoxCount)
    if (count <= 0 || count > remainingBoxes) return

    const targetCount = count
    pendingBurnItemRef.current = item
    activeBoxIndexRef.current = committedHiddenWalletBoxCount
    carryoverSequencesRef.current = []
    runtime.current.swallowCycles = 0
    runtime.current.gulpFlow = 0
    runtime.current.gulpAge = 9
    setRunTargetCount(targetCount)
    setRunCompletedBurnCount(0)
    setRunActive(targetCount > 0)
    dropSequenceStart.current = null
    setRunNonce((nonce) => nonce + 1)
  }

  return (
    <BurnStatusContext.Provider value={{ burn2Remaining, burn1Open }}>
    <div
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        overflow: 'hidden',
        background: '#aec9bf',
        cursor: 'none',
      }}
    >
      <Canvas
        dpr={[1.5, 2]}
        camera={{ fov: 41, position: [1.45, 6.1, 12.5], near: 0.1, far: 30 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        style={{ cursor: 'none' }}
      >
        <color attach="background" args={['#aec9bf']} />
        <InspectionCamera />
        <KeyboardCameraControls controlsRef={orbitControlsRef} />
        <RitualRunController
          sequenceStart={dropSequenceStart}
          activeBoxIndexRef={activeBoxIndexRef}
          carryoverSequencesRef={carryoverSequencesRef}
          runActive={runActive}
          runNonce={runNonce}
          startIndex={committedHiddenWalletBoxCount}
          targetCount={runTargetCount}
          completedCount={runCompletedBurnCount}
          onCycleComplete={(nextCompletedCount) => {
            setRunCompletedBurnCount(nextCompletedCount)
          }}
          onRunComplete={() => {
            const completedItem = pendingBurnItemRef.current
            setBurnedWalletBoxCount((currentCount) => Math.min(DEMO_WALLET_BOX_COUNT, currentCount + runTargetCount))
            setRunCompletedBurnCount(0)
            setRunActive(false)
            pendingBurnItemRef.current = null
            if (completedItem && onBurnRequested) {
              void onBurnRequested({
                source: 'vacuum-head-box-ritual',
                boxId: completedItem.id,
                itemId: completedItem.id,
                itemTitle: completedItem.title,
                tier: completedItem.boxCost,
                boxCount: completedItem.boxCost,
                visualState: 'burn-complete',
              })
            }
          }}
        />
        <InspectionPose
          runtime={runtime}
          sequenceStart={dropSequenceStart}
          activeBoxIndexRef={activeBoxIndexRef}
          runStartIndex={committedHiddenWalletBoxCount}
        />
        <ambientLight intensity={0.42} />
        <hemisphereLight color="#ffe8bd" groundColor="#405f63" intensity={0.19} />
        <directionalLight position={[-2.8, 4.2, 4.4]} intensity={0.86} color="#ffe0b0" />
        <directionalLight position={[3.8, 2.6, -2.4]} intensity={0.26} color="#73c7d7" />
        <pointLight position={[ROOM_LEFT_X + 3.12, 1.58, ROOM_BACK_Z + 0.55]} intensity={0.18} color="#ffd982" distance={3.6} decay={2} />
        <pointLight position={[ROOM_RIGHT_X - 3.16, 1.58, ROOM_BACK_Z + 0.55]} intensity={0.18} color="#ffd982" distance={3.6} decay={2} />
        <pointLight position={[ROOM_RIGHT_X - 1.18, 1.25, ROOM_BACK_Z + 0.75]} intensity={0.2} color="#ffd174" distance={4.25} decay={2} />
        <pointLight position={[TRAPDOOR_POSITION[0] - 0.04, ROOM_FLOOR_Y + 0.18, TRAPDOOR_POSITION[2] - 0.06]} intensity={0.12} color="#ff8f2f" distance={2.6} decay={2} />
        <RitualPolishFx sequenceStart={dropSequenceStart} carryoverSequencesRef={carryoverSequencesRef} activeBoxIndexRef={activeBoxIndexRef} />
        <MuseumStageBackdrop />
        <ToonRoomShell />
        <group scale={VACUUM_STAGE_SCALE} position={VACUUM_STAGE_POSITION}>
          <VacuumBody runtime={runtime} />
          <VacuumBagSuctionGlow runtime={runtime} />
        </group>
        <DropReactiveTable
          replayKey={boxDropReplayKey}
          sequenceStart={dropSequenceStart}
          impactEnabled={!walletConnected}
          walletConnected={walletConnected}
        />
        <CeilingTrapdoor replayKey={boxDropReplayKey} sequenceStart={dropSequenceStart} walletConnected={walletConnected} />
        <ConveyorBeltBuild sequenceStart={dropSequenceStart} />
        <GroundTrapdoor replayKey={boxDropReplayKey} sequenceStart={dropSequenceStart} carryoverSequencesRef={carryoverSequencesRef} />
        <DropImpactFx replayKey={boxDropReplayKey} sequenceStart={dropSequenceStart} impactEnabled={!walletConnected} />
        <WalletAssetTableBoxes
          walletConnected={walletConnected}
          hiddenCount={hiddenWalletBoxCount}
          runActive={runActive}
          activeBoxIndexRef={activeBoxIndexRef}
          sequenceStart={dropSequenceStart}
        />
        <BoxSuctionRibbons
          replayKey={boxDropReplayKey}
          sequenceStart={dropSequenceStart}
          activeBoxIndexRef={activeBoxIndexRef}
          runStartIndex={committedHiddenWalletBoxCount}
        />
        <BoxHoseContactSeal
          replayKey={boxDropReplayKey}
          sequenceStart={dropSequenceStart}
          activeBoxIndexRef={activeBoxIndexRef}
          runStartIndex={committedHiddenWalletBoxCount}
        />
        <BoxBurnVanishFx replayKey={boxDropReplayKey} sequenceStart={dropSequenceStart} carryoverSequencesRef={carryoverSequencesRef} />
        <ConveyorBurnCarryoverBoxes carryoverSequencesRef={carryoverSequencesRef} />
        <AnimatedDropBox
          replayKey={boxDropReplayKey}
          sequenceStart={dropSequenceStart}
          activeBoxIndexRef={activeBoxIndexRef}
          runStartIndex={committedHiddenWalletBoxCount}
        />
        <MuseumWalletConnectButton
          connected={walletConnected}
          onConnect={() => {
            if (controlledWalletConnected === undefined) setDemoWalletConnected(true)
            void onConnectWallet?.()
            setRunActive(false)
            setRunTargetCount(0)
            setBurnedWalletBoxCount(0)
            setRunCompletedBurnCount(0)
            setBurnDetailItemId(null)
            setBurnPickerOpen(false)
            activeBoxIndexRef.current = 0
            carryoverSequencesRef.current = []
            dropSequenceStart.current = null
          }}
        />
        {walletConnected && burnDetailItemId === null && !burnPickerOpen ? (
          <MuseumBurnLaunchButton
            onOpen={() => {
              setBurnPickerOpen(true)
            }}
          />
        ) : null}
        {walletConnected && burnDetailItemId === null && burnPickerOpen ? (
          <MuseumBurnCatalogSelector
            selectedItemId={selectedBurnItemId}
            availableBoxCount={availableWalletBoxCount}
            soldOutItemIds={soldOutItemIds}
            onSelect={(item) => {
              setSelectedBurnItemId(item.id)
              setBurnDetailItemId(item.id)
              setBurnPickerOpen(false)
            }}
          />
        ) : null}
        <MuseumBurnDetailWindow
          item={burnDetailItemId === null ? null : getBurnCatalogItem(burnDetailItemId)}
          availableBoxCount={availableWalletBoxCount}
          soldOut={burnDetailItemId !== null && soldOutItemIds.includes(burnDetailItemId)}
          onClose={() => {
            setBurnDetailItemId(null)
            setBurnPickerOpen(true)
          }}
          onBurn={(item) => {
            setSelectedBurnItemId(item.id)
            setBurnDetailItemId(null)
            setBurnPickerOpen(false)
            startBurnRun(item)
          }}
        />
        <MuseumToonCursor />
        <OrbitControls
          ref={orbitControlsRef}
          makeDefault
          target={BOX_TARGET}
          enableDamping
          dampingFactor={0.12}
          enablePan={false}
          minDistance={2.8}
          maxDistance={22}
          minPolarAngle={0.25}
          maxPolarAngle={Math.PI * 0.5}
          minAzimuthAngle={-0.5}
          maxAzimuthAngle={0.5}
        />
      </Canvas>
      {showDevSoldOutSwitch ? (
        <button
          type="button"
          aria-pressed={devSoldOut}
          onClick={() => {
            setDevSoldOut((soldOut) => !soldOut)
          }}
          style={{
            position: 'fixed',
            top: 18,
            right: 18,
            zIndex: 10,
            padding: '10px 16px',
            border: '3px solid #17121f',
            borderRadius: 6,
            background: devSoldOut ? '#c43426' : '#d4dde0',
            boxShadow: '4px 4px 0 #17121f',
            color: devSoldOut ? '#fff0a8' : '#17121f',
            cursor: 'none',
            fontFamily: 'inherit',
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: 0,
            textTransform: 'uppercase',
          }}
        >
          Dev sold out: {devSoldOut ? 'on' : 'off'}
        </button>
      ) : null}
    </div>
  )
}
