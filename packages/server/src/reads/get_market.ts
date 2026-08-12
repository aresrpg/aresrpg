// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Market view for one item type: live listings (LISTED_IN carries price) + the last-sale row
// the indexer maintains on the Market node.

import { type Graph, type Node } from '../graph.ts'

export async function get_market(graph: Graph, { item_type }: { item_type: string }) {
  const rows = await graph.read(
    `
    MATCH (i:Item {item_type: $item_type})-[l:LISTED_IN]->(k:Kiosk)
    OPTIONAL MATCH (m:Market {item_type: $item_type})
    RETURN i AS item, l.price AS price, l.at_ms AS at_ms, k.id AS kiosk, m AS market
    ORDER BY l.price ASC
    LIMIT 100`,
    { item_type }
  )
  return {
    listings: rows
      .filter(({ item }) => item)
      .map(({ item, price, at_ms, kiosk }) => ({ ...(item as Node)!.properties, price, at_ms, kiosk })),
    market: (rows[0]?.market as Node)?.properties ?? null,
  }
}
