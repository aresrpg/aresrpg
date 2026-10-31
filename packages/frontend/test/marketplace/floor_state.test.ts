// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { ClientPacket } from '@aresrpg/protocol'

import { fold_market_floor, send_market_floor_request, type MarketFloor } from '../../src/marketplace/floor_state.ts'
import type { AppInput, AppState } from '../../src/store.ts'

const opened = () => fold_market_floor(null, { type: 'market/floor_selected', item_type: 'wheat' })!
const requested = () => fold_market_floor(opened(), { type: 'market/floor_requested', id: 7 })!
const response = (id: number, prices: Readonly<Record<string, string>> = { 1: '1', 10: '123456789' }): AppInput => ({
  type: 'server/packet',
  packet: { type: 'packet/market_floor', id, prices },
})

test('closing and reopening the same item rejects the previous reply', () => {
  const closed = fold_market_floor(requested(), { type: 'market/floor_selected', item_type: null })
  expect(fold_market_floor(closed, response(7))).toBeNull()
  const reopened = fold_market_floor(opened(), { type: 'market/floor_requested', id: 8 })!
  expect(fold_market_floor(reopened, response(7))).toBe(reopened)
  expect(fold_market_floor(reopened, response(8))?.prices[10]).toBe('123456789')
})

test('empty, refused and disconnected reads stay distinct', () => {
  expect(fold_market_floor(requested(), response(7, {}))?.status).toBe('ready')
  expect(
    fold_market_floor(requested(), {
      type: 'server/packet',
      packet: { type: 'packet/error', id: 7, reason: 'rate limited' },
    })?.status
  ).toBe('unavailable')
  expect(fold_market_floor(requested(), { type: 'link/failed', error: 'offline' })?.status).toBe('unavailable')
  const other = { type: 'server/packet', packet: { type: 'packet/error', id: 8, reason: 'unrelated' } } as const
  const floor = requested()
  expect(fold_market_floor(floor, other)).toBe(floor)
})

test('one opening sends once; rendering and quantity changes do not poll or repeat', () => {
  let floor: MarketFloor | null = opened()
  const sent: ClientPacket[] = []
  const send = () =>
    send_market_floor_request({
      state: { marketplace: { floor } } as AppState,
      next_id: () => 7,
      dispatch: (input) => {
        floor = fold_market_floor(floor, input)
      },
      link: {
        send: (packet) => {
          sent.push(packet)
          return true
        },
        dispose: () => {},
      },
    })
  send()
  send()
  floor = fold_market_floor(floor, response(7))
  send()
  expect(sent).toEqual([{ type: 'packet/market_floor_request', id: 7, item_type: 'wheat' }])
})

test('an unavailable socket settles the request without retries', () => {
  let floor: MarketFloor | null = opened()
  send_market_floor_request({
    state: { marketplace: { floor } } as AppState,
    next_id: () => 1,
    link: null,
    dispatch: (input) => {
      floor = fold_market_floor(floor, input)
    },
  })
  expect(floor?.status).toBe('unavailable')
})
