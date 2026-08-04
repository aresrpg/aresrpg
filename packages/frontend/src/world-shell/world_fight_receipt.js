// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Receipt-first world-fight convergence. A successful create/join transaction already proves the Fight id; the
// full object may still be temporarily unreadable from the serving node. Keep that receipt-owned id mounted and
// retry the existing full-board reader forever with capped exponential backoff. Cancellation is state-driven: a
// different session replacing the id (or an explicit teardown clearing `fight_syncing`) stops the loop.
//
// #2154 — WHAT "converged" MEANS. It used to mean "the Fight document read", which is not the fact the actor is
// waiting for: a join's read-after-write legitimately serves the PRE-JOIN version, whose roster does not contain
// the joiner (the read that logs `my_entity_missing_from_fighters`). The walk exited successfully on that very
// read and left the joiner's own seat to the next 4s store heartbeat — measured 4.141/4.179/4.145s, a timer.
// Convergence is now "MY SEAT is in the read" (`my_seat_present`), the one predicate both this walk and the
// store's receipt-hold chip read.

import { participant_character_id } from '@aresrpg/fight/fight_control'

import { mark_join_receipt } from '../core/join_timing.js'

const sync_min_delay_ms = 250
const sync_max_delay_ms = 8000
// #242 read-layer census — "the fight-engage receipt poll retrying uncapped": bounds how long the TIGHT
// backoff loop below may keep re-reading on its own before giving up. This is not an abandonment: the
// SEPARATE 4s dungeon_run_store heartbeat (world_fight.js's _start_polling, already running the moment this
// loop starts) keeps calling the exact same refresh() forever regardless of this ceiling — so a fight that
// is still just slow to hydrate keeps converging on the slower cadence; this loop only stops DUPLICATING it.
const sync_max_wait_ms = 20_000

/** Capped exponential delay for a zero-based retry attempt. */
export function fight_sync_delay_ms(attempt) {
  const exponent = Math.max(0, Number(attempt) || 0)
  return Math.min(sync_max_delay_ms, sync_min_delay_ms * 2 ** exponent)
}

/**
 * Decide whether a receipt-owned fight may enter the shared board store. Re-entering the same id is deliberately
 * a no-op: when the full read catches up it enriches the existing session instead of mounting a second board.
 */
export function receipt_entry_decision({ current_fight_id, current_run_pass_id, next_fight_id, character_id }) {
  if (!next_fight_id || !character_id) return 'invalid'
  if (current_fight_id === next_fight_id) return 'same'
  if (current_fight_id || current_run_pass_id) return 'busy'
  return 'enter'
}

/** True only for the unreadable Fight id whose executed receipt is still the local source of truth. */
export function should_hold_receipt_fight(state, fight_id) {
  return Boolean(state?.fight_syncing && fight_id && state?.fight_id === fight_id)
}

/**
 * A receipt-owned fight whose object the serving node did NOT return: keep the mount and re-read (`retry`), or
 * let the session collapse to its outcome flow (`drop`). The ONE home for that call — `refresh` used to spell it
 * inline, which is where it grew its unbounded arm.
 *
 * `definitively_gone` (the node answered "deleted", not "not yet") is normally decisive, and a FRESH create/join
 * overrides it: a read-after-write against a just-executed receipt legitimately reports a brand-new object as
 * absent. #529 — that override had no end. A coop join whose fight evaporated (settled/liquidated under the join,
 * or deserted and cranked away) left a client that re-read a deleted object on the 4s heartbeat FOREVER: no
 * board, no collapse, no outcome recovery, no word to the player. The grant is a read-after-write window, so it
 * expires with the receipt poll that owns it — `fight_receipt_expired_id` names the exact id whose tight backoff
 * loop reached its ceiling without ever hydrating. ID-scoped by construction: a spent window belongs to the fight
 * that spent it and can never drop the next session this client enters.
 *
 * A merely-unreadable (not gone) object is untouched by the expiry — the slower heartbeat is still the honest
 * path for a fight that is only slow to hydrate.
 * @param {{ state:any, fight_id:string|null, definitively_gone:boolean }} args
 * @returns {'retry'|'drop'}
 */
export function receipt_read_miss_decision({ state, fight_id, definitively_gone }) {
  if (!should_hold_receipt_fight(state, fight_id)) return 'drop'
  if (!definitively_gone) return 'retry'
  const expired = state?.fight_receipt_expired_id != null && String(state.fight_receipt_expired_id) === String(fight_id)
  return state?.fight_fresh && !expired ? 'retry' : 'drop'
}

/**
 * THE CONVERGENCE FACT (#2154): this read contains MY SEAT. A session with no character of its own — a
 * spectator — has no seat to wait for, so for it any readable board IS the whole truth. Pure; the ONE home
 * both the receipt walk below and the store's `fight_syncing` chip read.
 * @param {any} board the projected board view (`use_dungeon` state's `dungeon`)
 * @param {string|null|undefined} character_id my seated character, or null when I hold no seat
 */
export function my_seat_present(board, character_id) {
  if (!board) return false
  if (!character_id) return true
  return (board.escrow ?? []).some((row) => participant_character_id(row) === String(character_id))
}

/** @returns {'pending'|'hydrated'|'cancelled'} */
function receipt_sync_state(state, fight_id, character_id) {
  if (state?.dungeon?.id === fight_id && my_seat_present(state.dungeon, character_id)) return 'hydrated'
  return should_hold_receipt_fight(state, fight_id) ? 'pending' : 'cancelled'
}

const sleep_ms = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Poll the full-board reader until the receipt-owned Fight hydrates or its session is explicitly replaced. This
 * loop's OWN attempts are bounded (sync_max_wait_ms): past that, it stops re-reading rather than retrying this
 * tight backoff forever — the slower 4s store heartbeat (already running alongside it) is the honest fallback
 * that keeps converging, so giving up here is never a refresh-only dead end. Reader errors are another lag
 * sample, not a reason to discard an executed receipt.
 *
 * `character_id` is the seat this walk is converging on (#2154) — null only for a session that holds none.
 * @param {{ fight_id:string, character_id?:string|null, get_state:()=>any, refresh:()=>Promise<any>,
 *   sleep?:(ms:number)=>Promise<any>, now?:()=>number, max_wait_ms?:number }} args
 * @returns {Promise<'hydrated'|'cancelled'|'timed_out'>}
 */
export async function poll_receipt_fight({
  fight_id,
  character_id = null,
  get_state,
  refresh,
  sleep = sleep_ms,
  now = Date.now,
  max_wait_ms = sync_max_wait_ms,
}) {
  let attempt = 0
  const deadline = now() + max_wait_ms
  while (receipt_sync_state(get_state(), fight_id, character_id) === 'pending') {
    if (now() >= deadline) return 'timed_out'
    try {
      await refresh()
    } catch {
      // The store reader normally contains its own error surface. An injected/transport throw still must retry.
    }
    const state = receipt_sync_state(get_state(), fight_id, character_id)
    if (state !== 'pending') return state
    await sleep(fight_sync_delay_ms(attempt))
    attempt += 1
  }
  return receipt_sync_state(get_state(), fight_id, character_id) === 'hydrated' ? 'hydrated' : 'cancelled'
}

/**
 * Execute a world-fight join, then enter from that very receipt boundary. A rejection never enters; a resolved
 * receipt enters before the caller closes its modal, so party members do not wait for a later discovery poll.
 */
export async function enter_after_world_join_receipt({
  execute,
  enter,
  fight_id,
  world_id = null,
  character_id,
  on_receipt = mark_join_receipt,
}) {
  const receipt = await execute()
  on_receipt(fight_id) // #2154 — everything after this stage is read latency, and it is now measured, not asserted
  enter({ fight_id, world_id, character_id })
  return receipt
}
