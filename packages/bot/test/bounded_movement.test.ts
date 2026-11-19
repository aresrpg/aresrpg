// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { world_city_areas, worlds_source } from '@aresrpg/engine/data'
import { world_center, world_size } from '@aresrpg/immutable'
import { ZONE_SIZE } from '@aresrpg/protocol'
import type { ClientPacket } from '@aresrpg/protocol'

import { step_walking_follower } from '../../engine/src/locomotion/walking_follower.ts'
import { create_controller_state } from '../../engine/src/locomotion/controller.ts'
import { begin_walking } from '../../engine/src/locomotion/walking.ts'
import { create_locomotion } from '../src/locomotion.ts'
import { onward_zone, select_discovery } from '../src/behavior_world.ts'
import { validate_gameplay } from '../src/gameplay.ts'
import { area_contains } from '../src/target_constraints.ts'

import { profession_context, character } from './helpers/profession_fixture.ts'

const flat = {
  solid_at: (_x: number, y: number) => y < 0,
  liquid_at: () => false,
  ready: () => true,
  ground_height: () => 0,
}

test('follower checks every controller integration including inertia before a forbidden pose can be adopted', () => {
  const body = create_controller_state([0, 0, 0])
  body.velocity = [100, 0, 0]
  let checked = 0
  const target = { x: -20, z: 0 }
  const result = step_walking_follower(
    flat,
    { body, walking: begin_walking(body.position, target) },
    body.position,
    target,
    130,
    (_from, to) => {
      checked++
      return to[0] <= 0.01
    }
  )
  expect(checked).toBeGreaterThan(0)
  expect(result.blocked).toBe(true)
  expect(result.position[0]).toBeLessThanOrEqual(0.01)
})

test('bounded locomotion publishes only same-city steps, refuses an outside endpoint before publication, and rechecks authority each tick', async () => {
  const world = worlds_source.find(({ cities }) => cities.length > 0)!
  const city = world.cities[0]!
  const rectangle = world_city_areas(world.world)[0]!
  const area = { world: world.world, city: city.city }
  let time = 0
  const movement = create_locomotion({
    now: () => time,
    wait: async (ms) => {
      time += ms
    },
    world_for: () => flat,
  })
  const packets: ClientPacket[] = []
  const travel = {
    character_id: character.id,
    checkpoint: 'bound',
    world: world.world,
    area,
    x: city.x,
    z: city.z,
    target_x: city.x + 10,
    target_z: city.z,
  }
  const send = async (packet: ClientPacket) => {
    packets.push(packet)
    return true
  }
  await movement.walk(async () => travel, send)
  expect(packets.length).toBeGreaterThan(10)
  expect(
    packets.every((packet) => packet.type === 'packet/position' && area_contains(area, world.world, packet.x, packet.z))
  ).toBe(true)
  const before = packets.length
  await expect(
    movement.walk(async () => ({ ...travel, target_x: rectangle.max_x + world_center + 1 }), send)
  ).rejects.toThrow('target_outside_area')
  expect(packets).toHaveLength(before)
  let calls = 0
  await expect(
    movement.walk(async () => {
      if (++calls > 2) throw new Error('stopped')
      return { ...travel, checkpoint: 'new', target_x: city.x + 20 }
    }, send)
  ).rejects.toThrow('stopped')
  expect(calls).toBe(3)
})

test('onward route is one adjacent world-wide cycle, closes at edges, and derives restart position without history', () => {
  const side = Math.ceil(world_size / ZONE_SIZE)
  const visited = new Set<string>()
  let current = { zx: 0, zz: 0 }
  for (let index = 0; index < side * side; index++) {
    visited.add(`${current.zx}:${current.zz}`)
    const next = onward_zone(current.zx, current.zz)
    expect(Math.abs(next.zx - current.zx) + Math.abs(next.zz - current.zz)).toBe(1)
    current = next
  }
  expect(visited.size).toBe(side * side)
  expect(current).toEqual({ zx: 0, zz: 0 })
  expect(onward_zone(side - 1, side - 1)).toEqual({ zx: side - 2, zz: side - 1 })
})

test('onward crosses a fresh depleted successor using canonical no-op refresh movement, then continues from the observed checkpoint', () => {
  const original = profession_context()
  const action = { type: 'discover', character_id: character.id, world: 'fixture', order: 'onward' } as const
  let context = {
    ...original,
    snapshot: {
      ...original.snapshot,
      tracked_zones: {
        [character.id]: {
          ...original.snapshot.tracked_zones[character.id]!,
          zones: [
            { zx: 97, zz: 97 },
            { zx: 96, zz: 97 },
            { zx: 95, zz: 97 },
          ],
        },
      },
      zones: {
        'fixture:96:97': {
          ...original.snapshot.zones['fixture:97:97']!,
          zone: { ...original.snapshot.zones['fixture:97:97']!.zone, zx: 96, searched_at_ms: 63000 },
        },
      },
    },
  }
  for (const zx of [96, 95]) {
    const selected = select_discovery(action, context)
    expect(selected).toMatchObject({
      status: 'action',
      action: { kind: 'world_search', payload: { x: (zx + 0.5) * ZONE_SIZE } },
    })
    if (selected.status !== 'action') throw new Error('expected search')
    const plan = validate_gameplay({ ...context, command: { ...context.command, ...selected.action } })
    expect(plan.kind).toBe('world_search')
    if (plan.kind !== 'world_search') throw new Error('expected search plan')
    // The ordinary search receipt's authoritative character checkpoint is the only route cursor.
    context = {
      ...context,
      snapshot: { ...context.snapshot, characters: [{ ...character, x: plan.input.x, z: plan.input.z }] },
    }
  }
})
