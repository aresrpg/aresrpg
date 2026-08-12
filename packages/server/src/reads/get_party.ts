// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One party: members in order + open invitations.

import { type Graph, type Node } from '../graph.ts'

export async function get_party(graph: Graph, { party_id }: { party_id: string }) {
  const rows = await graph.read(
    `
    MATCH (p:Party {id: $party_id})
    OPTIONAL MATCH (member:Character)-[m:MEMBER_OF]->(p)
    OPTIONAL MATCH (p)-[:INVITED]->(invited:Character)
    RETURN p AS party, collect(DISTINCT { order: m.order, character: member }) AS members, collect(DISTINCT invited.id) AS invited`,
    { party_id }
  )
  return rows.map(({ party, members, invited }) => ({
    ...(party as Node)?.properties,
    members: (members as { order: number; character: Node }[])
      .filter((entry) => entry.character)
      .sort((a, b) => a.order - b.order)
      .map(({ order, character }) => ({ order, ...character!.properties })),
    invited: (invited as (string | null)[]).filter(Boolean),
  }))
}
