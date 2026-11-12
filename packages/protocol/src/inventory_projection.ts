// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared packet reconciliation; consumers own lifecycle, receipts and presentation.
import type { ItemRow, ListingRow, MarketSnapshot, ServerPacket, TradeRow, TradeCapRow } from './packets.ts'

export type CatalogueProjection = Readonly<{
  listings: readonly ListingRow[]
  own_listings: readonly ListingRow[]
  catalogues: Readonly<Record<string, Readonly<{ version: string; owned: boolean }>>>
  departures: Readonly<Record<string, Readonly<Record<string, string>>>>
}>
export type TradeProjection = Readonly<{
  rows: readonly TradeRow[]
  tombstones: Readonly<Record<string, true>>
  awaiting_projection: Readonly<Record<string, TradeRow>>
}>
type ItemPacket = Extract<ServerPacket, { type: 'packet/item_updated' | 'packet/item_removed' }>
const ITEM_PACKETS = new Set<ServerPacket['type']>(['packet/item_updated', 'packet/item_removed'])
export const is_item_packet = (packet: Readonly<ServerPacket>): packet is ItemPacket => ITEM_PACKETS.has(packet.type)
const latest_item = (incoming: Readonly<ItemRow>, current: Readonly<ItemRow> | undefined): Readonly<ItemRow> =>
  BigInt(incoming.version ?? '0') < BigInt(current?.version ?? '0') ? current! : incoming
export type InventoryProjection = Readonly<{
  inventory: readonly ItemRow[]
  removed_item_versions: Readonly<Record<string, string>>
}>
const newer_than_departure = (item: Readonly<ItemRow>, removed: Readonly<Record<string, string>>): boolean =>
  removed[item.id] === undefined || BigInt(item.version ?? '0') > BigInt(removed[item.id]!)
export const fold_inventory = (current: InventoryProjection, incoming: readonly ItemRow[]): readonly ItemRow[] => {
  const by_id = new Map(current.inventory.map((item) => [item.id, item]))
  return incoming
    .map((item) => latest_item(item, by_id.get(item.id)))
    .filter((item) => newer_than_departure(item, current.removed_item_versions))
}
export const fold_item_packet = (current: InventoryProjection, packet: Readonly<ItemPacket>): InventoryProjection => {
  if (packet.type === 'packet/item_removed') {
    const previous = current.inventory.find(({ id }) => id === packet.item)
    const observed = previous?.version ?? current.removed_item_versions[packet.item] ?? '0'
    if (BigInt(packet.version) < BigInt(observed)) return current
    return Object.freeze({
      inventory: current.inventory.filter(({ id }) => id !== packet.item),
      removed_item_versions: { ...current.removed_item_versions, [packet.item]: packet.version },
    })
  }
  if (!newer_than_departure(packet.item, current.removed_item_versions)) return current
  const inventory = current.inventory.some(({ id }) => id === packet.item.id)
    ? current.inventory.map((row) => (row.id === packet.item.id ? latest_item(packet.item, row) : row))
    : [...current.inventory, packet.item]
  return Object.freeze({ ...current, inventory })
}
export const latest_listings = (
  current: readonly ListingRow[],
  incoming: readonly ListingRow[]
): readonly ListingRow[] => {
  const rows = new Map(current.map((row) => [row.id, row]))
  incoming.forEach((row) => {
    if (BigInt(row.version) >= BigInt(rows.get(row.id)?.version ?? '0')) rows.set(row.id, row)
  })
  return Object.freeze([...rows.values()])
}

export const without_relation = (
  rows: readonly ListingRow[],
  gone: Readonly<Pick<ListingRow, 'id' | 'kiosk'>>
): readonly ListingRow[] => rows.filter((row) => row.id !== gone.id || row.kiosk !== gone.kiosk)

export const fold_catalogue = <T extends CatalogueProjection>(
  market: T,
  snapshot: Readonly<MarketSnapshot>,
  own: boolean,
  address: string | null
): T => {
  const current_source = (kiosk: string): boolean =>
    BigInt(snapshot.kiosk_versions[kiosk] ?? '0') >= BigInt(market.catalogues[kiosk]?.version ?? '0')
  const incoming = snapshot.listings.filter(
    (row) => current_source(row.kiosk) && BigInt(row.version) > BigInt(market.departures[row.kiosk]?.[row.id] ?? '-1')
  )
  const previous = own ? market.own_listings : market.listings
  const rows = latest_listings(
    previous.filter((row) =>
      own
        ? BigInt(snapshot.kiosk_versions[row.kiosk] ?? '0') <= BigInt(market.catalogues[row.kiosk]?.version ?? '0')
        : !current_source(row.kiosk)
    ),
    incoming
  )
  const own_listings = own
    ? rows
    : latest_listings(
        market.own_listings,
        incoming.filter((row) => row.seller === address)
      )
  const public_rows = own ? market.listings : rows
  const owned_relations = new Set([...market.own_listings, ...own_listings].map((row) => `${row.kiosk}:${row.id}`))
  const listings = Object.freeze(
    public_rows.filter((row) => row.seller !== address && !owned_relations.has(`${row.kiosk}:${row.id}`))
  )
  const departures = Object.fromEntries(
    Object.entries(market.departures).flatMap(([kiosk, removed]) => {
      const retained = Object.fromEntries(
        Object.entries(removed).filter(
          ([, version]) => BigInt(version) > BigInt(snapshot.kiosk_versions[kiosk] ?? '-1')
        )
      )
      return Object.keys(retained).length ? [[kiosk, retained]] : []
    })
  )
  const versions = {
    ...market.catalogues,
    ...Object.fromEntries(
      Object.entries(snapshot.kiosk_versions).map(([kiosk, version]) => [
        kiosk,
        {
          version: current_source(kiosk) ? version : market.catalogues[kiosk]!.version,
          owned: own || !!market.catalogues[kiosk]?.owned,
        },
      ])
    ),
  }
  const observed = new Set([
    ...listings.map(({ kiosk }) => kiosk),
    ...Object.keys(snapshot.kiosk_versions),
    ...Object.keys(departures),
  ])
  const catalogues = Object.fromEntries(
    Object.entries(versions).filter(([kiosk, value]) => value.owned || observed.has(kiosk))
  )
  return Object.freeze({ ...market, own_listings, listings, catalogues, departures })
}

/** A certified relation departure dominates older page snapshots, regardless of delivery order. */
export const catalogue_departed = <T extends CatalogueProjection>(
  market: T,
  listing: Pick<ListingRow, 'kiosk' | 'id'>,
  version: string
): T => {
  const current = market.catalogues[listing.kiosk] ?? { version: '0', owned: false }
  if (BigInt(current.version) > BigInt(version)) return market
  if (BigInt(market.departures[listing.kiosk]?.[listing.id] ?? '-1') >= BigInt(version)) return market
  return Object.freeze({
    ...market,
    catalogues: { ...market.catalogues, [listing.kiosk]: { ...current, version } },
    departures: {
      ...market.departures,
      [listing.kiosk]: { ...market.departures[listing.kiosk], [listing.id]: version },
    },
    own_listings: without_relation(market.own_listings, listing),
    listings: without_relation(market.listings, listing),
  })
}

const cap_intersection = (left: readonly TradeCapRow[], right: readonly TradeCapRow[]): readonly TradeCapRow[] => {
  const right_ids = new Set(right.map(({ object }) => object))
  return Object.freeze(left.filter(({ object }) => right_ids.has(object)))
}

const min_balance = (left: string, right: string): string => {
  const a = BigInt(left)
  const b = BigInt(right)
  return (a < b ? a : b).toString()
}

export const terminal_phase = (trade: Readonly<TradeRow>): boolean =>
  trade.phase === 'settling' || trade.phase === 'cancelled'

export const reconcile_trade_row = (current: Readonly<TradeRow>, incoming: Readonly<TradeRow>): TradeRow => {
  if (incoming.offer_revision > current.offer_revision) return incoming
  if (incoming.offer_revision < current.offer_revision) return current
  if (current.phase !== incoming.phase) return incoming
  if (terminal_phase(current))
    return Object.freeze({
      ...incoming,
      caps_a: cap_intersection(current.caps_a, incoming.caps_a),
      caps_b: cap_intersection(current.caps_b, incoming.caps_b),
      sui_a: min_balance(current.sui_a, incoming.sui_a),
      sui_b: min_balance(current.sui_b, incoming.sui_b),
      kares_a: min_balance(current.kares_a, incoming.kares_a),
      kares_b: min_balance(current.kares_b, incoming.kares_b),
    })
  return Object.freeze({
    ...incoming,
    accept_a: current.accept_a || incoming.accept_a,
    accept_b: current.accept_b || incoming.accept_b,
  })
}

export const packet_rows_merged = (
  state: Readonly<TradeProjection>,
  packet_rows: readonly TradeRow[]
): readonly TradeRow[] => {
  const current_by_id = new Map(state.rows.map((row) => [row.id, row]))
  const merged = Object.freeze(
    packet_rows
      .filter(({ id }) => !state.tombstones[id])
      .map((row) => {
        const current = current_by_id.get(row.id)
        return current ? reconcile_trade_row(current, row) : row
      })
  )
  const packet_ids = new Set(packet_rows.map(({ id }) => id))
  const projected_requests = state.rows.filter(
    ({ id, phase }) =>
      phase === 'requested' && !!state.awaiting_projection[id] && !packet_ids.has(id) && !state.tombstones[id]
  )
  return Object.freeze([...merged, ...projected_requests])
}

export const close_trade_projection = <T extends TradeProjection>(state: T, id: string): T =>
  Object.freeze({
    ...state,
    rows: Object.freeze(state.rows.filter((trade) => trade.id !== id)),
    awaiting_projection: Object.freeze(
      Object.fromEntries(Object.entries(state.awaiting_projection).filter(([key]) => key !== id))
    ),
    tombstones: Object.freeze({ ...state.tombstones, [id]: true }),
  })
