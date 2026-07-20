// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure loot-display mapping for the §14 encyclopedia (no React / no RPC — plain data, so it is unit-tested
// offline against the /v1 contract). The /v1 mob doc's server-joined ON-CHAIN drops (RpcMobDrop) are the SINGLE
// source of truth for a mob's loot; this maps each row into the MobDetailView drop shape.
//
// TWO design laws are enforced here:
//   1. EXACT CHANCE — `chance_percent` (the on-chain basis-points / 100) is carried through VERBATIM and NEVER
//      rounded (a 0.10% drop must show "0.10%", not "0%"); `drop_weight` is only the clamped bar-fill width.
//   2. NO FABRICATION — the output is a pure projection of the /v1 rows passed in. There is no static-catalog
//      augmentation: a template not in the mob's on-chain `drops` can never appear (so "if it's in the
//      encyclopedia, it's provably in game"). An item still awaiting its object snapshot shows a short id.
import type { RpcMobDrop } from '../../rpc/views'

export interface DropDisplay {
  id: string
  name: string
  rarity: string
  category: string
  minQty: number
  maxQty: number
  chance_percent: number
  drop_weight: number
}

export function v1_drops_to_display(rows: RpcMobDrop[]): DropDisplay[] {
  return rows
    .map((d) => ({
      id: d.template_id,
      name: d.name ?? `${d.template_id.slice(0, 6)}…${d.template_id.slice(-4)}`,
      rarity: 'common',
      category: (d.category ?? '').toUpperCase(),
      minQty: d.min_qty,
      maxQty: d.max_qty,
      chance_percent: d.chance_percent,
      drop_weight: Math.min(100, d.chance_percent),
    }))
    .sort((a, b) => b.chance_percent - a.chance_percent)
}
