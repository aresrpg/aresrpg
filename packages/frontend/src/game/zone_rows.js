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

import { commitment_format, derive_zone } from '@aresrpg/sim/zone_derive'
import { get_world, get_zone_state } from '@aresrpg/sdk/game'

import { DEMO_NETWORK } from '../chain/deployment'
import { get_sdk } from '../chain/sdk'
import { get_zone, get_config } from '../rpc/client'

/** @type {Map<string, Promise<any>>} world_id → the World doc read (tables + dials — config-grade, cached) */
const world_docs = new Map()

/** @type {Map<string, any>} the SETTLED value of the same read — stamped on success only (never absence). */
const settled_world_docs = new Map()

/**
 * The World doc SYNCHRONOUSLY, if this tab has already read it — `null` when it has not. Same one home as
 * `zone_world_doc` (the promise resolves into this map; nothing else writes it), exposed for the callers that
 * cannot await: a pending fight session mounts its predicted board in the click's own turn (#1609), and a doc
 * that is not there yet simply yields no prediction rather than a fabricated one. Never caches absence — an
 * unreadable world leaves the map untouched and is retried by the promise path exactly as before.
 * @param {string} world_id
 */
export const settled_world_doc = (world_id) => world_docs.has(world_id) ? (settled_world_docs.get(world_id) ?? null) : null

/**
 * THE World doc (spawn tables + density + bounds + the zone grid dials) — ONE chain read per world per session,
 * shared by every consumer. #2054 folded the two hand-rolled twins of this cache (the world shell's search seam
 * and the compass strip each kept their own Map over the same read) into this home; a falsy world id resolves
 * null WITHOUT taking a cache slot, which is what those twins each guarded for locally.
 *
 * NEVER CACHES A NON-ANSWER: an absent world and a FAILED read both leave the map untouched, so the next caller
 * retries. Since #2054 the SDK read itself tells those two apart (absence resolves null, failure rejects) — the
 * catch below no longer papers over the difference for anyone downstream who wants it.
 */
export function zone_world_doc(/** @type {string} */ world_id) {
  if (!world_id) return Promise.resolve(null)
  if (!world_docs.has(world_id)) {
    const read = get_sdk()
      .then((sdk) => get_world({ grpc_client: sdk.grpc_client })(world_id))
      .then((doc) => {
        if (!doc) world_docs.delete(world_id) // an unreadable world is retried on the next call, never cached
        else settled_world_docs.set(world_id, doc)
        return doc
      })
      .catch(() => {
        world_docs.delete(world_id)
        settled_world_docs.delete(world_id)
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
 * @param {{ seed:string|number, discovered_at_ms:number, mob_bitmap:number[], res_bitmap:number[],
 *   group_root?:number[]|Uint8Array|null }} state the commitment root rides along: it selects the derivation
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
 * Whether a served zone doc's LIVENESS is resolvable: both consumed-bitmaps actually arrived. The bitmaps are
 * the only per-group liveness truth there is (`zones.move::claim` sets a group's bit at CLAIM time, and
 * `ESpawnNotFound` is asserted off it), so a doc that carries a `seed` with an ABSENT bitmap states nothing
 * about consumption — it is UNRESOLVABLE, not "nothing consumed". Reading absence as emptiness is the cache-law
 * inversion: since #596 a fetched cell is AUTHORITATIVE and REPLACES the zone's rows, so deriving off a missing
 * bitmap would republish every already-consumed group as proven-live truth — the ghost-mob bug, restored with
 * confidence. Absence and emptiness are indistinguishable one hop downstream, which is why this decision lives
 * at the read seam.
 * @param {{ mob_bitmap?: number[], res_bitmap?: number[] } | null | undefined} zone the /v1 zone doc
 */
export const zone_state_resolvable = (zone) => Array.isArray(zone?.mob_bitmap) && Array.isArray(zone?.res_bitmap)

// The first MEMBER-family commitment byte. Format 4 (the member TREE, #2194) commits the SAME derived stream
// as a Merkle tree rather than a flat digest, so every format from here up derives identically — the chain's
// own `>=` idiom, mirrored by `zone_derive`'s placer.
const FIRST_MEMBER_FORMAT = 3

/**
 * The authoritative MEMBER-FAMILY ZoneGroupCommitment projected by `/v1` from the sibling commitment DF —
 * format 3 (member LIST) or format 4 (member TREE). A missing/malformed value is not permission to fall back
 * to the legacy derivation: doing so would expose claim rows whose member-zone polarity the chain rejects.
 * #2227 — pinning this to the byte `3` alone made a format-4 zone read as UNCOMMITTED, so the first
 * member-tree zone on testnet rendered zero mob rows and no player could reach its claim door at all.
 * @param {{ group_root?: number[] | null, group_count?: number | null } | null | undefined} zone
 * @returns {number[] | null}
 */
export const member_group_commitment = (zone) => {
  const root = zone?.group_root
  return Array.isArray(root) &&
    commitment_format(root) >= FIRST_MEMBER_FORMAT &&
    Number.isInteger(zone?.group_count) &&
    Number(zone?.group_count) >= 0
    ? root
    : null
}

/**
 * Zone rows via the /v1 read layer (the steady-state poll path). The v1 zone doc carries the raw
 * Zone DF state plus the sibling member-family ZoneGroupCommitment.
 * `null` = undiscovered, OR a doc whose liveness is unresolvable (see `zone_state_resolvable`) — both mean
 * "no derivable truth this poll", which the caller already handles by leaving the zone's rows alone rather
 * than deriving a set it cannot trust.
 */
export async function zone_rows_v1(world_id, zx, zy, { signal = undefined, fresh = false } = {}) {
  const zone = await get_zone(world_id, zx, zy, signal, fresh)
  if (zone?.seed == null) return null // discovered-list form or a pre-rework doc — no state to derive from
  // LOUD but graceful: never silently derive a zone whose consumption state did not arrive (a half-projected
  // doc while the indexer re-anchors is exactly this shape). One warn names the gap; the rows stand pat.
  if (!zone_state_resolvable(zone)) {
    console.warn(
      `[zone-rows] zone ${zx}:${zy} served a seed with no consumed-bitmap — group liveness is UNRESOLVABLE ` +
        '(an absent bitmap is not an empty one); keeping the last known rows instead of deriving them all live'
    )
    return null
  }
  const group_commitment = member_group_commitment(zone)
  if (!group_commitment) {
    console.warn(
      `[zone-rows] zone ${zx}:${zy} has no authoritative member-family group commitment; ` +
        'keeping the last known rows instead of deriving legacy claim eligibility'
    )
    return null
  }
  return compose(world_id, zx, zy, {
    seed: zone.seed,
    discovered_at_ms: Number(zone.discovered_at_ms ?? 0),
    mob_bitmap: zone.mob_bitmap,
    res_bitmap: zone.res_bitmap,
    // The commitment root's leading byte selects WHICH derivation this zone was committed under; dropping it
    // here would silently derive the other one — a whole zone of spawn_ids the chain never committed.
    group_root: group_commitment,
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
