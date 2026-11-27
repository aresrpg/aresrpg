// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The world: discovery, place fences, walking and idle wander.
import { expect, test, describe } from 'bun:test'
import { type ClientPacket, ZONE_SIZE } from '@aresrpg/protocol'
import { CHARACTER_RADIUS } from '@aresrpg/engine/locomotion/collision'
import { world_city_areas, worlds_source } from '@aresrpg/engine/data'
import { world_center } from '@aresrpg/immutable'

import { create_locomotion } from '../src/locomotion.ts'
import { idle_travels, SLEEP_AFTER_IDLE_MS } from '../src/idle.ts'
import { create_control_service, empty_lane, lane_key_for, type Command, type Lane } from '../src/control.ts'
import { parse_target_options } from '../src/target_constraints.ts'
import { select_group } from '../src/behavior_targets.ts'
import { zone_checkpoint_id } from '../src/gameplay_context.ts'
import { next_behavior_action, retain_behavior_draft } from '../src/behavior_plan.ts'
import { parse_behavior_script, type BehaviorRun } from '../src/behavior_script.ts'
import { empty_behavior_memory } from '../src/behavior_tree.ts'
import mobs from '../../../seed/content/mobs.json'

import { profession_context, plan_of } from './fixture_game.ts'
import { memory_store, put, runtime_fixture } from './fixture.ts'
import { fixture_script } from './fixture_fight.ts'

describe('idle', () => {
  test('idle publishes real walking and jumping inside its original radius, then yields', async () => {
    let time = 0
    const packets: { x: number; y: number; z: number }[] = []
    const movement = create_locomotion({
      now: () => time,
      random: () => 0.25,
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
    await movement.idle(
      async () =>
        time < 120000
          ? [
              {
                character_id: 'c',
                checkpoint: 'cp',
                world: 'world',
                x: 50000,
                z: 50000,
                target_x: 50000,
                target_z: 50000,
              },
            ]
          : null,
      async (packet) => {
        if (packet.type === 'packet/position') packets.push(packet)
        return true
      }
    )
    expect(packets.some((p) => Math.hypot(p.x - 50000, p.z - 50000) > 2)).toBe(true)
    expect(packets.some((p) => p.y > 0.5)).toBe(true)
    expect(packets.every((p) => Math.hypot(p.x - 50000, p.z - 50000) <= 50)).toBe(true)
    const last = packets.at(-1)!
    const first_active: typeof packets = []
    await movement.walk(
      async () => ({
        character_id: 'c',
        checkpoint: 'cp',
        world: 'world',
        x: 50000,
        z: 50000,
        target_x: last.x + 2,
        target_z: last.z,
      }),
      async (packet) => {
        if (packet.type === 'packet/position') first_active.push(packet)
        return true
      }
    )
    expect(first_active[0]).toMatchObject({ x: last.x, y: last.y, z: last.z })
    expect(first_active.at(-1)!.x).toBeCloseTo(last.x + 2, 0)
  })

  // Owner 2026-11-27: a journey is presence only. It runs beside the signing queue and signs nothing.
  test('a journey walks straight to its target in the background, and a busy wallet moves only its travellers', async () => {
    let time = 0
    const packets: { x: number; z: number }[] = []
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
    const journey = {
      character_id: 'c',
      checkpoint: 'cp',
      world: 'world',
      x: 50000,
      z: 50000,
      target_x: 50120,
      target_z: 50000,
      journey: true,
    }
    await movement.idle(
      async () => (time < 60000 ? [journey] : null),
      async (packet) => {
        if (packet.type === 'packet/position') packets.push(packet)
        return true
      }
    )
    // Straight to the target at walking pace, never past it and never wandering off the line.
    expect(packets.at(-1)!.x).toBeCloseTo(50120, 0)
    expect(packets.every((p, index) => index === 0 || p.x >= packets[index - 1]!.x - 0.001)).toBe(true)
    expect(packets.every((p) => Math.abs(p.z - 50000) < 1)).toBe(true)
    expect(movement.positions().c).toMatchObject({ checkpoint: 'cp' })
    expect(movement.positions().c!.x).toBeCloseTo(50120, 0)
    const context = profession_context()
    const [hero] = context.snapshot.characters
    const lane = { ...empty_lane({ network: 'mainnet', address: context.address }), needs_resync: false }
    const busy = { ...lane, runs: { [hero!.id]: 'run' }, active_command: 'work' }
    const target = { world: hero!.world!, x: hero!.x! + 4000, z: hero!.z! }
    expect(idle_travels(context, busy)).toBeNull()
    expect(idle_travels(context, busy, new Map([[hero!.id, target]]))).toMatchObject([
      { character_id: hero!.id, journey: true, x: hero!.x, target_x: target.x, target_z: target.z },
    ])
    // A journey of a hero whose run is gone, or to another world, moves nobody.
    expect(idle_travels(context, { ...busy, runs: {} }, new Map([[hero!.id, target]]))).toBeNull()
    expect(idle_travels(context, busy, new Map([[hero!.id, { ...target, world: 'elsewhere' }]]))).toBeNull()
  })

  test('idle requires a free lane, fresh contract and an unrooted owned overworld character', () => {
    const context = profession_context()
    const lane = { ...empty_lane({ network: 'mainnet', address: context.address }), needs_resync: false }
    expect(idle_travels(context, lane)).toHaveLength(1)
    const pet = { ...context.snapshot.characters[0]!.equipment[0]!, slot: 'pet', category: 'pet', item_type: 'siluri' }
    const mounted = {
      ...context,
      snapshot: {
        ...context.snapshot,
        characters: context.snapshot.characters.map((character) => ({ ...character, equipment: [pet] })),
      },
    }
    expect(idle_travels(mounted, lane)?.[0]?.riding).toBe(true)
    expect(idle_travels(context, lane)?.[0]?.riding).toBe(false)
    for (const blocked of [
      { paused: true },
      { needs_resync: true },
      { active_command: 'work' },
      { reconciliation_command: 'receipt' },
      { runs: { hero: 'active-run' } },
    ])
      expect(idle_travels(context, { ...lane, ...blocked })).toBeNull()
    for (const unavailable of [
      { active_fight: { id: 'fight', seat: 0 } },
      { custody: 'fight' as const },
      { world: 'elsewhere' },
      { at_ms: 100000 },
    ])
      expect(
        idle_travels(
          {
            ...context,
            snapshot: {
              ...context.snapshot,
              characters: context.snapshot.characters.map((character) => ({ ...character, ...unavailable })),
            },
          },
          lane
        )
      ).toEqual([])
    for (const snapshot of [{ frozen: true }, { frozen: null }, { ready: false }, { observed_at: 0 }])
      expect(() => idle_travels({ ...context, snapshot: { ...context.snapshot, ...snapshot } }, lane)).toThrow(
        'needs_resync'
      )
  })

  for (const hazard of ['unknown', 'water', 'cliff', 'wall']) {
    test(`idle never advances through ${hazard}`, async () => {
      let time = 0
      const poses: { x: number; y: number; z: number }[] = []
      const movement = create_locomotion({
        now: () => time,
        random: () => 0.75,
        wait: async (ms) => {
          time += ms
        },
        world_for: () => ({
          ready: () => hazard !== 'unknown',
          ground_height: () => 0,
          liquid_at: () => hazard === 'water',
          solid_at: (x, y) => (y < 0 && (hazard !== 'cliff' || x < 0.75)) || (hazard === 'wall' && x >= 0.75),
        }),
      })
      await movement.idle(
        async () =>
          time < 30000
            ? [
                {
                  character_id: 'c',
                  checkpoint: 'cp',
                  world: 'w',
                  x: 50000,
                  z: 50000,
                  target_x: 50000,
                  target_z: 50000,
                },
              ]
            : null,
        async (packet) => {
          if (packet.type === 'packet/position') poses.push(packet)
          return true
        }
      )
      // Collision samples voxel cells; the capsule may overhang the last supported cell.
      expect(poses.every((pose) => pose.x < 50001 + CHARACTER_RADIUS && pose.y >= 0)).toBe(true)
      if (hazard === 'unknown') expect(poses).toEqual([])
    })
  }

  test('equipped mount makes real double jumps and moving glides, then retires flight flags', async () => {
    let time = 0
    const packets: Extract<ClientPacket, { type: 'packet/position' }>[] = []
    const movement = create_locomotion({
      now: () => time,
      random: () => 0.25,
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
    const send = async (packet: ClientPacket) => {
      if (packet.type === 'packet/position') packets.push(packet)
      return true
    }
    const travel = {
      character_id: 'c',
      checkpoint: 'cp',
      world: 'w',
      x: 50000,
      z: 50000,
      target_x: 50000,
      target_z: 50000,
      riding: true,
    }
    await movement.idle(async () => (time < 60000 ? [travel] : null), send)
    const gliding = packets.filter((packet) => packet.gliding)
    expect(gliding.length).toBeGreaterThan(1)
    expect(gliding.every((packet) => packet.riding)).toBe(true)
    expect(packets.some((packet) => packet.y > 2)).toBe(true)
    expect(Math.hypot(gliding[0]!.x - gliding[1]!.x, gliding[0]!.z - gliding[1]!.z)).toBeGreaterThan(0)
    expect(packets.every((packet) => Math.hypot(packet.x - 50000, packet.z - 50000) <= 50)).toBe(true)
    await movement.rest(send)
    expect(packets.at(-1)).toMatchObject({ riding: false, gliding: false })
    const offset = packets.length
    await movement.idle(async () => (time < 61000 ? [{ ...travel, riding: false }] : null), send)
    expect(packets.slice(offset).every((packet) => !packet.riding && !packet.gliding)).toBe(true)
  })
})

describe('target constraints', () => {
  const nearest = { order: 'nearest' } as const
  const world = worlds_source.find(({ cities }) => cities.length > 0)!
  const city = world.cities[0]!
  const area = { world: world.world, city: city.city }
  const rectangle = world_city_areas(world.world)[0]!
  const { mob_type } = mobs.find(({ role }) => role !== 'protector')!
  const options = { area, min_size: 1, max_size: 1, mob_types: [mob_type] }
  /** A hero that fights single mobs inside the city. */
  const patrol = (character: string) =>
    fixture_script({ character, world: world.world, area, target_options: { area, min_size: 1, max_size: 1 } })
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
    expect(plan_of({ ...context, command: { ...context.command, ...selected } })).toMatchObject({
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
      plan_of({
        ...context,
        command: { ...context.command, ...selected, payload: fresh_payload },
        snapshot: { ...context.snapshot, zones: { [Object.keys(context.snapshot.zones)[0]!]: changed } },
      })
    ).toThrow('target_group_mismatch')
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
      script: parse_behavior_script(patrol(character.id)),
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
    expect(plan_of({ ...searched, command: { ...searched.command, ...discovery.action! } })).toMatchObject({
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
})

describe('sleep', () => {
  /** A wallet whose seat is open and admitted, with no hero and no work. */
  const seated = async () => {
    const f = await runtime_fixture()
    await f.observe()
    await f.admit()
    await f.runtime.settle()
    return f
  }
  /** Minutes pass with the runtime's own heartbeat and tick, at half the fixture lease as deployed. */
  const wait = async (f: Awaited<ReturnType<typeof seated>>, minutes: number) => {
    for (let elapsed = 0; elapsed < minutes * 60_000; elapsed += 5_000) {
      f.clock.now += 5_000
      f.clock.monotonic += 5_000
      await f.runtime.renew()
      await f.runtime.tick()
    }
    await f.runtime.settle()
  }
  const lane_of = async (f: Awaited<ReturnType<typeof seated>>) => (await f.store.read<Lane>(lane_key_for(f.bot)))!

  test('a wallet without work for 20 minutes leaves the game and stays out; work before then restarts the count', async () => {
    const f = await seated()
    try {
      expect(SLEEP_AFTER_IDLE_MS).toBe(20 * 60_000)
      await wait(f, 19)
      // A direct command is work: the wallet is not idle while it holds one.
      await put(f.store, lane_key_for(f.bot), { ...(await lane_of(f)), direct: 'queued' })
      await wait(f, 1)
      await put(f.store, lane_key_for(f.bot), { ...(await lane_of(f)), direct: null })
      await wait(f, 19)
      expect([f.sockets.length, f.sockets.at(-1)!.closed]).toEqual([1, false])
      await wait(f, 2)
      // Asleep: its socket is closed, so the server counts it offline, and nothing opens another one.
      expect([f.sockets.length, f.sockets.at(-1)!.closed]).toEqual([1, true])
      const lease = (await lane_of(f)).lease_until
      await wait(f, 5)
      expect([f.sockets.length, (await lane_of(f)).lease_until]).toEqual([1, lease])
    } finally {
      await f.runtime.stop()
    }
  })

  test('the next read wakes a sleeping wallet and says when it left; a command then signs in its turn', async () => {
    const f = await seated()
    try {
      await wait(f, 21)
      const slept = f.sockets.at(-1)!
      expect(slept.closed).toBe(true)
      const answer = await f.observe()
      expect(f.sockets.length).toBe(2)
      // It slept at the end of its twentieth idle minute and reconnects for this read.
      const { status, asleep_since } = answer as { status: string; asleep_since: string }
      expect([status, Date.parse(asleep_since) > 20 * 60_000, Date.parse(asleep_since) <= f.clock.now]).toEqual([
        'pending',
        true,
        true,
      ])
      await f.admit()
      await f.runtime.settle()
      expect(await f.observe()).not.toHaveProperty('asleep_since')
      const lane = await lane_of(f)
      const command = await create_control_service(f.store, f.options.config, 60000, () => f.clock.now).accept(
        f.grant,
        {
          idempotency_key: 'after-sleep',
          kind: 'raise_stats',
          payload: { character_id: `0x${'2'.repeat(64)}`, spending: { vitality: 1 } },
          decision_revision: lane.decision_revision,
          observation_revision: lane.observation_revision,
        }
      )
      await f.runtime.tick()
      await f.runtime.settle()
      // The command took its turn: it was judged against the fresh observation and refused unsigned.
      expect((await f.store.read<Command>(`command:${command.id}`))?.status).toBe('failed')
    } finally {
      await f.runtime.stop()
    }
  })
})
