// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { ListingRow } from '@aresrpg/protocol'

import marketplace_module from '../../src/modules/marketplace.ts'
import { initial_app_state, reduce_app_state } from '../../src/store.ts'
import { displayed_listings, market_page_ready, remember_offer_page } from '../../src/marketplace/browse_cache.ts'

const settings = { quality: 'medium', music_enabled: true, render_distance: null } as const
const barley: ListingRow = {
  kind: 'item',
  version: '1',
  id: 'barley',
  item_type: 'bag_barley',
  name: 'Bag of Barley',
  category: 'consumable',
  level: 1,
  amount: 1,
  price_mist: '1000000000',
  kiosk: 'seller',
  seller: 'other',
  at_ms: 1,
}
const select = (state: ReturnType<typeof initial_app_state>, item_type: string) =>
  reduce_app_state(state, { type: 'market/group_selected', group: 'CONSUMABLE', category: 'consumable', item_type })
const snapshot = (state: ReturnType<typeof initial_app_state>, listings: readonly ListingRow[]) =>
  reduce_app_state(state, {
    type: 'server/packet',
    packet: {
      type: 'packet/market_slice',
      observation: state.marketplace.observation!,
      listings: [...listings],
      kiosk_versions: { seller: '1' },
      next_cursor: null,
    },
  })

test('returning cached rows never become purchase authority; a fresh empty page removes them', () => {
  const first = snapshot(select(initial_app_state(settings), 'bag_barley'), [barley])
  const other = snapshot(select(first, 'bag_quartz'), [{ ...barley, id: 'quartz', item_type: 'bag_quartz' }])
  const back = select(other, 'bag_barley')
  expect(displayed_listings(back.marketplace)).toEqual([barley])
  expect(back.marketplace.listings).toEqual([])
  expect(market_page_ready(back.marketplace)).toBe(false)
  expect(reduce_app_state(back, { type: 'market/buy_requested', listing: barley }).marketplace.pending).toBeNull()
  const empty = snapshot(back, [])
  expect(displayed_listings(empty.marketplace)).toEqual([])
  expect(market_page_ready(empty.marketplace)).toBe(true)
  const reopened = reduce_app_state(first, { type: 'market/opened' })
  expect(displayed_listings(reopened.marketplace)).toEqual([barley])
  expect(market_page_ready(reopened.marketplace)).toBe(false)
  expect(reopened.marketplace.observation!.request).toBeGreaterThan(first.marketplace.observation!.request)
})

test('recent pages are bounded and distinct cursors cannot replace one another', () => {
  const query = { kind: 'offers', category: 'consumable', item_type: 'bag_barley', request: 1 } as const
  const pages = Array.from({ length: 12 }, (_, i) => i).reduce(
    (pages, i) => remember_offer_page(pages, { ...query, cursor: String(i) }, [barley]),
    remember_offer_page([], query, [barley])
  )
  expect(pages).toHaveLength(10)
  expect(new Set(pages.map((page) => page.key)).size).toBe(10)
})

test('the purchase observer never invokes the SDK for cached or changed offers', () => {
  const ready = snapshot(select(initial_app_state(settings), 'bag_barley'), [barley])
  const stale = select(select(ready, 'bag_quartz'), 'bag_barley')
  let current = stale
  const listeners = new Map<string, (input: never) => void>()
  let calls = 0
  const controller = new AbortController()
  marketplace_module.observe?.({
    signal: controller.signal,
    get_state: () => ({
      ...current,
      session: {
        ...current.session,
        wallet: {
          marketplace: {
            buy: () => {
              calls++
            },
          },
        },
      },
    }),
    events: { on: (name: string, listener: (input: never) => void) => listeners.set(name, listener) },
    dispatch: () => {},
  } as never)
  listeners.get('market/buy_requested')?.({ listing: barley } as never)
  expect(calls).toBe(0)
  current = ready
  listeners.get('market/buy_requested')?.({ listing: { ...barley, price_mist: '2000000000' } } as never)
  expect(calls).toBe(0)
  controller.abort()
})

test('reconnection keeps display snapshots but clears old live purchase rows', () => {
  const first = snapshot(select(initial_app_state(settings), 'bag_barley'), [barley])
  const disconnected = reduce_app_state(first, { type: 'link/failed', error: 'offline' })
  expect(disconnected.marketplace.listings).toEqual([])
  expect(displayed_listings(disconnected.marketplace)).toEqual([barley])
  expect(market_page_ready(disconnected.marketplace)).toBe(false)
  const empty = reduce_app_state(disconnected, {
    type: 'server/packet',
    packet: {
      type: 'packet/market_slice',
      observation: disconnected.marketplace.observation!,
      listings: [],
      kiosk_versions: {},
      next_cursor: null,
    },
  })
  expect(displayed_listings(empty.marketplace)).toEqual([])
})
