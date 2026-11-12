// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { ClientPacket } from '@aresrpg/protocol'

import { create_locomotion } from '../src/locomotion.ts'

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
test('walks through normal position packets before returning to transaction execution', async () => {
  const f = fixture()
  await f.movement.walk(f.authorize, f.send)
  const poses = f.packets.filter((packet) => packet.type === 'packet/position')
  expect(poses.length).toBeGreaterThan(10)
  expect(poses[0]!.x).toBe(50000)
  expect(poses.at(-1)!.x).toBeCloseTo(50010, 0)
  expect(poses.every((pose) => pose.checkpoint === 'checkpoint' && Number.isFinite(pose.y))).toBe(true)
  expect(poses.slice(1).every((pose, i) => Math.abs(pose.x - poses[i]!.x) < 1)).toBe(true)
})
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
test('failed transport stops the command', async () => {
  const f = fixture()
  await expect(f.movement.walk(f.authorize, async () => false)).rejects.toThrow('needs_resync')
})
test('a new command resumes the last position on the same checkpoint', async () => {
  const f = fixture()
  let sent = 0
  await expect(
    f.movement.walk(f.authorize, async (packet) => {
      await f.send(packet)
      if (++sent === 8) f.fail('paused')
      return true
    })
  ).rejects.toThrow('paused')
  const last = f.packets.at(-1)!
  f.fail('')
  await f.movement.walk(f.authorize, f.send)
  expect(f.packets[8]).toEqual(last)
})

test('disconnect invalidates an in-flight walk even if readiness returns before the next step', async () => {
  const f = fixture()
  await expect(
    f.movement.walk(f.authorize, async (packet) => {
      await f.send(packet)
      f.movement.clear()
      return true
    })
  ).rejects.toThrow('needs_resync')
  expect(f.packets).toHaveLength(1)
})

test('new authoritative checkpoint replaces the retained transient pose', async () => {
  const f = fixture()
  await f.movement.walk(f.authorize, f.send)
  const offset = f.packets.length
  await f.movement.walk(async () => ({ ...f.travel, checkpoint: 'new', x: 50020, target_x: 50021 }), f.send)
  expect(f.packets[offset]).toMatchObject({ checkpoint: 'new', x: 50020 })
})

test('a disconnect during send cannot repopulate the cleared pose cache', async () => {
  const f = fixture()
  let sent = 0
  await expect(
    f.movement.walk(f.authorize, async (packet) => {
      await f.send(packet)
      if (++sent === 8) f.movement.clear()
      return true
    })
  ).rejects.toThrow('needs_resync')
  const offset = f.packets.length
  await f.movement.walk(f.authorize, f.send)
  expect(f.packets[offset]).toMatchObject({ x: 50000 })
})
