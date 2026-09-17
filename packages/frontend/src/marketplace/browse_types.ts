// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ListingRow, MarketCounts } from '@aresrpg/protocol'

import { content_catalog } from '../content/catalog.ts'

/** Navigation comes from whole-market counts; the bounded slice supplies asks, not item discovery. */
export const browse_types = (
  counts: MarketCounts,
  listings: readonly ListingRow[],
  category: string | null,
  search: string
) => {
  const types = new Set([
    ...Object.entries(counts.items ?? {})
      .filter(([, count]) => count > 0)
      .map(([type]) => type),
    ...listings.flatMap((row) => (row.item_type ? [row.item_type] : [])),
  ])
  const query = search.trim().toLowerCase()
  return [...types]
    .map((item_type) => {
      const rows = listings.filter((row) => row.item_type === item_type)
      const item = content_catalog.item(item_type)?.item ?? rows[0]
      return { item_type, rows, category: item?.category, name: item?.name ?? item_type, level: item?.level ?? 0 }
    })
    .filter((row) => row.category === category && `${row.name} ${row.item_type}`.toLowerCase().includes(query))
    .sort((a, b) => a.level - b.level || a.item_type.localeCompare(b.item_type))
}
