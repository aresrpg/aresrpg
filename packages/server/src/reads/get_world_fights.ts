// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Live fights anchored in the tracked zones — the world markers a traveler sees. Bounding-box
// query over the spiral square, JS-filtered to the requested cells.

import type { FightRow } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

export async function get_world_fights(
  graph: Graph,
  { world, zones }: { world: string; zones: { zx: number; zz: number }[] }
) {
  if (zones.length === 0) return []
  const rows = await graph.read(
    `
    MATCH (f:Fight {world: $world})
    WHERE f.x >= $zx_min AND f.x <= $zx_max AND f.z >= $zz_min AND f.z <= $zz_max
    RETURN f AS fight`,
    {
      world,
      zx_min: Math.min(...zones.map(({ zx }) => zx)),
      zx_max: Math.max(...zones.map(({ zx }) => zx)),
      zz_min: Math.min(...zones.map(({ zz }) => zz)),
      zz_max: Math.max(...zones.map(({ zz }) => zz)),
    }
  )
  const wanted = new Set(zones.map(({ zx, zz }) => `${zx}:${zz}`))
  return rows
    .map(({ fight }) => (fight as Exclude<Node, null | undefined>).properties as unknown as FightRow)
    .filter((fight) => wanted.has(`${fight.x}:${fight.z}`))
}
