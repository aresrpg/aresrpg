// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The zone_math twin's seals: deterministic expansion, the consumption masks, and the draw-order
// contract (a taken group still consumes its draws — the stream is the chain's contract).

import { expect, test } from 'bun:test'

import { mob_groups, resource_packs, world_population } from '../src/zone_spawns.ts'

const world = world_population('01_first_shore')!
const CENTER_ZONE = { zx: 97, zz: 97 } // ~center of the 100k world — level floor 0 territory

test('the population derives deterministically from the zone seed', () => {
  const first = mob_groups(world, CENTER_ZONE.zx, CENTER_ZONE.zz, 424_242n, 0n)
  const second = mob_groups(world, CENTER_ZONE.zx, CENTER_ZONE.zz, 424_242n, 0n)

  expect(world).not.toBeNull()
  expect(first.length).toBeGreaterThanOrEqual(48)
  expect(first.length).toBeLessThanOrEqual(64)
  expect(second).toEqual(first)
  // a different seed is a different population
  expect(mob_groups(world, CENTER_ZONE.zx, CENTER_ZONE.zz, 424_243n, 0n)).not.toEqual(first)
  // every group stands inside its zone
  for (const group of first) {
    expect(Math.floor(group.x / 512)).toBe(CENTER_ZONE.zx)
    expect(Math.floor(group.z / 512)).toBe(CENTER_ZONE.zz)
    expect(group.members.length).toBeGreaterThanOrEqual(1)
  }
})

test('a consumed mob group disappears WITHOUT disturbing the other groups (draw-order contract)', () => {
  const all = mob_groups(world, CENTER_ZONE.zx, CENTER_ZONE.zz, 7n, 0n)
  const taken = mob_groups(world, CENTER_ZONE.zx, CENTER_ZONE.zz, 7n, 1n << BigInt(all[3]!.index))

  expect(taken.find(({ index }) => index === all[3]!.index)).toBeUndefined()
  expect(taken).toEqual(all.filter(({ index }) => index !== all[3]!.index))
})

test('resource packs subtract consumption per node and drop exhausted packs', () => {
  const all = resource_packs(world, CENTER_ZONE.zx, CENTER_ZONE.zz, 7n, [])
  expect(all.length).toBeGreaterThanOrEqual(24)
  const [first] = all
  const partially = resource_packs(world, CENTER_ZONE.zx, CENTER_ZONE.zz, 7n, [1])
  const exhausted = resource_packs(world, CENTER_ZONE.zx, CENTER_ZONE.zz, 7n, [first!.nodes])

  expect(partially.find(({ index }) => index === first!.index)?.nodes).toBe(first!.nodes - 1)
  expect(exhausted.find(({ index }) => index === first!.index)).toBeUndefined()
  // untouched packs are byte-identical
  expect(exhausted.filter(({ index }) => index !== first!.index)).toEqual(
    all.filter(({ index }) => index !== first!.index)
  )
})

test('distance ramps the level floor: a frontier zone spawns stronger members than the center', () => {
  const center = mob_groups(world, CENTER_ZONE.zx, CENTER_ZONE.zz, 7n, 0n)
  const frontier = mob_groups(world, 5, 5, 7n, 0n) // ~47k blocks out — floor at the 75 cap
  const min_scalar = (groups: typeof center) =>
    Math.min(...groups.flatMap(({ members }) => members.map(({ level_scalar }) => level_scalar)))

  expect(min_scalar(frontier)).toBeGreaterThanOrEqual(75)
  expect(min_scalar(center)).toBeLessThan(75)
})

test('an unknown world has no population door', () => {
  expect(world_population('99_nowhere')).toBeNull()
})
