// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
type Rgb = readonly [number, number, number]

export const WING_SHAPES = [
  'circuit',
  'puffs',
  'feathers',
  'bones',
  'aurora',
  'surf',
  'fin',
  'shards',
  'fronds',
  'slats',
  'shadow',
  'candles',
] as const
export const WING_TRAILS = ['dashes', 'smoke', 'ribbon', 'wisps', 'streaks', 'embers'] as const

export type PetWingStyle = Readonly<{
  shape: (typeof WING_SHAPES)[number]
  trail: (typeof WING_TRAILS)[number]
  primary: Rgb
  secondary: Rgb
  shade: Rgb
  variant: number
  scale: number
}>
export type PetWingsRender = PetWingStyle & Readonly<{ deployed: boolean }>
