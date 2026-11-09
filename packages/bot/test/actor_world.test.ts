// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { ServerPacket } from '@aresrpg/protocol'

import { fold_actor_world, zone_key, type ActorWorld } from '../src/actor_world.ts'
const zone = { world: 'fixture', zx: 0, zz: 0, seed: '1', searched_at_ms: 1000, mob_taken: '0', res_taken: [] }
const spawns: Extract<ServerPacket, { type: 'packet/zone_spawns' }> = {
  type: 'packet/zone_spawns',
  world: zone.world,
  zx: 0,
  zz: 0,
  mobs: [],
  resources: [],
}
test('new seed invalidates prior population until following ordinary spawn packet', () => {
  const empty: ActorWorld = { zones: {}, tracked_zones: {} }
  expect(fold_actor_world(empty, spawns)).toEqual(empty)
  const baseline = fold_actor_world(empty, { type: 'packet/zones', zones: [zone] })
  const paired = fold_actor_world(baseline, spawns)
  const key = zone_key(zone.world, 0, 0)
  expect(paired.zones[key]!.spawns).toEqual(spawns)
  const reroll = fold_actor_world(paired, { type: 'packet/zones', zones: [{ ...zone, seed: '2' }] })
  expect(reroll.zones[key]!.spawns).toBeNull()
  expect(fold_actor_world(reroll, spawns).zones[key]!.zone.seed).toBe('2')
})
test('releasing tracked windows and removed owners retire zone projections', () => {
  const key = zone_key(zone.world, 0, 0)
  const state: ActorWorld = {
    zones: { [key]: { zone, spawns } },
    tracked_zones: {
      hero: { type: 'packet/tracked_zones', character_id: 'hero', world: zone.world, zones: [{ zx: 0, zz: 0 }] },
    },
  }
  expect(
    fold_actor_world(state, { type: 'packet/tracked_zones', character_id: 'hero', world: zone.world, zones: [] }).zones
  ).toEqual({})
  expect(fold_actor_world(state, { type: 'packet/characters', characters: [] }).tracked_zones).toEqual({})
})
