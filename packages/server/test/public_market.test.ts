// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'

import { create_public_market, market_change_matches } from '../src/public_market.ts'
import type { EventEnvelope } from '../src/protocol.ts'

import { flush } from './helpers/world_wire.ts'

test('category discovery shares reads and refreshes only the affected category', async () => {
  const emitter = new EventEmitter()
  const reads: unknown[] = []
  const market = create_public_market(
    {
      read: async (_query, params) => {
        reads.push(params?.category)
        return [{ item_type: 'template', name: 'Item', level: 1 }]
      },
      close: async () => {},
    },
    { emitter, subscribe: async () => {}, unsubscribe: async () => {} }
  )
  const stops = Array.from({ length: 100 }, () =>
    market.watch(
      'hat',
      () => {},
      () => {}
    )
  )
  stops.push(
    market.watch(
      'cloak',
      () => {},
      () => {}
    )
  )
  await flush()
  expect(reads).toEqual(['hat', 'cloak'])
  emitter.emit('evt:economy', {
    type: 'MarketPurchased',
    data: { kind: 'item', category: 'hat', item_type: 'template' },
  })
  await flush()
  expect(reads).toEqual(['hat', 'cloak', 'hat'])
  stops.forEach((stop) => stop())
  await flush()
  expect(emitter.eventNames()).toEqual([])
})

test('offer invalidation uses indexed item identity and preserves conservative unknown departures', () => {
  const observation = { kind: 'offers', category: 'hat', item_type: 'mokan', request: 1 } as const
  const event = (data: Record<string, unknown>) => ({ type: 'MarketDelisted', data }) as EventEnvelope
  expect(market_change_matches(event({ kind: 'item', category: 'hat', item_type: 'mokan' }), observation)).toBeTrue()
  expect(market_change_matches(event({ kind: 'item', category: 'hat', item_type: 'other' }), observation)).toBeFalse()
  expect(market_change_matches(event({ kind: 'character' }), observation)).toBeFalse()
  expect(market_change_matches(event({}), observation)).toBeTrue()
})

test('all catalogue badges share one bounded query and no background work without viewers', async () => {
  const emitter = new EventEmitter()
  let reads = 0
  const market = create_public_market(
    {
      read: async () => {
        reads++
        return [{ category: 'hat', types: 2 }]
      },
      close: async () => {},
    },
    { emitter, subscribe: async () => {}, unsubscribe: async () => {} }
  )
  const delivered: unknown[] = []
  const stops = Array.from({ length: 100 }, () =>
    market.counts.watch(
      'all',
      (counts) => delivered.push(counts),
      () => {}
    )
  )
  await flush()
  expect(reads).toBe(1)
  expect(delivered).toHaveLength(100)
  expect(delivered[0]).toEqual({ hat: 2 })
  for (let i = 0; i < 1000; i++) emitter.emit('evt:economy', { type: 'MarketListed', data: { kind: 'item' } })
  await flush()
  expect(reads).toBe(1)
  stops.forEach((stop) => stop())
  await flush()
  expect(emitter.eventNames()).toEqual([])
})
