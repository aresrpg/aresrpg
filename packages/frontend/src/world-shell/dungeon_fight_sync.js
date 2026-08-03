// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S2 SYNC SEAM — the chain-read → core-snapshot leg extracted from dungeon_fight_shim.js (thin-shim ≤120 LoC gate).
// It owns NO fight logic: it only decodes a Fight OBJECT read and feeds its snapshot + public render facts through
// the core's ONE input door, plus the per-world render offset. The shim re-exports both so importers are unchanged.

import { decode_fight, get_member_templates, get_weapon_lines } from '@aresrpg/sdk/fight'
import { mob_entity_id } from '@aresrpg/fight/fight_control'
import { world_offsets } from '@aresrpg/sdk/coords'
import { get_world } from '@aresrpg/sdk/game'
import { fight_store } from '@aresrpg/fight/store'
import { read_fighter_statuses } from '@aresrpg/fight/fight_status_snapshot'
import { read_fight_traps } from '@aresrpg/fight/project'

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

// #1323 — the seat's AUTHORED weapon lines. `cast.move` resolves a strike from them and falls back to the
// participant's family `Weapon` only when a seat has none, so a client that cannot see them previews a number the
// chain will not settle. They live in per-seat DYNAMIC FIELDS on the Fight (never in the object json the poll
// already reads), and they are IMMUTABLE for a seat's lifetime — attached once at create/join — so this resolves
// ONCE per fight and re-reads only when the roster GREW (a joiner seated new lines). Unreadable ⇒ `{}` ⇒ every
// seat honestly falls back to its family line, exactly as the chain does for an un-authored weapon.
/** @type {Map<string, { seats: number, by_seat: Record<number, any[]> }>} */
const _weapon_lines_cache = new Map()
export async function resolve_weapon_lines(
  /** @type {any} */ sdk,
  /** @type {string | null | undefined} */ fight_id,
  /** @type {number} */ seats
) {
  if (!fight_id || seats <= 0) return {}
  const hit = _weapon_lines_cache.get(fight_id)
  if (hit && hit.seats >= seats) return hit.by_seat
  const by_seat = await get_weapon_lines({ grpc_client: sdk.grpc_client })(fight_id)
  _weapon_lines_cache.set(fight_id, { seats, by_seat })
  return by_seat
}

// #1865 — THE PACK'S PER-MEMBER IDENTITY, on a client that did not claim it. A world claim composes the seated
// roster itself and carries it into the fight through `ctx.mob_roster` (world_spawns.js), so a LIVE-spawned fight
// names every member correctly. A page refresh has no claim: the session rebuilds from chain reads alone, and the
// only species fact those reads carry is the Fight's shared `group_template` — the PRIMARY's block. Every mob then
// resolved through it and a mixed pack rendered one name for all of them (a rat and a Bonelet both read "Bonelet").
// The member templates are on chain as indexed dynamic fields (`get_member_templates`), so rehydration resolves the
// SAME entity-keyed roster shape the claim path composes — one home for the fact, two ways in.
// IMMUTABLE for the fight's lifetime (attached once at create_members), so this is one read per fight, not per poll.
/** @type {Map<string, { mobs: number, roster: Array<{ id:string, template_id:string }> }>} */
const _member_roster_cache = new Map()
export async function resolve_member_roster(
  /** @type {any} */ sdk,
  /** @type {string | null | undefined} */ fight_id,
  /** @type {number} */ mob_count
) {
  if (!fight_id || mob_count <= 0) return []
  const hit = _member_roster_cache.get(fight_id)
  if (hit && hit.mobs >= mob_count) return hit.roster
  const by_index = await get_member_templates({ grpc_client: sdk.grpc_client })(fight_id)
  // A homogeneous (pre-member-door) fight attaches no member fields at all. Composing a roster from the shared
  // primary would be a SECOND home for what `group_template` already says, so an empty read stays empty and the
  // existing group fallback keeps naming those packs exactly as it did.
  const roster = Array.from({ length: mob_count }, (_, index) => ({
    id: mob_entity_id(index),
    template_id: by_index[index] ?? null,
  })).filter((row) => row.template_id != null)
  _member_roster_cache.set(fight_id, { mobs: mob_count, roster })
  return roster
}

/**
 * The entity-keyed roster the projection reads, with the CLAIM's own rows winning wherever it has one: a claim
 * composed its members from the world card and already rendered those names, while a rehydrated row carries the
 * template id alone (the name resolves downstream through `mob_names`). Pure — one merge, keyed by fighter id,
 * never by ordinal (#1608: an array reorder must not rename a living fighter).
 * @param {Array<{id?:string}>|null|undefined} claimed @param {Array<{id:string, template_id:string}>} recovered
 */
export const merge_mob_roster = (claimed, recovered) => {
  const rows = new Map(recovered.map((row) => [row.id, row]))
  for (const row of claimed ?? []) if (row?.id) rows.set(row.id, row)
  return [...rows.values()]
}

/**
 * SNAPSHOT a decoded Fight OBJECT read into the core (the base lane). `read` = { json, version } for a live fight,
 * or null for the pre-engage OPEN roam view (a run with no fight yet — versioned by `open_version`, the RunPass
 * version, so a room advance re-adopts). ALL fighter-status rows are attached from the raw json (decode_fight omits
 * them; the field name `invisibility_statuses` is legacy — board_state maps it to the view's per-fighter `statuses`
 * the fold groups and engine_view exposes as `effects`).
 *
 * QUARANTINE ENTRY POINT — BRIDGE B6 (expiry: P2, register #17/#51). This is the SOLE entry of a chain-direct gRPC
 * tactical Fight read into fight state: it dispatches through the reducer door, and the reducer's VERSIONED MERGE is
 * the only thing that touches snapshot state (below-floor drops, equal-version compares — keystone #3 — higher
 * adopts). A gRPC read NEVER pushes state by any other path. The transport swap (gRPC → /v1 versioned feed) is P2
 * (a k8s deploy, owner-gated) and orthogonal to this discipline — delete this bridge when P2 lands.
 * `weapon_lines` is the seat-keyed authored-line map from `resolve_weapon_lines` — a per-seat DYNAMIC FIELD read
 * that rides ALONGSIDE the object, attached here like the fighter statuses above so `board_state` sees one
 * complete fight record (#1323).
 * @param {{ read: { json:any, version:any }|null, run?: any, rooms_total?: number, ctx?: any, open_version?: number,
 *           weapon_lines?: Record<number, any[]> }} args
 */
export function sync_dungeon_fight({
  read,
  run = null,
  rooms_total = 0,
  ctx = {},
  open_version = 0,
  weapon_lines = {},
}) {
  const fight = read ? decode_fight(read.json) : null
  const chain_traps = read ? read_fight_traps(read.json) : []
  // The board list is a VERSIONED fact: the fold adopts its rows into the one trap ledger and needs the read's
  // own version to tell a stale list still naming a detonated trap (the ghost) from a genuine re-arm (#1858).
  const chain_traps_version = read ? Number(read.version) : 0
  // #1993 WP6 — MIGRATION DECLINED, and this is the why. The audit read these rows as "authoritative status state
  // injected by every snapshot"; they are not. They ride the `snapshot` message like every other decoded field,
  // and the reducer is what does anything with them: `fold_base.base_state_from_view` groups them per fighter as
  // the BASE the journal actions then replay onto, under the versioned merge that is the only writer of snapshot
  // state. So the rows are already reducer-owned and this read is already reconciliation INPUT — moving it would
  // buy a second door, not a single home. Its two-transport agreement is pinned by
  // `packages/fight/test/status_projection_one_collection.test.js`.
  if (fight && read) fight.invisibility_statuses = read_fighter_statuses(read.json)
  if (fight) fight.weapon_lines = weapon_lines
  fight_store.getState().input({
    type: 'snapshot',
    fight,
    // SESSION IDENTITY (register #18): a decoded read for fight A must never adopt into fight B. The reducer drops
    // on a proven fight_id MISMATCH and HOLDS an id-less OPEN read (fight == null, the pre-engage roam).
    fight_id: fight?.id ?? null,
    version: read ? Number(read.version) : Number(open_version) || 0,
    run,
    rooms_total,
    ctx: { ...ctx, chain_traps, chain_traps_version },
  })
  // Active object reads are checkpoint-only after bootstrap, so refresh the public board prim input through the
  // existing reducer context door too. Apply it only after the session-gated snapshot proves this read still owns
  // the core; a stale fight-A read must never write fight A's traps into a newer fight B session.
  if (String(fight_store.getState().fight_id ?? '') === String(fight?.id ?? ''))
    fight_store.getState().input({ type: 'ctx', ctx: { chain_traps, chain_traps_version } })
  if (fight?.id && String(fight_store.getState().core.fight_id) === String(fight.id))
    mark_engage_fight_adopted(fight.id)
  return fight
}
