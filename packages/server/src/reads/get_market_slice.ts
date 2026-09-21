// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One market category's live PUBLIC listings — the slice pushed when a player observes a
// category (exclusive listings are private p2p offers; they never reach the browse surface).

import { ITEM_STAT_FIELDS } from '@aresrpg/fight/move_contract'
import { MARKET_GROUP_PAGE_SIZE, MARKET_OFFERS_PER_GROUP } from '@aresrpg/protocol'
import { max_level as character_max_level, stackable_item_categories, type ItemCategory } from '@aresrpg/immutable'
import type { ListingRow, MarketObservation, MarketSnapshot, MarketPage, MarketType, ItemRow } from '@aresrpg/protocol'

import { type Graph, type Node, type GraphRow } from '../graph.ts'

import { shape_item } from './stat_block.ts'

export const shape_market_snapshot = (rows: readonly GraphRow[]): MarketSnapshot => ({
  kiosk_versions: Object.fromEntries(
    rows
      .filter(({ kiosk }) => typeof kiosk === 'string')
      .map(({ kiosk, market_version }) => [kiosk, String(market_version ?? '0')])
  ),
  listings: rows
    .filter(({ asset }) => asset)
    .map(({ asset, kinds, price_mist, at_ms, kiosk, seller, version, group_key }) => {
      const row = (asset as Node)!.properties
      const kind = (kinds as string[]).includes('Character') ? 'character' : 'item'
      const details = shape_item(row) as ItemRow
      return {
        kind,
        group_key: group_key as string | undefined,
        version: String(version ?? '0'),
        id: String(row.id),
        name: String(row.name),
        item_type: kind === 'item' ? String(row.item_type) : null,
        category: kind === 'item' ? String(row.category) : null,
        level: Number(row.level),
        amount: kind === 'item' ? Number(row.amount) : 1,
        ...(kind === 'item'
          ? {
              stats: details.stats,
              damages: details.damages,
              pet_power: details.pet_power,
              pet_last_day: details.pet_last_day,
              puits: details.puits,
            }
          : {}),
        ...(kind === 'character' ? { classe: String(row.classe) } : {}),
        price_mist: String(price_mist),
        kiosk: String(kiosk),
        seller: String(seller),
        at_ms: Number(at_ms),
      } satisfies ListingRow
    }),
})

// One group identity over the indexed purchase-relevant values. Unknown rolls stay distinct.
const ROLL_KEY = `CASE WHEN asset.category IN $stackable THEN 'lot:' + toString(asset.amount)
  WHEN asset.stats IS NULL OR size(asset.stats) <> $stat_count THEN 'object:' + asset.id
  ELSE 'roll:' + toString(asset.amount) + ':' + toString(asset.level)
    + reduce(key = '', value IN asset.stats | key + ':' + toString(value))
    + '|' + coalesce(asset.damages, '')
    + '|' + coalesce(toString(asset.pet_power), '')
    + '|' + coalesce(toString(asset.pet_last_day), '')
    + '|' + coalesce(asset.puits, '') END`
const OFFER = `{group_key: group_key, asset: asset, kinds: labels(asset), price_mist: listing.price, at_ms: listing.at_ms,
  kiosk: kiosk.id, market_version: kiosk.market_version, version: listing.version, seller: owner.address}`

const listing_query = (observation: Extract<MarketObservation, { kind: 'offers' | 'characters' }>) => {
  if (observation.kind === 'characters')
    return {
      match: `MATCH (asset:Character)-[listing:LISTED_IN {exclusive: false}]->(kiosk:Kiosk)<-[:OWNS]-(owner:User)
      WHERE owner.address <> $address AND ($classe IS NULL OR asset.classe = $classe)
        AND asset.level >= $min_level AND asset.level <= $max_level`,
      group_key: 'asset.id',
      params: {
        classe: observation.classe ?? null,
        min_level: observation.min_level ?? 1,
        max_level: observation.max_level ?? character_max_level,
      },
    }
  return {
    match: `MATCH (asset:Item {item_type: $item_type})-[listing:LISTED_IN {exclusive: false}]->(kiosk:Kiosk)<-[:OWNS]-(owner:User)
      WHERE owner.address <> $address AND asset.category = $category`,
    group_key: ROLL_KEY,
    params: { item_type: observation.item_type, category: observation.category },
  }
}

export async function get_market_slice(
  graph: Graph,
  { observation, address, kiosks = [] }: { observation: MarketObservation; address: string; kiosks?: readonly string[] }
): Promise<MarketPage> {
  if (observation.kind === 'types' || observation.kind === 'overview')
    return { listings: [], kiosk_versions: {}, next_cursor: null }
  const plan = listing_query(observation)
  const [snapshot] = await graph.read(
    `${plan.match}
    WITH asset, listing, kiosk, owner, ${plan.group_key} AS group_key
    WHERE group_key > $cursor
    WITH group_key, collect({asset:asset, listing:listing, kiosk:kiosk, owner:owner}) AS candidates
    ORDER BY group_key LIMIT ${MARKET_GROUP_PAGE_SIZE + 1}
    UNWIND candidates AS candidate
    WITH group_key, candidate.asset AS asset, candidate.listing AS listing, candidate.kiosk AS kiosk, candidate.owner AS owner
    ORDER BY group_key, size(listing.price), listing.price, asset.id
    WITH group_key, collect(${OFFER})[0..${MARKET_OFFERS_PER_GROUP}] AS offers
    ORDER BY group_key
    WITH collect({group_key: group_key, offers: offers}) AS groups
    OPTIONAL MATCH (previous:Kiosk) WHERE previous.id IN $kiosks
    RETURN groups, collect({kiosk: previous.id, market_version: previous.market_version}) AS kiosks`,
    {
      address,
      kiosks: [...kiosks],
      cursor: observation.cursor ?? '',
      stackable: [...stackable_item_categories],
      stat_count: ITEM_STAT_FIELDS.length,
      ...plan.params,
    }
  )
  const rows = (snapshot?.groups ?? []) as { group_key: string; offers: GraphRow[] }[]
  const page = rows.slice(0, MARKET_GROUP_PAGE_SIZE)
  return {
    ...shape_market_snapshot([...page.flatMap(({ offers }) => offers ?? []), ...(snapshot?.kiosks ?? [])]),
    next_cursor: rows.length > MARKET_GROUP_PAGE_SIZE ? String(page.at(-1)!.group_key) : null,
  }
}

export async function get_market_types(graph: Graph, category: ItemCategory): Promise<readonly MarketType[]> {
  const rows = await graph.read(
    `MATCH (asset:Item {category: $category})-[:LISTED_IN {exclusive: false}]->(:Kiosk)<-[:OWNS]-(:User)
    RETURN asset.item_type AS item_type, min(asset.name) AS name, min(asset.level) AS level
    ORDER BY level, item_type`,
    { category }
  )
  return rows.map(({ item_type, name, level }) => ({
    item_type: String(item_type),
    name: String(name),
    level: Number(level),
    category,
  }))
}
