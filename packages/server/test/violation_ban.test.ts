// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_player } from './helpers/player.ts'
import { flush, wire } from './helpers/stream_wire.ts'

// Regression: the cool-off ban was read from the close frame of ANY socket, for the address that
// socket merely claimed in its URL. A script that never signed in could send close 1008 "RATE_LIMIT"
// and lock any player or hosted bot out for ten minutes. The ban now belongs to the server's own
// decision to drop a verified player.
test('a verified player the server drops for a violation is penalized, once per drop', async () => {
  const penalized: string[] = []
  const { ws, graph, pubsub } = wire()
  const closes: string[] = []
  const socket = { ...ws, close: (_code: number, reason: string) => void closes.push(reason) }
  const player = create_player({
    ws: socket as typeof ws,
    address: '0xme',
    admin: false,
    graph,
    pubsub,
    realtime_limiter: { take: () => false, size: () => 0 },
    penalize: () => void penalized.push('0xme'),
  })
  await flush()
  player.on_message(JSON.stringify({ type: 'packet/ping' }))
  expect(closes).toEqual(['RATE_LIMIT'])
  expect(penalized).toEqual(['0xme'])
})

test('a player that only disconnects is never penalized', async () => {
  const penalized: string[] = []
  const { ws, graph, pubsub } = wire()
  const player = create_player({
    ws,
    address: '0xme',
    admin: false,
    graph,
    pubsub,
    penalize: () => void penalized.push('0xme'),
  })
  await flush()
  player.on_close()
  expect(penalized).toEqual([])
})
