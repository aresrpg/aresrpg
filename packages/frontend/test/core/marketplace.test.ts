// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import marketplace_module, { market_categories, market_sale_notice } from '../../src/modules/marketplace.ts'
import { initial_app_state, reduce_app_state, type AppInput } from '../../src/store.ts'
import { toast, type Toast } from '../../src/toast.ts'

const equipment_observation = { kind: 'offers', category: 'sword', item_type: 'aberrant_edge', request: 1 } as const

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)
const listing = Object.freeze({
  version: '1',
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
  test('market volume follows the heartbeat epoch and clears unavailable totals', () => {
    const initial = initial_app_state(settings)
    const heartbeat = {
      type: 'packet/server_info' as const,
      online: 1,
      indexing_lag: 0,
      current_epoch: '100',
      chain_timestamp_ms: 1000,
      chain_sample_age_ms: 0,
      market_volume: { day_mist: '123000000000', month_mist: '456000000000', history_days: 30 },
    }
    const ready = reduce_app_state(initial, { type: 'server/packet', packet: heartbeat })
    expect(ready.marketplace.volume).toEqual({ day_mist: '123000000000', month_mist: '456000000000', history_days: 30 })
    const next = reduce_app_state(ready, {
      type: 'server/packet',
      packet: {
        ...heartbeat,
        current_epoch: '101',
        market_volume: { day_mist: '123000000000', month_mist: '456000000000', history_days: 30 },
      },
    })
    expect(next.marketplace.volume).toEqual({ day_mist: '123000000000', month_mist: '456000000000', history_days: 30 })
    const unavailable = reduce_app_state(next, {
      type: 'server/packet',
      packet: { ...heartbeat, market_volume: null },
    })
    expect(unavailable.marketplace.volume).toBeNull()
  })

  test('browse groups compile to exact chain-category windows', () => {
    expect(market_categories('PETS')).toEqual(['pet'])
    expect(market_categories('CHARACTERS')).toEqual([])
    expect(market_categories('EQUIPMENT')).toContain('sword')
    expect(market_categories('EQUIPMENT')).toContain('cosmetic_hat')
    expect(market_categories('EQUIPMENT')).toContain('cosmetic_cloak')
    expect(market_categories('EQUIPMENT')).not.toContain('pet')
    expect(market_categories('EQUIPMENT')).not.toContain('resource')
  })

  test('opening the market requests overview only and category discovery is scoped', () => {
    const opened = reduce_app_state(initial_app_state(settings), { type: 'market/opened' })
    expect(opened.marketplace.observation).toEqual({ kind: 'overview', request: 1 })
    const selected = reduce_app_state(opened, { type: 'market/group_selected', group: 'RESOURCES' })
    const observation = selected.marketplace.observation!
    expect(observation).toEqual({ kind: 'types', category: 'resource', request: 2 })
    const items = [{ item_type: 'wood', category: 'resource' as const, name: 'Wood', level: 1 }]
    const current = reduce_app_state(selected, {
      type: 'server/packet',
      packet: { type: 'packet/market_types', observation, items },
    })
    expect(current.marketplace.types).toEqual(items)
    expect(current.marketplace.listings).toEqual([])
  })

  test('a final pushed slice replaces departed listings without a second store', () => {
    const initial = initial_app_state(settings)
    const opened = reduce_app_state(initial, {
      type: 'market/group_selected',
      group: 'EQUIPMENT',
      category: 'sword',
      item_type: 'aberrant_edge',
    })
    const sliced = reduce_app_state(opened, {
      type: 'server/packet',
      packet: {
        type: 'packet/market_slice',
        next_cursor: null,
        kiosk_versions: { [listing.kiosk]: '1' },
        observation: equipment_observation,
        listings: [listing],
      },
    })
    const removed = reduce_app_state(sliced, {
      type: 'server/packet',
      packet: {
        type: 'packet/market_slice',
        next_cursor: null,
        kiosk_versions: { [listing.kiosk]: '1' },
        observation: equipment_observation,
        listings: [],
      },
    })
    expect(sliced.marketplace.listings).toEqual([listing])
    expect(removed.marketplace.listings).toEqual([])
  })

  test('an older async slice cannot roll the selected browse window back', () => {
    const equipment = reduce_app_state(initial_app_state(settings), {
      type: 'market/group_selected',
      group: 'EQUIPMENT',
      category: 'sword',
      item_type: 'aberrant_edge',
    })
    const pets = reduce_app_state(equipment, { type: 'market/group_selected', group: 'PETS' })
    const stale = reduce_app_state(pets, {
      type: 'server/packet',
      packet: {
        type: 'packet/market_slice',
        next_cursor: null,
        kiosk_versions: { [listing.kiosk]: '1' },
        observation: equipment_observation,
        listings: [listing],
      },
    })
    expect(stale).toBe(pets)
    expect(stale.marketplace.observation).toEqual({ kind: 'types', category: 'pet', request: 2 })
  })

  test('history and unclaimed proceeds arrive as one server projection', () => {
    const state = reduce_app_state(initial_app_state(settings), {
      type: 'server/packet',
      packet: {
        type: 'packet/market_history',
        sales: [
          {
            id: '1:2:3',
            object: '0xitem',
            kind: 'item',
            name: 'Aberrant Edge',
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

  test('a historical sale cannot delete a currently projected relisting', () => {
    const sale = {
      id: '10:2:3',
      object: listing.id,
      kind: 'item' as const,
      name: 'Rune PA Fo',
      item_type: 'rune_action_pa',
      amount: 1,
      price_mist: '2000000000',
      counterparty: '0xbuyer',
      ts_ms: Date.now(),
    }
    const listed = reduce_app_state(initial_app_state(settings), {
      type: 'server/packet',
      packet: { type: 'packet/listings', kiosk_versions: { [listing.kiosk]: '1' }, listings: [listing] },
    })
    const sold = reduce_app_state(listed, { type: 'server/packet', packet: { type: 'packet/listing_sold', sale } })

    expect(sold.marketplace.own_listings).toEqual([listing])
    expect(sold.marketplace.history).toEqual([sale])
    expect(sold.marketplace.history_total).toBe(1)
    expect(sold.marketplace.revenue_30d_mist).toBe('2000000000')
    expect(reduce_app_state(sold, { type: 'server/packet', packet: { type: 'packet/listing_sold', sale } })).toBe(sold)
  })

  test('sale notification localizes token order and keeps semantic colors', () => {
    const notice = market_sale_notice(
      {
        id: '10:2:3',
        object: '0xrune',
        kind: 'item',
        name: 'Rune PA Fo',
        item_type: 'rune_action_pa',
        amount: 1,
        price_mist: '2000000000',
        counterparty: '0xbuyer',
        ts_ms: 1,
      },
      '{{name}} sold: {{price}} ({{amount}})'
    )

    expect(notice.message).toBe('Rune PA Fo sold: 2.00 SUI (×1)')
    expect(notice.parts).toContainEqual({ text: 'Rune PA Fo', tone: 'primary' })
    expect(notice.parts).toContainEqual({ text: '2.00 SUI', tone: 'sui' })
  })

  test('the pubsub sale packet emits one success toast when duplicated', () => {
    const listeners = new Map<string, (payload: never) => void>()
    const events: unknown[] = []
    const base = initial_app_state(settings)
    const state = {
      ...base,
      copy: { marketplace_page: { sold_toast: 'Sold {{amount}} {{name}} for {{price}}' } },
    } as never
    const unsubscribe = toast.subscribe((event) => events.push(event))
    marketplace_module.observe?.({
      events: { on: (name: string, listener: (payload: never) => void) => listeners.set(name, listener) },
      signal: new AbortController().signal,
      get_state: () => state,
      dispatch: () => undefined,
    } as never)
    const packet = {
      type: 'packet/listing_sold',
      sale: {
        id: '10:2:3',
        object: '0xrune',
        kind: 'item',
        name: 'Rune PA Fo',
        item_type: 'rune_action_pa',
        amount: 1,
        price_mist: '2000000000',
        counterparty: '0xbuyer',
        ts_ms: 1,
      },
    }
    listeners.get('server/packet')?.({ packet } as never)
    listeners.get('server/packet')?.({ packet } as never)
    const shown = events.filter((event) => (event as { type: string }).type === 'show') as Readonly<
      { type: 'show'; toast: Toast }[]
    >

    expect(shown).toHaveLength(1)
    expect(shown[0]!.toast).toMatchObject({ message: 'Sold ×1 Rune PA Fo for 2.00 SUI', type: 'success' })
    unsubscribe()
  })

  test('a full roster refuses a character purchase before any transaction leaves', () => {
    const listeners = new Map<string, (payload: never) => void>()
    const dispatched: AppInput[] = []
    const bought: unknown[] = []
    const base = initial_app_state(settings)
    const state = {
      ...base,
      session: {
        ...base.session,
        characters: Array.from({ length: 6 }, (_, index) => ({ id: `0xc${index}` })),
        wallet: { marketplace: { buy: (asset: unknown) => (bought.push(asset), Promise.resolve({ digest: '0x' })) } },
      },
    } as never
    marketplace_module.observe?.({
      events: { on: (name: string, listener: (payload: never) => void) => listeners.set(name, listener) },
      signal: new AbortController().signal,
      get_state: () => state,
      dispatch: (input: AppInput) => dispatched.push(input),
    } as never)
    listeners.get('market/buy_requested')?.({
      listing: { ...listing, kind: 'character', item_type: null, category: null },
    } as never)

    expect(bought).toHaveLength(0)
    expect(dispatched).toMatchObject([{ type: 'market/write_failed' }])
  })
})

test('a certified own listing survives an older empty kiosk catalogue but a later removal wins', () => {
  const row = { ...listing, version: '10' }
  const written = reduce_app_state(initial_app_state(settings), {
    type: 'market/write_succeeded',
    operation: 'list',
    listing: row,
    version: '10',
  })
  const old = reduce_app_state(written, {
    type: 'server/packet',
    packet: { type: 'packet/listings', listings: [], kiosk_versions: { [listing.kiosk]: '9' } },
  })
  expect(old.marketplace.own_listings).toEqual([row])
  const removed = reduce_app_state(old, {
    type: 'server/packet',
    packet: { type: 'packet/listings', listings: [], kiosk_versions: { [listing.kiosk]: '11' } },
  })
  expect(removed.marketplace.own_listings).toEqual([])
})

test('a certified purchase rejects its stale source listing while an equal-version cross-kiosk relist survives', () => {
  const opened = reduce_app_state(initial_app_state(settings), {
    type: 'market/group_selected',
    group: 'EQUIPMENT',
    category: 'sword',
    item_type: 'aberrant_edge',
  })
  const bought = reduce_app_state(opened, {
    type: 'market/write_succeeded',
    operation: 'buy',
    listing: { ...listing, version: '9' },
    version: '10',
  })
  const old = reduce_app_state(bought, {
    type: 'server/packet',
    packet: {
      type: 'packet/market_slice',
      next_cursor: null,
      observation: equipment_observation,
      listings: [{ ...listing, version: '9' }],
      kiosk_versions: { [listing.kiosk]: '9' },
    },
  })
  expect(old.marketplace.listings).toEqual([])
  const relisted = { ...listing, kiosk: '0xnew-kiosk', version: '10' }
  const current = reduce_app_state(old, {
    type: 'server/packet',
    packet: {
      type: 'packet/market_slice',
      next_cursor: null,
      observation: equipment_observation,
      listings: [relisted],
      kiosk_versions: { [listing.kiosk]: '10', '0xnew-kiosk': '10' },
    },
  })
  expect(current.marketplace.listings).toEqual([relisted])
})

test('same-revision partial reads cannot erase a receipt and stale rows cannot overwrite its price', () => {
  const opened = reduce_app_state(initial_app_state(settings), {
    type: 'market/group_selected',
    group: 'EQUIPMENT',
    category: 'sword',
    item_type: 'aberrant_edge',
  })
  const row = { ...listing, version: '12', price_mist: '12' }
  const written = reduce_app_state(opened, {
    type: 'market/write_succeeded',
    operation: 'list',
    listing: row,
    version: '12',
  })
  const same = reduce_app_state(written, {
    type: 'server/packet',
    packet: { type: 'packet/listings', listings: [], kiosk_versions: { [listing.kiosk]: '12' } },
  })
  const stale = reduce_app_state(same, {
    type: 'server/packet',
    packet: {
      type: 'packet/market_slice',
      next_cursor: null,
      observation: equipment_observation,
      listings: [{ ...listing, version: '11' }],
      kiosk_versions: { [listing.kiosk]: '11' },
    },
  })
  expect(stale.marketplace.own_listings).toEqual([row])
  expect(stale.marketplace.listings).toEqual([])
  const gone = reduce_app_state(stale, {
    type: 'server/packet',
    packet: { type: 'packet/listings', listings: [], kiosk_versions: { [listing.kiosk]: '13' } },
  })
  expect(gone.marketplace.own_listings).toEqual([])
  expect(gone.marketplace.listings).toEqual([])
})

test('confirmed departures retain only current and previous catalogue metadata', () => {
  let state = reduce_app_state(initial_app_state(settings), {
    type: 'market/group_selected',
    group: 'EQUIPMENT',
    category: 'sword',
    item_type: 'aberrant_edge',
  })
  for (let i = 0; i < 500; i += 1) {
    const row = { ...listing, kiosk: `kiosk-${i}`, version: '9' }
    state = reduce_app_state(state, { type: 'market/write_succeeded', operation: 'buy', listing: row, version: '10' })
    state = reduce_app_state(state, {
      type: 'server/packet',
      packet: {
        type: 'packet/market_slice',
        next_cursor: null,
        observation: equipment_observation,
        listings: [],
        kiosk_versions: { [`kiosk-${i}`]: '10', [`kiosk-${i - 1}`]: '10' },
      },
    })
  }
  expect(state.marketplace.departures).toEqual({})
  expect(Object.keys(state.marketplace.catalogues)).toHaveLength(2)
})

test('an owned listing receipt does not replace another seller on the current public page', () => {
  const opened = reduce_app_state(initial_app_state(settings), {
    type: 'market/group_selected',
    group: 'EQUIPMENT',
    category: 'sword',
    item_type: 'aberrant_edge',
  })
  const rows = Array.from({ length: 60 }, (_, index) => ({
    ...listing,
    id: `item-${index}`,
    kiosk: 'other-kiosk',
    at_ms: index,
  }))
  const full = reduce_app_state(opened, {
    type: 'server/packet',
    packet: {
      type: 'packet/market_slice',
      next_cursor: null,
      observation: equipment_observation,
      listings: rows,
      kiosk_versions: { 'other-kiosk': '1' },
    },
  })
  const row = { ...listing, id: 'new-listing', at_ms: 201, version: '2' }
  const written = reduce_app_state(full, {
    type: 'market/write_succeeded',
    operation: 'list',
    listing: row,
    version: '2',
  })
  expect(written.marketplace.listings).toEqual(rows)
  expect(written.marketplace.own_listings).toEqual([row])
  expect(written.marketplace.listings.some(({ id }) => id === row.id)).toBe(false)
})

test('changing offer pages rejects the previous response and preserves owned catalogue rows', () => {
  const selected = reduce_app_state(initial_app_state(settings), {
    type: 'market/group_selected',
    group: 'EQUIPMENT',
    category: 'sword',
    item_type: listing.item_type,
  })
  const owned = { ...listing, id: 'owned', kiosk: 'own-kiosk', version: '30' }
  const with_own = reduce_app_state(selected, {
    type: 'market/write_succeeded',
    operation: 'list',
    listing: owned,
    version: '30',
  })
  const first = reduce_app_state(with_own, {
    type: 'server/packet',
    packet: {
      type: 'packet/market_slice',
      observation: selected.marketplace.observation!,
      next_cursor: 'roll:next',
      listings: [listing],
      kiosk_versions: { [listing.kiosk]: '1' },
    },
  })
  const next = reduce_app_state(first, { type: 'market/page_requested', direction: 'next' })
  expect(next.marketplace.listings).toEqual([])
  const stale = reduce_app_state(next, {
    type: 'server/packet',
    packet: {
      type: 'packet/market_slice',
      observation: first.marketplace.observation!,
      next_cursor: null,
      listings: [listing],
      kiosk_versions: { [listing.kiosk]: '100' },
    },
  })
  expect(stale).toBe(next)
  const row = { ...listing, id: 'next-page', kiosk: 'next-kiosk' }
  const ready = reduce_app_state(stale, {
    type: 'server/packet',
    packet: {
      type: 'packet/market_slice',
      observation: next.marketplace.observation!,
      next_cursor: null,
      listings: [row],
      kiosk_versions: { [row.kiosk]: '1' },
    },
  })
  expect(ready.marketplace.listings).toEqual([row])
  expect(ready.marketplace.own_listings).toEqual([owned])
  const previous = reduce_app_state(ready, { type: 'market/page_requested', direction: 'previous' })
  expect(previous.marketplace.observation).toMatchObject({ cursor: '', request: 3 })
  expect(previous.marketplace.page_cursors).toEqual([])
})

test('type-count snapshots reject stale observations and distinguish unavailable from zero', () => {
  const opened = reduce_app_state(initial_app_state(settings), { type: 'market/opened' })
  const current = reduce_app_state(opened, {
    type: 'server/packet',
    packet: { type: 'packet/market_counts', observation: opened.marketplace.observation!, counts: { hat: 2 } },
  })
  const selected = reduce_app_state(current, { type: 'market/group_selected', group: 'RESOURCES' })
  const stale = reduce_app_state(selected, {
    type: 'server/packet',
    packet: { type: 'packet/market_counts', observation: opened.marketplace.observation!, counts: { hat: 99 } },
  })
  expect(stale.marketplace.type_counts).toEqual({ hat: 2 })
  const empty = reduce_app_state(stale, {
    type: 'server/packet',
    packet: { type: 'packet/market_counts', observation: selected.marketplace.observation!, counts: {} },
  })
  expect(empty.marketplace.type_counts).toEqual({})
  const unavailable = reduce_app_state(empty, {
    type: 'server/packet',
    packet: { type: 'packet/market_counts', observation: selected.marketplace.observation!, counts: null },
  })
  expect(unavailable.marketplace.type_counts).toBeNull()
})
