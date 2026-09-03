// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Durable recovery only. Live clients settle from their terminal checkpoint and receipt;
// RESULT_FOR lets a reconnect rebuild the same transaction after either of those was lost.

import type { FightResolutionRow } from '@aresrpg/protocol'

import type { Graph } from '../graph.ts'

export async function get_fight_resolutions(
  graph: Graph,
  { address }: Readonly<{ address: string }>
): Promise<FightResolutionRow[]> {
  const rows = await graph.read(
    `MATCH (f:Fight)-[r:RESULT_FOR]->(:User {address: $address})
     OPTIONAL MATCH (k:Kolizeum {fight_id: f.id})
     RETURN f.id AS fight, f.world AS world, f.dungeon AS dungeon, f.dungeon_room AS dungeon_room, f.winner AS winner,
            k.id AS kolizeum,
            r.seat AS fighter, r.character AS character,
            r.team AS team, r.dead AS dead, r.settled AS settled,
            r.loot_types AS loot_types, r.drops AS drops`,
    { address }
  )
  return rows.map((row) => ({
    fight: String(row.fight),
    world: String(row.world),
    dungeon: row.dungeon === null || row.dungeon === undefined ? null : String(row.dungeon),
    dungeon_room: row.dungeon_room === null || row.dungeon_room === undefined ? null : Number(row.dungeon_room),
    kolizeum: typeof row.kolizeum === 'string' ? row.kolizeum : null,
    fighter: Number(row.fighter),
    character: String(row.character),
    team: Number(row.team),
    winner: row.winner === null || row.winner === undefined ? null : Number(row.winner),
    dead: Boolean(row.dead),
    settled: Boolean(row.settled),
    loot_types: typeof row.loot_types === 'string' ? JSON.parse(row.loot_types) : [],
    drops: typeof row.drops === 'string' ? JSON.parse(row.drops) : [],
  }))
}
