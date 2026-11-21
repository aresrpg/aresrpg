// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { buyer_total, type MarketplaceActions, type MarketplaceAsset } from '@aresrpg/sdk/marketplace'
import { item_is_stackable, marketplace_lot_sizes } from '@aresrpg/immutable'
import type { Receipt } from '@aresrpg/sdk/cache'

import { decode, matches, object_schema, identifier, nonempty, decimal, u64 } from './gameplay_schema.ts'
import { owned_character, custody_of, type GameplayContext } from './gameplay_context.ts'
import { profession_inventory, inventory_projected, inventory_read, type ActorInventory } from './actor_inventory.ts'
import { market_receipt_relation } from './actor_market.ts'
import type { ActorSnapshot } from './actor_snapshot.ts'
import type { Command } from './control.ts'

const schema = object_schema({
  character_id: identifier,
  item_id: identifier,
  seller_kiosk: identifier,
  listing_version: decimal,
  item_type: nonempty,
  amount: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  price_mist: decimal,
  max_total_mist: decimal,
})
type Purchase = Readonly<{
  character_id: string
  item_id: string
  seller_kiosk: string
  listing_version: string
  item_type: string
  amount: number
  price_mist: string
  max_total_mist: string
}>
const parse = (value: unknown) => {
  const payload = decode<Purchase>(schema, value)
  u64(payload.price_mist)
  u64(payload.max_total_mist)
  return payload
}
export const MARKET_BUY_ACTION = Object.freeze({
  description:
    'Buy one exact item lot into the selected owned character kiosk. The bot reads the current offers of that item itself before it signs, then gives the market view back. Exact price and royalty-inclusive maximum are checked before preparation. Native Sui kiosk purchase checks asset and price on chain; listing version is a local freshness check, not an on-chain compare-and-swap. Receipt-proven inventory must reconcile before another action.',
  input_schema: schema,
  parse,
})
export type MarketBuyPlan = Readonly<{ kind: 'market_buy'; input: MarketplaceAsset }>
export const validate_market_buy = (context: GameplayContext): MarketBuyPlan => {
  const payload = parse(context.command.payload)
  const character = owned_character(context, payload.character_id)
  const custody = custody_of(character)
  if (character.custody !== 'kiosk' || character.active_fight || character.ambush)
    throw new Error('character_not_available')
  const market = context.snapshot.inventory?.market
  if (!market) throw new Error('market_unavailable')
  const listing = market.listings.find(({ id, kiosk }) => id === payload.item_id && kiosk === payload.seller_kiosk)
  const valid =
    listing &&
    [
      listing.kind === 'item',
      listing.item_type === payload.item_type,
      listing.version === payload.listing_version,
      listing.amount === payload.amount,
      listing.price_mist === payload.price_mist,
      listing.seller !== context.address,
      BigInt(payload.price_mist) > 0n,
      buyer_total(BigInt(payload.price_mist)) <= BigInt(payload.max_total_mist),
    ].every(Boolean)
  if (!valid) throw new Error('listing_changed_or_ineligible')
  return {
    kind: 'market_buy',
    input: {
      kind: 'item',
      id: listing.id,
      kiosk: listing.kiosk,
      price_mist: BigInt(listing.price_mist),
      max_total_mist: BigInt(payload.max_total_mist),
      destination_kiosk: custody.kiosk,
    },
  }
}

const sell_schema = object_schema({
  character_id: identifier,
  source_kiosk: identifier,
  item_id: identifier,
  item_version: decimal,
  item_type: nonempty,
  source_amount: { type: 'integer', minimum: 1, maximum: 4294967295 },
  amount: { type: 'integer', minimum: 1, maximum: 1000 },
  price_mist: decimal,
})
type Sale = Readonly<{
  character_id: string
  source_kiosk: string
  item_id: string
  item_version: string
  item_type: string
  source_amount: number
  amount: number
  price_mist: string
}>
const parse_sale = (value: unknown) => {
  const payload = decode<Sale>(sell_schema, value)
  if (u64(payload.price_mist) === 0n || !marketplace_lot_sizes.some((amount) => amount === payload.amount))
    throw new Error('invalid_market_lot')
  u64(payload.item_version)
  if (payload.amount > payload.source_amount) throw new Error('invalid_market_lot')
  return payload
}
export const MARKET_SELL_ACTION = Object.freeze({
  description:
    'List one exact owned, unencumbered item or legal stack lot at the authored SUI ask. Revalidates source kiosk, item version and quantity; the existing SDK splits a partial lot. Waits for certified inventory and listing projection.',
  input_schema: sell_schema,
  parse: parse_sale,
})
export type MarketSellPlan = Readonly<{ kind: 'market_sell'; input: MarketplaceAsset }>
export const validate_market_sell = (context: GameplayContext): MarketSellPlan => {
  const payload = parse_sale(context.command.payload)
  const character = owned_character(context, payload.character_id)
  const custody = custody_of(character)
  if (
    [
      character.custody !== 'kiosk',
      character.active_fight,
      character.ambush,
      custody.kiosk !== payload.source_kiosk,
    ].some(Boolean)
  )
    throw new Error('character_not_available')
  const item = profession_inventory(context.snapshot.inventory, custody.kiosk).find(({ id }) => id === payload.item_id)
  if (!item) throw new Error('sale_source_changed_or_unavailable')
  if (
    ![
      item.version === payload.item_version,
      item.item_type === payload.item_type,
      item.amount === payload.source_amount,
    ].every(Boolean)
  )
    throw new Error('sale_source_changed_or_unavailable')
  const stackable = item_is_stackable(item.category)
  if (!stackable && [payload.amount, item.amount].some((amount) => amount !== 1)) throw new Error('invalid_market_lot')
  return {
    kind: 'market_sell',
    input: {
      kind: 'item',
      id: item.id,
      kiosk: custody.kiosk,
      price_mist: BigInt(payload.price_mist),
      ...(stackable ? { amount: payload.amount, source_amount: item.amount } : {}),
    },
  }
}
export const market_sell_projected = (command: Command, receipt: Receipt, inventory: ActorInventory | undefined) => {
  const relation = market_receipt_relation(command, receipt)
  if (!relation || relation.operation !== 'sell' || !inventory_projected(receipt, inventory)) return false
  return (
    inventory?.listings?.some(
      (row) =>
        row.id === relation.id &&
        row.kiosk === relation.kiosk &&
        BigInt(row.version) >= BigInt(relation.version) &&
        row.amount === command.payload.amount &&
        row.item_type === command.payload.item_type &&
        row.price_mist === command.payload.price_mist
    ) ?? false
  )
}

const delist_schema = object_schema({ item_id: identifier, kiosk: identifier })
type Delisting = Readonly<{ item_id: string; kiosk: string }>
export const MARKET_DELIST_ACTION = Object.freeze({
  description:
    'Withdraw one exact item listing of this bot account from the market, named by the id and kiosk of its own listing row. The item stays in its kiosk and is usable again once the listing leaves the observed own listings.',
  input_schema: delist_schema,
  parse: (value: unknown) => decode<Delisting>(delist_schema, value),
})
export type MarketDelistPlan = Readonly<{ kind: 'market_delist'; input: Omit<MarketplaceAsset, 'price_mist'> }>
const own_listing = (inventory: ActorInventory | undefined, { item_id, kiosk }: Delisting) => {
  if (!inventory_read(inventory)) throw new Error('inventory_unavailable')
  return inventory.listings.find((row) => row.id === item_id && row.kiosk === kiosk)
}
export const validate_market_delist = (context: GameplayContext): MarketDelistPlan => {
  const listing = own_listing(context.snapshot.inventory, MARKET_DELIST_ACTION.parse(context.command.payload))
  // Sold or already withdrawn. The bot lists items only: a character listing is never its own to withdraw.
  if (!listing) throw new Error('listing_gone')
  if (listing.kind !== 'item') throw new Error('listing_changed_or_ineligible')
  return { kind: 'market_delist', input: { kind: 'item', id: listing.id, kiosk: listing.kiosk } }
}
/** The delisting is projected once the account's own listings no longer hold that row. */
export const market_delist_projected = (command: Command, inventory: ActorInventory | undefined) =>
  inventory_read(inventory) && !own_listing(inventory, MARKET_DELIST_ACTION.parse(command.payload))

const collect_schema = {
  ...object_schema({ kiosks: { type: 'array', items: identifier, minItems: 1, uniqueItems: true } }),
  required: [],
}
type Collection = Readonly<{ kiosks?: readonly string[] }>
export const MARKET_COLLECT_ACTION = Object.freeze({
  description:
    'Collect the sale proceeds held in the kiosks of this bot account into the bot wallet itself; the destination is never an input. Omit kiosks to collect from every kiosk the account is observed to hold. A kiosk that holds nothing yields nothing and is not an error. The bot also sends this command by itself when it observes proceeds, so it is only needed to force a collection.',
  input_schema: collect_schema,
  parse: (value: unknown) => decode<Collection>(collect_schema, value),
})
export type MarketCollectPlan = Readonly<{ kind: 'market_collect'; input: readonly string[] }>
/** Every kiosk the account is observed to hold: its heroes', its bag items' and its own listings'. */
export const wallet_kiosks = ({ characters, inventory }: Pick<ActorSnapshot, 'characters' | 'inventory'>) => {
  const rows = [...characters, ...(inventory?.items ?? []), ...(inventory?.listings ?? [])]
  return [...new Set(rows.map(({ kiosk }) => kiosk))].filter((kiosk) => matches(identifier, kiosk)).toSorted()
}
export const validate_market_collect = (context: GameplayContext): MarketCollectPlan => {
  const { kiosks = wallet_kiosks(context.snapshot) } = MARKET_COLLECT_ACTION.parse(context.command.payload)
  if (!kiosks.length) throw new Error('nothing_to_collect')
  return { kind: 'market_collect', input: kiosks }
}

/** The market fragment of the one catalogue: descriptions, schemas, validators and executors. */
export const MARKET_ACTIONS = {
  market_buy: MARKET_BUY_ACTION,
  market_sell: MARKET_SELL_ACTION,
  market_delist: MARKET_DELIST_ACTION,
  market_collect: MARKET_COLLECT_ACTION,
}
export type MarketPlan = MarketBuyPlan | MarketSellPlan | MarketDelistPlan | MarketCollectPlan
export const market_validators = (context: GameplayContext) => ({
  market_buy: () => validate_market_buy(context),
  market_sell: () => validate_market_sell(context),
  market_delist: () => validate_market_delist(context),
  market_collect: () => validate_market_collect(context),
})
export type MarketExecutor = Partial<Pick<MarketplaceActions, 'buy' | 'list' | 'delist' | 'collect'>>
const required = <T>(action: T | undefined): T => {
  if (!action) throw new Error('market_executor_unavailable')
  return action
}
/** The proceeds destination is fixed inside the SDK call to the wallet these actions were built for. */
export const market_executors = (actions: MarketExecutor) => ({
  market_buy: (input: MarketBuyPlan['input']) => required(actions.buy)(input),
  market_sell: (input: MarketSellPlan['input']) => required(actions.list)(input),
  market_delist: (input: MarketDelistPlan['input']) => required(actions.delist)(input),
  market_collect: (input: MarketCollectPlan['input']) => required(actions.collect)(input),
})
