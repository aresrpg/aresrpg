// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Walking: discovery routes, place fences on the way, and the socket position packets before signing.
import { expect, test, describe } from 'bun:test'
import { type ClientPacket, ZONE_SIZE, ZONE_RESEARCH_TTL_MS, character_checkpoint } from '@aresrpg/protocol'
import { world_city_areas, worlds_source } from '@aresrpg/engine/data'
import { world_center } from '@aresrpg/immutable'

import { create_locomotion } from '../src/locomotion.ts'
import { type Lane, type Command, create_control_service, lane_key_for } from '../src/control.ts'
import { area_contains, parse_world_area } from '../src/target_constraints.ts'
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

  const toward = (area: NonNullable<DiscoverAction['area']>): DiscoverAction => ({
    type: 'discover',
    character_id: character.id,
    world: WORLD,
    area,
    order: 'toward',
  })
  const centre = (index: number) => (index + 0.5) * ZONE_SIZE
  /** The hero's feet after a background walk that began from its current checkpoint. */
  const standing_at = (context: ReturnType<typeof world_context>, x: number, z: number) => {
    const [hero] = context.snapshot.characters
    return { ...context, presence: { [hero!.id]: { x, z, checkpoint: character_checkpoint(hero!)! } } }
  }
  // Owner 2026-11-27: moving is presence, not chain state. A walk signs nothing on the way.
  test('a walk toward a place is a journey: it signs nothing and ends when the feet stand there', () => {
    const action = toward({ world: WORLD, city: 'the_ruins' })
    const context = world_context(hero_in({ zx: 98, zz: 97 }))
    // The Ruins stand west of Thebes: the nearest corner of the city is the whole target, 27 zones away.
    const journey = { world: WORLD, x: centre(71), z: centre(96) }
    expect(select_discovery(action, context)).toEqual({ status: 'waiting', code: 'travelling', journey })
    // The checkpoint never moved: only the feet did. Half way, the same journey goes on.
    expect(select_discovery(action, standing_at(context, centre(85), centre(96)))).toMatchObject({ journey })
    expect(select_discovery(action, standing_at(context, journey.x, journey.z))).toEqual({
      status: 'failure',
      code: 'area_reached',
    })
    // Feet that belong to an older checkpoint are forgotten: the hero is where the chain says.
    const stale = { ...context, presence: { [character.id]: { x: journey.x, z: journey.z, checkpoint: 'older' } } }
    expect(select_discovery(action, stale)).toMatchObject({ status: 'waiting', journey })
    // A hero already inside has nothing to walk, and a seated one cannot leave its fight.
    expect(select_discovery(toward({ world: WORLD, city: 'thebes' }), context)).toEqual({
      status: 'failure',
      code: 'area_reached',
    })
    const seated = world_context(hero_in({ zx: 98, zz: 97 }, { custody: 'fight' }))
    expect(select_discovery(action, seated)).toEqual({ status: 'failure', code: 'character_not_available' })
  })
  test('a walk toward a teammate follows it and stops beside it', () => {
    const hero = hero_in({ zx: 98, zz: 97 })
    const ally = { ...hero_in({ zx: 30, zz: 46 }), id: `0x${'a'.repeat(64)}` }
    const base = world_context(hero)
    const context = { ...base, snapshot: { ...base.snapshot, characters: [hero, ally] } }
    const follow: DiscoverAction = {
      type: 'discover',
      character_id: hero.id,
      world: WORLD,
      ally: ally.id,
      order: 'toward',
    }
    expect(select_discovery(follow, context)).toEqual({
      status: 'waiting',
      code: 'travelling',
      journey: { world: WORLD, x: ally.x!, z: ally.z! },
    })
    expect(select_discovery(follow, standing_at(context, ally.x! + 20, ally.z!))).toEqual({
      status: 'failure',
      code: 'area_reached',
    })
    const away = { ...context, snapshot: { ...context.snapshot, characters: [hero, { ...ally, world: 'yakutia' }] } }
    expect(() => select_discovery(follow, away)).toThrow('area_unreachable')
  })
  test('a walk waits for facts it lacks, and a place nothing belongs to is refused when the tree is checked', () => {
    const action = toward({ world: WORLD, city: 'the_ruins' })
    const unknown = world_context(hero_in({ zx: 98, zz: 97 }, { world: undefined }))
    expect(select_discovery(action, unknown)).toEqual({ status: 'waiting', code: 'needs_resync' })
    const moving = world_context(hero_in({ zx: 98, zz: 97 }, { checkpoint_world: 'yakutia' }))
    expect(select_discovery(action, moving)).toEqual({ status: 'waiting', code: 'needs_resync' })
    const elsewhere = world_context(hero_in({ zx: 98, zz: 97 }, { world: 'yakutia', checkpoint_world: 'yakutia' }))
    expect(() => select_discovery(action, elsewhere)).toThrow('area_unreachable')
    // A distance band is measured from the centre of the world: no zone of Thebes lies ten thousand
    // blocks from it. The mistake live trees made on 2026-11-27 with Fuwage is told to the author.
    const nowhere = { world: WORLD, city: 'thebes', min_distance: 10_000, max_distance: 50_000 }
    expect(() => parse_world_area(nowhere)).toThrow('area_has_no_zone')
    expect(parse_world_area({ world: WORLD, city: 'thebes' })).toEqual({ world: WORLD, city: 'thebes' })
    expect(parse_world_area({ world: WORLD, min_distance: 38_000 })).toEqual({ world: WORLD, min_distance: 38_000 })
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
