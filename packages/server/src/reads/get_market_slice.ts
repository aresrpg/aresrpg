// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One market category's live PUBLIC listings — the slice pushed when a player observes a
// category (exclusive listings are private p2p offers; they never reach the browse surface).

import { MARKET_WINDOW_SIZE } from '@aresrpg/protocol'
import type { ListingRow, MarketCounts, MarketObservation, MarketSnapshot } from '@aresrpg/protocol'

import { type Graph, type Node, type GraphRow } from '../graph.ts'

export const shape_market_snapshot = (rows: readonly GraphRow[]): MarketSnapshot => ({
  kiosk_versions: Object.fromEntries(
    rows
      .filter(({ kiosk }) => typeof kiosk === 'string')
      .map(({ kiosk, market_version }) => [kiosk, String(market_version ?? '0')])
  ),
  listings: rows
    .filter(({ asset }) => asset)
    .map(({ asset, kinds, price_mist, at_ms, kiosk, seller, version }) => {
      const row = (asset as Node)!.properties
      const kind = (kinds as string[]).includes('Character') ? 'character' : 'item'
      return {
        kind,
        version: String(version ?? '0'),
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
      } satisfies ListingRow
    }),
})

export async function get_market_slice(
  graph: Graph,
  { observation, kiosks = [] }: { observation: MarketObservation; kiosks?: readonly string[] }
): Promise<MarketSnapshot> {
  const [snapshot] = await graph.read(
    `
    MATCH (u:User)-[:OWNS]->(k:Kiosk)<-[l:LISTED_IN {exclusive: false}]-(asset)
    WHERE (asset:Item AND asset.category IN $categories) OR (asset:Character AND $characters)
    WITH asset, k, u, l ORDER BY l.at_ms DESC LIMIT ${MARKET_WINDOW_SIZE}
    WITH collect({asset: asset, kinds: labels(asset), price_mist: l.price, at_ms: l.at_ms,
      kiosk: k.id, market_version: k.market_version, version: l.version, seller: u.address}) AS listings
    OPTIONAL MATCH (previous:Kiosk) WHERE previous.id IN $kiosks
    RETURN listings, collect({kiosk: previous.id, market_version: previous.market_version}) AS kiosks`,
    { categories: [...observation.categories], characters: observation.characters, kiosks: [...kiosks] }
  )
  return shape_market_snapshot([...(snapshot?.listings ?? []), ...(snapshot?.kiosks ?? [])])
}

export async function get_market_counts(graph: Graph): Promise<MarketCounts> {
  const [items, characters] = await Promise.all([
    graph.read(
      `MATCH (:User)-[:OWNS]->(:Kiosk)<-[:LISTED_IN {exclusive: false}]-(asset:Item)
       RETURN asset.category AS category, count(asset) AS count`
    ),
    graph.read(
      `MATCH (:User)-[:OWNS]->(:Kiosk)<-[:LISTED_IN {exclusive: false}]-(asset:Character)
       RETURN count(asset) AS count`
    ),
  ])
  const categories = Object.fromEntries(
    items.flatMap(({ category, count }) => (typeof category === 'string' ? [[category, Number(count)] as const] : []))
  ) as MarketCounts['categories']
  return Object.freeze({ categories: Object.freeze(categories), characters: Number(characters[0]?.count ?? 0) })
}
