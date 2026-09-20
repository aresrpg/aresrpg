// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ListingRow, MarketType } from '@aresrpg/protocol'

/** The selected category supplies navigation; the current offer page never defines which types exist. */
export const browse_types = (
  items: readonly MarketType[],
  listings: readonly ListingRow[],
  category: string | null,
  search: string
) => {
  const query = search.trim().toLowerCase()
  return items
    .filter((row) => row.category === category && `${row.name} ${row.item_type}`.toLowerCase().includes(query))
    .map((row) => ({ ...row, rows: listings.filter((listing) => listing.item_type === row.item_type) }))
    .sort((a, b) => a.level - b.level || a.item_type.localeCompare(b.item_type))
}
