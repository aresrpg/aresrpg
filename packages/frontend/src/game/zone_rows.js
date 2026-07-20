// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ZONE ROWS — the ONE frontend home turning a zone's on-chain STATE into its live spawn rows (search-cost
// rework): the chain stores only `{ seed, consumed bitmaps }` per discovered zone, and the
// row list DERIVES from the seed via `@aresrpg/sim`'s `derive_zone` — the byte-exact mirror of the chain's own
// `zone_comp`/`zone_gen` derivation, parity-pinned on both sides (zone_derive.test.js ↔ zone_gen_tests.move),
// so what this module renders IS what a fight/gather would materialise. Every legacy `get_zone(+decode)` /
// `get_zone_spawns` consumer (world_spawns.js, CompassStrip.jsx, gather_actions.js, embed_voxel_dev.js) now
// reads rows through here; the ROW SHAPE is unchanged apart from `spawn_id`/`group_seed` being decimal STRINGS
// (derived 64-bit ids exceed 2^53) and the new `index` field — the derivation-stream index the chain's gather
// door takes as `node_index` (STABLE across consumption, unlike the retired swap-remove positional index).
//
// Derivation INPUTS are the world's spawn tables + density dials (the World doc) and the live
// `team_size_bound` config dial — cached here (config-grade data; a world's tables change only at
// admin-authoring time, and a TTL re-search re-rolls the zone anyway).

import { derive_zone } from '@aresrpg/sim/zone_derive'
import { get_world, get_zone_state } from '@aresrpg/sdk/game'

import { DEMO_NETWORK } from '../chain/deployment'
import { get_sdk } from '../chain/sdk'
import { get_zone, get_config } from '../rpc/client'

/** @type {Map<string, Promise<any>>} world_id → the World doc read (tables + dials — config-grade, cached) */
const world_docs = new Map()

/** The World doc (spawn tables + density + bounds) — one chain read per world, shared by every consumer. */
export function zone_world_doc(/** @type {string} */ world_id) {
  if (!world_docs.has(world_id)) {
    const read = get_sdk()
      .then((sdk) => get_world({ grpc_client: sdk.grpc_client })(world_id))
      .then((doc) => {
        if (!doc) world_docs.delete(world_id) // an unreadable world is retried on the next call, never cached
        return doc
      })
      .catch(() => {
        world_docs.delete(world_id)
        return null
      })
    world_docs.set(world_id, read)
  }
  return world_docs.get(world_id)
}

/** @type {Promise<number> | null} the cached team_size_bound dial (§4 size cap input; chain default 6) */
let team_bound_read = null
function team_bound() {
  if (!team_bound_read)
    team_bound_read = get_config()
      .then((cfg) => (cfg?.dials?.team_size_bound != null ? Number(cfg.dials.team_size_bound) : 6))
      .catch(() => {
        team_bound_read = null // transient failure → retry next call; 6 = config.move DEFAULT_TEAM_SIZE
        return 6
      })
  return team_bound_read
}

/**
 * PURE composer: zone state + world doc (+ the dial) → live spawn rows. Exported for tests and for callers
 * that already hold both reads.
 * @param {{ seed:string|number, discovered_at_ms:number, mob_bitmap:number[], res_bitmap:number[] }} state
 * @param {number} zx @param {number} zy @param {any} world @param {number} bound
 */
export function rows_from_state(state, zx, zy, world, bound) {
  return derive_zone({ zone: state, zx, zy, world, team_bound: bound })
}

/** Join a fetched zone state with the cached world doc + dial → rows (`null` = undiscovered/unreadable). */
async function compose(/** @type {string} */ world_id, /** @type {number} */ zx, /** @type {number} */ zy, /** @type {any} */ state) {
  if (!state) return null
  const [world, bound] = await Promise.all([zone_world_doc(world_id), team_bound()])
  if (!world) return null
  return rows_from_state(state, zx, zy, world, bound)
}

/**
 * Zone rows via the /v1 read layer (the steady-state poll path). The v1 zone doc carries the raw
 * `{ seed, mob_bitmap, res_bitmap, discovered_at_ms }` the indexer projected off the Zone DF.
 * `null` = undiscovered (the honest "unsearched" signal).
 */
export async function zone_rows_v1(world_id, zx, zy, { signal = undefined, fresh = false } = {}) {
  const zone = await get_zone(world_id, zx, zy, signal, fresh)
  if (zone?.seed == null) return null // discovered-list form or a pre-rework doc — no state to derive from
  return compose(world_id, zx, zy, {
    seed: zone.seed,
    discovered_at_ms: Number(zone.discovered_at_ms ?? 0),
    mob_bitmap: zone.mob_bitmap ?? [],
    res_bitmap: zone.res_bitmap ?? [],
  })
}

/**
 * Zone rows CHAIN-DIRECT (tx pre-flight + the search fast-path): reads the Zone DF itself — immediately
 * consistent post-cert, zero indexer/cache hop. `null` = undiscovered.
 */
export async function zone_rows_chain(world_id, zx, zy) {
  const sdk = await get_sdk()
  const state = await get_zone_state({ grpc_client: sdk.grpc_client, network: DEMO_NETWORK })(world_id, zx, zy)
  return compose(world_id, zx, zy, state)
}
