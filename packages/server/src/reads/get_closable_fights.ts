// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Graph } from '../graph.ts'

export async function get_closable_fights(graph: Graph, { address }: Readonly<{ address: string }>) {
  const rows = await graph.read(
    `MATCH (f:Fight)-[:CLOSABLE_FOR]->(:User {address: $address})
     OPTIONAL MATCH (k:Kolizeum {fight_id: f.id})
     RETURN f.id AS fight, k.id AS kolizeum`,
    { address }
  )
  return rows.map(({ fight, kolizeum }) => ({
    fight: String(fight),
    kolizeum: typeof kolizeum === 'string' ? kolizeum : null,
  }))
}
