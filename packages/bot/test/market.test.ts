// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { ListingRow, MarketObservation, ServerPacket } from '@aresrpg/protocol'
import type { Receipt } from '@aresrpg/sdk/cache'

import { empty_inventory, fold_actor_inventory } from '../src/actor_inventory.ts'
import {
  fold_actor_market,
  fold_market_receipt,
  market_observation_progress,
  market_receipt_relation,
  same_market_observation,
} from '../src/actor_market.ts'
import { select_purchase, select_sale } from '../src/behavior_market.ts'
import {
  validate_market_buy,
  validate_market_sell,
  market_sell_projected,
  MARKET_SELL_ACTION,
} from '../src/market_actions.ts'
import { market_price_condition, market_prices_observed } from '../src/market_prices.ts'
import { parse_behavior_script } from '../src/behavior_script.ts'

import { character, item, profession_context, resource } from './helpers/profession_fixture.ts'

const id = (n: number) => `0x${String(n).padStart(64, '0')}`
const observation: MarketObservation = {
  kind: 'offers',
  category: 'resource',
  item_type: resource.item_type,
  request: 1,
}
const listing = (n: number, amount = 1, price_mist = '20000000'): ListingRow => ({
  id: id(n),
  kiosk: id(80),
  seller: id(81),
  version: '1',
  kind: 'item',
  name: 'Resource',
  item_type: resource.item_type,
  category: 'resource',
  level: 1,
  amount,
  price_mist,
  at_ms: 1,
})
const page = (
  listings: ListingRow[],
  cursor?: string,
  next_cursor: string | null = null,
  version = '1'
): Extract<ServerPacket, { type: 'packet/market_slice' }> => ({
  type: 'packet/market_slice',
  observation: { ...observation, ...(cursor ? { cursor } : {}) },
  listings,
  next_cursor,
  kiosk_versions: { [id(80)]: version },
})
const purchase = {
  type: 'buy' as const,
  character_id: character.id,
  item_type: resource.item_type,
  min_amount: 1,
  max_amount: 1000,
  max_total_mist: '1000000000',
  order: 'lowest_total' as const,
}
const context_with = (inventory: ReturnType<typeof empty_inventory>) => {
  const context = profession_context()
  return { ...context, snapshot: { ...context.snapshot, inventory } }
}
const receipt = (version = '9'): Receipt => ({
  Transaction: {
    digest: 'sale',
    effects: {
      status: { success: true },
      lamportVersion: version,
      changedObjects: [],
    },
    objectTypes: {},
    events: [],
  },
})

test('market query identity ignores authored property order', () => {
  const authored = { request: 1, item_type: resource.item_type, category: 'resource', kind: 'offers' } as const
  const script = parse_behavior_script({
    version: '1',
    objective: { title: 'Observe' },
    tree: { type: 'action', action: { type: 'observe_market', observation: authored } },
  })
  expect(script.tree.type).toBe('action')
  expect(same_market_observation(authored, observation)).toBe(true)
})

test('all pages contribute candidates, including offers from one kiosk across pages', () => {
  const first = fold_actor_market(empty_inventory(), page([listing(1, 1, '20000000')], undefined, 'next'))
  expect(market_observation_progress(observation, first)).toEqual({
    complete: false,
    observation: { ...observation, cursor: 'next' },
  })
  expect(() => select_purchase(purchase, context_with(first))).toThrow('market_unavailable')
  const all = fold_actor_market(first, page([listing(2, 10, '40000000')], 'next'))
  expect(all.market?.complete).toBe(true)
  expect(market_observation_progress(observation, all)).toEqual({ complete: true, observation })
  expect(all.market?.listings.map(({ id }) => id)).toEqual([id(1), id(2)])
  expect(select_purchase(purchase, context_with(all))?.payload.item_id).toBe(id(1))
  expect(select_purchase({ ...purchase, order: 'lowest_unit' }, context_with(all))?.payload.item_id).toBe(id(2))
  const refresh = fold_actor_market(all, page([listing(3, 1, '10000000')], undefined, 'next'))
  expect(refresh.market?.complete).toBe(false)
  expect(refresh.market?.listings.map(({ id }) => id)).toEqual([id(3)])
  expect(() => select_purchase(purchase, context_with(refresh))).toThrow('market_unavailable')
  const refreshed = fold_actor_market(refresh, page([listing(2, 10, '40000000')], 'next'))
  expect(select_purchase(purchase, context_with(refreshed))?.payload.item_id).toBe(id(3))
})

test('a trailing page cannot masquerade as complete and cursor cycles stop explicitly', () => {
  const orphan = fold_actor_market(empty_inventory(), page([listing(2)], 'next'))
  expect(market_observation_progress(observation, orphan)).toEqual({ complete: false, observation })
  const first = fold_actor_market(empty_inventory(), page([listing(1)], undefined, 'next'))
  const cyclic = fold_actor_market(first, page([listing(2)], 'next', 'next'))
  expect(() => market_observation_progress(observation, cyclic)).toThrow('market_cursor_cycle')
})

test('purchase receipt removes its lot and restores catalogue freshness before any inventory baseline', () => {
  const context = profession_context()
  const command = { ...context.command, kind: 'market_buy' as const, payload: { item_id: id(1), seller_kiosk: id(80) } }
  const initial = fold_actor_market(empty_inventory(), page([listing(1)]))
  const bought = fold_market_receipt(initial, command, receipt())
  expect(bought.market?.listings).toEqual([])
  expect(bought.market?.complete).toBe(false)
  expect(market_observation_progress(observation, bought).observation).toEqual(observation)
  const restored = fold_market_receipt(empty_inventory(), command, receipt())
  expect(restored.catalogues[id(80)]?.version).toBe('9')
  expect(fold_actor_market(restored, page([listing(1)])).market).toBeUndefined()
  const caught_up = fold_actor_market(restored, page([], undefined, null, '9'))
  expect(caught_up.departures).toEqual({})
  expect(fold_market_receipt(caught_up, command, receipt())).toBe(caught_up)
  const owned_refresh = fold_actor_inventory(caught_up, {
    type: 'packet/listings',
    listings: [],
    kiosk_versions: { [character.kiosk]: '10' },
  })
  const unrelated = fold_actor_market(owned_refresh, { ...page([]), kiosk_versions: {} })
  expect(unrelated.catalogues[id(80)]?.version).toBe('9')
  expect(fold_actor_market(unrelated, page([listing(1)]))).toBe(unrelated)
  const relisted = fold_actor_market(restored, page([{ ...listing(1), version: '10' }], undefined, null, '10'))
  expect(relisted.market?.listings).toHaveLength(1)
  expect(
    fold_market_receipt(initial, command, {
      Transaction: { ...receipt().Transaction!, effects: { status: { success: false } } },
    })
  ).toEqual(initial)
})

test('sell validates exact available source and the chain-owned legal lot sizes', () => {
  const context = profession_context()
  const source = item(resource.item_type, 57)
  const current = context_with({ ...context.snapshot.inventory!, items: [source] })
  const selected = select_sale(
    {
      type: 'sell',
      character_id: character.id,
      item_type: resource.item_type,
      amount: 10,
      price_mist: '1000000',
      order: 'smallest_sufficient',
    },
    current
  )!
  const command = { ...current.command, ...selected } as typeof current.command
  expect(validate_market_sell({ ...current, command }).input).toMatchObject({
    id: source.id,
    kiosk: source.kiosk,
    amount: 10,
    source_amount: 57,
    price_mist: 1000000n,
  })
  expect(() =>
    validate_market_sell({ ...current, command: { ...command, payload: { ...command.payload, item_version: '0' } } })
  ).toThrow('sale_source_changed_or_unavailable')
  expect(() =>
    validate_market_sell({
      ...current,
      command,
      snapshot: {
        ...current.snapshot,
        inventory: {
          ...current.snapshot.inventory!,
          listings: [{ ...listing(30), id: source.id, kiosk: source.kiosk }],
        },
      },
    })
  ).toThrow('sale_source_changed_or_unavailable')
  expect(() => MARKET_SELL_ACTION.parse({ ...command.payload, amount: 11 })).toThrow('invalid_market_lot')
  expect(() => MARKET_SELL_ACTION.parse({ ...command.payload, price_mist: '0' })).toThrow('invalid_market_lot')
  expect(() =>
    validate_market_sell({ ...current, command: { ...command, payload: { ...command.payload, source_kiosk: id(99) } } })
  ).toThrow('character_not_available')
})

test('partial sale reconciles its receipt-created listing, never the source stack', () => {
  const context = profession_context()
  const source = item(resource.item_type, 57)
  const command = {
    ...context.command,
    kind: 'market_sell',
    payload: {
      item_id: source.id,
      source_kiosk: source.kiosk,
      source_amount: 57,
      amount: 10,
      item_type: source.item_type,
      price_mist: '1000000',
    },
  } as typeof context.command
  const result: Receipt = {
    Transaction: {
      ...receipt().Transaction!,
      effects: {
        status: { success: true },
        lamportVersion: '9',
        changedObjects: [{ objectId: id(90), idOperation: 'Created', outputVersion: '9' }],
      },
      objectTypes: { [id(90)]: 'fixture::item::Item' },
    },
  }
  expect(market_receipt_relation(command, result)).toEqual({
    operation: 'sell',
    id: id(90),
    kiosk: source.kiosk,
    version: '9',
  })
  const retained = fold_market_receipt(empty_inventory(), command, result)
  expect(fold_market_receipt(retained, command, result)).toBe(retained)
  const inventory = {
    ...context.snapshot.inventory!,
    items: [
      { ...source, amount: 47 },
      { ...source, id: id(90), amount: 10, version: '9' },
    ],
    listings: [],
  }
  expect(market_sell_projected(command, result, inventory)).toBe(false)
  const projected = { ...inventory, listings: [{ ...listing(90, 10, '1000000'), kiosk: source.kiosk, version: '9' }] }
  expect(market_sell_projected(command, result, projected)).toBe(true)
  expect(
    market_sell_projected(command, result, { ...projected, listings: [{ ...projected.listings[0]!, amount: 1 }] })
  ).toBe(false)
})

test('price observations retain exact ratios and unknown is never a zero price', () => {
  const state = fold_actor_market(empty_inventory(), page([listing(1, 10, '90071992547409930')]))
  expect(
    market_price_condition(
      { item_type: resource.item_type, metric: 'lowest_unit_mist', op: 'gt', value: '9007199254740993' },
      context_with(state)
    )
  ).toBe(true)
  const packet: Extract<ServerPacket, { type: 'packet/market_prices' }> = {
    type: 'packet/market_prices',
    observation: { item_type: resource.item_type, id: 2 },
    total_units: '0',
    history: {
      first_timestamp_ms: 1,
      sampled_at_ms: 3,
      buckets: [{ at_ms: 2, total_mist: '10', units: '3', sales: '1', checkpoint: 1 }],
    },
  }
  const observed = context_with(fold_actor_inventory(state, packet))
  expect(market_prices_observed(packet.observation, observed)).toBe(true)
  expect(
    market_price_condition(
      { item_type: resource.item_type, metric: 'latest_daily_unit_mist', op: 'gt', value: '3' },
      observed
    )
  ).toBe(true)
  expect(
    market_price_condition(
      { item_type: resource.item_type, metric: 'latest_sale_unit_mist', op: 'gt', value: '3' },
      observed
    )
  ).toBeNull()
  expect(
    market_price_condition({ item_type: resource.item_type, metric: 'total_units', op: 'eq', value: '0' }, observed)
  ).toBe(true)
  expect(
    market_price_condition({ item_type: 'missing', metric: 'lowest_ask_mist', op: 'eq', value: '0' }, observed)
  ).toBeNull()
})

test('buy refuses a changed listing and preserves the authored spend cap into the SDK', () => {
  const inventory = fold_actor_market(empty_inventory(), page([listing(1)]))
  const context = context_with(inventory)
  const action = select_purchase(purchase, context)!
  const command = { ...context.command, ...action }
  expect(validate_market_buy({ ...context, command }).input.max_total_mist).toBe(1000000000n)
  expect(() =>
    validate_market_buy({ ...context, command: { ...command, payload: { ...command.payload, price_mist: '1' } } })
  ).toThrow('listing_changed_or_ineligible')
})
