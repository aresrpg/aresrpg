// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { market_observation } from '../../src/modules/marketplace.ts'
import { initial_app_state, reduce_app_state } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)
const listing = Object.freeze({
  kind: 'item' as const,
  id: '0xitem',
  name: 'Blade',
  item_type: 'aberrant_edge',
  category: 'sword',
  level: 80,
  amount: 1,
  price_mist: '1000000000',
  kiosk: '0xkiosk',
  seller: '0xseller',
  at_ms: 10,
})

describe('marketplace projection', () => {
  test('browse groups compile to exact chain-category windows', () => {
    expect(market_observation('PETS')).toEqual({ categories: ['pet'], characters: false })
    expect(market_observation('CHARACTERS')).toEqual({ categories: [], characters: true })
    expect(market_observation('EQUIPMENT').categories).toContain('sword')
    expect(market_observation('EQUIPMENT').categories).not.toContain('resource')
  })

  test('a pushed slice is patched by live listing deltas without polling or a second store', () => {
    const initial = initial_app_state(settings)
    const opened = reduce_app_state(initial, { type: 'market/group_selected', group: 'EQUIPMENT' })
    const sliced = reduce_app_state(opened, {
      type: 'server/packet',
      packet: { type: 'packet/market_slice', observation: market_observation('EQUIPMENT'), listings: [listing] },
    })
    const removed = reduce_app_state(sliced, {
      type: 'server/packet',
      packet: { type: 'packet/market_delisted', object: listing.id },
    })
    expect(sliced.marketplace.listings).toEqual([listing])
    expect(removed.marketplace.listings).toEqual([])
  })

  test('an older async slice cannot roll the selected browse window back', () => {
    const equipment = reduce_app_state(initial_app_state(settings), {
      type: 'market/group_selected',
      group: 'EQUIPMENT',
    })
    const pets = reduce_app_state(equipment, { type: 'market/group_selected', group: 'PETS' })
    const stale = reduce_app_state(pets, {
      type: 'server/packet',
      packet: { type: 'packet/market_slice', observation: market_observation('EQUIPMENT'), listings: [listing] },
    })
    expect(stale).toBe(pets)
    expect(stale.marketplace.observation).toEqual(market_observation('PETS'))
  })

  test('history and unclaimed proceeds arrive as one server projection', () => {
    const state = reduce_app_state(initial_app_state(settings), {
      type: 'server/packet',
      packet: {
        type: 'packet/market_history',
        sales: [
          {
            object: '0xitem',
            kind: 'item',
            item_type: 'aberrant_edge',
            amount: 1,
            price_mist: '7',
            counterparty: '0xbuyer',
            ts_ms: 10,
          },
        ],
        revenue_30d_mist: '7',
        total: 1,
        profits: [{ kiosk: '0xkiosk', amount_mist: '6' }],
      },
    })
    expect(state.marketplace.history).toHaveLength(1)
    expect(state.marketplace.revenue_30d_mist).toBe('7')
    expect(state.marketplace.profits).toEqual([{ kiosk: '0xkiosk', amount_mist: '6' }])
    expect(reduce_app_state(state, { type: 'auth/disconnected' }).marketplace).toEqual(
      initial_app_state(settings).marketplace
    )
  })
})
