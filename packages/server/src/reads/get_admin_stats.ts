// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Whitelist-gated: global counts — the owner's dashboard floor. Revenue detail rides the
// economy zsets later; the graph gives the population truth.

import { type Graph, type Node } from '../graph.ts'

export async function get_admin_stats(graph: Graph) {
  const rows = await graph.read(`
    MATCH (v)
    RETURN labels(v)[0] AS label, count(v) AS count
    ORDER BY count DESC`)
  return Object.fromEntries(rows.map(({ label, count }) => [label as string, count as number]))
}
