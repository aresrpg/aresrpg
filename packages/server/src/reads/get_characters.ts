// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The caller's characters: everything held by kiosks the address OWNS, with equipment attached.
// A character seated in a fight has its HOLDS edge severed (graph.rs law) — it returns through
// the fight read, not here.

import type { CharacterRow } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

/** The Character node carries DF-sourced props raw: `spells` as a JSON string, one flat
 *  `job_<slug>` per job. Shape them into the protocol row here — the one decode seam. */
export const shape_character = (props: Record<string, unknown>) => {
  const { spells, spell_points_spent, ...rest } = props
  const jobs = Object.fromEntries(
    Object.entries(rest)
      .filter(([key]) => key.startsWith('job_'))
      .map(([key, value]) => [key.slice(4), String(value)])
  )
  const plain = Object.fromEntries(Object.entries(rest).filter(([key]) => !key.startsWith('job_')))
  return {
    ...plain,
    spells: typeof spells === 'string' ? (JSON.parse(spells) as Record<string, number>) : {},
    spell_points_spent: Number(spell_points_spent ?? 0),
    jobs,
  }
}

export async function get_characters(graph: Graph, { address }: { address: string }) {
  const rows = await graph.read(
    `
    MATCH (:User {address: $address})-[:OWNS]->(k:Kiosk)-[:HOLDS]->(c:Character)
    OPTIONAL MATCH (c)-[e:EQUIPS]->(i:Item)
    RETURN c AS character, k.id AS kiosk, collect({ slot: e.slot, item: i }) AS equipment`,
    { address }
  )
  return rows.map(({ character, kiosk, equipment }) => ({
    ...shape_character((character as Exclude<Node, null | undefined>).properties),
    kiosk,
    equipment: (equipment as { slot: string; item: Node }[])
      .filter((entry) => entry.item)
      .map(({ slot, item }) => ({ slot, ...item!.properties })),
  })) as CharacterRow[]
}
