// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'

import { create_game_state } from '../src/game_state.ts'

test('game state subscribes before loading the Version snapshot and then follows indexer changes', async () => {
  const calls: string[] = []
  const emitter = new EventEmitter()
  const game_state = create_game_state({
    graph: {
      read: async () => {
        calls.push('read')
        return [{ version: 1 }]
      },
      close: async () => {},
    },
    pubsub: {
      emitter,
      subscribe: async () => void calls.push('subscribe'),
      unsubscribe: async () => {},
      indexed_checkpoint: async () => null,
      sales_history: async () => [],
      close: () => {},
    },
  })
  const seen: (boolean | null)[] = []
  game_state.listen((frozen) => seen.push(frozen))

  await game_state.start()
  emitter.emit('evt:game', { type: 'GameStateChanged', data: { frozen: true } })

  expect(calls).toEqual(['subscribe', 'read'])
  expect(game_state.get()).toBeTrue()
  expect(seen).toEqual([false, true])
})
