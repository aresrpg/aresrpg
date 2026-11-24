// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Walking: discovery routes, place fences on the way, and the socket position packets before signing.
import { expect, test, describe } from 'bun:test'
import { type ClientPacket, ZONE_SIZE, ZONE_RESEARCH_TTL_MS } from '@aresrpg/protocol'
import { world_city_areas, worlds_source } from '@aresrpg/engine/data'
import { world_center } from '@aresrpg/immutable'

import { create_locomotion } from '../src/locomotion.ts'
import { type Lane, type Command, create_control_service, lane_key_for } from '../src/control.ts'
import { area_contains } from '../src/target_constraints.ts'
import { select_discovery, type DiscoverAction } from '../src/behavior_world.ts'
import { create_actor_runtime } from '../src/actor_runtime.ts'
import { fake_client, pins } from '../../sdk/test/helpers/transport.ts'

import { profession_context, character, hero_in, world_context, WORLD, plan_of } from './fixture_game.ts'
import { runtime_fixture } from './fixture.ts'

describe('behavior world', () => {
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
    expect(select_discovery({ ...discovery, region: { ...discovery.region, min_zx: 100, max_zx: 99 } }, wider)).toEqual(
      {
        status: 'failure',
        code: 'invalid_region',
      }
    )
    expect(select_discovery({ ...discovery, world: 'other' }, wider)).toMatchObject({ status: 'waiting' })
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
})

describe('bounded movement', () => {
  const flat = {
    solid_at: (_x: number, y: number) => y < 0,
    liquid_at: () => false,
    ready: () => true,
    ground_height: () => 0,
  }

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
      packets.every(
        (packet) => packet.type === 'packet/position' && area_contains(area, world.world, packet.x, packet.z)
      )
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
      const plan = plan_of({ ...context, command: { ...context.command, ...selected.action } })
      expect(plan.kind).toBe('world_search')
      if (plan.kind !== 'world_search') throw new Error('expected search plan')
      // The ordinary search receipt's authoritative character checkpoint is the only route cursor.
      context = {
        ...context,
        snapshot: { ...context.snapshot, characters: [{ ...character, x: plan.input.x, z: plan.input.z }] },
      }
    }
  })
})

describe('actor locomotion', () => {
  for (const interruption of ['pause', 'revocation', 'lease_loss', 'freeze', 'stop']) {
    test(`runtime publishes feet before SDK execution and ${interruption} prevents submission`, async () => {
      const f = await runtime_fixture()
      const chain = fake_client({ simulate_ok: true })
      const first_position = Promise.withResolvers<ClientPacket>()
      const runtime = create_actor_runtime({
        ...f.options,
        report_failure: (error) => {
          f.options.report_failure(error)
          first_position.reject(error)
        },
        sdk_options: { client: chain, pins },
        transport: {
          open: (url, handlers) => {
            const socket = f.options.transport.open(url, handlers)
            return {
              ...socket,
              send: (raw) => {
                socket.send(raw)
                const packet = JSON.parse(raw) as ClientPacket
                if (packet.type === 'packet/position') first_position.resolve(packet)
              },
            }
          },
        },
      })
      const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
      const key = lane_key_for(f.bot)
      try {
        await runtime.observe(f.grant, {})
        await f.admit()
        await f.send({
          type: 'packet/characters',
          characters: [{ ...character, x: 1000, z: 1000, world: 'nauvis', checkpoint_world: 'nauvis' }],
        })
        await f.send({
          type: 'packet/tracked_zones',
          character_id: character.id,
          world: 'nauvis',
          zones: [{ zx: 1, zz: 1 }],
        })
        await f.send({
          type: 'packet/server_info',
          online: 1,
          online_characters: 1,
          indexing_lag: 0,
          current_epoch: '1',
          chain_timestamp_ms: 100000,
          chain_sample_age_ms: 0,
        })
        await runtime.settle()
        const lane = (await f.store.read<Lane>(key))!
        const command = await control.accept(f.grant, {
          idempotency_key: 'walk',
          kind: 'world_search',
          payload: { character_id: character.id, world: 'nauvis', x: 1010, z: 1000 },
          decision_revision: lane.decision_revision,
          observation_revision: lane.observation_revision,
        })
        await runtime.wake(`command:${command.id}`)
        const packet = await first_position.promise
        expect(packet).toMatchObject({ type: 'packet/position', character_id: character.id, x: 1000, z: 1000 })
        expect(chain.calls.executions).toBe(0)
        switch (interruption) {
          case 'pause':
            await control.pause(f.grant)
            break
          case 'revocation':
            await f.store.transaction(['grant:grant'], async (tx) => {
              await tx.put('grant:grant', { ...f.grant, revoked: true })
            })
            break
          case 'lease_loss':
            await f.store.transaction([key], async (tx) => {
              const current = (await tx.get<Lane>(key))!
              await tx.put(key, { ...current, actor_id: 'replacement', fence: current.fence + 1 })
            })
            break
          case 'freeze':
            await f.send({ type: 'packet/game_state', frozen: true })
            break
          case 'stop':
            await runtime.stop()
            break
        }
        await runtime.settle()
        expect(chain.calls.executions).toBe(0)
        expect((await f.store.read<Lane>(key))?.pending).toBeNull()
        if (interruption === 'freeze')
          expect(await f.store.read<Command>(`command:${command.id}`)).toMatchObject({
            status: 'accepted',
            waiting_for_resume: true,
          })
      } finally {
        await runtime.stop()
      }
    })
  }
})

describe('locomotion', () => {
  const fixture = () => {
    let time = 0
    let failure: string | null = null
    const packets: ClientPacket[] = []
    const travel = {
      character_id: 'character',
      checkpoint: 'checkpoint',
      world: 'world',
      x: 50000,
      z: 50000,
      target_x: 50010,
      target_z: 50000,
    }
    const movement = create_locomotion({
      now: () => time,
      wait: async (ms) => {
        time += ms
      },
      world_for: () => ({
        solid_at: (_x, y) => y < 0,
        liquid_at: () => false,
        ready: () => true,
        ground_height: () => 0,
      }),
    })
    return {
      movement,
      packets,
      travel,
      fail: (reason: string) => {
        failure = reason
      },
      authorize: async () => {
        if (failure) throw new Error(failure)
        return travel
      },
      send: async (packet: ClientPacket) => {
        packets.push(packet)
        return true
      },
    }
  }
  for (const reason of ['paused', 'lease_lost', 'revoked', 'checkpoint_changed', 'stopped']) {
    test(`stops walking before execution when ${reason}`, async () => {
      const f = fixture()
      const send = async (packet: ClientPacket) => {
        await f.send(packet)
        f.fail(reason)
        return true
      }
      await expect(f.movement.walk(f.authorize, send)).rejects.toThrow(reason)
      expect(f.packets).toHaveLength(1)
    })
  }
})
