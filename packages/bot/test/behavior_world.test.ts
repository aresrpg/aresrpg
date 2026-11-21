// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { world_biome_at_zone } from '@aresrpg/engine/data'
import { center_distance } from '@aresrpg/immutable'
import { ZONE_RESEARCH_TTL_MS, ZONE_SIZE } from '@aresrpg/protocol'

import { select_discovery, world_available, type DiscoverAction } from '../src/behavior_world.ts'

import { profession_context, character, resource } from './helpers/profession_fixture.ts'
import { hero_in, world_context, WORLD } from './helpers/travel_fixture.ts'

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

const toward = (area: Extract<DiscoverAction, { order: 'toward' }>['area']): DiscoverAction => ({
  type: 'discover',
  character_id: character.id,
  world: WORLD,
  area,
  order: 'toward',
})
const zone_of = (payload: Readonly<Record<string, unknown>>) => ({
  zx: Math.floor(Number(payload.x) / ZONE_SIZE),
  zz: Math.floor(Number(payload.z) / ZONE_SIZE),
})
/** Follow the leaf until it has nothing left to walk; each step moves the hero's checkpoint and window. */
const walk = (action: DiscoverAction, from: Readonly<{ zx: number; zz: number }>) => {
  const path = [from]
  for (;;) {
    const step = select_discovery(action, world_context(hero_in(path.at(-1)!)))
    if (step.status !== 'action') return { path, end: step }
    expect(step.action).toMatchObject({ kind: 'world_search', payload: { character_id: character.id, world: WORLD } })
    expect(step.action.payload).not.toHaveProperty('area')
    const next = zone_of(step.action.payload)
    // One adjacent zone per step: the server tracks no further.
    expect(Math.max(Math.abs(next.zx - path.at(-1)!.zx), Math.abs(next.zz - path.at(-1)!.zz))).toBe(1)
    path.push(next)
    expect(path.length).toBeLessThan(400)
  }
}
test('a walk toward a city crosses the world one zone at a time and ends inside it', () => {
  // The Ruins stand west of Thebes: 27 searches reach the nearest corner of the city, one adjacent zone each.
  const { path, end } = walk(toward({ world: WORLD, city: 'the_ruins' }), { zx: 98, zz: 97 })
  expect(end).toEqual({ status: 'failure', code: 'area_reached' })
  expect(path).toHaveLength(28)
  expect(path.at(-1)).toEqual({ zx: 71, zz: 96 })
  // A hero already inside has nothing to walk.
  expect(walk(toward({ world: WORLD, city: 'thebes' }), { zx: 98, zz: 97 }).path).toHaveLength(1)
})
test('a walk toward a biome or a distance band ends on the nearest zone that belongs to it', () => {
  const start = { zx: 98, zz: 97 }
  const other = ['forest', 'desert', 'highlands', 'plains'].find(
    (biome) => biome !== world_biome_at_zone(WORLD, 104, 97)
  )!
  const biome = walk(toward({ world: WORLD, biome: other }), { zx: 104, zz: 97 })
  expect(biome.end).toEqual({ status: 'failure', code: 'area_reached' })
  expect(world_biome_at_zone(WORLD, biome.path.at(-1)!.zx, biome.path.at(-1)!.zz)).toBe(other)
  const band = walk(toward({ world: WORLD, min_distance: 2000, max_distance: 2666 }), start)
  expect(band.end).toEqual({ status: 'failure', code: 'area_reached' })
  const last = band.path.at(-1)!
  const distance = center_distance((last.zx + 0.5) * ZONE_SIZE, (last.zz + 0.5) * ZONE_SIZE)
  expect(distance).toBeGreaterThanOrEqual(2000)
  expect(distance).toBeLessThanOrEqual(2666)
  // Every step before the last stood outside the band.
  expect(band.path.length).toBeGreaterThan(2)
})
test('a walk waits for facts it lacks and names the area it can never reach', () => {
  const action = toward({ world: WORLD, city: 'the_ruins' })
  const context = world_context(hero_in({ zx: 98, zz: 97 }))
  const untracked = {
    ...context,
    snapshot: {
      ...context.snapshot,
      tracked_zones: {
        [character.id]: { ...context.snapshot.tracked_zones[character.id]!, zones: [{ zx: 98, zz: 97 }] },
      },
    },
  }
  expect(select_discovery(action, untracked)).toEqual({ status: 'waiting', code: 'needs_resync' })
  const unknown = world_context(hero_in({ zx: 98, zz: 97 }, { world: undefined }))
  expect(select_discovery(action, unknown)).toEqual({ status: 'waiting', code: 'needs_resync' })
  const moving = world_context(hero_in({ zx: 98, zz: 97 }, { checkpoint_world: 'yakutia' }))
  expect(select_discovery(action, moving)).toEqual({ status: 'waiting', code: 'needs_resync' })
  const elsewhere = world_context(hero_in({ zx: 98, zz: 97 }, { world: 'yakutia', checkpoint_world: 'yakutia' }))
  expect(() => select_discovery(action, elsewhere)).toThrow('area_unreachable')
  // No zone of Thebes lies ten thousand blocks from the centre.
  const nowhere = toward({ world: WORLD, city: 'thebes', min_distance: 10_000, max_distance: 50_000 })
  expect(() => select_discovery(nowhere, world_context(hero_in({ zx: 110, zz: 97 })))).toThrow('area_unreachable')
})
