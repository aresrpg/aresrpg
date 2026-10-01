// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Live fights anchored in the tracked zones — the world markers a traveler sees. Bounding-box
// query over the spiral square in BLOCK coordinates (a zone is ZONE_SIZE blocks), then filtered
// to the requested cells; ended fights never project (their zone channel already despawned them).

import { FIGHT_DISCOVERY_MAX_AGE_MS, fight_discoverable, ZONE_SIZE, zone_of, type FightRow } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

export async function get_world_fights(
  graph: Graph,
  { world, zones }: { world: string; zones: { zx: number; zz: number }[] }
) {
  if (zones.length === 0) return []
  const now_ms = Date.now()
  const rows = await graph.read(
    `
    MATCH (f:Fight {world: $world})
    WHERE f.x >= $x_min AND f.x < $x_max AND f.z >= $z_min AND f.z < $z_max
      AND f.placement_ms >= $earliest_ms AND f.phase <> 'ended'
    RETURN f AS fight`,
    {
      world,
      earliest_ms: now_ms - FIGHT_DISCOVERY_MAX_AGE_MS,
      x_min: Math.min(...zones.map(({ zx }) => zx)) * ZONE_SIZE,
      x_max: (Math.max(...zones.map(({ zx }) => zx)) + 1) * ZONE_SIZE,
      z_min: Math.min(...zones.map(({ zz }) => zz)) * ZONE_SIZE,
      z_max: (Math.max(...zones.map(({ zz }) => zz)) + 1) * ZONE_SIZE,
    }
  )
  const wanted = new Set(zones.map(({ zx, zz }) => `${zx}:${zz}`))
  return rows
    .map(({ fight }) => (fight as Exclude<Node, null | undefined>).properties as unknown as FightRow)
    .filter((fight) => fight.phase !== 'ended' && fight_discoverable(fight, now_ms))
    .filter((fight) => wanted.has(`${zone_of(fight.x, fight.z).zx}:${zone_of(fight.x, fight.z).zz}`))
}
