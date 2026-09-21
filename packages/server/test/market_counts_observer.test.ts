// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'
import type { MarketObservation, ServerPacket } from '@aresrpg/protocol'

import { create_public_market } from '../src/public_market.ts'
import { observe_market_counts } from '../src/market_counts_observer.ts'

import { flush } from './helpers/world_wire.ts'

test('overview receives counts and changing selection resends the same snapshot without another query', async () => {
  const emitter = new EventEmitter(),
    events = new EventEmitter(),
    controller = new AbortController()
  const packets: ServerPacket[] = []
  let reads = 0
  let state: { market_observation: MarketObservation | null } = { market_observation: null }
  const public_market = create_public_market(
    {
      read: async () => {
        reads++
        return [{ category: 'hat', types: 2 }]
      },
      close: async () => {},
    },
    { emitter, subscribe: async () => {}, unsubscribe: async () => {} }
  )
  observe_market_counts({
    public_market,
    events,
    signal: controller.signal,
    get_state: () => state,
    send: (packet: ServerPacket) => packets.push(packet),
  } as never)
  const change = (observation: MarketObservation | null) => {
    const previous = state
    state = { market_observation: observation }
    events.emit('STATE_UPDATED', state, previous)
  }
  try {
    change({ kind: 'overview', request: 1 })
    await flush()
    expect(packets).toEqual([
      { type: 'packet/market_counts', observation: { kind: 'overview', request: 1 }, counts: { hat: 2 } },
    ])
    change({ kind: 'types', category: 'hat', request: 2 })
    await flush()
    expect(reads).toBe(1)
    expect(packets.at(-1)).toMatchObject({ observation: { request: 2 }, counts: { hat: 2 } })
    change(null)
    await flush()
    expect(emitter.eventNames()).toEqual([])
  } finally {
    controller.abort()
  }
})
