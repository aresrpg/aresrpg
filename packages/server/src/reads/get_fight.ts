// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One fight's projected node as the WIRE row — the same `FightRow` the zone snapshot ships, so
// a marker born on the stream and a marker read from a snapshot are the same shape (a client
// that has to invent the difference invents it wrong). The roster lives inside the `machine`
// document, so a caller that needs seats reads `get_fight_checkpoint`, which owns that decode.

import type { FightRow } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

export async function get_fight(graph: Graph, { fight_id }: { fight_id: string }): Promise<FightRow[]> {
  const rows = await graph.read(
    `MATCH (f:Fight {id: $fight_id}) OPTIONAL MATCH (m:TournamentMatch {fight_id: f.id}) RETURN f AS fight, m.tournament AS tournament`,
    { fight_id }
  )
  return rows.map(
    ({ fight, tournament }) =>
      ({
        ...(fight as Exclude<Node, null | undefined>).properties,
        ...(typeof tournament === 'string' ? { tournament } : {}),
      }) as unknown as FightRow
  )
}
