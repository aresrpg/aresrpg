// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One character in full: props, equipment, party seat, fight seat — wherever it currently lives.

import { type Graph, type Node } from '../graph.ts'

import { shape_character } from './get_characters.ts'

export async function get_character(graph: Graph, { character_id }: { character_id: string }) {
  const rows = await graph.read(
    `
    MATCH (c:Character {id: $character_id})
    OPTIONAL MATCH (c)-[e:EQUIPS]->(i:Item)
    OPTIONAL MATCH (c)-[m:MEMBER_OF]->(p:Party)
    OPTIONAL MATCH (f:Fight)-[s:FIGHTER]->(c)
    RETURN c AS character,
           collect({ slot: e.slot, item: i }) AS equipment,
           p.id AS party, m.order AS party_order,
           f.id AS fight, s.seat AS seat, s.team AS team`,
    { character_id }
  )
  return rows.map(({ character, equipment, party, party_order, fight, seat, team }) => ({
    ...shape_character((character as Exclude<Node, null | undefined>).properties),
    equipment: (equipment as { slot: string; item: Node }[])
      .filter((entry) => entry.item)
      .map(({ slot, item }) => ({ slot, ...item!.properties })),
    party: party ? { id: party, order: party_order } : null,
    fight: fight ? { id: fight, seat, team } : null,
  }))
}
