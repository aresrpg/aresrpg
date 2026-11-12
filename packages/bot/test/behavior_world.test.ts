// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { ZONE_RESEARCH_TTL_MS } from '@aresrpg/protocol'

import { select_discovery, world_available, type DiscoverAction } from '../src/behavior_world.ts'

import { profession_context, character, resource } from './helpers/profession_fixture.ts'

const discovery: DiscoverAction = {
  type: 'discover',
  character_id: character.id,
  world: 'fixture',
  region: { min_zx: 97, max_zx: 98, min_zz: 97, max_zz: 97 },
  order: 'nearest',
}
test('discovery waits for canonical chain TTL without paying for no-op searches', () => {
  const context = profession_context()
  expect(select_discovery(discovery, context)).toEqual({
    status: 'waiting',
    code: 'zone_refresh_pending',
    wake_at: ZONE_RESEARCH_TTL_MS,
  })
  const ready = {
    ...context,
    now: ZONE_RESEARCH_TTL_MS,
    snapshot: {
      ...context.snapshot,
      observed_at: ZONE_RESEARCH_TTL_MS,
      clock: { chain_ms: ZONE_RESEARCH_TTL_MS, observed_at: ZONE_RESEARCH_TTL_MS },
    },
  }
  expect(select_discovery(discovery, ready)).toMatchObject({ status: 'action', action: { kind: 'world_search' } })
})
test('discovery resolves unseen tracked zone dynamically and respects authored bounds', () => {
  const context = profession_context()
  const window = context.snapshot.tracked_zones[character.id]!
  const wider = {
    ...context,
    snapshot: {
      ...context.snapshot,
      tracked_zones: {
        [character.id]: { ...window, zones: [...window.zones, { zx: 98, zz: 97 }, { zx: 96, zz: 97 }] },
      },
    },
  }
  expect(select_discovery(discovery, wider)).toEqual({
    status: 'action',
    action: {
      kind: 'world_search',
      payload: { character_id: character.id, world: 'fixture', x: 50432, z: 49920 },
    },
  })
  expect(select_discovery({ ...discovery, region: { ...discovery.region, min_zx: 100, max_zx: 99 } }, wider)).toEqual({
    status: 'failure',
    code: 'invalid_region',
  })
  expect(select_discovery({ ...discovery, world: 'other' }, wider)).toMatchObject({ status: 'waiting' })
})
test('availability distinguishes unknown, consumed and present resources', () => {
  const context = profession_context()
  const fact = { ...discovery, type: 'resource_available', item_type: resource.item_type } as const
  expect(world_available(fact, context)).toBe(true)
  expect(world_available({ ...fact, item_type: 'absent' }, context)).toBe(false)
  expect(world_available(fact, { ...context, snapshot: { ...context.snapshot, zones: {} } })).toBeNull()
  expect(world_available({ ...discovery, type: 'mob_available', mob_types: ['crab'] }, context)).toBe(false)
})
