// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Mutable shop truth. Immutable content stays in seed/ and never enters the graph packet.

import type { ShopState } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

const properties_of = (node: Node): Record<string, unknown> => node?.properties ?? {}

export async function get_shop_state(graph: Graph, { address }: { address: string }): Promise<ShopState> {
  const [sale_rows, airdrop_rows] = await Promise.all([
    graph.read(`MATCH (s:Sale) RETURN s AS sale`),
    graph.read(`MATCH (a:Airdrop) RETURN a AS airdrop`),
  ])
  return {
    sales: sale_rows.map(({ sale }) => {
      const properties = properties_of(sale as Node)
      return {
        item_type: String(properties.item_type),
        price: String(properties.price),
        supply: String(properties.supply),
        infinite: properties.infinite === true,
        enabled: properties.enabled !== false,
      }
    }),
    airdrops: airdrop_rows.map(({ airdrop }) => {
      const properties = properties_of(airdrop as Node)
      const whitelist = Array.isArray(properties.whitelist) ? (properties.whitelist as string[]) : []
      return {
        drop_id: String(properties.drop_id),
        eligible: whitelist.includes(address),
        eligible_count: whitelist.length,
      }
    }),
  }
}
