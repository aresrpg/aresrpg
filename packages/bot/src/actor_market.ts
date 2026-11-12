// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { parse_market_observation, type MarketObservation, type ListingRow, type ServerPacket } from '@aresrpg/protocol'
import { fold_catalogue, catalogue_departed } from '@aresrpg/protocol/inventory'
import { created_object_id, receipt_version, type Receipt } from '@aresrpg/sdk/cache'

import type { ActorInventory } from './actor_inventory.ts'
import type { Command } from './control.ts'

type Page = Readonly<{ cursor: string; next_cursor: string | null; ids: readonly string[] }>
export type ActorMarket = Readonly<{
  observation: MarketObservation
  next_cursor: string | null
  listings: readonly ListingRow[]
  pages: readonly Page[]
  complete: boolean
}>
export const same_market_observation = (left: MarketObservation | undefined, right: MarketObservation) =>
  left !== undefined &&
  JSON.stringify(parse_market_observation(left)) === JSON.stringify(parse_market_observation(right))
const projection = (state: ActorInventory) => ({
  listings: state.market?.listings ?? [],
  own_listings: state.listings ?? [],
  catalogues: state.catalogues,
  departures: state.departures,
})
const first_page = (observation: MarketObservation): MarketObservation => {
  const parsed = parse_market_observation(observation)!
  return 'cursor' in parsed ? { ...parsed, cursor: undefined } : parsed
}
const same_sweep = (left: MarketObservation | undefined, right: MarketObservation) =>
  !!left && same_market_observation(first_page(left), first_page(right))
const cursor_of = (observation: MarketObservation) => ('cursor' in observation ? (observation.cursor ?? '') : '')
const relation_id = (row: Pick<ListingRow, 'id' | 'kiosk'>) => `${row.kiosk}:${row.id}`
const page_prefix = (market: ActorMarket | undefined, observation: MarketObservation) => {
  const known = same_sweep(market?.observation, observation) ? market!.pages : []
  const cursor = cursor_of(observation)
  const position = known.findIndex((page) => page.cursor === cursor)
  const prefix = known.slice(0, position < 0 ? known.length : position)
  return prefix.at(-1)?.next_cursor === cursor ? prefix : []
}
/** One list owns observed offers. Page metadata retains only relation IDs, never duplicate rows. */
export const fold_actor_market = (
  state: ActorInventory,
  packet: Extract<ServerPacket, { type: 'packet/market_slice' }>
): ActorInventory => {
  if (
    Object.entries(packet.kiosk_versions).some(
      ([kiosk, version]) => BigInt(version) < BigInt(state.catalogues[kiosk]?.version ?? '0')
    )
  )
    return state
  const previous = projection(state)
  const cursor = cursor_of(packet.observation)
  // Only a chain beginning at the first page can certify full coverage. Late/unrelated pages
  // remain visible but cannot authorize a best-offer selection.
  const retained = page_prefix(state.market, packet.observation)
  const ids = new Set(retained.flatMap((page) => page.ids))
  const earlier = previous.listings.filter((row) => ids.has(relation_id(row)))
  const next = fold_catalogue(
    { ...previous, listings: earlier },
    {
      listings: [...earlier, ...packet.listings],
      kiosk_versions: packet.kiosk_versions,
    },
    false,
    null
  )
  const pages = [...retained, { cursor, next_cursor: packet.next_cursor, ids: packet.listings.map(relation_id) }]
  const complete = pages[0]!.cursor === '' && packet.next_cursor === null
  return {
    ...state,
    // The shared UI fold prunes off-screen kiosks; actors retain monotone receipt watermarks.
    catalogues: { ...state.catalogues, ...next.catalogues },
    departures: next.departures,
    market: {
      observation: parse_market_observation(packet.observation)!,
      next_cursor: packet.next_cursor,
      listings: next.listings,
      pages,
      complete,
    },
  }
}
/** Follow every server cursor; the server still returns its existing cheapest offers per group.
 * This is a live multi-read sweep, not an atomic market snapshot. */
export const market_observation_progress = (observation: MarketObservation, state: ActorInventory | undefined) => {
  const base = first_page(observation)
  const market = state?.market
  if (!market) return { complete: false, observation: base }
  if (![same_sweep(market.observation, base), market.pages[0]?.cursor === ''].every(Boolean))
    return { complete: false, observation: base }
  // Keep this completed sweep usable now, and watch the first page for the next live sweep.
  if (market.complete) return { complete: true, observation: base }
  const cursor = market.next_cursor
  if (!cursor || market.pages.some((page) => page.cursor === cursor)) throw new Error('market_cursor_cycle')
  return { complete: false, observation: { ...base, cursor } as MarketObservation }
}
const receipt_asset = (command: Command, receipt: Receipt, version: string) => {
  if (String(command.kind) === 'market_buy')
    return {
      operation: 'buy' as const,
      id: String(command.payload.item_id),
      kiosk: String(command.payload.seller_kiosk),
      version,
    }
  if (String(command.kind) !== 'market_sell') return null
  const id =
    Number(command.payload.amount) < Number(command.payload.source_amount)
      ? created_object_id(receipt, '::item::Item')
      : String(command.payload.item_id)
  return id ? { operation: 'sell' as const, id, kiosk: String(command.payload.source_kiosk), version } : null
}
export const market_receipt_relation = (command: Command, receipt: Receipt) => {
  if (receipt.Transaction?.effects?.status?.success !== true) return null
  const version = receipt_version(receipt)
  return version ? receipt_asset(command, receipt, version) : null
}
const receipt_observed = (state: ActorInventory, relation: NonNullable<ReturnType<typeof market_receipt_relation>>) => {
  const current = state.catalogues[relation.kiosk]
  if (!current) return false
  if (BigInt(current.version) > BigInt(relation.version)) return true
  const visible = [...projection(state).listings, ...projection(state).own_listings].some(
    (row) => row.kiosk === relation.kiosk && row.id === relation.id
  )
  return current.version === relation.version && (relation.operation === 'sell' || !visible)
}
export const fold_market_receipt = (state: ActorInventory, command: Command, receipt: Receipt): ActorInventory => {
  const relation = market_receipt_relation(command, receipt)
  if (!relation) return state
  if (receipt_observed(state, relation)) return state
  if (relation.operation === 'sell') {
    return {
      ...state,
      catalogues: { ...state.catalogues, [relation.kiosk]: { version: relation.version, owned: true } },
      ...(state.market ? { market: { ...state.market, pages: [], complete: false } } : {}),
    }
  }
  const before = projection(state)
  const next = catalogue_departed(before, relation, relation.version)
  if (next === before) return state
  return {
    ...state,
    catalogues: next.catalogues,
    departures: next.departures,
    ...(state.market ? { market: { ...state.market, listings: next.listings, pages: [], complete: false } } : {}),
  }
}
