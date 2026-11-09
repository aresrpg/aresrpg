// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { merge_zone_rows, merge_zone_population, tracked_zone_keys, retain_zone_keys } from '../src/world_projection.ts'

const zone = { world: 'world', zx: 1, zz: 2, seed: '1', searched_at_ms: 1000, mob_taken: '0', res_taken: [] }
const key = 'world:1:2'
const population = { mobs: [], resources: [] }

test('population requires a baseline; consumption retains it and rerolls invalidate it', () => {
  expect(merge_zone_population({}, {}, key, population)).toEqual({})
  const initial = merge_zone_rows({}, {}, [zone])
  const spawns = merge_zone_population(initial.zones, initial.spawns, key, population)
  const consumed = merge_zone_rows(initial.zones, spawns, [{ ...zone, mob_taken: '1' }])
  expect(consumed.spawns).toBe(spawns)
  expect(consumed.spawns[key]).toBe(population)
  const rerolled = merge_zone_rows(consumed.zones, consumed.spawns, [{ ...zone, seed: '2' }])
  expect(rerolled.spawns).toEqual({})
  expect(spawns[key]).toBe(population)
  expect(initial.zones[key]!.mob_taken).toBe('0')
  expect(merge_zone_population(rerolled.zones, rerolled.spawns, key, population)[key]).toBe(population)
})

test('overlapping windows retain one shared zone until its last observer leaves', () => {
  const window = { world: 'world', zones: [{ zx: 1, zz: 2 }] }
  const rows = { [key]: zone, 'other:1:2': { ...zone, world: 'other' } }
  expect(tracked_zone_keys([window, window]).size).toBe(1)
  expect(retain_zone_keys(rows, tracked_zone_keys([window]))).toEqual({ [key]: zone })
  expect(retain_zone_keys(rows, tracked_zone_keys([]))).toEqual({})
})
