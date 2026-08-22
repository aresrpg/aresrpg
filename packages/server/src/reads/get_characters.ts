// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The caller's characters, in BOTH custody shapes — everything held by kiosks the address OWNS,
// plus everything seated in a live fight (a seat severs the HOLDS edge by law, graph.rs). Both
// are equally his: the roster is what the client selects and embodies from, so a character
// missing here is a character its owner cannot reach at all.

import { MAX_TRACKED_CHARACTERS, type CharacterRow } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

import { shape_item, stats_record_of } from './stat_block.ts'

/** The Character node carries DF-sourced props raw: `spells` as a JSON string, one flat
 *  `job_<slug>` per job, `folded_stats` as the canonical 15-int array. Shape them into the
 *  protocol row here — the one decode seam. */
export const shape_character = (props: Record<string, unknown>) => {
  const { spells, available_spell_points, folded_stats, ambush, ...rest } = props
  const jobs = Object.fromEntries(
    Object.entries(rest)
      .filter(([key]) => key.startsWith('job_'))
      // graph.rs lowercases the slug at projection; the shared vocabulary (immutable job_slugs)
      // is UPPERCASE — restore it here, the one decode seam
      .map(([key, value]) => [key.slice(4).toUpperCase(), String(value)])
  )
  const plain = Object.fromEntries(Object.entries(rest).filter(([key]) => !key.startsWith('job_')))
  return {
    ...plain,
    spells: typeof spells === 'string' ? (JSON.parse(spells) as Record<string, number>) : {},
    available_spell_points: Number(available_spell_points ?? 0),
    ...(Array.isArray(folded_stats) ? { folded_stats: stats_record_of(folded_stats) } : {}),
    ...(typeof ambush === 'string' ? { ambush: JSON.parse(ambush) as CharacterRow['ambush'] } : {}),
    jobs,
  }
}

const shape_row = ({ character, kiosk_node, equipment }: Record<string, unknown>, custody: CharacterRow['custody']) => {
  const kiosk = (kiosk_node as Node)?.properties ?? {}
  return {
    ...shape_character((character as Exclude<Node, null | undefined>).properties),
    kiosk: kiosk.id,
    // the custody cap the client hands the SDK — absent until the indexer first meets the cap
    ...(typeof kiosk.personal_cap === 'string' ? { kiosk_cap: kiosk.personal_cap } : {}),
    equipment: (equipment as { slot: string; item: Node }[])
      .filter((entry) => entry.item)
      .map(({ slot, item }) => ({ slot, ...shape_item(item!.properties) })),
    custody,
  }
}

export async function get_characters(graph: Graph, { address }: { address: string }) {
  const [held, seated] = await Promise.all([
    graph.read(
      `
      MATCH (:User {address: $address})-[:OWNS]->(k:Kiosk)-[:HOLDS]->(c:Character)
      OPTIONAL MATCH (c)-[e:EQUIPS]->(i:Item)
      RETURN c AS character, k AS kiosk_node, collect({ slot: e.slot, item: i }) AS equipment`,
      { address }
    ),
    // the seated half: a character in a fight has NO holding kiosk, and the roster is the only
    // door back to it — omit it and the client drops the selection, so the player sees an empty
    // character list and can never embody, forfeit, or finish the fight (incident 2026-08-21).
    // Its custody pair is the caller's own kiosk, the one it re-locks into when it leaves.
    graph.read(
      `
      MATCH (:Fight)-[:FIGHTER]->(c:Character {owner: $address})
      OPTIONAL MATCH (c)-[e:EQUIPS]->(i:Item)
      WITH c, collect({ slot: e.slot, item: i }) AS equipment
      OPTIONAL MATCH (:User {address: $address})-[:OWNS]->(k:Kiosk)
      WITH c, equipment, collect(k) AS kiosks
      RETURN c AS character, head(kiosks) AS kiosk_node, equipment`,
      { address }
    ),
  ])
  const rows = [
    ...held.map((row) => shape_row(row, 'kiosk')),
    ...seated.map((row) => shape_row(row, 'fight')),
  ] as CharacterRow[]
  return [...rows].sort((left, right) => left.id.localeCompare(right.id)).slice(0, MAX_TRACKED_CHARACTERS)
}
