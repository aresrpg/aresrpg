// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { ClientPacket } from '@aresrpg/protocol'
import { create_controller_state } from '@aresrpg/engine/locomotion/controller'
import { walkable_spawn_height } from '@aresrpg/engine/locomotion/collision'

import { create_locomotion } from '../src/locomotion.ts'
import { begin_idle, idle_travels, step_idle } from '../src/idle.ts'
import { empty_lane } from '../src/control.ts'

import { profession_context } from './helpers/profession_fixture.ts'

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
    const poses: { x: number; z: number }[] = []
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
          ? [{ character_id: 'c', checkpoint: 'cp', world: 'w', x: 50000, z: 50000, target_x: 50000, target_z: 50000 }]
          : null,
      async (packet) => {
        if (packet.type === 'packet/position') poses.push(packet)
        return true
      }
    )
    expect(poses.every((pose) => pose.x < 50000.75 && pose.z === 50000)).toBe(true)
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

test('mounted momentum cannot carry a published pose outside the idle radius', () => {
  const position = [49.9, 0, 0] as const
  const body = {
    ...create_controller_state([...position]),
    on_ground: true,
    velocity: [12, 0, 0] as [number, number, number],
  }
  const state = { ...begin_idle([0, 0, 0], 0, () => 0), yaw: -Math.PI / 2, move_until: 5000, change_at: 10000 }
  const step = step_idle(
    { solid_at: (_x, y) => y < 0, liquid_at: () => false, ready: () => true, ground_height: () => 0 },
    body,
    position,
    state,
    100,
    100,
    () => 0.25,
    true
  )
  expect(step.position).toEqual(position)
  expect(step.gliding).toBe(false)
  expect(body.position).toEqual([...position])
})

for (const riding of [false, true]) {
  test(`idle ${riding ? 'mounted double jump' : 'jump'} lands with the production ground-height oracle`, async () => {
    let time = 0
    const packets: Extract<ClientPacket, { type: 'packet/position' }>[] = []
    const solid_at = (_x: number, y: number) => y < 0
    const movement = create_locomotion({
      now: () => time,
      random: () => 0.25,
      wait: async (ms) => {
        time += ms
      },
      world_for: () => ({
        solid_at,
        liquid_at: () => false,
        ready: () => true,
        // Same upward-only spawn-clearance projection as create_world_collision.
        ground_height: (x, z, anchor_y = 0) => walkable_spawn_height(solid_at, x, anchor_y, z),
      }),
    })
    await movement.idle(
      async () =>
        time < 60000
          ? [
              {
                character_id: 'c',
                checkpoint: 'cp',
                world: 'w',
                x: 50000,
                z: 50000,
                target_x: 50000,
                target_z: 50000,
                riding,
              },
            ]
          : null,
      async (packet) => {
        if (packet.type === 'packet/position') packets.push(packet)
        return true
      }
    )
    const airborne = packets.findIndex((packet) => packet.y > 1)
    expect(airborne).toBeGreaterThan(-1)
    expect(packets.slice(airborne + 1).some((packet) => packet.y < 0.01)).toBe(true)
    if (riding) expect(packets.some((packet) => packet.gliding)).toBe(true)
    expect(packets.every((packet) => Math.hypot(packet.x - 50000, packet.z - 50000) <= 50)).toBe(true)
  })
}
