// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One market category's live PUBLIC listings — the slice pushed when a player observes a
// category (exclusive listings are private p2p offers; they never reach the browse surface).

import type { ListingRow, MarketObservation } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

const listing = (
  asset: Node,
  kind: ListingRow['kind'],
  price_mist: unknown,
  at_ms: unknown,
  kiosk: unknown,
  seller: unknown
): ListingRow => {
  const row = asset!.properties
  return {
    kind,
    id: String(row.id),
    name: String(row.name),
    item_type: kind === 'item' ? String(row.item_type) : null,
    category: kind === 'item' ? String(row.category) : null,
    level: Number(row.level),
    amount: kind === 'item' ? Number(row.amount) : 1,
    ...(kind === 'character' ? { classe: String(row.classe) } : {}),
    price_mist: String(price_mist),
    kiosk: String(kiosk),
    seller: String(seller),
    at_ms: Number(at_ms),
  }
}

export async function get_market_slice(
  graph: Graph,
  { observation }: { observation: MarketObservation }
): Promise<ListingRow[]> {
  if (observation.categories.length === 0 && !observation.characters) return []
  const rows = await graph.read(
    `
    MATCH (u:User)-[:OWNS]->(k:Kiosk)<-[l:LISTED_IN {exclusive: false}]-(asset)
    WHERE (asset:Item AND asset.category IN $categories) OR (asset:Character AND $characters)
    RETURN asset, labels(asset) AS kinds, l.price AS price_mist, l.at_ms AS at_ms, k.id AS kiosk, u.address AS seller
    ORDER BY l.at_ms DESC
    LIMIT 200`,
    { categories: [...observation.categories], characters: observation.characters }
  )
  return rows
    .filter(({ asset }) => asset)
    .map(({ asset, kinds, price_mist, at_ms, kiosk, seller }) =>
      listing(
        asset as Node,
        (kinds as string[]).includes('Character') ? 'character' : 'item',
        price_mist,
        at_ms,
        kiosk,
        seller
      )
    )
}

export async function get_market_listing(graph: Graph, { id }: { id: string }): Promise<ListingRow | null> {
  const rows = await graph.read(
    `
    MATCH (u:User)-[:OWNS]->(k:Kiosk)<-[l:LISTED_IN {exclusive: false}]-(asset {id: $id})
    RETURN asset, labels(asset) AS kinds, l.price AS price_mist, l.at_ms AS at_ms, k.id AS kiosk, u.address AS seller`,
    { id }
  )
  const [row] = rows
  if (!row?.asset) return null
  return listing(
    row.asset as Node,
    (row.kinds as string[]).includes('Character') ? 'character' : 'item',
    row.price_mist,
    row.at_ms,
    row.kiosk,
    row.seller
  )
}
