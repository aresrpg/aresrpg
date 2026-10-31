// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'
import type { ServerPacket } from '@aresrpg/protocol'

import player_requests from '../../src/modules/player_requests.ts'
import type { PlayerContext } from '../../src/player.ts'
import type { GraphRow } from '../../src/graph.ts'

test('floor failures answer their request; closed connections suppress pending replies', async () => {
  const events = new EventEmitter()
  const controller = new AbortController()
  const packets: ServerPacket[] = []
  let pending = Promise.withResolvers<GraphRow[]>()
  player_requests.observe({
    events,
    signal: controller.signal,
    graph: { read: () => pending.promise },
    send: (packet: ServerPacket) => packets.push(packet),
  } as unknown as PlayerContext)
  events.emit('packet/market_floor_request', { id: 1, item_type: 'wheat' })
  pending.reject(new Error('floor test failure'))
  await Bun.sleep(0)
  expect(packets).toEqual([{ type: 'packet/error', id: 1, reason: 'market floor lookup failed' }])
  pending = Promise.withResolvers<GraphRow[]>()
  events.emit('packet/market_floor_request', { id: 2, item_type: 'wheat' })
  controller.abort()
  pending.resolve([{ amount: 10, price: '123' }])
  await Bun.sleep(0)
  expect(packets).toHaveLength(1)
})
