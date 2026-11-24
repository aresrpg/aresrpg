// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The detail views of the bot's one read path. `bot_observe` says what the wallet holds and does in a
// few kilobytes; a bag, the stacks of one item and the zones around a hero are asked for by name.
// Owner ruling 2026-11-22: an observation is a status, never a dump of packets, bags and zones.
import { encumbered_asset_ids } from '@aresrpg/protocol/inventory'
import {
  has_market_page,
  parse_market_observation,
  zone_of,
  type CharacterRow,
  type ItemRow,
  type ListingRow,
  type MarketObservation,
  type MarketPriceObservation,
} from '@aresrpg/protocol'
import { is_item_category } from '@aresrpg/immutable'

import { empty_inventory, inventory_read, type ActorInventory } from './actor_inventory.ts'
import { market_observation_progress } from './actor_market.ts'
import type { ActorSnapshot } from './actor_snapshot.ts'
import { zone_key } from './actor_world.ts'
import { item_bonuses } from './character_observability.ts'
import { zone_checkpoint_id } from './gameplay_context.ts'
import { market_prices_observed } from './market_prices.ts'
import { zone_knowledge } from './catalog.ts'

/** A value without the keys that hold nothing: an absent fact is absent, never `null`. */
export const without_nulls = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(without_nulls)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== null && entry !== undefined)
      .map(([key, entry]) => [key, without_nulls(entry)])
  )
}

const read_inventory = (inventory: ActorInventory | undefined) => {
  if (!inventory_read(inventory)) throw new Error('inventory_unavailable')
  return inventory
}
/** How much the wallet holds, in counts: the status never lists a bag. */
export const inventory_counts = (inventory: ActorInventory = empty_inventory()) => {
  const count = (rows: readonly unknown[] | null) => rows?.length ?? 0
  return {
    loaded: inventory.loaded,
    stacks: inventory.items.length,
    item_types: new Set(inventory.items.map(({ item_type }) => item_type)).size,
    listings: count(inventory.listings),
    trades: count(inventory.trades),
    claims: count(inventory.claims),
  }
}

type Filter = Readonly<{ category?: string; kiosk?: string; item_type?: string }>
const kept = (items: readonly ItemRow[], { category, kiosk, item_type }: Filter) =>
  items.filter(
    (item) =>
      (!category || item.category === category) &&
      (!kiosk || item.kiosk === kiosk) &&
      (!item_type || item.item_type === item_type)
  )
/** The bag as a player reads it: one line per item and kiosk, with what is free to use. Stacks,
 * object ids and versions are detail: `stacks_view` gives them for one item. */
export const inventory_view = ({ inventory }: ActorSnapshot, filter: Filter) => {
  const state = read_inventory(inventory)
  const encumbered = encumbered_asset_ids(state.listings, state.trades)
  const lines = new Map<
    string,
    {
      item_type: string
      name: string
      category: string
      level: number
      kiosk: string
      amount: number
      available: number
      stacks: number
    }
  >()
  for (const item of kept(state.items, filter)) {
    const key = `${item.kiosk}:${item.item_type}`
    const line = lines.get(key) ?? {
      item_type: item.item_type,
      name: item.name,
      category: item.category,
      level: item.level,
      kiosk: item.kiosk,
      amount: 0,
      available: 0,
      stacks: 0,
    }
    lines.set(key, {
      ...line,
      amount: line.amount + item.amount,
      available: line.available + (encumbered.has(item.id) ? 0 : item.amount),
      stacks: line.stacks + 1,
    })
  }
  return { items: [...lines.values()], listings: state.listings, trades: state.trades, claims: state.claims }
}

/** How many stacks of one item a read returns unless it asks for more (product choice, owner
 * disclosure 2026-11-22: a wallet held 330 stacks of one mushroom). The largest come first. */
export const STACKS_DEFAULT = 20
export const STACKS_MAXIMUM = 200
/** The stacks of one item: the object ids a sale, an equip or a craft names. */
export const stacks_view = ({ inventory }: ActorSnapshot, filter: Filter & Readonly<{ limit?: number }>) => {
  const state = read_inventory(inventory)
  const encumbered = encumbered_asset_ids(state.listings, state.trades)
  const rows = kept(state.items, filter).toSorted(
    (left, right) => right.amount - left.amount || left.id.localeCompare(right.id)
  )
  const [first] = rows
  return {
    item_type: filter.item_type,
    name: first?.name,
    category: first?.category,
    level: first?.level,
    total_stacks: rows.length,
    total_amount: rows.reduce((total, { amount }) => total + amount, 0),
    stacks: rows.slice(0, filter.limit ?? STACKS_DEFAULT).map((item) => ({
      id: item.id,
      kiosk: item.kiosk,
      amount: item.amount,
      ...(encumbered.has(item.id) ? { encumbered: true } : {}),
      ...(item.stats ? { stats: item.stats, bonuses: item_bonuses(item) } : {}),
    })),
  }
}

/** The zone each hero stands in, by the key the zone views and checkpoints use. */
export const current_zones = (characters: readonly CharacterRow[]): Readonly<Record<string, string>> =>
  Object.fromEntries(
    characters.flatMap((character) => {
      const { world, x, z } = character
      if (!world || x === undefined || z === undefined) return []
      const { zx, zz } = zone_of(x, z)
      return [[character.id, zone_key(world, zx, zz)]]
    })
  )
type ZoneAsk = Readonly<{ character_id?: string; nearby?: boolean; mobs?: boolean; resources?: boolean }>
/**
 * The zones the heroes stand in, or with `nearby` every zone the game tracks around them. A zone says
 * how many monster groups and resource packs it holds; the groups and the packs themselves come only
 * when asked for.
 */
export const zones_view = (snapshot: ActorSnapshot, ask: ZoneAsk) => {
  const heroes = snapshot.characters.filter(({ id }) => !ask.character_id || id === ask.character_id)
  const standing = current_zones(heroes)
  const tracked = new Set(
    heroes.flatMap(({ id }) => {
      const packet = snapshot.tracked_zones[id]
      return packet ? packet.zones.map(({ zx, zz }) => zone_key(packet.world, zx, zz)) : []
    })
  )
  const wanted = ask.nearby ? new Set([...tracked, ...Object.values(standing)]) : new Set(Object.values(standing))
  return {
    zones: Object.entries(snapshot.zones)
      .filter(([key]) => wanted.has(key))
      .map(([key, row]) => {
        const { resources, mobs, ...place } = zone_knowledge(row)
        return {
          key,
          ...place,
          heroes: Object.entries(standing).flatMap(([id, zone]) => (zone === key ? [id] : [])),
          ...(row.spawns ? { zone_checkpoint_id: zone_checkpoint_id(row) } : {}),
          mob_groups: mobs?.length,
          resource_packs: resources?.length,
          ...(ask.mobs ? { mobs } : {}),
          ...(ask.resources ? { resources } : {}),
        }
      }),
  }
}

/** How many listed types or listed heroes a market read returns unless it asks for more, how many it
 * returns at most, and how many offers of one item a read by unit price returns at most (product
 * choices proposed 2026-11-24, after the owner asked for a light default: a read costs what its question is
 * worth). */
export const MARKET_ROWS_DEFAULT = 30
export const MARKET_ROWS_MAXIMUM = 200
export const MARKET_OFFERS_MAXIMUM = 50
/** How many daily sale buckets of one item a market read returns, newest first. */
export const MARKET_HISTORY_BUCKETS = 30
export type MarketAsk = Readonly<{
  item_type?: string
  category?: string
  limit?: number
  history?: boolean
  heroes?: boolean
  release?: boolean
}>
/** What a market question watches on the wire. Each carries request 0: its kind, category and item type
 * already tell it from another question, so the same question asked again continues its own sweep. */
type MarketQuestion = Readonly<{ market?: MarketObservation; prices?: MarketPriceObservation; unlisted?: true }>
const LISTED_TYPES: MarketObservation = { kind: 'types', request: 0 }
const RELEASE: MarketQuestion = {}
/** The offers of one item, or with its history its daily prices too. Its category comes from the ask,
 * else from the listed types. A type missing from them is not on sale; while they were never read,
 * they are read first. */
const item_question = (item_type: string, { category, history }: MarketAsk, inventory?: ActorInventory) => {
  const prices = history ? { prices: { item_type, id: 0 } } : {}
  const known = category ?? inventory?.market_types?.find((row) => row.item_type === item_type)?.category
  if (known)
    return { market: parse_market_observation({ kind: 'offers', category: known, item_type, request: 0 })!, ...prices }
  return inventory?.market_types ? { unlisted: true as const, ...prices } : { market: LISTED_TYPES, ...prices }
}
const question_of = (ask: MarketAsk, inventory: ActorInventory | undefined): MarketQuestion => {
  if ((ask.heroes && ask.item_type) || (ask.history && !ask.item_type)) throw new Error('invalid_argument')
  if (ask.category !== undefined && !is_item_category(ask.category)) throw new Error('unknown_category')
  if (ask.heroes) return { market: { kind: 'characters', request: 0 } }
  return ask.item_type ? item_question(ask.item_type, ask, inventory) : { market: LISTED_TYPES }
}
/** Whether the snapshot answers one market observation, and what the market view watches for it. A
 * sweep under way watches its next page; a complete sweep keeps the page it ended on, so its rows stay
 * live without a new sweep. */
const page_watch = (observation: MarketObservation, inventory: ActorInventory | undefined) => {
  const { complete, observation: next } = market_observation_progress(observation, inventory)
  const ended = complete && has_market_page(observation) ? inventory?.market?.observation : undefined
  return { complete, watch: ended ?? next }
}
/** Whether the snapshot answers a market question, and what the wallet's market views must watch for
 * it. A release gives both views back. */
const market_read = (ask: MarketAsk, snapshot: ActorSnapshot) => {
  if (ask.release) return { question: RELEASE, complete: true, watches: { market: null, prices: null } }
  const question = question_of(ask, snapshot.inventory)
  const page = question.market ? page_watch(question.market, snapshot.inventory) : { complete: true }
  const priced = !question.prices || market_prices_observed(question.prices, { snapshot })
  return {
    question,
    complete: page.complete && priced,
    watches: {
      ...('watch' in page ? { market: page.watch } : {}),
      ...(question.prices ? { prices: question.prices } : {}),
    },
  }
}
export const market_watches = (snapshot: ActorSnapshot, ask: MarketAsk) => market_read(ask, snapshot).watches

/** Cheaper first, by exact mist: per lot, or per unit by cross-multiplying, never a float. Ties go to the
 * lower id. */
const cheaper = (per_unit: boolean) => (left: ListingRow, right: ListingRow) => {
  const units = (row: ListingRow) => (per_unit ? BigInt(row.amount) : 1n)
  const difference = BigInt(left.price_mist) * units(right) - BigInt(right.price_mist) * units(left)
  if (difference === 0n) return left.id.localeCompare(right.id)
  return difference < 0n ? -1 : 1
}
/** An offer as `bot_market_buy` names it, with what tells two unique items apart. */
const offer_row = (row: ListingRow) => {
  const [price, amount] = [BigInt(row.price_mist), BigInt(row.amount)]
  return {
    item_id: row.id,
    seller_kiosk: row.kiosk,
    listing_version: row.version,
    amount: row.amount,
    price_mist: row.price_mist,
    unit_price_mist: price % amount === 0n ? String(price / amount) : undefined,
    stats: row.stats,
    damages: row.damages,
    pet_power: row.pet_power,
    seller: row.seller,
  }
}
/** The offers of one item: by default the cheapest of each lot size, by size; with `limit`, the cheapest
 * per unit. */
const item_offers = ({ market }: ActorInventory, { item_type, limit }: MarketAsk) => {
  const rows = (market?.listings ?? []).filter((row) => row.kind === 'item' && row.item_type === item_type)
  const lot_sizes = [...new Set(rows.map(({ amount }) => amount))].toSorted((left, right) => left - right)
  const by_lot = rows.toSorted(cheaper(false))
  const chosen =
    limit === undefined
      ? lot_sizes.map((amount) => by_lot.find((row) => row.amount === amount)!)
      : rows.toSorted(cheaper(true)).slice(0, Math.min(limit, MARKET_OFFERS_MAXIMUM))
  return { item_type, total_offers: rows.length, lot_sizes, offers: chosen.map(offer_row) }
}
/** Every item type on sale, in the server's order: its listed units and the cheapest lot of each size. */
const listed_types = ({ market_types = [] }: ActorInventory, { category, limit }: MarketAsk) => {
  const rows = market_types.filter((row) => !category || row.category === category)
  return {
    total_types: rows.length,
    types: rows.slice(0, limit ?? MARKET_ROWS_DEFAULT).map(({ quote, ...row }) => ({
      item_type: row.item_type,
      name: row.name,
      category: row.category,
      level: row.level,
      units: quote.units,
      lots: quote.lots,
      change_bps: quote.change_bps,
    })),
  }
}
/** The listed heroes, cheapest first. */
const listed_heroes = ({ market }: ActorInventory, { limit }: MarketAsk) => {
  const rows = (market?.listings ?? []).filter((row) => row.kind === 'character').toSorted(cheaper(false))
  return {
    total_heroes: rows.length,
    heroes: rows.slice(0, limit ?? MARKET_ROWS_DEFAULT).map((row) => ({
      id: row.id,
      name: row.name,
      classe: row.classe,
      level: row.level,
      price_mist: row.price_mist,
      seller_kiosk: row.kiosk,
      listing_version: row.version,
    })),
  }
}
/** The daily sale prices of one item as the wire gives them, its newest buckets only. */
const price_history = ({ total_units, history }: NonNullable<ActorInventory['market_prices']>) => ({
  total_units,
  history: history && {
    ...history,
    buckets: history.buckets.toSorted((left, right) => right.at_ms - left.at_ms).slice(0, MARKET_HISTORY_BUCKETS),
  },
})
const market_answer = (ask: MarketAsk, question: MarketQuestion, inventory: ActorInventory) => {
  const prices = question.prices && inventory.market_prices ? { prices: price_history(inventory.market_prices) } : {}
  if (question.unlisted) return { item_type: ask.item_type, listed: false, ...prices }
  if (ask.heroes) return listed_heroes(inventory, ask)
  return ask.item_type ? { ...item_offers(inventory, ask), ...prices } : listed_types(inventory, ask)
}
/**
 * The public market, one question at a time: the listed types, the offers of one item with its price
 * history, or the listed heroes. A question the snapshot does not answer yet is pending; the read that
 * asked it pointed the wallet's one market view at it.
 */
export const market_view = (snapshot: ActorSnapshot, ask: MarketAsk) => {
  const { question, complete } = market_read(ask, snapshot)
  if (ask.release) return { released: true }
  if (!complete) return { status: 'pending', asked: { market: question.market, prices: question.prices } }
  return market_answer(ask, question, snapshot.inventory ?? empty_inventory())
}
