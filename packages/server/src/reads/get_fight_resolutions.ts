// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Durable post-fight work. RESULT_FOR is projected from the Fight object and survives character
// custody returning to a kiosk; when settlement and every drop are complete, the edge vanishes.

import type { FightResolutionRow } from '@aresrpg/protocol'

import type { Graph } from '../graph.ts'

export async function get_fight_resolutions(
  graph: Graph,
  { address }: Readonly<{ address: string }>
): Promise<FightResolutionRow[]> {
  const rows = await graph.read(
    `MATCH (f:Fight)-[r:RESULT_FOR]->(:User {address: $address})
     OPTIONAL MATCH (c:Character) WHERE c.id = r.character
     RETURN f.id AS fight, f.winner AS winner, r.seat AS fighter, r.character AS character,
            r.team AS team, r.dead AS dead, r.settled AS settled,
            r.drops AS drops, c.level AS level, c.experience AS experience`,
    { address }
  )
  return rows.map((row) => ({
    fight: String(row.fight),
    fighter: Number(row.fighter),
    character: String(row.character),
    team: Number(row.team),
    winner: row.winner === null || row.winner === undefined ? null : Number(row.winner),
    dead: Boolean(row.dead),
    settled: Boolean(row.settled),
    level: Number(row.level ?? 1),
    experience: String(row.experience ?? 0),
    drops: typeof row.drops === 'string' ? JSON.parse(row.drops) : [],
  }))
}
