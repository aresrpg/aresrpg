// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_player } from '../src/player.ts'

import { flush, wire } from './helpers/stream_wire.ts'

test('certified character deletion refreshes the roster and releases the character watch', async () => {
  const { sent, ws, graph, pubsub } = wire()
  let deleted = false
  const player = create_player({
    ws,
    address: '0xme',
    admin: false,
    pubsub,
    graph: {
      ...graph,
      read: async (query, params) =>
        deleted && query.includes('RETURN c AS character') ? [] : graph.read(query, params),
    },
  })
  try {
    await flush()
    expect(
      sent
        .filter((packet) => packet.type === 'packet/characters')
        .at(-1)
        ?.characters.some(({ id }) => id === '0xabc')
    ).toBeTrue()
    deleted = true
    pubsub.emitter.emit('evt:character:0xabc', { type: 'CharacterDeleted', data: { character: '0xabc' } })
    await flush()
    expect(sent.filter((packet) => packet.type === 'packet/characters').at(-1)?.characters).toEqual([])
    expect(pubsub.emitter.listenerCount('evt:character:0xabc')).toBe(0)
  } finally {
    player.on_close()
  }
})
