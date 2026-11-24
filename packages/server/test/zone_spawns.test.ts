// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The zone_math twin against Move: the mirrored constants, the native seed fixture and the archimob
// vector. Consumption is not applied here; `live_mob_groups`/`live_resource_packs` own it in protocol.

import { readFileSync } from 'node:fs'

import { archimob_appearance_bp, GROUP_SIZE_AVG3_AT, GROUP_SIZE_FULL_AT } from '@aresrpg/immutable'
import { expect, test } from 'bun:test'

import { mob_groups, resource_packs, world_population } from '../src/zone_spawns.ts'

const world = world_population('nauvis')!

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
    'LEVEL_RAMP_AT',
    'LEVEL_LOW_CAP',
    'LEVEL_HIGH_CAP',
    'NODES_RAMP_AT',
    'HOMOGENEOUS_BP',
  ]
  const value = (source: string, name: string, move: boolean): string | null =>
    new RegExp(`const ${name}${move ? ': u64' : ''} = ([\\d_]+)${move ? ';' : 'n'}`).exec(source)?.[1] ?? null

  names.forEach((name) => expect(value(twin_source, name, false), name).toBe(value(move_source, name, true)))
  // The group-size constants live in the shared rule the server imports; they still equal the chain's.
  const chain = (name: string) => BigInt(value(move_source, name, true)!.replaceAll('_', ''))
  expect(GROUP_SIZE_FULL_AT).toBe(chain('GROUP_SIZE_FULL_AT'))
  expect(GROUP_SIZE_AVG3_AT).toBe(chain('GROUP_SIZE_AVG3_AT'))
  expect(new RegExp('const ARCHIMOB_BP: u64 = ([\\d_]+);').exec(move_source)?.[1]).toBe(String(archimob_appearance_bp))
})

test('border anchors retain the native seed and population-index fixture', () => {
  const population = {
    ...world,
    mobs: [{ mob_type: 'fuwa', weight_bp: 10_000n, biomes: [...Array(9).keys()], cities: [] }],
    resources: [{ item_type: 'wheat', biomes: [...Array(9).keys()], cities: [] }],
  }
  const groups = mob_groups(population, 195, 0, 1n)
  const packs = resource_packs(population, 195, 0, 1n)
  expect(groups).toHaveLength(54)
  expect(groups[0]).toMatchObject({ index: 0, x: 99_927, z: 378 })
  expect(packs).toHaveLength(35)
  expect(packs[0]).toMatchObject({ index: 0, x: 99_947, z: 139 })
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
