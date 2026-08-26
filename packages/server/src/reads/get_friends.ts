// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The caller's friends — the address edge is truth; immutable character names are optional
// display enrichment resolved through Character.owner, independent of current custody.

import { type Graph, type Node } from '../graph.ts'

export async function get_friends(graph: Graph, { address }: { address: string }) {
  const rows = await graph.read(
    `
    MATCH (:User {address: $address})-[:FRIEND]->(friend:User)
    OPTIONAL MATCH (c:Character) WHERE c.owner = friend.address
    RETURN friend.address AS address, collect(c.name) AS characters`,
    { address }
  )
  return rows.map(({ address: friend, characters }) => ({
    address: friend,
    characters: (characters as (string | null)[])
      .filter((name): name is string => typeof name === 'string')
      .sort((left, right) => left.localeCompare(right)),
  }))
}
