// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The caller's friends — User-FRIEND->User edges, with each friend's characters for display.

import { type Graph, type Node } from '../graph.ts'

export async function get_friends(graph: Graph, { address }: { address: string }) {
  const rows = await graph.read(
    `
    MATCH (:User {address: $address})-[:FRIEND]->(friend:User)
    OPTIONAL MATCH (friend)-[:OWNS]->(:Kiosk)-[:HOLDS]->(c:Character)
    RETURN friend.address AS address, collect(c.name) AS characters`,
    { address }
  )
  return rows.map(({ address: friend, characters }) => ({
    address: friend,
    characters: (characters as (string | null)[]).filter(Boolean),
  }))
}
