// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { changed_object_ids, receipt_version, spending_receipt, type Receipt } from '@aresrpg/sdk/cache'
import type { ClaimRow, ItemRow, ListingRow, TradeRow, ServerPacket } from '@aresrpg/protocol'
import {
  available_inventory_items,
  encumbered_asset_ids,
  fold_inventory,
  fold_item_packet,
  is_item_packet,
  fold_catalogue,
  packet_rows_merged,
  close_trade_projection,
  type CatalogueProjection,
} from '@aresrpg/protocol/inventory'

import { fold_actor_market, type ActorMarket } from './actor_market.ts'

export type ActorInventory = Readonly<{
  market?: ActorMarket
  market_prices?: Extract<ServerPacket, { type: 'packet/market_prices' }>
  claims: readonly ClaimRow[] | null
  items: readonly ItemRow[]
  removed: Readonly<Record<string, string>>
  listings: readonly ListingRow[] | null
  trades: readonly TradeRow[] | null
  catalogues: CatalogueProjection['catalogues']
  departures: CatalogueProjection['departures']
  trade_tombstones: Readonly<Record<string, true>>
  loaded: boolean
}>
export const empty_inventory = (): ActorInventory => ({
  items: [],
  claims: null,
  removed: {},
  listings: null,
  trades: null,
  catalogues: {},
  departures: {},
  trade_tombstones: {},
  loaded: false,
})
const snapshot_packet = (state: ActorInventory, packet: ServerPacket): ActorInventory | null => {
  switch (packet.type) {
    case 'packet/market_prices':
      return { ...state, market_prices: packet }
    case 'packet/market_slice':
      return fold_actor_market(state, packet)
    case 'packet/claims':
      return { ...state, claims: packet.claims }
    case 'packet/inventory':
      return {
        ...state,
        loaded: true,
        items: fold_inventory({ inventory: state.items, removed_item_versions: state.removed }, packet.items),
      }
    default:
      return null
  }
}
const fold_owned_listings = (
  state: ActorInventory,
  packet: Extract<ServerPacket, { type: 'packet/listings' }>
): ActorInventory => {
  const next = fold_catalogue(
    {
      listings: state.market?.listings ?? [],
      own_listings: state.listings ?? [],
      catalogues: state.catalogues,
      departures: state.departures,
    },
    packet,
    true,
    null
  )
  return {
    ...state,
    listings: next.own_listings,
    catalogues: { ...state.catalogues, ...next.catalogues },
    departures: next.departures,
    market: state.market && { ...state.market, listings: next.listings },
  }
}
/** Adapt the actor's readiness/field names to the same projection used by the game. */
export const fold_actor_inventory = (state: ActorInventory, packet: ServerPacket): ActorInventory => {
  const snapshot = snapshot_packet(state, packet)
  if (snapshot) return snapshot
  const inventory = { inventory: state.items, removed_item_versions: state.removed }
  if (is_item_packet(packet)) {
    const next = fold_item_packet(inventory, packet)
    return { ...state, items: next.inventory, removed: next.removed_item_versions }
  }
  if (packet.type === 'packet/listings') return fold_owned_listings(state, packet)
  const trades = { rows: state.trades ?? [], tombstones: state.trade_tombstones, awaiting_projection: {} }
  if (packet.type === 'packet/trades') return { ...state, trades: packet_rows_merged(trades, packet.trades) }
  if (packet.type === 'packet/trade_destroyed') {
    const next = close_trade_projection(trades, packet.trade)
    return { ...state, trades: state.trades ? next.rows : null, trade_tombstones: next.tombstones }
  }
  return state
}
export const profession_inventory = (state: ActorInventory | undefined, kiosk: string) => {
  if (!state?.loaded || !state.listings || !state.trades) throw new Error('inventory_unavailable')
  return available_inventory_items(state.items, encumbered_asset_ids(state.listings, state.trades), kiosk)
}

export const inventory_projected = (receipt: Receipt, inventory: ActorInventory | undefined) => {
  const version = receipt_version(receipt)
  if (!inventory?.loaded || !version || !receipt.Transaction?.objectTypes) return false
  const current = (id: string) => inventory.items.find((row) => row.id === id)
  const newer = (value: string | undefined) => value !== undefined && BigInt(value) >= BigInt(version)
  const written = new Set(changed_object_ids(receipt, '::item::Item'))
  const changed = spending_receipt(receipt).inventory_changes.every(({ id, amount }) => {
    const row = current(id)
    if (!row) return amount === 0 || newer(inventory.removed[id])
    // Merge then spend can restore the original bytes: Sui emits no object write/version.
    if (!written.has(id)) return row.amount === amount
    return newer(row.version) && (BigInt(row.version!) > BigInt(version) || row.amount === amount)
  })
  return changed && [...written].every((id) => newer(current(id)?.version) || newer(inventory.removed[id]))
}
