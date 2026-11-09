// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ItemRow, ListingRow, TradeRow, ServerPacket } from '@aresrpg/protocol'
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

export type ActorInventory = Readonly<{
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
  removed: {},
  listings: null,
  trades: null,
  catalogues: {},
  departures: {},
  trade_tombstones: {},
  loaded: false,
})
/** Adapt the actor's readiness/field names to the same projection used by the game. */
export const fold_actor_inventory = (state: ActorInventory, packet: ServerPacket): ActorInventory => {
  const inventory = { inventory: state.items, removed_item_versions: state.removed }
  if (packet.type === 'packet/inventory')
    return { ...state, loaded: true, items: fold_inventory(inventory, packet.items) }
  if (is_item_packet(packet)) {
    const next = fold_item_packet(inventory, packet)
    return { ...state, items: next.inventory, removed: next.removed_item_versions }
  }
  if (packet.type === 'packet/listings') {
    const next = fold_catalogue(
      {
        listings: [],
        own_listings: state.listings ?? [],
        catalogues: state.catalogues,
        departures: state.departures,
      },
      packet,
      true,
      null
    )
    return { ...state, listings: next.own_listings, catalogues: next.catalogues, departures: next.departures }
  }
  if (packet.type === 'packet/trades')
    return {
      ...state,
      trades: packet_rows_merged(
        {
          rows: state.trades ?? [],
          tombstones: state.trade_tombstones,
          awaiting_projection: {},
        },
        packet.trades
      ),
    }
  if (packet.type === 'packet/trade_destroyed') {
    const next = close_trade_projection(
      { rows: state.trades ?? [], tombstones: state.trade_tombstones, awaiting_projection: {} },
      packet.trade
    )
    return { ...state, trades: state.trades ? next.rows : null, trade_tombstones: next.tombstones }
  }
  return state
}
export const profession_inventory = (state: ActorInventory | undefined, kiosk: string) => {
  if (!state?.loaded || !state.listings || !state.trades) throw new Error('inventory_unavailable')
  return available_inventory_items(state.items, encumbered_asset_ids(state.listings, state.trades), kiosk)
}
