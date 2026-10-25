// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Graph } from '../graph.ts'

import { tournament_link } from './tournament_link.ts'

export async function get_closable_fights(graph: Graph, { address }: Readonly<{ address: string }>) {
  const rows = await graph.read(
    `MATCH (f:Fight)-[:CLOSABLE_FOR]->(:User {address: $address})
     OPTIONAL MATCH (k:Kolizeum {fight_id: f.id})
     OPTIONAL MATCH (tm:TournamentMatch {fight_id: f.id})
     RETURN tm.tournament AS tournament, tm.index AS tournament_index, f.id AS fight, k.id AS kolizeum`,
    { address }
  )
  return rows.map(({ fight, kolizeum, tournament, tournament_index }) => ({
    fight: String(fight),
    ...tournament_link({ tournament, tournament_index }),
    kolizeum: typeof kolizeum === 'string' ? kolizeum : null,
  }))
}
