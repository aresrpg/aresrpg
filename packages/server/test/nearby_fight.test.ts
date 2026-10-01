// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'

import { get_world_fights } from '../src/reads/get_world_fights.ts'

import { create_player } from './helpers/player.ts'
import { embody, fight_node, flush, wire } from './helpers/stream_wire.ts'

const public_fight = (id = '0xf1', x = 120) => ({
  properties: {
    ...fight_node.properties,
    id,
    placement_ms: Date.now(),
    x,
    machine: JSON.stringify({ ...JSON.parse(fight_node.properties.machine), fighters: [] }),
  },
})
const watch = (player: { on_message: (raw: string) => void }, fight: string | null) =>
  player.on_message(JSON.stringify({ type: 'packet/fight_nearby', character_id: '0xabc', fight }))

test('ambient demand permits one public nearby fight and releases the previous stream', async () => {
  const wires = wire({ fight_read: async (id) => [{ fight: public_fight(id) }] })
  const player = create_player({ ...wires, address: '0xme', admin: false })
  try {
    await flush()
    await embody(player)
    watch(player, '0xf1')
    await flush()
    await flush()
    expect(wires.sent.some((packet) => packet.type === 'packet/fight_state' && packet.fight === '0xf1')).toBe(true)
    watch(player, '0xf2')
    await flush()
    await flush()
    wires.sent.length = 0
    for (const fight of ['0xf1', '0xf2'])
      wires.pubsub.emitter.emit(`evt:fight:${fight}`, { type: 'FightProjected', data: { fight } })
    await flush()
    await flush()
    expect(wires.sent.filter((packet) => packet.type === 'packet/fight_state').map((packet) => packet.fight)).toEqual([
      '0xf2',
    ])
    player.on_message(
      JSON.stringify({
        type: 'packet/fight_action',
        fight: '0xf2',
        action: { type: 'move_to', fighter: '0', path: ['1'] },
      })
    )
    expect(wires.published.some(({ channel }) => channel === 'act:fight:0xf2')).toBe(false)
    watch(player, null)
    await flush()
    wires.sent.length = 0
    wires.pubsub.emitter.emit('evt:fight:0xf2', { type: 'FightProjected', data: { fight: '0xf2' } })
    await flush()
    expect(wires.sent.some((packet) => packet.type === 'packet/fight_state')).toBe(false)
  } finally {
    player.on_close()
  }
})

test.each([
  { x: 151, z: 100 },
  { world: 'elsewhere' },
  { managed: true },
  { wagered: true },
  { phase: 'ended' },
  { placement_ms: Date.now() - 3_600_001 },
])('ambient watch refuses unavailable fights: %j', async (properties) => {
  const fight = public_fight()
  const wires = wire({ fight: { properties: { ...fight.properties, ...properties } } })
  const player = create_player({ ...wires, address: '0xme', admin: false })
  try {
    await flush()
    await embody(player)
    watch(player, '0xf1')
    await flush()
    await flush()
    expect(wires.sent.some((packet) => packet.type === 'packet/fight_state')).toBe(false)
  } finally {
    player.on_close()
  }
})

test('leaving during an initial read cannot restore an ambient subscription', async () => {
  const pending = Promise.withResolvers<{ fight: typeof fight_node }[]>()
  const wires = wire({ fight_read: () => pending.promise })
  const player = create_player({ ...wires, address: '0xme', admin: false })
  try {
    await flush()
    await embody(player)
    watch(player, '0xf1')
    watch(player, null)
    pending.resolve([{ fight: public_fight() }])
    await flush()
    await flush()
    expect(wires.sent.some((packet) => packet.type === 'packet/fight_state')).toBe(false)
  } finally {
    pending.resolve([])
    player.on_close()
  }
})

test('ambient watchers receive draft actions and ordered indexed witnesses, then silence on release', async () => {
  const wires = wire({ fight: public_fight() })
  const player = create_player({ ...wires, address: '0xme', admin: false })
  try {
    await flush()
    await embody(player)
    watch(player, '0xf1')
    await flush()
    await flush()
    wires.sent.length = 0
    const action = { type: 'move_to', fighter: '0', path: ['2'] } as const
    wires.pubsub.emitter.emit('act:fight:0xf1', { kind: 'action', address: '0xother', action })
    wires.pubsub.emitter.emit('evt:fight:0xf1', {
      type: 'TurnSeedUsed',
      data: { fight: '0xf1', seat: '1', seed: '42' },
    })
    wires.pubsub.emitter.emit('evt:fight:0xf1', { type: 'FightProjected', data: { fight: '0xf1' } })
    await flush()
    await flush()
    expect(
      wires.sent
        .filter(({ type }) => ['packet/fight_action', 'packet/turn_seed', 'packet/fight_state'].includes(type))
        .map(({ type }) => type)
    ).toEqual(['packet/fight_action', 'packet/turn_seed', 'packet/fight_state'])
    expect(wires.sent.find(({ type }) => type === 'packet/fight_action')).toEqual({
      type: 'packet/fight_action',
      fight: '0xf1',
      from: '0xother',
      action,
    })
    watch(player, null)
    await flush()
    wires.sent.length = 0
    wires.pubsub.emitter.emit('act:fight:0xf1', { kind: 'action', address: '0xother', action })
    expect(wires.sent).toEqual([])
  } finally {
    player.on_close()
  }
})

test('world discovery excludes old snapshots and late creation events', async () => {
  const now = 10_000_000
  const clock = spyOn(Date, 'now').mockReturnValue(now)
  const fresh = public_fight('0xf1')
  const boundary = { properties: { ...public_fight('0xf2').properties, placement_ms: now - 3_600_000 } }
  const old = { properties: { ...public_fight('0xf3').properties, placement_ms: now - 3_600_001 } }
  const wires = wire({ fight_read: async (id) => [{ fight: id === '0xf3' ? old : fresh }] })
  const player = create_player({ ...wires, address: '0xme', admin: false })
  try {
    const graph = { ...wires.graph, read: async () => [fresh, boundary, old].map((fight) => ({ fight })) }
    expect(
      (await get_world_fights(graph, { world: 'overworld', zones: [{ zx: 0, zz: 0 }] })).map(({ id }) => id)
    ).toEqual(['0xf1', '0xf2'])
    await flush()
    await embody(player)
    wires.pubsub.emitter.emit('evt:zone:overworld:0:0', { type: 'FightCreated', data: { fight: '0xf3' } })
    await flush()
    expect(wires.sent.some(({ type }) => type === 'packet/fight_created')).toBe(false)
    wires.pubsub.emitter.emit('evt:zone:overworld:0:0', { type: 'FightCreated', data: { fight: '0xf1' } })
    await flush()
    expect(wires.sent.find(({ type }) => type === 'packet/fight_created')).toMatchObject({ fight: { id: '0xf1' } })
  } finally {
    player.on_close()
    clock.mockRestore()
  }
})
