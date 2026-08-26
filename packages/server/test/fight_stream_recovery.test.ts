// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_player } from '../src/player.ts'

import { embody, fight_node, flush, wire } from './helpers/stream_wire.ts'

test('a cleared preview cannot be re-armed by its older graph read', async () => {
  let resolve_fight!: (rows: { fight: typeof fight_node }[]) => void
  const delayed = new Promise<{ fight: typeof fight_node }[]>((resolve) => {
    resolve_fight = resolve
  })
  const { sent, ws, graph, pubsub } = wire({ fight_read: () => delayed })
  const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
  await flush()
  await embody(player)
  player.on_message(JSON.stringify({ type: 'packet/fight_preview', character_id: '0xabc', fight: '0xf1' }))
  player.on_message(JSON.stringify({ type: 'packet/fight_preview', character_id: '0xabc', fight: null }))
  resolve_fight([{ fight: fight_node }])
  await flush()
  await flush()
  const before = sent.filter((packet) => packet.type === 'packet/fight_state').length
  pubsub.emitter.emit('evt:fight:0xf1', { type: 'FightProjected', data: { fight: '0xf1' } })
  await flush()
  expect(sent.filter((packet) => packet.type === 'packet/fight_state')).toHaveLength(before)
})

test('only a participant may request one canonical fight resync', async () => {
  const { sent, ws, graph, pubsub, published } = wire()
  const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
  await flush()
  await embody(player)
  player.on_message(JSON.stringify({ type: 'packet/fight_resync', fight: '0xf1' }))
  expect(sent.find((packet) => packet.type === 'packet/error' && packet.reason === 'not in this fight')).toBeTruthy()

  pubsub.emitter.emit('evt:character:0xabc', {
    type: 'CharacterSeated',
    data: { fight: '0xf1', character: '0xabc', seat: 0 },
  })
  await flush()
  await flush()
  const before = sent.filter((packet) => packet.type === 'packet/fight_state').length
  player.on_message(JSON.stringify({ type: 'packet/fight_resync', fight: '0xf1' }))
  await flush()
  const fact = published.find(
    ({ channel, payload }) => channel === 'act:fight:0xf1' && Reflect.get(payload, 'kind') === 'resync'
  )
  expect(fact).toBeDefined()
  expect(sent.filter((packet) => packet.type === 'packet/fight_state')).toHaveLength(before + 1)
})
