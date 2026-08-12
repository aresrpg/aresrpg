// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The tracked spiral's zone states — only zones a search ever touched exist in the graph; an
// unsearched zone is honestly absent (the client renders it dormant). The spiral is a square,
// so the query is a bounding box; the JS filter keeps only the requested cells (a diff may be
// smaller than its box).

import type { ZoneRow } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

export async function get_zones(
  graph: Graph,
  { world, zones }: { world: string; zones: { zx: number; zz: number }[] }
) {
  if (zones.length === 0) return []
  const rows = await graph.read(
    `
    MATCH (z:Zone {world: $world})
    WHERE z.zx >= $zx_min AND z.zx <= $zx_max AND z.zz >= $zz_min AND z.zz <= $zz_max
    RETURN z AS zone`,
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
    .map(({ zone }) => (zone as Exclude<Node, null | undefined>).properties as unknown as ZoneRow)
    .filter((zone) => wanted.has(`${zone.zx}:${zone.zz}`))
}
