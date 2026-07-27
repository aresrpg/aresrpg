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

import { use_world_binding } from './session_gate.js'

/** THE one spawns/zones atom for the app (the package factory owns its shape + door). */
export const spawns_store = create_spawns_store()

/** Dispatch one typed spawns input without exposing store plumbing at call sites. */
export function spawns_input(input, now) {
  spawns_store.getState().input(input, now)
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
const max_age_ms = 30 * 60 * 1_000

/** @typedef {{x:number,z:number}} WorldPosition */
/**
 * @typedef {{
 *   character_id:string,
 *   world_id:string,
 *   x:number,
 *   z:number,
 *   saved_at:number,
 *   chain_anchor:WorldPosition,
 * }} PositionSnapshot
 */

const position_key = (character_id, world_id) => `${character_id}:${world_id}`
const finite_position = (position) =>
  !!position && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.z))
const same_position = (a, b) =>
  finite_position(a) && finite_position(b) && Number(a.x) === Number(b.x) && Number(a.z) === Number(b.z)

/**
 * PURE restore guard. A row is usable only for the exact identity, while fresh, and while the chain still
 * reports the SAME committed anchor captured by the writer. The final radius check rejects corrupt or
 * implausible free-walk deltas even when the anchor metadata itself matches.
 * @param {PositionSnapshot | null | undefined} snapshot
 * @param {{character_id:string,world_id:string,chain_anchor:WorldPosition|null,now:number}} current
 */
export function position_snapshot_is_current(snapshot, { character_id, world_id, chain_anchor, now }) {
  if (!snapshot || snapshot.character_id !== character_id || snapshot.world_id !== world_id) return false
  if (!finite_position(snapshot) || !finite_position(snapshot.chain_anchor) || !finite_position(chain_anchor))
    return false
  const age = Number(now) - Number(snapshot.saved_at)
  if (!Number.isFinite(age) || age < 0 || age > max_age_ms) return false
  if (!same_position(snapshot.chain_anchor, chain_anchor)) return false
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

/* eslint-disable functional/no-let --
   Mutable cadence/ownership tokens are confined to this effect edge; reducer state remains immutable. */
/** @type {Omit<PositionSnapshot, 'saved_at'> | null} */
let pending_position = null
/** @type {Map<string, number>} */
const last_position_write = new Map()
/** @type {string | null} identity that owns spawns_store.state.player */
let player_position_owner = null
let restore_generation = 0
/** Serialize separate IndexedDB transactions so an older completion can never overwrite a newer pose. */
let position_write_tail = Promise.resolve()
/* eslint-enable functional/no-let */

const current_binding_is = (character_id, world_id) => {
  const binding = use_world_binding.getState()
  return binding.character_id === character_id && binding.world === world_id
}

const discard_pending_position = () => {
  pending_position = null
}

const commit_pending_position = (now = Date.now()) => {
  const pending = pending_position
  pending_position = null
  if (!pending) return position_write_tail
  const state = spawns_store.getState()
  if (
    !current_binding_is(pending.character_id, pending.world_id) ||
    state.world_id !== pending.world_id ||
    !same_position(pending.chain_anchor, state.checkpoint)
  )
    return position_write_tail
  const snapshot = { ...pending, saved_at: now }
  last_position_write.set(position_key(snapshot.character_id, snapshot.world_id), now)
  position_write_tail = position_write_tail.then(() => save_position_snapshot(snapshot))
  return position_write_tail
}

/**
 * Note one eligible free-walk position. The input is reduced immediately, but IndexedDB receives at most one
 * write per five seconds. Since movement reports continuously, the durable row trails a stop by at most that
 * interval; explicit lifecycle flushes commit the newest pending note sooner.
 * @param {{character_id:string,world_id:string,x:number,z:number}} position
 * @param {number} [now]
 */
export function note_world_position({ character_id, world_id, x, z }, now = Date.now()) {
  if (!character_id || !world_id || !finite_position({ x, z }) || !current_binding_is(character_id, world_id))
    return position_write_tail
  const before = spawns_store.getState()
  if (before.world_id !== world_id || !finite_position(before.checkpoint)) return position_write_tail
  spawns_input({ type: 'player_pos', x, z })
  player_position_owner = position_key(character_id, world_id)
  pending_position = {
    character_id,
    world_id,
    x: Number(x),
    z: Number(z),
    chain_anchor: { x: Number(before.checkpoint.x), z: Number(before.checkpoint.z) },
  }
  const elapsed = now - (last_position_write.get(player_position_owner) ?? 0)
  if (elapsed >= write_interval_ms) return commit_pending_position(now)
  return position_write_tail
}

/** Flush the freshest eligible note now (pagehide/renderer reboots may fire-and-forget this async edge). */
export function flush_world_position(now = Date.now()) {
  return commit_pending_position(now)
}

/**
 * Load and validate the exact character+world row, then re-enter through the existing `player_pos` reducer
 * input. The identity and anchor are checked again after the async read so a travel during IndexedDB I/O
 * cannot land a stale position in the new world.
 * @returns {Promise<WorldPosition|null>}
 */
export async function restore_world_position(character_id, world_id, now = Date.now()) {
  if (!character_id || !world_id || !current_binding_is(character_id, world_id)) return null
  const generation = ++restore_generation
  player_position_owner = null
  const snapshot = await load_position_snapshot(position_key(character_id, world_id))
  const state = spawns_store.getState()
  if (
    generation !== restore_generation ||
    !current_binding_is(character_id, world_id) ||
    state.world_id !== world_id ||
    !position_snapshot_is_current(snapshot, {
      character_id,
      world_id,
      chain_anchor: state.checkpoint,
      now,
    })
  )
    return null
  spawns_input({ type: 'player_pos', x: snapshot.x, z: snapshot.z })
  player_position_owner = position_key(character_id, world_id)
  const { player } = spawns_store.getState()
  return player ? { x: player.x, z: player.z } : null
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
    restore_generation += 1
    if (
      pending_position &&
      (pending_position.character_id !== state.character_id || pending_position.world_id !== state.world)
    )
      discard_pending_position()
  }
  if (state.world !== prev.world) ferry_world(state.world)
})
