// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Frontend adapter for @aresrpg/world's settled character↔world binding core. Creation writes membership in
// its own PTB (#1714); this edge owns only the singleton store, stale-poll logging, and RPC binding reads.

import { useStore } from 'zustand'
import {
  create_session_gate_store,
  select_bound_world,
  select_world_rows,
  subscribe_stale_poll,
} from '@aresrpg/world/session_gate'

import { game_log } from '../core/log.js'

/** THE one session-gate atom for the app (the package factory owns its shape + door). */
const session_gate_store = create_session_gate_store()

/** @typedef {import('@aresrpg/world').SessionGateState} SessionGateState */

/**
 * React binding + imperative statics over the atom (the M2 use_party idiom): call as a hook with a
 * selector, or use `.getState()` / `.subscribe()` imperatively.
 * @type {(<T>(selector: (state: SessionGateState) => T) => T) & Pick<import('zustand/vanilla').StoreApi<SessionGateState>, 'getState' | 'subscribe'>}
 */
export const use_world_binding = Object.assign((selector) => useStore(session_gate_store, selector), {
  getState: () => session_gate_store.getState(),
  subscribe: (listener) => session_gate_store.subscribe(listener),
})

// ── THE STALE-POLL LOG EDGE — each discarded poll row lands exactly once as one honest log line.
subscribe_stale_poll(session_gate_store, ({ character_id, target }) =>
  game_log(
    'session-gate',
    `poll world-binding discarded (stale) for ${character_id} — pending target still ${target ?? 'unbound'}`
  )
)

/** Dispatch one typed session-gate input without exposing store plumbing at async call sites. */
export function session_gate_input(input) {
  session_gate_store.getState().input(input)
}

/** Publish the selected character's binding (undefined never published — a read always CONFIRMS bound/unbound).
 *  `source`: 'manual' (default — creation/manual travel chain truth, fetch_world_binding's
 *  resolve-time read) arms the core's pending-confirmation guard; 'poll' (DiscoveryPrompts' char-doc poll only)
 *  is discarded while it disagrees with a pending trusted write, and confirms/clears the guard once it agrees. */
export function publish_world_binding(character_id, world, source = 'manual') {
  session_gate_input({
    type: 'binding_published',
    character_id: character_id ?? null,
    world: world ?? null,
    source,
  })
}

/**
 * Re-key the resident world session to an explicitly selected roster character. The roster's `world_id`
 * comes from the indexed character document (boot_roster.rpc_to_card), so this is the same binding truth the
 * host would otherwise re-read through fetch_world_binding. `undefined` is rejected: treating a malformed
 * card as confirmed-unbound would silently strand the selected character on the spectate backdrop.
 * @param {string} character_id
 * @param {string | null | undefined} world_id
 */
export function rebind_world_character(character_id, world_id) {
  if (!character_id) throw new Error('cannot rebind the world session without a character id')
  if (world_id === undefined) throw new Error(`character ${character_id} has no indexed world binding`)
  session_gate_input({ type: 'character_selected', character_id, world_id })
}

/**
 * Ferry the indexed roster feed into the book as roster-grade evidence (#2007). A card's `world_id` is a
 * CACHED snapshot, so it never overrides an unconfirmed chain-truth write; `undefined` (an optimistic row)
 * is UNKNOWN and is dropped rather than published as a confirmed-unbound binding.
 * @param {Array<{ id?: string, world_id?: string | null }>} characters
 */
export function observe_roster_bindings(characters) {
  const rows = (characters ?? [])
    .filter((card) => card?.id && card.world_id !== undefined)
    .map((card) => ({ character_id: card.id, world: card.world_id ?? null }))
  if (rows.length) session_gate_input({ type: 'roster_observed', rows })
}

/** THE binding answer for one character (`undefined` = unknown, `null` = confirmed unbound). */
export const bound_world_of = (character_id) => select_bound_world(session_gate_store.getState(), character_id)

/** Member-roster world projection for cross-domain consumers — one book, resolved at decision time. */
export const world_rows_of = (character_ids) => select_world_rows(session_gate_store.getState(), character_ids)

/** Back to UNKNOWN (wallet/account switch — a stale binding must never leak a controller across accounts). */
export function reset_world_binding() {
  session_gate_input({ type: 'binding_reset' })
}

/**
 * Read the character's CURRENT world binding off the RPC char doc (the one reliable source) and PUBLISH it.
 * Returns the binding ('0x…' | null). A read failure returns undefined and publishes NOTHING — the caller
 * keeps its previous knowledge (never a false unbound that would tear a live resident session down).
 * @param {string | null} character_id
 * @returns {Promise<string | null | undefined>}
 */
export async function fetch_world_binding(character_id) {
  if (!character_id) return null
  try {
    const { get_characters } = await import('../rpc/client')
    const docs = await get_characters({ ids: [character_id] })
    const world = docs?.[0]?.world ?? null
    publish_world_binding(character_id, world)
    return world
  } catch (error) {
    game_log('session-gate', 'world-binding read failed — keeping previous knowledge', error)
    return undefined
  }
}
