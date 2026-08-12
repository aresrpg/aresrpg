// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One item's projected props by id — the enrichment read behind equipment forwards and
// market-listing rows (the chain event names an id; the client renders a type).

import { type Graph, type Node } from '../graph.ts'

export async function get_item(graph: Graph, { id }: { id: string }) {
  const rows = await graph.read(`MATCH (i:Item {id: $id}) RETURN i AS item`, { id })
  return ((rows[0]?.item as Node)?.properties ?? null) as {
    id: string
    name: string
    item_type: string
    category: string
    level: number
    amount: number
  } | null
}
