export const PALETTE = {
  outline: '#101113',
  uiSteel: '#4C6B7B',
  uiDark: '#263B45',
  warningYellow: '#F2C230',
  boneYellow: '#F1D67A',
  bone: '#F8E6B0',
  hauntedFloor: '#5C526D',
  deepPurple: '#2B2638',
  drainGreen: '#4E7D54',
  murkBlue: '#304E65',
  plankPurple: '#6B5B83',
  rust: '#9A4A35',
  asphaltInk: '#1D1C24',
  offWhite: '#FFF5C8',
  slimeMagenta: '#D238B6',
  slimeLime: '#9CDE36',
  slimeCyan: '#21B4D8',
} as const

export const SLIME_FAMILIES = [
  ['#D238B6', '#9CDE36', '#21B4D8', '#F2C230', '#5C526D'],
  ['#21B4D8', '#7C6B9A', '#9CDE36', '#F8E6B0', '#2B2638'],
  ['#9CDE36', '#D238B6', '#F1D67A', '#21B4D8', '#304E65'],
  ['#F2C230', '#D238B6', '#9CDE36', '#6B5B83', '#101113'],
] as const

export type SlimePalette = (typeof SLIME_FAMILIES)[number]
