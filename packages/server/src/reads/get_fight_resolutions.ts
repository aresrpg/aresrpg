// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Durable post-fight work. RESULT_FOR is projected before the one atomic settlement; its
// disappearance proves character return and every assigned loot deposit completed together.

import type { FightResolutionRow } from '@aresrpg/protocol'

import type { Graph } from '../graph.ts'

export async function get_fight_resolutions(
  graph: Graph,
  { address }: Readonly<{ address: string }>
): Promise<FightResolutionRow[]> {
  const rows = await graph.read(
    `MATCH (f:Fight)-[r:RESULT_FOR]->(:User {address: $address})
     OPTIONAL MATCH (c:Character) WHERE c.id = r.character
     RETURN f.id AS fight, f.world AS world, f.dungeon_room AS dungeon, f.winner AS winner,
            r.seat AS fighter, r.character AS character,
            r.team AS team, r.dead AS dead, r.settled AS settled,
            r.loot_types AS loot_types, r.drops AS drops, c.level AS level, c.experience AS experience`,
    { address }
  )
  return rows.map((row) => ({
    fight: String(row.fight),
    world: String(row.world),
    dungeon: row.dungeon === null || row.dungeon === undefined ? null : Number(row.dungeon),
    fighter: Number(row.fighter),
    character: String(row.character),
    team: Number(row.team),
    winner: row.winner === null || row.winner === undefined ? null : Number(row.winner),
    dead: Boolean(row.dead),
    settled: Boolean(row.settled),
    level: Number(row.level ?? 1),
    experience: String(row.experience ?? 0),
    loot_types: typeof row.loot_types === 'string' ? JSON.parse(row.loot_types) : [],
    drops: typeof row.drops === 'string' ? JSON.parse(row.drops) : [],
  }))
}
