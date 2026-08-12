// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The user's ONE inventory: every Item held by any kiosk the address OWNS, flat. The kiosk id
// rides on each row as a transaction-building convenience — never a grouping (owner 2026-08-12).
// Equipment is a CHARACTER concern and comes through the characters read.

import type { ItemRow } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

export async function get_items(graph: Graph, { address }: { address: string }) {
  const rows = await graph.read(
    `
    MATCH (:User {address: $address})-[:OWNS]->(k:Kiosk)-[:HOLDS]->(i:Item)
    RETURN i AS item, k.id AS kiosk`,
    { address }
  )
  return rows.map(({ item, kiosk }) => ({ ...(item as Node)!.properties, kiosk })) as ItemRow[]
}
