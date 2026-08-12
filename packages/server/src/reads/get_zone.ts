// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One world zone: its searched state (seed, mobs surface).

import { type Graph, type Node } from '../graph.ts'

export async function get_zone(graph: Graph, { world, zx, zz }: { world: string; zx: number; zz: number }) {
  const rows = await graph.read(
    `
    MATCH (z:Zone {world: $world, zx: $zx, zz: $zz})
    RETURN z AS zone`,
    { world, zx, zz }
  )
  return rows.map(({ zone }) => (zone as Node)?.properties)
}
