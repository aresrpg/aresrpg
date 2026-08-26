// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One party: members in order + open invitations.

import { type Graph, type Node } from '../graph.ts'

type ShapedParty = Readonly<{
  id: string
  members: readonly Readonly<{ id: string; name: string; order: number }>[]
  invited: readonly Readonly<{ id: string; name: string }>[]
}>

const shape_parties = (rows: readonly Record<string, unknown>[]): ShapedParty[] =>
  rows.flatMap(({ party, members, invited }): ShapedParty[] => {
    if (!party) return []
    return [
      {
        id: String((party as Exclude<Node, null | undefined>).properties.id),
        members: ((members ?? []) as { order: number; character: Node }[])
          .filter((entry): entry is { order: number; character: Exclude<Node, null | undefined> } => !!entry.character)
          .sort((a, b) => a.order - b.order)
          .map(({ order, character }) => ({
            order,
            id: String(character.properties.id),
            name: String(character.properties.name),
          })),
        invited: ((invited ?? []) as Node[]).flatMap((character) =>
          character ? [{ id: String(character.properties.id), name: String(character.properties.name) }] : []
        ),
      },
    ]
  })

export async function get_party(graph: Graph, { party_id }: { party_id: string }) {
  const rows = await graph.read(
    `
    MATCH (p:Party {id: $party_id})
    OPTIONAL MATCH (member:Character)-[m:MEMBER_OF]->(p)
    OPTIONAL MATCH (p)-[:INVITED]->(invited:Character)
    RETURN p AS party, collect(DISTINCT { order: m.order, character: member }) AS members, collect(DISTINCT invited) AS invited`,
    { party_id }
  )
  return shape_parties(rows)
}

export async function get_party_invites(graph: Graph, { character_id }: { character_id: string }) {
  const rows = await graph.read(
    `MATCH (p:Party)-[:INVITED]->(:Character {id: $character_id})
     WITH DISTINCT p ORDER BY p.ckpt DESC LIMIT 50
     OPTIONAL MATCH (member:Character)-[m:MEMBER_OF]->(p)
     OPTIONAL MATCH (p)-[:INVITED]->(invited:Character)
     RETURN p AS party, collect(DISTINCT { order: m.order, character: member }) AS members,
            collect(DISTINCT invited) AS invited`,
    { character_id }
  )
  return shape_parties(rows)
}
