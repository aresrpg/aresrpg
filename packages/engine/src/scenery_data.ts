// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { EngineQuality, Vec3 } from './types.ts'

export type Waterfall = Readonly<{ top: Vec3; bottom_y: number; width: number; yaw: number }>
export type SceneryVolume = Readonly<{ center: Vec3; size: Vec3 }>
export type HangingVine = Readonly<{ top: Vec3; length: number; yaw: number }>
export type SceneryGlow = Readonly<{ center: Vec3; size: number; color: Vec3; range?: number }>
export type SceneryFire = Readonly<{ center: Vec3; scale: number }>
export type SceneryPlant = Readonly<{
  kind: 'fern' | 'bush' | 'mushroom' | 'spike' | 'icicle' | 'grass' | 'pine' | 'mineral' | 'rock'
  center: Vec3
  scale: number
  color: Vec3
  accent: Vec3
  glow?: number
}>
export type WorldScenery = Readonly<{
  waterfalls: readonly Waterfall[]
  spores: readonly SceneryVolume[]
  butterflies?: readonly SceneryVolume[]
  vines: readonly HangingVine[]
  light_shafts?: readonly SceneryVolume[]
  snow?: readonly SceneryVolume[]
  mist?: readonly SceneryVolume[]
  plants?: readonly SceneryPlant[]
  glows?: readonly SceneryGlow[]
  fires?: readonly SceneryFire[]
}>

export const SCENERY_LIGHT_BUDGET = Object.freeze({ low: 1, medium: 2, high: 4 })

export const SCENERY_BUDGET = Object.freeze({
  low: { mist_per_volume: 2, spores_per_volume: 16 },
  medium: { mist_per_volume: 4, spores_per_volume: 48 },
  high: { mist_per_volume: 8, spores_per_volume: 96 },
} satisfies Record<EngineQuality, Readonly<{ mist_per_volume: number; spores_per_volume: number }>>)

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' ? (value as Readonly<Record<string, unknown>>) : {}
const vector = (value: unknown): value is Vec3 =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((entry) => typeof entry === 'number' && Number.isFinite(entry) && Math.abs(entry) <= 20_000)
const bounded = (value: unknown, min: number, max: number): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

const valid_fall = (value: unknown): boolean => {
  const row = record(value)
  return (
    vector(row.top) &&
    bounded(row.top[1], 1, 383) &&
    bounded(row.bottom_y, 0, row.top[1] - 1) &&
    bounded(row.width, 1, 64) &&
    bounded(row.yaw, -Math.PI * 2, Math.PI * 2)
  )
}
const valid_volume = (value: unknown): boolean => {
  const row = record(value)
  return (
    vector(row.center) &&
    bounded(row.center[1], 0, 383) &&
    vector(row.size) &&
    row.size.every((size) => size > 0 && size <= 128)
  )
}

const valid_vine = (value: unknown): boolean => {
  const row = record(value)
  return (
    vector(row.top) &&
    bounded(row.top[1], 1, 383) &&
    bounded(row.length, 1, Math.min(32, row.top[1])) &&
    bounded(row.yaw, -Math.PI * 2, Math.PI * 2)
  )
}

const valid_glow = (value: unknown): boolean => {
  const row = record(value)
  return (
    (row.range === undefined || bounded(row.range, 1, 32)) &&
    vector(row.center) &&
    vector(row.color) &&
    row.color.every((channel) => channel >= 0 && channel <= 4) &&
    bounded(row.size, 0.1, 8)
  )
}

const valid_color = (value: unknown): boolean => vector(value) && value.every((channel) => channel >= 0 && channel <= 4)

const valid_fire = (value: unknown): boolean => {
  const row = record(value)
  return vector(row.center) && bounded(row.center[1], 0, 370) && bounded(row.scale, 0.1, 3)
}

const valid_plant = (value: unknown): boolean => {
  const row = record(value)
  return (
    ['fern', 'bush', 'mushroom', 'spike', 'icicle', 'grass', 'pine', 'mineral', 'rock'].includes(String(row.kind)) &&
    vector(row.center) &&
    valid_color(row.color) &&
    valid_color(row.accent) &&
    bounded(row.scale, 0.1, 5) &&
    bounded(row.glow ?? 0, 0, 2)
  )
}

export const validate_scenery = (value: unknown): readonly string[] => {
  if (value === undefined) return []
  const row = record(value)
  const collections = [
    { name: 'waterfalls', limit: 12, valid: valid_fall, optional: false },
    { name: 'spores', limit: 8, valid: valid_volume, optional: false },
    { name: 'butterflies', limit: 4, valid: valid_volume, optional: true },
    { name: 'vines', limit: 384, valid: valid_vine, optional: false },
    { name: 'light_shafts', limit: 4, valid: valid_volume, optional: true },
    { name: 'snow', limit: 4, valid: valid_volume, optional: true },
    { name: 'mist', limit: 8, valid: valid_volume, optional: true },
    { name: 'plants', limit: 512, valid: valid_plant, optional: true },
    { name: 'glows', limit: 96, valid: valid_glow, optional: true },
    { name: 'fires', limit: 32, valid: valid_fire, optional: true },
  ]
  const lights = Array.isArray(row.glows) ? row.glows.filter((glow) => record(glow).range !== undefined).length : 0
  return [
    ...(lights > SCENERY_LIGHT_BUDGET.high ? ['scenery supports at most four local lights'] : []),
    ...collections.flatMap(({ name, limit, valid, optional }) => {
      const entries = row[name] === undefined && optional ? [] : row[name]
      return Array.isArray(entries) && entries.length <= limit && entries.every(valid)
        ? []
        : [`scenery.${name} must contain at most ${limit} bounded placements`]
    }),
  ]
}
