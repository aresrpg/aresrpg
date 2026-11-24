// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The market: buying, selling, delisting and collecting the bot's own proceeds.
import { expect, test, describe } from 'bun:test'
import type { ListingRow, MarketObservation, ServerPacket } from '@aresrpg/protocol'
import { SDK, type SuiTransport } from '@aresrpg/sdk'
import type { Receipt } from '@aresrpg/sdk/cache'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Inputs, Transaction, type TransactionPlugin } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'

import { empty_inventory, fold_actor_inventory } from '../src/actor_inventory.ts'
import type { GameplayContext } from '../src/gameplay_context.ts'
import {
  fold_actor_market,
  fold_market_receipt,
  market_observation_progress,
  market_receipt_relation,
} from '../src/actor_market.ts'
import { select_purchase, select_sale } from '../src/behavior_market.ts'
import { MARKET_ACTIONS, market_sell_projected, wallet_kiosks } from '../src/market_actions.ts'
import { execute_gameplay, execute_gameplay_actions, parse_gameplay_action } from '../src/gameplay.ts'
import { digest, fake_client, pins } from '../../sdk/test/helpers/transport.ts'
import { market_price_condition, market_prices_observed } from '../src/market_prices.ts'
import { type Command } from '../src/control.ts'

import { character, item, profession_context, resource, plan_of } from './fixture_game.ts'

describe('market', () => {
  const as_kind = (kind: Command['kind']) => (context: GameplayContext) =>
    plan_of({ ...context, command: { ...context.command, kind } })
  const [validate_market_buy, validate_market_sell, validate_market_delist, validate_market_collect] = (
    ['market_buy', 'market_sell', 'market_delist', 'market_collect'] as const
  ).map(as_kind)
  const MARKET_SELL_ACTION = MARKET_ACTIONS.market_sell
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

  test('purchase receipt removes its lot and restores catalogue freshness before any inventory baseline', () => {
    const context = profession_context()
    const command = {
      ...context.command,
      kind: 'market_buy' as const,
      payload: { item_id: id(1), seller_kiosk: id(80) },
    }
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
      validate_market_sell({
        ...current,
        command: { ...command, payload: { ...command.payload, source_kiosk: id(99) } },
      })
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

  const own = (n: number): ListingRow => ({
    ...listing(n),
    kiosk: character.kiosk,
    seller: profession_context().address,
  })
  const wallet_context = (kind: 'market_delist' | 'market_collect', payload: Record<string, unknown>) => {
    const context = profession_context()
    return {
      ...context,
      command: { ...context.command, kind, payload },
      snapshot: { ...context.snapshot, inventory: { ...context.snapshot.inventory!, listings: [own(40)] } },
    }
  }
  /** SDK-shaped marketplace actions that record every call. */
  const market_recorder = () => {
    const calls: (readonly [string, unknown])[] = []
    const record = (name: string) => async (input: unknown) => {
      calls[calls.length] = [name, input]
      return { digest: 'fixture', version: '9' }
    }
    const actions = { buy: record('buy'), list: record('list'), delist: record('delist'), collect: record('collect') }
    return { calls, actions: actions as unknown as Parameters<typeof execute_gameplay_actions>[1] }
  }

  test('delist names one own item listing, refuses anything else and makes exactly one SDK call', async () => {
    const payload = { item_id: id(40), kiosk: character.kiosk }
    expect(parse_gameplay_action('market_delist', payload)).toEqual(payload)
    for (const bad of [{ item_id: id(40) }, { ...payload, kiosk: '0x12' }, { ...payload, price_mist: '1' }])
      expect(() => parse_gameplay_action('market_delist', bad)).toThrow('invalid_gameplay_payload')
    const context = wallet_context('market_delist', payload)
    expect(plan_of(context)).toEqual({
      kind: 'market_delist',
      input: { kind: 'item', id: id(40), kiosk: character.kiosk },
    })
    const { calls, actions } = market_recorder()
    await execute_gameplay_actions(context, actions)
    expect(calls).toEqual([['delist', { kind: 'item', id: id(40), kiosk: character.kiosk }]])
    const with_listings = (listings: readonly ListingRow[] | null) => ({
      ...context,
      snapshot: { ...context.snapshot, inventory: { ...context.snapshot.inventory, listings } as never },
    })
    // Sold or already withdrawn, or another kiosk's row: the listing is gone.
    for (const listings of [[], [{ ...own(40), kiosk: id(80) }], [own(41)]])
      expect(() => validate_market_delist(with_listings(listings))).toThrow('listing_gone')
    // The bot lists items only: a character listing is never its own to withdraw.
    expect(() => validate_market_delist(with_listings([{ ...own(40), kind: 'character' }]))).toThrow(
      'listing_changed_or_ineligible'
    )
    expect(() => validate_market_delist(with_listings(null))).toThrow('inventory_unavailable')
    expect(() => plan_of({ ...context, snapshot: { ...context.snapshot, ready: false } })).toThrow('needs_resync')
    await expect(execute_gameplay_actions(with_listings([]), actions)).rejects.toThrow('listing_gone')
    expect(calls).toHaveLength(1)
  })

  test('collect takes kiosks only, defaults to every observed kiosk of the wallet and never takes a destination', async () => {
    expect(parse_gameplay_action('market_collect', {})).toEqual({})
    expect(parse_gameplay_action('market_collect', { kiosks: [id(80)] })).toEqual({ kiosks: [id(80)] })
    for (const bad of [
      { kiosks: [] },
      { kiosks: [id(80), id(80)] },
      { kiosks: ['0x12'] },
      { kiosks: id(80) },
      { recipient: id(1) },
      { kiosks: [id(80)], address: id(1) },
    ])
      expect(() => parse_gameplay_action('market_collect', bad)).toThrow('invalid_gameplay_payload')
    const context = wallet_context('market_collect', {})
    const elsewhere = { ...item(resource.item_type, 1, 61), kiosk: id(81) }
    const direct = { ...item(resource.item_type, 1, 62), kiosk: '' }
    const snapshot = {
      ...context.snapshot,
      inventory: {
        ...context.snapshot.inventory,
        items: [elsewhere, direct],
        listings: [{ ...own(40), kiosk: id(82) }],
      },
    }
    // Heroes', bag items' and own listings' kiosks, once each; an item held outside a kiosk names none.
    expect(wallet_kiosks(snapshot)).toEqual([character.kiosk, id(81), id(82)].toSorted())
    expect(validate_market_collect({ ...context, snapshot }).input).toEqual(wallet_kiosks(snapshot))
    const chosen = { ...context, command: { ...context.command, payload: { kiosks: [id(83)] } } }
    expect(plan_of(chosen)).toEqual({ kind: 'market_collect', input: [id(83)] })
    const { calls, actions } = market_recorder()
    await execute_gameplay_actions(chosen, actions)
    expect(calls).toEqual([['collect', [id(83)]]])
    const bare = { ...context.snapshot.inventory, items: [], listings: [] }
    const empty = { ...context.snapshot, characters: [], inventory: bare }
    await expect(execute_gameplay_actions({ ...context, snapshot: empty as never }, actions)).rejects.toThrow(
      'nothing_to_collect'
    )
    expect(() => plan_of({ ...context, snapshot: { ...context.snapshot, frozen: true } })).toThrow('needs_resync')
    expect(calls).toHaveLength(1)
  })

  test('the real SDK collection withdraws each kiosk and sends the coin to the bot wallet only', async () => {
    const context = wallet_context('market_collect', { kiosks: [character.kiosk] })
    const chain = fake_client({ simulate_ok: true })
    const transfers: string[] = []
    const targets: string[] = []
    const client = {
      ...chain,
      core: {
        ...chain.core,
        resolveTransactionPlugin: (): TransactionPlugin => async (data, options, next) => {
          // Fixture resolver supplies refs; production Core resolves these through its normal object reader.
          data.inputs.forEach((input, index) => {
            if (input.$kind === 'UnresolvedObject')
              data.inputs[index] = Inputs.ObjectRef({ objectId: input.UnresolvedObject.objectId, version: '1', digest })
          })
          await chain.core.resolveTransactionPlugin()(data, options, next)
        },
        executeTransaction: async (input: { transaction: Uint8Array }) => {
          const { commands, inputs } = Transaction.from(input.transaction).getData()
          for (const command of commands) {
            if (command.MoveCall) targets[targets.length] = command.MoveCall.function
            const recipient = command.TransferObjects?.address
            if (recipient?.$kind !== 'Input') continue
            const pure = inputs[recipient.Input]!
            transfers[transfers.length] = bcs.Address.fromBase64(pure.Pure!.bytes)
          }
          return chain.core.executeTransaction(input)
        },
      },
    } as unknown as SuiTransport
    const sdk = SDK({ client, pins, signer: new Ed25519Keypair(), transaction_storage: null })
    await execute_gameplay({
      ...context,
      sdk: {
        ...sdk,
        get_owned_kiosks: async () => ({
          kioskOwnerCaps: [
            { objectId: character.kiosk_cap!, kioskId: character.kiosk, isPersonal: true, version: '1', digest },
          ],
          kioskIds: [character.kiosk],
          hasNextPage: false,
          nextCursor: null,
        }),
      },
    })
    expect(targets.filter((name) => name === 'withdraw')).toHaveLength(1)
    // The only recipient of the transaction is the wallet the bot acts for; no input can name another.
    expect(transfers).toEqual([context.address])
    expect(chain.calls.executions).toBe(1)
  })
})
