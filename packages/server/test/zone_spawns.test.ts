// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The zone_math twin's seals: deterministic expansion off the seed alone, and the draw-order
// contract (every group and pack the chain draws is emitted, at its own index — consumption is
// NOT applied here; `live_mob_groups`/`live_resource_packs` own that, sealed in protocol).

import { readFileSync } from 'node:fs'

import { archimob_appearance_bp } from '@aresrpg/immutable'
import { expect, test } from 'bun:test'

import {
  archimob_type_for_roll,
  mob_group_size_bounds,
  mob_groups,
  mob_level_scalar_bounds,
  resource_packs,
  world_population,
} from '../src/zone_spawns.ts'

test('every eligible member has an independent exact one-percent replacement boundary', () => {
  const rows = [{ ordinary_type: 'fuwa', archi_type: 'fukuo' }]
  expect([99n, 100n, 0n].map((roll) => archimob_type_for_roll('fuwa', rows, roll))).toEqual(['fukuo', 'fuwa', 'fukuo'])
  expect(archimob_type_for_roll('ant', rows, 0n)).toBe('ant')
})

const world = world_population('nauvis')!
const world_with_mobs = {
  ...world,
  mobs: [{ mob_type: 'protector_wheat_bricheton', weight_bp: 10_000n, biomes: [...Array(9).keys()], cities: [0] }],
} as never
const CENTER_ZONE = { zx: 97, zz: 97 } // center starter zone, authored plains — level floor 0 territory
const OCEAN_ZONE = { zx: 88, zz: 85 }

test('every hand-mirrored zone constant matches Move', () => {
  const move_source = readFileSync(new URL('../../move-math/sources/zone_math.move', import.meta.url), 'utf8')
  const twin_source = readFileSync(new URL('../src/zone_spawns.ts', import.meta.url), 'utf8')
  const names = [
    'GROUPS_MIN',
    'GROUPS_MAX',
    'RES_PACKS_MIN',
    'RES_PACKS_MAX',
    'CITY_RESOURCE_NODE_NUMERATOR',
    'CITY_RESOURCE_NODE_DENOMINATOR',
    'GROUP_SIZE_FULL_AT',
    'GROUP_SIZE_AVG3_AT',
    'LEVEL_RAMP_AT',
    'LEVEL_LOW_CAP',
    'LEVEL_HIGH_CAP',
    'NODES_RAMP_AT',
    'HOMOGENEOUS_BP',
  ]
  const value = (source: string, name: string, move: boolean): string | null =>
    new RegExp(`const ${name}${move ? ': u64' : ''} = ([\\d_]+)${move ? ';' : 'n'}`).exec(source)?.[1] ?? null

  names.forEach((name) => expect(value(twin_source, name, false), name).toBe(value(move_source, name, true)))
  expect(new RegExp('const ARCHIMOB_BP: u64 = ([\\d_]+);').exec(move_source)?.[1]).toBe(String(archimob_appearance_bp))
})

test('Nauvis exposes its exact hand-authored roaming roster', () => {
  expect(world.mobs).toHaveLength(26)
  expect(new Set(world.mobs.map(({ mob_type }) => mob_type))).toHaveLength(26)
  expect(world.mobs.some(({ mob_type }) => mob_type === 'araknomath')).toBeFalse()
  expect(world.mobs.find(({ mob_type }) => mob_type === 'nook')?.biomes).toEqual([1])
  expect(world.mobs.find(({ mob_type }) => mob_type === 'nook')?.cities).toEqual([0])
  expect(mob_groups(world, CENTER_ZONE.zx, CENTER_ZONE.zz, 1n)).not.toEqual([])
})

test('Nook materializes in the City of Thebes population', () => {
  const city_members = mob_groups(world, 98, 97, 1n).flatMap(({ members }) => members.map(({ mob_type }) => mob_type))

  expect(city_members).toContain('nook')
})

test('the independent archimob stream changes only eligible member identity', () => {
  const ordinary = mob_groups({ ...world, archis: [] }, 94, 94, 0n)
  const substituted = mob_groups(world, 94, 94, 0n)

  expect(ordinary[24]?.members[2]).toEqual({ mob_type: 'fuwa__black', level_scalar: 7 })
  expect(substituted[24]?.members[2]).toEqual({ mob_type: 'fuwa__fukuo', level_scalar: 7 })
  expect(
    substituted.map(({ index, x, z, members }) => ({
      index,
      x,
      z,
      levels: members.map(({ level_scalar }) => level_scalar),
    }))
  ).toEqual(
    ordinary.map(({ index, x, z, members }) => ({
      index,
      x,
      z,
      levels: members.map(({ level_scalar }) => level_scalar),
    }))
  )
})

test('the fixed archimob population vector matches Move', () => {
  const population = {
    mobs: [{ mob_type: 'fuwa', weight_bp: 10_000n, biomes: [0], cities: [] }],
    resources: [],
    cities: [],
    archis: [{ ordinary_type: 'fuwa', archi_type: 'fukuo' }],
    map: { side: 0, cells: new Uint8Array(), zone_x0: 0, zone_z0: 0 },
  } as never
  const groups = mob_groups(population, 97, 97, 0n)

  expect(groups).toHaveLength(56)
  expect(groups[42]).toEqual({ index: 42, x: 49_816, z: 50_068, members: [{ mob_type: 'fukuo', level_scalar: 0 }] })
})

test('city fauna enters Thebes only through explicit city membership', () => {
  const city_fauna = ['nook', 'lorito__earth', 'lorito__fire', 'lorito__water', 'lorito__air', 'bramble', 'tinker']
  const city_only = new Set(['lorito__earth', 'lorito__fire', 'lorito__water', 'lorito__air'])

  for (const mob_type of city_fauna)
    expect(world.mobs.find((row) => row.mob_type === mob_type)).toMatchObject({
      biomes: city_only.has(mob_type) ? [] : [1],
      cities: [0],
    })
  expect(world.mobs.filter(({ cities }) => cities.includes(0)).map(({ mob_type }) => mob_type)).toEqual(city_fauna)
})

test('the ocean biome generates neither mobs nor resource packs', () => {
  expect(mob_groups(world, OCEAN_ZONE.zx, OCEAN_ZONE.zz, 1n)).toEqual([])
  expect(resource_packs(world, OCEAN_ZONE.zx, OCEAN_ZONE.zz, 1n)).toEqual([])
})

test('a small ocean pocket cannot empty a land-majority zone', () => {
  // Player-reported relative zone 0,4: its center is submerged, but 69% of its surface is plains.
  expect(mob_groups(world, 97, 101, 3_904_461_295n)).not.toEqual([])
  expect(resource_packs(world, 97, 101, 3_904_461_295n)).not.toEqual([])
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

test('city resource abundance is the exact Move 3/2 node multiplier without extra packs', () => {
  const city = resource_packs(world, 98, 97, 7n)
  const ordinary = resource_packs({ ...world, cities: [] }, 98, 97, 7n)

  expect(city).toHaveLength(ordinary.length)
  city.forEach((pack, index) => expect(pack.nodes).toBe(Math.floor(ordinary[index]!.nodes * 1.5)))
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
