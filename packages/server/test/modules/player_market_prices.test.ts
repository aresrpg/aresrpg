// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'
import type { MarketPriceHistory, MarketPriceObservation, ServerPacket } from '@aresrpg/protocol'

import { observe_market_prices } from '../../src/market_prices_observer.ts'
import player_market from '../../src/modules/player_market.ts'
import type { PlayerContext, PlayerState } from '../../src/player.ts'

const harness = () => {
  const events = new EventEmitter()
  const controller = new AbortController()
  const packets: ServerPacket[] = []
  const reads: {
    item_type: string
    resolve: (history: MarketPriceHistory | null) => void
    reject: (reason: Error) => void
  }[] = []
  let state = { market_price_observation: null, market_observation: null } as PlayerState
  observe_market_prices({
    events,
    signal: controller.signal,
    get_state: () => state,
    send: (packet: ServerPacket) => packets.push(packet),
    pubsub: {
      graph: {
        market_prices: (item_type: string) =>
          new Promise<MarketPriceHistory | null>((resolve, reject) => reads.push({ item_type, resolve, reject })),
      },
    },
  } as unknown as PlayerContext)
  const observe = (observation: MarketPriceObservation | null) => {
    const previous = state
    state = player_market.reduce(state, { type: 'packet/market_prices_observe', observation })
    events.emit('STATE_UPDATED', state, previous)
  }
  return { reads, packets, controller, observe }
}

const history = { first_timestamp_ms: 1, sampled_at_ms: 2, buckets: [] }

test('selection changes coalesce behind one read and obsolete results never reach the client', async () => {
  const h = harness()
  try {
    h.observe({ item_type: 'quartz', id: 1 })
    h.observe({ item_type: 'wood', id: 2 })
    h.observe({ item_type: 'ore', id: 3 })
    expect(h.reads.map(({ item_type }) => item_type)).toEqual(['quartz'])
    h.reads[0]!.resolve(history)
    await Bun.sleep(0)
    expect(h.packets).toEqual([])
    expect(h.reads.map(({ item_type }) => item_type)).toEqual(['quartz', 'ore'])
    h.reads[1]!.resolve(history)
    await Bun.sleep(0)
    expect(h.packets).toEqual([{ type: 'packet/market_prices', observation: { item_type: 'ore', id: 3 }, history }])
    h.observe({ item_type: 'quartz', id: 4 })
    h.observe(null)
    h.reads[2]!.resolve(history)
    await Bun.sleep(0)
    expect(h.packets).toHaveLength(1)
  } finally {
    h.controller.abort()
  }
})

test('failed reads report unavailable; connection teardown suppresses later completions', async () => {
  const h = harness()
  try {
    h.observe({ item_type: 'quartz', id: 1 })
    h.reads[0]!.reject(new Error('price test failure'))
    await Bun.sleep(0)
    expect(h.packets).toEqual([
      { type: 'packet/market_prices', observation: { item_type: 'quartz', id: 1 }, history: null },
    ])
    h.observe({ item_type: 'wood', id: 2 })
    h.controller.abort()
    h.reads[1]!.resolve(history)
    await Bun.sleep(0)
    expect(h.packets).toHaveLength(1)
  } finally {
    h.controller.abort()
  }
})
