// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One fight's projected node. Its `fighters` prop is the decoded fighters JSON (array order IS
// the seat; player entries carry `character` + `owner`) — no edge join needed.

import { type Graph, type Node } from '../graph.ts'

export async function get_fight(graph: Graph, { fight_id }: { fight_id: string }) {
  const rows = await graph.read(`MATCH (f:Fight {id: $fight_id}) RETURN f AS fight`, { fight_id })
  return rows.map(({ fight }) => (fight as Exclude<Node, null | undefined>).properties)
}
