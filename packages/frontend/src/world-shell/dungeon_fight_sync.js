// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S2 SYNC SEAM — the chain-read → core-snapshot leg extracted from dungeon_fight_shim.js (thin-shim ≤120 LoC gate).
// It owns NO fight logic: it only decodes a Fight OBJECT read and feeds it through the core's ONE snapshot door,
// plus the per-world render offset the read is placed against. The shim re-exports both so importers are unchanged.

import { decode_fight } from '@aresrpg/sdk/fight'
import { world_offsets } from '@aresrpg/sdk/coords'
import { get_world } from '@aresrpg/sdk/game'
import { fight_store } from '@aresrpg/fight/store'
import { read_fighter_statuses } from '@aresrpg/fight/fight_status_snapshot'

import { mark_engage_fight_adopted } from '../core/engage_timing.js'

// A world fight's UNSIGNED chain anchor → signed WORLD render space via the per-world `bounds/2` offset (immutable
// on-chain, so resolved ONCE per world, tab-cached). A miss falls back to the default-bounds offset (near origin).
/** @type {Map<string, { x: number, z: number }>} */
const _world_offset_cache = new Map()
export async function resolve_world_offset(/** @type {any} */ sdk, /** @type {string | null | undefined} */ world_id) {
  if (!world_id) return world_offsets(null)
  const hit = _world_offset_cache.get(world_id)
  if (hit) return hit
  const off = world_offsets(await get_world({ grpc_client: sdk.grpc_client })(world_id).catch(() => null))
  _world_offset_cache.set(world_id, off)
  return off
}

/**
 * SNAPSHOT a decoded Fight OBJECT read into the core (the base lane). `read` = { json, version } for a live fight,
 * or null for the pre-engage OPEN roam view (a run with no fight yet — versioned by `open_version`, the RunPass
 * version, so a room advance re-adopts). ALL fighter-status rows are attached from the raw json (decode_fight omits
 * them; the field name `invisibility_statuses` is legacy — board_state maps it to the view's per-fighter `statuses`
 * the fold groups and engine_view exposes as `effects`).
 *
 * QUARANTINE ENTRY POINT — BRIDGE B6 (expiry: P2, register #17/#51). This is the SOLE entry of a chain-direct gRPC
 * tactical Fight read into fight state: it dispatches the `snapshot` input, and the reducer's VERSIONED MERGE is the
 * only thing that touches state (below-floor drops, equal-version compares — keystone #3 — higher adopts). A gRPC
 * read NEVER pushes state by any other path. The transport swap (gRPC → /v1 versioned feed) is P2 (a k8s deploy,
 * owner-gated) and orthogonal to this discipline — delete this bridge when P2 lands.
 * @param {{ read: { json:any, version:any }|null, run?: any, rooms_total?: number, ctx?: any, open_version?: number }} args
 */
export function sync_dungeon_fight({ read, run = null, rooms_total = 0, ctx = {}, open_version = 0 }) {
  const fight = read ? decode_fight(read.json) : null
  if (fight && read) fight.invisibility_statuses = read_fighter_statuses(read.json)
  fight_store.getState().input({
    type: 'snapshot',
    fight,
    // SESSION IDENTITY (register #18): a decoded read for fight A must never adopt into fight B. The reducer drops
    // on a proven fight_id MISMATCH and HOLDS an id-less OPEN read (fight == null, the pre-engage roam).
    fight_id: fight?.id ?? null,
    version: read ? Number(read.version) : Number(open_version) || 0,
    run,
    rooms_total,
    ctx,
  })
  if (fight?.id && String(fight_store.getState().view?.id) === String(fight.id)) mark_engage_fight_adopted(fight.id)
  return fight
}
