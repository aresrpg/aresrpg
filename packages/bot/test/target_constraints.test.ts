// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { world_city_areas, worlds_source, world_biome_at_zone } from '@aresrpg/engine/data'
import { world_center } from '@aresrpg/immutable'
import { ZONE_SIZE } from '@aresrpg/protocol'
import { bind_strategy } from '@aresrpg/protocol/strategies'

import { area_contains, area_allows_segment, parse_target_options } from '../src/target_constraints.ts'
import { select_group } from '../src/behavior_targets.ts'
import { validate_gameplay, zone_checkpoint_id, fight_checkpoint_id } from '../src/gameplay.ts'
import { next_behavior_action } from '../src/behavior_plan.ts'
import { parse_behavior_script, type BehaviorRun } from '../src/behavior_script.ts'
import { empty_behavior_memory } from '../src/behavior_tree.ts'
import { retain_behavior_draft } from '../src/behavior_refresh.ts'
import { idle_travels } from '../src/idle.ts'
import type { Lane } from '../src/control.ts'
import mobs from '../../../seed/content/mobs.json'

import { memory_store } from './helpers/control_fixture.ts'
import { profession_context } from './helpers/profession_fixture.ts'
import { combat_fixture, placement, character_id, fight_id, row_of } from './helpers/combat_runtime_fixture.ts'

const nearest = { order: 'nearest' } as const
const world = worlds_source.find(({ cities }) => cities.length > 0)!
const city = world.cities[0]!
const area = { world: world.world, city: city.city }
const rectangle = world_city_areas(world.world)[0]!
const { mob_type } = mobs.find(({ role }) => role !== 'protector')!
const options = { area, min_size: 1, max_size: 1, mob_types: [mob_type] }
const city_context = () => {
  const context = profession_context()
  const character = {
    ...context.snapshot.characters[0]!,
    world: world.world,
    checkpoint_world: world.world,
    x: rectangle.min_x + world_center + 1,
    z: city.z,
  }
  const zx = Math.floor(character.x / ZONE_SIZE)
  const zz = Math.floor(character.z / ZONE_SIZE)
  const members = [{ mob_type, level_scalar: 100 }]
  const zone = {
    zone: { world: world.world, zx, zz, seed: '1', searched_at_ms: 0, mob_taken: '0', res_taken: [] },
    spawns: {
      type: 'packet/zone_spawns' as const,
      world: world.world,
      zx,
      zz,
      resources: [],
      mobs: [
        { index: 0, x: character.x + 1, z: character.z, members: [...members, ...members, ...members] },
        { index: 1, x: character.x + 3, z: character.z, members },
      ],
    },
  }
  return {
    ...context,
    snapshot: {
      ...context.snapshot,
      characters: [character],
      zones: { [`${world.world}:${zx}:${zz}`]: zone },
      tracked_zones: {
        [character.id]: {
          type: 'packet/tracked_zones' as const,
          character_id: character.id,
          world: world.world,
          zones: [{ zx, zz }],
        },
      },
    },
  }
}

test('optional constraints validate canonical identities and sizes, while unbounded selection remains unchanged', () => {
  for (const invalid of [
    { min_size: 3, max_size: 2 },
    { min_size: 0 },
    { max_size: NaN },
    { mob_types: ['invented'] },
    { area: { world: 'invented', city: city.city } },
    { area: { world: world.world, city: 'invented' } },
    { area: { world: world.world, biome: 'invented' } },
    { area: { ...area, biome: 'forest' } },
  ])
    expect(() => parse_target_options(invalid)).toThrow()
  const context = city_context()
  const character = context.snapshot.characters[0]!
  expect(select_group(character.id, [mob_type], context, undefined, nearest)?.payload.group_index).toBe('0')
  const selected = select_group(character.id, [mob_type], context, options, nearest)!
  expect(selected.payload.group_index).toBe('1')
  expect(selected.payload.target_options).toEqual(options)
  expect(validate_gameplay({ ...context, command: { ...context.command, ...selected } })).toMatchObject({
    kind: 'fight_engage',
    travel: { area },
  })
  const zone = Object.values(context.snapshot.zones)[0]!
  const changed = {
    ...zone,
    spawns: {
      ...zone.spawns,
      mobs: zone.spawns.mobs.map((group) => ({ ...group, members: [...group.members, ...group.members] })),
    },
  }
  const fresh_payload = { ...selected.payload, zone_checkpoint_id: zone_checkpoint_id(changed) }
  expect(() =>
    validate_gameplay({
      ...context,
      command: { ...context.command, ...selected, payload: fresh_payload },
      snapshot: { ...context.snapshot, zones: { [Object.keys(context.snapshot.zones)[0]!]: changed } },
    })
  ).toThrow('target_group_mismatch')
})

test('same-city bounds reject outside targets and unknown/outside current location without rounding fractional positions', () => {
  const context = city_context()
  const character = context.snapshot.characters[0]!
  const zone = Object.values(context.snapshot.zones)[0]!
  const outside = {
    ...zone,
    spawns: { ...zone.spawns, mobs: [{ ...zone.spawns.mobs[1]!, x: rectangle.min_x + world_center - 0.1 }] },
  }
  const changed = {
    ...context,
    snapshot: { ...context.snapshot, zones: { [Object.keys(context.snapshot.zones)[0]!]: outside } },
  }
  expect(select_group(character.id, [mob_type], changed, options, nearest)).toBeUndefined()
  const moved = {
    ...context,
    snapshot: { ...context.snapshot, characters: [{ ...character, x: rectangle.min_x + world_center - 0.1 }] },
  }
  expect(() => select_group(character.id, [mob_type], moved, options, nearest)).toThrow('target_outside_area')
  expect(area_contains(area, world.world, rectangle.max_x + world_center + 0.01, city.z)).toBe(false)
  expect(area_contains(area, world.world, Number.NaN, city.z)).toBe(false)
})

test('canonical city rectangles do not overlap and biome constraints exclude population city overrides', () => {
  for (const source of worlds_source) {
    const cities = world_city_areas(source.world)
    for (const [index, left] of cities.entries())
      for (const right of cities.slice(index + 1))
        expect(
          left.max_x < right.min_x || right.max_x < left.min_x || left.max_z < right.min_z || right.max_z < left.min_z
        ).toBe(true)
  }
  const biome = world_biome_at_zone(world.world, Math.floor(city.x / ZONE_SIZE), Math.floor(city.z / ZONE_SIZE))!
  expect(area_contains({ world: world.world, biome }, world.world, city.x, city.z)).toBe(false)
  const zones = Array.from({ length: 196 }, (_, zx) => ({ zx, biome: world_biome_at_zone(world.world, zx, 0)! }))
  const start = zones.find((left) =>
    zones.some(
      (right) =>
        right.zx > left.zx + 1 &&
        right.biome === left.biome &&
        zones.slice(left.zx, right.zx).some((middle) => middle.biome !== left.biome)
    )
  )!
  const end = zones.find(
    (right) =>
      right.zx > start.zx + 1 &&
      right.biome === start.biome &&
      zones.slice(start.zx, right.zx).some((middle) => middle.biome !== start.biome)
  )!
  const from = [(start.zx + 0.5) * ZONE_SIZE, ZONE_SIZE / 2] as const
  const to = [(end.zx + 0.5) * ZONE_SIZE, ZONE_SIZE / 2] as const
  expect(area_contains({ world: world.world, biome: start.biome }, world.world, ...from)).toBe(true)
  expect(area_contains({ world: world.world, biome: start.biome }, world.world, ...to)).toBe(true)
  expect(area_allows_segment({ world: world.world, biome: start.biome }, world.world, from, to)).toBe(false)
})

test('constrained restart proves original fight origin and every original mob, including dead enemies', async () => {
  const checkpoint = placement()
  checkpoint.contract.world = world.world
  checkpoint.contract.x = BigInt(city.x)
  checkpoint.contract.z = BigInt(city.z)
  const mob = checkpoint.contract.fighters.find(({ kind }) => kind.type === 'mob')!
  if (mob.kind.type !== 'mob') throw new Error('fixture')
  mob.kind.snapshot.mob_type = mob_type
  const f = await combat_fixture(checkpoint)
  const context = {
    ...f.context,
    snapshot: {
      ...f.context.snapshot,
      characters: f.context.snapshot.characters.map((character) => ({
        ...character,
        world: world.world,
        checkpoint_world: world.world,
        x: city.x,
        z: city.z,
      })),
    },
  }
  const run: BehaviorRun = {
    ...(await f.get_run()),
    character_id,
    revision: 1,
    script: parse_behavior_script(
      bind_strategy('fight_nearby', { character: character_id, title: 'City patrol', area })
    ),
    memory: empty_behavior_memory(),
    pending_node: null,
    activation: null,
    consumed_command_id: null,
  }
  const next = next_behavior_action(run, null, context)
  expect(next.action?.kind).toBe('fight_ready')
  expect(next.action?.payload.target_options).toMatchObject({ area, min_size: 1, max_size: 1 })
  checkpoint.contract.fighters.push({ ...structuredClone(mob), dead: true })
  const changed = row_of(checkpoint)
  const late_context = {
    ...context,
    snapshot: { ...context.snapshot, fights: { [fight_id]: changed } },
    command: {
      ...context.command,
      ...next.action!,
      payload: { ...next.action!.payload, checkpoint_id: fight_checkpoint_id(changed) },
    },
  }
  expect(() => validate_gameplay(late_context)).toThrow('target_group_mismatch')
  expect(next_behavior_action(run, null, late_context).state).toBe('awaiting_ai')
  checkpoint.contract.fighters.pop()
  checkpoint.contract.x = BigInt(rectangle.max_x + world_center + 1)
  expect(
    next_behavior_action(run, null, {
      ...context,
      snapshot: { ...context.snapshot, fights: { [fight_id]: row_of(checkpoint) } },
    })
  ).toMatchObject({ state: 'awaiting_ai', issue: 'target_outside_area' })
})

test('a waiting constrained run disables ordinary idle roaming without a second movement policy', () => {
  const context = city_context()
  expect(idle_travels(context, { runs: { hero: 'city-patrol' } } as unknown as Lane)).toBeNull()
})

test('patrol exhaustion selects bounded canonical research and refreshed drafts retain the original reviewed city', async () => {
  const context = city_context()
  const character = context.snapshot.characters[0]!
  const run: BehaviorRun = {
    id: 'patrol',
    bot_id: 'bot',
    grant_id: 'grant',
    lane_key: 'lane',
    character_id: character.id,
    fingerprint: 'fixture',
    script: parse_behavior_script(bind_strategy('fight_nearby', { character: character.id, title: 'Patrol', area })),
    revision: 1,
    memory: empty_behavior_memory(),
    pending_node: null,
    activation: null,
    consumed_command_id: null,
    status: 'active',
    actions_started: 0,
    last_command_id: null,
    created_at: 0,
  }
  const next = next_behavior_action(run, null, context)
  expect(next.action).toMatchObject({
    kind: 'fight_engage',
    payload: { target_options: { area, min_size: 1, max_size: 1 } },
  })
  const zone = Object.values(context.snapshot.zones)[0]!
  const searched = {
    ...context,
    now: 8_000_000,
    snapshot: {
      ...context.snapshot,
      clock: { chain_ms: 8_000_000, observed_at: 8_000_000 },
      observed_at: 8_000_000,
      zones: { [Object.keys(context.snapshot.zones)[0]!]: { ...zone, zone: { ...zone.zone, mob_taken: '3' } } },
    },
  }
  const discovery = next_behavior_action(run, null, searched)
  expect(discovery.action).toMatchObject({ kind: 'world_search', payload: { area } })
  expect(validate_gameplay({ ...searched, command: { ...searched.command, ...discovery.action! } })).toMatchObject({
    kind: 'world_search',
    travel: { area },
  })
  const store = memory_store()
  const current = {
    ...context.command,
    ...next.action!,
    id: 'draft',
    behavior_binding: { node: next.node!, revision: 1 },
  }
  const refreshed = await store.transaction(['command:draft', 'behavior:patrol', 'lane'], (tx) =>
    retain_behavior_draft(tx, next.record, current, { observation_revision: 2 } as Lane, context)
  )
  expect(refreshed).toMatchObject({ payload: { target_options: { area, min_size: 1, max_size: 1 } } })
})
