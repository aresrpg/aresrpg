// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The zone_math twin's seals: deterministic expansion off the seed alone, and the draw-order
// contract (every group and pack the chain draws is emitted, at its own index — consumption is
// NOT applied here; `live_mob_groups`/`live_resource_packs` own that, sealed in protocol).

import { expect, test } from 'bun:test'

import {
  dungeon_portal,
  mob_group_size_bounds,
  mob_groups,
  mob_level_scalar_bounds,
  resource_packs,
  world_population,
} from '../src/zone_spawns.ts'

const world = world_population('nauvis')!
const world_with_mobs = {
  ...world,
  mobs: [{ mob_type: 'protector_wheat_bricheton', weight_bp: 10_000n, biomes: [...Array(9).keys()] }],
} as never
const CENTER_ZONE = { zx: 97, zz: 97 } // center starter zone, authored plains — level floor 0 territory
const OCEAN_ZONE = { zx: 100, zz: 90 }

test('Nauvis exposes its exact hand-authored roaming roster', () => {
  expect(world.mobs).toHaveLength(18)
  expect(new Set(world.mobs.map(({ mob_type }) => mob_type))).toHaveLength(18)
  expect(world.mobs.some(({ mob_type }) => mob_type === 'araknomath')).toBeFalse()
  expect(mob_groups(world, CENTER_ZONE.zx, CENTER_ZONE.zz, 1n)).not.toEqual([])
})

test('the ocean biome generates neither mobs nor resource packs', () => {
  expect(mob_groups(world, OCEAN_ZONE.zx, OCEAN_ZONE.zz, 1n)).toEqual([])
  expect(resource_packs(world, OCEAN_ZONE.zx, OCEAN_ZONE.zz, 1n)).toEqual([])
})

test('the population derives deterministically from the zone seed', () => {
  const first = mob_groups(world_with_mobs, CENTER_ZONE.zx, CENTER_ZONE.zz, 424_242n)
  const second = mob_groups(world_with_mobs, CENTER_ZONE.zx, CENTER_ZONE.zz, 424_242n)

  expect(world).not.toBeNull()
  expect(first.length).toBeGreaterThanOrEqual(48)
  expect(first.length).toBeLessThanOrEqual(64)
  expect(second).toEqual(first)
  // a different seed is a different population
  expect(mob_groups(world_with_mobs, CENTER_ZONE.zx, CENTER_ZONE.zz, 424_243n)).not.toEqual(first)
  // every group stands inside its zone
  for (const group of first) {
    expect(Math.floor(group.x / 512)).toBe(CENTER_ZONE.zx)
    expect(Math.floor(group.z / 512)).toBe(CENTER_ZONE.zz)
    expect(group.members.length).toBeGreaterThanOrEqual(1)
  }
})

test('the dungeon portal is the exact zone_math seed draw and absent without dungeon content', () => {
  expect(dungeon_portal(world, 3, 4, 8n)).toEqual({ x: 1_649, z: 2_490 })
  expect(dungeon_portal({ ...world, has_dungeon: false }, 3, 4, 8n)).toBeNull()
  expect(dungeon_portal(world, 3, 4, 7n)).toBeNull()
})

test('group size reaches average three at 2,000 blocks and grows before then', () => {
  expect(mob_group_size_bounds(2_000n)).toEqual([2n, 4n])
  expect(mob_group_size_bounds(848n)).toEqual([1n, 2n])
  expect(mob_groups(world_with_mobs, 95, 98, 736_939_901n).some(({ members }) => members.length > 1)).toBeTrue()
})

test('distance moves both mob level bounds instead of rolling to 100 from the center', () => {
  expect(mob_level_scalar_bounds(0n)).toEqual([0n, 0n])
  expect(mob_level_scalar_bounds(10_000n)).toEqual([37n, 50n])
  expect(mob_level_scalar_bounds(20_000n)).toEqual([75n, 100n])
  expect(mob_level_scalar_bounds(50_000n)).toEqual([75n, 100n])
})

test('every drawn group is emitted at its own bitmap index (the draw-order contract)', () => {
  const groups = mob_groups(world_with_mobs, CENTER_ZONE.zx, CENTER_ZONE.zz, 7n)

  // the index IS the bit a consumed group sets on chain — a gap here would retire the wrong
  // group the moment somebody engages one
  expect(groups.map(({ index }) => index)).toEqual(groups.map((_, position) => position))
})

test('resource packs carry the TOTAL nodes the seed drew, consumption unapplied', () => {
  const packs = resource_packs(world, CENTER_ZONE.zx, CENTER_ZONE.zz, 7n)

  expect(packs.length).toBeGreaterThanOrEqual(24)
  expect(packs.length).toBeLessThanOrEqual(42)
  expect(packs.map(({ index }) => index)).toEqual(packs.map((_, position) => position))
  for (const pack of packs) {
    expect(pack.nodes).toBeGreaterThanOrEqual(2)
    expect(Math.floor(pack.x / 512)).toBe(CENTER_ZONE.zx)
    expect(Math.floor(pack.z / 512)).toBe(CENTER_ZONE.zz)
  }
  expect(resource_packs(world, CENTER_ZONE.zx, CENTER_ZONE.zz, 7n)).toEqual(packs)
})

test('distance ramps the level window: center mobs are minimum and frontier mobs are upper-band', () => {
  const center = mob_groups(world_with_mobs, CENTER_ZONE.zx, CENTER_ZONE.zz, 7n)
  const frontier = mob_groups(world_with_mobs, 5, 5, 7n) // ~47k blocks out — floor at the 75 cap
  const min_scalar = (groups: typeof center) =>
    Math.min(...groups.flatMap(({ members }) => members.map(({ level_scalar }) => level_scalar)))

  expect(min_scalar(frontier)).toBeGreaterThanOrEqual(75)
  expect(center.every(({ members }) => members.every(({ level_scalar }) => level_scalar === 0))).toBeTrue()
})

test('an unknown world has no population door', () => {
  expect(world_population('99_nowhere')).toBeNull()
})
