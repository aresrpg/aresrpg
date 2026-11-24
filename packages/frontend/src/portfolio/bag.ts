// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The portfolio's bag: what the account on screen can act on, as the game's inventory shows it, and the market's
// groups that narrow it.
import type { ItemRow, ListingRow, TradeRow } from '@aresrpg/protocol'

import { available_inventory_items, encumbered_asset_ids, inventory_groups } from '../inventory_stacks.ts'
import { market_categories, type MarketGroup } from '../modules/marketplace.ts'
import type { SiteState } from '../store.ts'

/** An account's items, and its own listings and trades, which lock some of them. */
export type BagAccount = Readonly<{
  items: readonly ItemRow[]
  listings: readonly ListingRow[]
  trades: readonly TradeRow[]
}>

/** The game account, or the bot account the owner observes: each one is locked by its own listings and trades. */
export const bag_account = (
  { session, marketplace, trade }: Pick<SiteState, 'session' | 'marketplace' | 'trade'>,
  on_bot: boolean
): BagAccount =>
  on_bot
    ? {
        items: session.agent_inventory.inventory,
        listings: session.agent_inventory.catalogue.own_listings,
        trades: session.agent_inventory.trades,
      }
    : { items: session.inventory, listings: marketplace.own_listings, trades: trade.rows }

/** What the account can act on: every item a listing or a trade does not hold. */
export const bag_items = ({ items, listings, trades }: BagAccount): readonly ItemRow[] =>
  available_inventory_items(items, encumbered_asset_ids(listings, trades))

/** The bag's cells: one per stackable type and kiosk with its total amount, one per unique item. */
export const bag_cells = (account: BagAccount) => inventory_groups(bag_items(account))
export type BagCell = ReturnType<typeof bag_cells>[number]

/** Whether a cell falls in a group of the market; no group shows every cell. */
export const in_group =
  (group: MarketGroup | null) =>
  ({ item }: Readonly<{ item: ItemRow }>): boolean =>
    !group || (market_categories(group) as readonly string[]).includes(item.category)
