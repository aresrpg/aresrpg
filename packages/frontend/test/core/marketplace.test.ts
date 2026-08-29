// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import marketplace_module, {
  market_group_count,
  market_observation,
  market_sale_notice,
} from '../../src/modules/marketplace.ts'
import { initial_app_state, reduce_app_state, type AppInput } from '../../src/store.ts'
import { toast, type Toast } from '../../src/toast.ts'

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

  test('the browse rail counts every group from the aggregate market projection', () => {
    const counts = { categories: { hat: 2, sword: 3, pet: 4, rune: 5, resource: 6 }, characters: 7 }
    expect(market_group_count('EQUIPMENT', counts)).toBe(5)
    expect(market_group_count('PETS', counts)).toBe(4)
    expect(market_group_count('RUNES', counts)).toBe(5)
    expect(market_group_count('CONSUMABLE', counts)).toBe(0)
    expect(market_group_count('RESOURCES', counts)).toBe(6)
    expect(market_group_count('CHARACTERS', counts)).toBe(7)
    expect(market_group_count('RESOURCES', { categories: {}, characters: 0 }, 1)).toBe(1)
    const state = reduce_app_state(initial_app_state(settings), {
      type: 'server/packet',
      packet: { type: 'packet/market_counts', counts },
    })
    expect(state.marketplace.counts).toEqual(counts)
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

  test('a sold packet removes the listing and prepends history immediately', () => {
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
      packet: { type: 'packet/listings', listings: [listing] },
    })
    const sold = reduce_app_state(listed, { type: 'server/packet', packet: { type: 'packet/listing_sold', sale } })

    expect(sold.marketplace.own_listings).toEqual([])
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
