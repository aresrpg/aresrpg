// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPAWNS ADAPTER (D770a W2) — the frontend edge of @aresrpg/world's spawns_zones core: THE one store
// instance, the session_gate → spawns ferry (a bound-world change is a typed RESET input, never a shared
// reference), and the dispatch helper every effect edge uses. The renderer (game/world_spawns.js) syncs its
// rig residency from `spawn_rows` projections and reports `player_pos`; the tx edges (discovery_actions /
// gather_actions / world_spawns' claim executor) dispatch intents and receipts through here.

import { useStore } from 'zustand'
import { create_spawns_store } from '@aresrpg/world/spawns_zones'
import { AGREE_RADIUS_M } from '@aresrpg/world/checkpoint'

import { read_dungeon_session } from './dungeon_session.js'
import { use_world_binding } from './session_gate.js'

/** THE one spawns/zones atom for the app (the package factory owns its shape + door). */
export const spawns_store = create_spawns_store()

/** Dispatch one typed spawns input without exposing store plumbing at call sites. */
export function spawns_input(input, now) {
  // A checkpoint/receipt can finish after a same-world character switch. Reject it before the world-only
  // reducer sees it; checking ownership after `.input` is too late because checkpoint/hunt_zone would be stale.
  const scoped_chain_input =
    input.type === 'checkpoint_resolved' ||
    input.type === 'zone_searched' ||
    input.type === 'claim_receipt' ||
    input.type === 'gather_receipt'
  if (scoped_chain_input) {
    const binding = use_world_binding.getState()
    if (input.character_id !== binding.character_id || input.world_id !== binding.world) return
  }
  const before = spawns_store.getState()
  spawns_store.getState().input(input, now)
  const after = spawns_store.getState()
  if (input.type === 'world_bound' && after.world_id !== before.world_id) {
    discard_pending_position()
    player_position_owner = null
    last_noted_position = null
    last_noted_position_owner = null
    position_chain_anchor = null
    position_chain_anchor_owner = null
    restore_generation += 1
  } else {
    const { character_id } = use_world_binding.getState()
    const owns_chain_commit =
      input.type === 'zone_searched' ||
      input.type === 'claim_receipt' ||
      input.type === 'gather_receipt' ||
      (input.type === 'checkpoint_resolved' && input.character_id === character_id)
    const committed =
      input.type === 'checkpoint_resolved' && finite_position(input.world_position)
        ? input.world_position
        : input.type !== 'checkpoint_resolved' && finite_position(input)
          ? { x: input.x, z: input.z, time_ms: input.time_ms }
          : after.checkpoint
    const receipt_commit =
      input.type === 'zone_searched' || input.type === 'claim_receipt' || input.type === 'gather_receipt'
    if (owns_chain_commit && (receipt_commit || after.checkpoint !== before.checkpoint) && finite_position(committed)) {
      if (receipt_commit) void invalidate_world_position(character_id, after.world_id)
      adopt_position_chain_anchor(character_id, after.world_id, committed)
    }
  }
}

/**
 * React binding + imperative statics (the M2 use_party idiom).
 * @type {(<T>(selector: (state: import('@aresrpg/world').SpawnsState) => T) => T) & Pick<import('zustand/vanilla').StoreApi<import('@aresrpg/world').SpawnsState>, 'getState' | 'subscribe'>}
 */
export const use_spawns = Object.assign((selector) => useStore(spawns_store, selector), {
  getState: () => spawns_store.getState(),
  subscribe: (listener) => spawns_store.subscribe(listener),
})

// ── LAST WORLD POSITION — IndexedDB persistence at the position-store edge ───────────────────────────────────
// `player_pos` is already the one reducer door for a live position. A restore comes back through that SAME
// input; IndexedDB is only an edge cache, never a second store or a direct Zustand write.
const position_db_name = 'aresrpg_world_position'
const position_db_version = 1
const position_store_name = 'positions'
const write_interval_ms = 5_000
const movement_stop_ms = 750
const max_age_ms = 30 * 60 * 1_000

/** @typedef {{x:number,z:number}} WorldPosition */
/** @typedef {{x:number,z:number,time_ms:number|null}} ChainAnchor */
/**
 * @typedef {{
 *   character_id:string,
 *   world_id:string,
 *   x:number,
 *   z:number,
 *   saved_at:number,
 *   chain_anchor:ChainAnchor,
 * }} PositionSnapshot
 */

const position_key = (character_id, world_id) => `${character_id}:${world_id}`
const finite_position = (position) =>
  !!position && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.z))
const same_position = (a, b) =>
  finite_position(a) && finite_position(b) && Number(a.x) === Number(b.x) && Number(a.z) === Number(b.z)
const chain_anchor_time = (anchor) => {
  const time_ms = Number(anchor?.time_ms)
  return Number.isFinite(time_ms) && time_ms > 0 ? time_ms : null
}
const normalize_chain_anchor = (anchor) =>
  finite_position(anchor) ? { x: Number(anchor.x), z: Number(anchor.z), time_ms: chain_anchor_time(anchor) } : null
const same_chain_anchor = (a, b) =>
  same_position(a, b) && chain_anchor_time(a) !== null && chain_anchor_time(a) === chain_anchor_time(b)
const same_chain_observation = (a, b) =>
  same_position(a, b) && (chain_anchor_time(a) ?? null) === (chain_anchor_time(b) ?? null)

/**
 * PURE restore guard. A row is usable only for the exact identity, while fresh, and while the chain still
 * reports the SAME committed anchor captured by the writer. The final radius check rejects corrupt or
 * implausible free-walk deltas even when the anchor metadata itself matches.
 * @param {PositionSnapshot | null | undefined} snapshot
 * @param {{character_id:string,world_id:string,chain_anchor:ChainAnchor|null,now:number}} current
 */
export function position_snapshot_is_current(snapshot, { character_id, world_id, chain_anchor, now }) {
  if (!snapshot || snapshot.character_id !== character_id || snapshot.world_id !== world_id) return false
  if (!finite_position(snapshot) || !same_chain_anchor(snapshot.chain_anchor, chain_anchor)) return false
  const age = Number(now) - Number(snapshot.saved_at)
  if (!Number.isFinite(age) || age < 0 || age > max_age_ms) return false
  const dx = Number(snapshot.x) - Number(chain_anchor.x)
  const dz = Number(snapshot.z) - Number(chain_anchor.z)
  return dx * dx + dz * dz <= AGREE_RADIUS_M * AGREE_RADIUS_M
}

/* eslint-disable functional/immutable-data --
   IndexedDB completes through assigned request/transaction handlers; this is the platform edge. */
const open_position_db = () =>
  new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(position_db_name, position_db_version)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(position_store_name))
        request.result.createObjectStore(position_store_name)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const position_transaction = async (mode, run) => {
  const db = await open_position_db()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(position_store_name, mode)
    const request = run(tx.objectStore(position_store_name))
    request.onerror = () => {
      db.close()
      reject(request.error)
    }
    tx.oncomplete = () => {
      db.close()
      resolve(request.result)
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}
/* eslint-enable functional/immutable-data */

/** @param {string} key @returns {Promise<PositionSnapshot|null>} */
const load_position_snapshot = (key) =>
  position_transaction('readonly', (store) => store.get(key))
    .then((row) => row ?? null)
    .catch(() => null)

/** @param {PositionSnapshot} snapshot */
const save_position_snapshot = (snapshot) =>
  position_transaction('readwrite', (store) =>
    store.put(snapshot, position_key(snapshot.character_id, snapshot.world_id))
  ).catch(() => undefined)

/** @param {string} key */
const delete_position_snapshot = (key) =>
  position_transaction('readwrite', (store) => store.delete(key)).catch(() => undefined)

/* eslint-disable functional/no-let --
   Mutable cadence/ownership tokens are confined to this effect edge; reducer state remains immutable. */
/** @type {Omit<PositionSnapshot, 'saved_at'> | null} */
let pending_position = null
/** @type {Map<string, number>} */
const last_position_write = new Map()
/** @type {ReturnType<typeof setTimeout> | null} */
let position_timer = null
/** @type {string | null} identity that owns spawns_store.state.player */
let player_position_owner = null
/** @type {WorldPosition | null} */
let last_noted_position = null
/** @type {string | null} */
let last_noted_position_owner = null
/** Canonical signed chain anchor associated with the current character+world edge identity. */
/** @type {ChainAnchor | null} */
let position_chain_anchor = null
/** @type {string | null} */
let position_chain_anchor_owner = null
let restore_generation = 0
/** Serialize separate IndexedDB transactions so an older completion can never overwrite a newer pose. */
let position_write_tail = Promise.resolve()
/* eslint-enable functional/no-let */

const current_binding_is = (character_id, world_id) => {
  const binding = use_world_binding.getState()
  return binding.character_id === character_id && binding.world === world_id
}

const adopt_position_chain_anchor = (character_id, world_id, chain_anchor) => {
  const normalized = normalize_chain_anchor(chain_anchor)
  if (
    !character_id ||
    !world_id ||
    !normalized ||
    !current_binding_is(character_id, world_id) ||
    spawns_store.getState().world_id !== world_id
  )
    return null
  const owner = position_key(character_id, world_id)
  if (position_chain_anchor_owner !== owner || !same_chain_observation(position_chain_anchor, normalized)) {
    discard_pending_position()
    last_noted_position = null
    last_noted_position_owner = null
    restore_generation += 1
  }
  position_chain_anchor_owner = owner
  position_chain_anchor = normalized
  return position_chain_anchor
}

const read_position_chain_anchor = (character_id, world_id) =>
  position_chain_anchor_owner === position_key(character_id, world_id) && finite_position(position_chain_anchor)
    ? position_chain_anchor
    : null

const clear_position_timer = () => {
  if (position_timer !== null) clearTimeout(position_timer)
  position_timer = null
}

const discard_pending_position = () => {
  pending_position = null
  clear_position_timer()
}

const position_phase_is_blocked = () => {
  const phase = read_dungeon_session()
  return phase.in_session || !!phase.run_pass_id || !!phase.dungeon_id || !!phase.fight_id
}

/**
 * PURE eligibility gate shared by movement notes and explicit lifecycle flushes.
 * @param {{
 *   character_id?:string|null,
 *   world_id?:string|null,
 *   in_fight?:boolean,
 *   in_dungeon?:boolean,
 *   in_cave?:boolean,
 * }} state
 */
export function can_persist_world_position({
  character_id,
  world_id,
  in_fight = false,
  in_dungeon = false,
  in_cave = false,
}) {
  return !!character_id && !!world_id && !in_fight && !in_dungeon && !in_cave
}

const commit_pending_position = (now = Date.now()) => {
  clear_position_timer()
  const pending = pending_position
  pending_position = null
  if (!pending) return position_write_tail
  if (position_phase_is_blocked()) return position_write_tail
  const state = spawns_store.getState()
  if (
    !current_binding_is(pending.character_id, pending.world_id) ||
    state.world_id !== pending.world_id ||
    !same_chain_anchor(pending.chain_anchor, read_position_chain_anchor(pending.character_id, pending.world_id))
  )
    return position_write_tail
  const snapshot = { ...pending, saved_at: now }
  last_position_write.set(position_key(snapshot.character_id, snapshot.world_id), now)
  position_write_tail = position_write_tail.then(() => save_position_snapshot(snapshot))
  return position_write_tail
}

/**
 * Note one eligible free-walk position. The input is reduced immediately; continuous movement writes at most
 * once per five seconds, while a trailing debounce commits the final pose after movement stops. Explicit
 * lifecycle flushes commit the newest pending note sooner.
 * @param {{character_id:string,world_id:string,x:number,z:number}} position
 * @param {number} [now]
 */
export function note_world_position({ character_id, world_id, x, z }, now = Date.now()) {
  if (
    !character_id ||
    !world_id ||
    !finite_position({ x, z }) ||
    !current_binding_is(character_id, world_id) ||
    position_phase_is_blocked()
  )
    return position_write_tail
  const before = spawns_store.getState()
  if (before.world_id !== world_id) return position_write_tail
  spawns_input({ type: 'player_pos', x, z })
  const owner = position_key(character_id, world_id)
  player_position_owner = owner
  const chain_anchor = read_position_chain_anchor(character_id, world_id)
  // Reducer truth still advances while a receipt anchor awaits its canonical chain time. Persistence pauses
  // until a direct checkpoint read supplies that revision, so an A→B→A chain move cannot resurrect A.
  if (!chain_anchor || chain_anchor_time(chain_anchor) === null) return position_write_tail
  const noted = { x: Number(x), z: Number(z) }
  if (last_noted_position_owner === owner && same_position(last_noted_position, noted)) return position_write_tail
  last_noted_position_owner = owner
  last_noted_position = noted
  pending_position = {
    character_id,
    world_id,
    ...noted,
    chain_anchor: { ...chain_anchor },
  }
  const elapsed = now - (last_position_write.get(owner) ?? 0)
  if (elapsed >= write_interval_ms) return commit_pending_position(now)
  clear_position_timer()
  // This is a persistence debounce at the app edge, not a reducer clock: no state transition reads it.
  // eslint-disable-next-line one-pipeline/no-settimeout-in-stores
  position_timer = setTimeout(() => {
    void commit_pending_position()
  }, movement_stop_ms)
  if (typeof position_timer.unref === 'function') position_timer.unref()
  return position_write_tail
}

/** Flush the freshest eligible note now (pagehide/renderer reboots may fire-and-forget this async edge). */
export function flush_world_position(now = Date.now()) {
  return commit_pending_position(now)
}

/**
 * A chain receipt invalidates every local pose captured before it. Deletion is serialized behind any in-flight
 * save, so an older completion cannot resurrect the row after the receipt. The next canonical anchor can then
 * start a fresh cadence.
 */
export function invalidate_world_position(character_id, world_id) {
  if (!character_id || !world_id) return position_write_tail
  const owner = position_key(character_id, world_id)
  if (pending_position?.character_id === character_id && pending_position.world_id === world_id)
    discard_pending_position()
  if (player_position_owner === owner) player_position_owner = null
  if (last_noted_position_owner === owner) {
    last_noted_position = null
    last_noted_position_owner = null
  }
  if (position_chain_anchor_owner === owner) {
    position_chain_anchor = null
    position_chain_anchor_owner = null
  }
  restore_generation += 1
  position_write_tail = position_write_tail.then(() => delete_position_snapshot(owner))
  return position_write_tail
}

/**
 * Load and validate the exact character+world row, then re-enter through the existing `player_pos` reducer
 * input. The identity and anchor are checked again after the async read so a travel during IndexedDB I/O
 * cannot land a stale position in the new world.
 * @param {ChainAnchor|null} chain_anchor canonical signed position + checkpoint time from world_checkpoint.js
 * @returns {Promise<WorldPosition|null>}
 */
export async function restore_world_position(character_id, world_id, chain_anchor, now = Date.now()) {
  if (!character_id || !world_id || !current_binding_is(character_id, world_id)) return null
  const generation = ++restore_generation
  player_position_owner = null
  const known_anchor = read_position_chain_anchor(character_id, world_id)
  // A resolver miss may return an older cache entry after a receipt already advanced this edge. Never let that
  // fallback replace a conflicting receipt-proven observation; ambiguity means the chain-side live fact wins.
  if (known_anchor && !same_chain_observation(known_anchor, chain_anchor)) return null
  const current_anchor = known_anchor ?? adopt_position_chain_anchor(character_id, world_id, chain_anchor)
  if (!current_anchor || chain_anchor_time(current_anchor) === null) return null
  const snapshot = await load_position_snapshot(position_key(character_id, world_id))
  const state = spawns_store.getState()
  if (
    generation !== restore_generation ||
    !current_binding_is(character_id, world_id) ||
    state.world_id !== world_id ||
    !position_snapshot_is_current(snapshot, {
      character_id,
      world_id,
      chain_anchor: read_position_chain_anchor(character_id, world_id),
      now,
    })
  )
    return null
  spawns_input({ type: 'player_pos', x: snapshot.x, z: snapshot.z })
  player_position_owner = position_key(character_id, world_id)
  last_noted_position_owner = player_position_owner
  last_noted_position = { x: Number(snapshot.x), z: Number(snapshot.z) }
  const { player } = spawns_store.getState()
  return player ? { x: player.x, z: player.z } : null
}

/** The current reducer-edge chain anchor for this exact character+world, including its staleness revision. */
export function read_world_chain_anchor(character_id, world_id) {
  if (!character_id || !world_id || !current_binding_is(character_id, world_id)) return null
  const anchor = read_position_chain_anchor(character_id, world_id)
  return anchor ? { ...anchor } : null
}

/** The reducer-owned position only when it belongs to this exact character+world session. */
export function read_world_position(character_id, world_id) {
  if (
    !character_id ||
    !world_id ||
    player_position_owner !== position_key(character_id, world_id) ||
    !current_binding_is(character_id, world_id)
  )
    return null
  const state = spawns_store.getState()
  const { player } = state
  return state.world_id === world_id && finite_position(player) ? { x: player.x, z: player.z } : null
}

/** Test-only: clear cadence/session memory while deliberately retaining IndexedDB (the reload simulation). */
export function _reset_position_persistence_for_test() {
  discard_pending_position()
  last_position_write.clear()
  player_position_owner = null
  last_noted_position = null
  last_noted_position_owner = null
  position_chain_anchor = null
  position_chain_anchor_owner = null
  restore_generation += 1
  position_write_tail = Promise.resolve()
}

// ── THE SESSION→SPAWNS FERRY — the composition-root seam (design note: cross-domain facts travel as typed
// inputs; a world change is a reset input). The session gate's bound world is the only cross-domain fact the
// spawns core consumes; polling cadence stays the renderer's (polling is an effect — cores never know it).
// Seed once at module init (a binding published before this module loaded would otherwise never ferry), then
// follow every change.
const ferry_world = (world) => spawns_input({ type: 'world_bound', world_id: typeof world === 'string' ? world : null })
ferry_world(use_world_binding.getState().world)
use_world_binding.subscribe((state, prev) => {
  if (state.character_id !== prev.character_id || state.world !== prev.world) {
    player_position_owner = null
    last_noted_position = null
    last_noted_position_owner = null
    position_chain_anchor = null
    position_chain_anchor_owner = null
    restore_generation += 1
    if (
      pending_position &&
      (pending_position.character_id !== state.character_id || pending_position.world_id !== state.world)
    )
      discard_pending_position()
  }
  if (state.world !== prev.world) ferry_world(state.world)
  else if (state.character_id !== prev.character_id) {
    ferry_world(null)
    if (state.character_id && state.world) ferry_world(state.world)
  }
})
