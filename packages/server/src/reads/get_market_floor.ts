// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { marketplace_lot_sizes } from '@aresrpg/immutable'

import type { Graph } from '../graph.ts'

/** Exact total asking prices, including the seller's own public listings. */
export const get_market_floor = async (graph: Graph, item_type: string): Promise<Readonly<Record<string, string>>> => {
  const rows = await graph.read(
    `MATCH (asset:Item {item_type: $item_type})-[listing:LISTED_IN {exclusive: false}]->(:Kiosk)<-[:OWNS]-(:User)
     WHERE asset.amount IN $lots AND listing.price <> '0'
     WITH asset.amount AS amount, listing.price AS price
     ORDER BY amount, size(price), price
     WITH amount, collect(price)[0] AS price
     RETURN amount, price`,
    { item_type, lots: [...marketplace_lot_sizes] }
  )
  return Object.fromEntries(rows.map(({ amount, price }) => [String(amount), String(price)]))
}
