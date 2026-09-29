// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_player } from './helpers/player.ts'
import { embody, fight_node, flush, wire } from './helpers/stream_wire.ts'

const public_fight = (id = '0xf1', x = 120) => ({
  properties: {
    ...fight_node.properties,
    id,
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

test.each([{ x: 151, z: 100 }, { world: 'elsewhere' }, { managed: true }, { wagered: true }, { phase: 'ended' }])(
  'ambient watch refuses unavailable fights: %j',
  async (properties) => {
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
  }
)

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
