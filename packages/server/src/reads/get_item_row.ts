// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One kiosk-held item as a full wire row — the item-stream push's read (an equipped or
// burned item has no HOLDS edge and honestly returns null).

import type { ItemRow } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

import { shape_item } from './stat_block.ts'

export async function get_item_row(graph: Graph, { id }: { id: string }): Promise<ItemRow | null> {
  const rows = await graph.read(`MATCH (k:Kiosk)-[:HOLDS]->(i:Item {id: $id}) RETURN i AS item, k.id AS kiosk`, { id })
  const [row] = rows
  if (!row?.item) return null
  return { ...shape_item((row.item as Node)!.properties), kiosk: row.kiosk } as ItemRow
}
