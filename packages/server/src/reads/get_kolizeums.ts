// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The open kolizeum lobbies — the matchmaking board.

import { type Graph, type Node } from '../graph.ts'

export async function get_kolizeums(graph: Graph) {
  const rows = await graph.read(`
    MATCH (k:Kolizeum)
    RETURN k AS kolizeum
    ORDER BY k.ckpt DESC
    LIMIT 100`)
  return rows.map(({ kolizeum }) => (kolizeum as Node)?.properties)
}
