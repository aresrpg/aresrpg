// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One market category's live PUBLIC listings — the slice pushed when a player observes a
// category (exclusive listings are private p2p offers; they never reach the browse surface).

import type { ListingRow } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

export async function get_market_slice(graph: Graph, { category }: { category: string }): Promise<ListingRow[]> {
  const rows = await graph.read(
    `
    MATCH (i:Item {category: $category})-[l:LISTED_IN {exclusive: false}]->(k:Kiosk)
    RETURN i AS item, l.price AS price_mist, l.at_ms AS at_ms, k.id AS kiosk
    ORDER BY l.at_ms DESC
    LIMIT 200`,
    { category }
  )
  return rows
    .filter(({ item }) => item)
    .map(({ item, price_mist, at_ms, kiosk }) => ({
      ...((item as Node)!.properties as Omit<ListingRow, 'price_mist' | 'at_ms' | 'kiosk'>),
      price_mist: String(price_mist),
      at_ms: Number(at_ms),
      kiosk: kiosk as string,
    }))
}
