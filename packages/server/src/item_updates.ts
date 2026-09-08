// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Resolve an indexer invalidation once at bus ingress, then fan out only to its custodians.
import type { ItemRow, ServerPacket } from '@aresrpg/protocol'

import type { Graph, Node } from './graph.ts'
import type { EventEnvelope } from './protocol.ts'
import { shape_item } from './reads/stat_block.ts'

export const item_updates = async (
  graph: Graph,
  { data }: EventEnvelope
): Promise<readonly { address: string; packet: ServerPacket }[]> => {
  const id = String(data.item)
  const holders = [
    ...new Set([data.holder, data.previous_holder].filter((holder): holder is string => typeof holder === 'string')),
  ]
  const [current, previous] = await Promise.all([
    graph.read(
      `MATCH (u:User)-[:OWNS]->(k:Kiosk)-[:HOLDS]->(i:Item {id: $id})
      RETURN i AS item, k.id AS kiosk, u.address AS address`,
      { id }
    ),
    holders.length
      ? graph.read(
          `MATCH (u:User)-[:OWNS]->(k:Kiosk) WHERE k.id IN $holders
      RETURN DISTINCT u.address AS address`,
          { holders }
        )
      : Promise.resolve([]),
  ])
  const [row] = current
  const item = row?.item ? ({ ...shape_item((row.item as Node)!.properties), kiosk: row.kiosk } as ItemRow) : null
  const addresses = new Set(previous.map(({ address }) => String(address)))
  if (item) addresses.add(String(row!.address))
  return [...addresses].map((address) => ({
    address,
    packet:
      item && address === row!.address
        ? { type: 'packet/item_updated', item }
        : { type: 'packet/item_removed', item: id, version: String(data.version) },
  }))
}
