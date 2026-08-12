// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The embody gate. Two custody shapes prove ownership:
//   held   — the caller's own kiosk HOLDS the character (the normal chain),
//   seated — the character sits a live Fight (HOLDS is severed by law); the Fight node's
//            fighters JSON names each seat's OWNER — the address must appear there.
// The read also carries everything embodiment needs in ONE roundtrip: the four VISIBLE
// equipment slots (presence visuals), the party, and the live fight + seat.

import { VISIBLE_SLOTS, type VisibleSlot } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

import { shape_character } from './get_characters.ts'

export type OwnedCharacter = {
  character: Record<string, unknown>
  kiosk: string | null
  visuals: Record<VisibleSlot, string | null>
  party: string | null
  fight: { id: string; seat: number } | null
}

type FighterEntry = { kind: string; character?: string; owner?: string }

export async function get_owned_character(
  graph: Graph,
  { address, character_id }: { address: string; character_id: string }
): Promise<OwnedCharacter | null> {
  const rows = await graph.read(
    `
    MATCH (c:Character {id: $character_id})
    OPTIONAL MATCH (:User {address: $address})-[:OWNS]->(held_kiosk:Kiosk)-[:HOLDS]->(c)
    OPTIONAL MATCH (f:Fight)-[:FIGHTER]->(c)
    OPTIONAL MATCH (:User {address: $address})-[:OWNS]->(any_kiosk:Kiosk)
    OPTIONAL MATCH (c)-[e:EQUIPS]->(i:Item)
    OPTIONAL MATCH (c)-[:MEMBER_OF]->(p:Party)
    RETURN c AS character, held_kiosk.id AS held_kiosk, f AS fight, any_kiosk.id AS kiosk,
           p.id AS party, collect(DISTINCT { slot: e.slot, item_type: i.item_type }) AS worn`,
    { address, character_id }
  )
  const [row] = rows
  if (!row) return null

  // ownership: the custody chain, or a seat whose fighters JSON names this address
  const fight_node = row.fight as Node
  const fighters = JSON.parse((fight_node?.properties?.fighters as string) ?? '[]') as FighterEntry[]
  const seat = fighters.findIndex((fighter) => fighter.character === character_id && fighter.owner === address)
  if (!row.held_kiosk && seat === -1) return null

  const worn = row.worn as { slot: string | null; item_type: string | null }[]
  const visuals = Object.fromEntries(
    VISIBLE_SLOTS.map((slot) => [slot, worn.find((entry) => entry.slot === slot)?.item_type ?? null])
  ) as Record<VisibleSlot, string | null>

  return {
    character: shape_character((row.character as Exclude<Node, null | undefined>).properties),
    kiosk: (row.held_kiosk ?? row.kiosk ?? null) as string | null,
    visuals,
    party: (row.party ?? null) as string | null,
    fight: seat === -1 ? null : { id: (fight_node!.properties as { id: string }).id, seat },
  }
}
