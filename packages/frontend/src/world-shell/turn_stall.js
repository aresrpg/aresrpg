// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TURN STALL (#1381 ②③) — the ONE home for "a player is not ending their turn, and someone may force it".
//
// THE MACHINERY GETS ITS WINDOW FIRST. Every watching client already auto-cranks an expired deadline
// (fight-liquidation.js: jitter, single-flight, per-deadline executed-failure latch), and the deadline-proximity
// read (#1381 ①, dungeon_run_store's stream `deadline` belt) makes sure a silent wire cannot hide the moment it
// passes. What had no home was the state AFTER all of that: past `EXPIRY_GRACE_MS` (fight_expiry_gate.js — the
// ONE overdue predicate, never re-spelled here) the fight still has not moved. That was developer telemetry
// (one console.error) and nothing else, so the other players sat in front of a frozen board.
//
// THE OFFER IS CLICKED, NEVER AUTOMATIC. Auto-forcing a pass would grief a slow-but-alive player AND burn gas
// doing it, so this module only decides that the OTHER participants may be OFFERED the door; a human press is
// what fires it.
//
// SIMULATE-FIRST, SUBMIT EXACTLY ONCE. `turns::crank` rides the one submission door (dungeon_actions' `sign` →
// run_character_action → the tx choke), which DRY-RUNS every transaction before the wallet signs and refuses at
// ZERO gas. That dry run is precisely the discriminator this row asked for:
//   · simulation passes         → the wallet signs ONCE. Nothing here retries; the spend guard's per-deadline
//                                 circuit (`advance_turn:<fight>:<deadline>`) owns any repeat mechanically.
//   · turns::107 ENotYetExpired → the deadline moved on: the turn WAS passed and we were merely desynced.
//   · turns::105 ENotActive     → the fight is no longer active (it ended while we watched).
//   Both refusals burn NOTHING and mean the same thing to a player — there is nothing to force. Resync the
//   fold, drop the offer, say nothing: being desynced is not news.
// An EXECUTED failure (a digest exists ⇒ gas is gone) is surfaced ONCE and never retried (tx-retry burn law).

import { parse_move_abort } from '../game/core/abort_copy.js'

import { error_executed_digest } from './tx_digest_error.js'

/** `turns.move` aborts that mean THE TURN IS NOT STALLED AFTER ALL — read firsthand from the engine module:
 *  105 ENotActive (the fight is not ACTIVE) · 107 ENotYetExpired (the current deadline has not passed). */
export const TURN_ALREADY_ADVANCED_CODES = Object.freeze([105, 107])

/**
 * PURE — what a force-pass attempt's failure means. Ordered by proof strength: a DIGEST outranks everything
 * (the transaction executed and the gas left the wallet), then the chain's own abort code, then "we do not
 * know" — which is a refusal, never a silent success.
 * @param {unknown} error the crank door's rejection, or null/undefined when it landed
 * @returns {'passed' | 'already_advanced' | 'executed' | 'refused'}
 */
export function force_pass_verdict(error) {
  if (!error) return 'passed'
  if (error_executed_digest(error)) return 'executed'
  const abort = parse_move_abort(error)
  if (abort?.module === 'turns' && TURN_ALREADY_ADVANCED_CODES.includes(Number(abort.code))) return 'already_advanced'
  return 'refused'
}

/**
 * Fire ONE force pass, or none at all. `claim` is the caller's single-shot latch — a store action door, so the
 * "this fight@deadline already had its press" fact is a reducer transition and not a component ref; a refused
 * claim means someone already owns this attempt and NOTHING is composed. Exactly one `crank` call per claim,
 * with zero retries on any path.
 * @param {{ claim: () => boolean, crank: () => Promise<any>, resync: () => Promise<any> }} deps
 * @returns {Promise<{ verdict: 'held' | 'passed' | 'already_advanced' | 'executed' | 'refused', error: unknown }>}
 */
export async function run_force_pass({ claim, crank, resync }) {
  if (!claim()) return { verdict: 'held', error: null }
  try {
    await crank()
  } catch (error) {
    const verdict = force_pass_verdict(error)
    // A zero-gas "nothing to force" refusal is not a failure to report — it is a stale view. Re-read and hush.
    if (verdict === 'already_advanced') {
      await resync().catch(() => {})
      return { verdict, error: null }
    }
    return { verdict, error }
  }
  await resync().catch(() => {}) // the pass landed; the fold re-reads the turn it just advanced
  return { verdict: 'passed', error: null }
}

/**
 * PURE — the single-shot latch key: ONE press per fight per DEADLINE. A fresh deadline is a genuinely new
 * stall (the turn advanced and stalled again), so it re-arms by key change alone; the same deadline can never
 * be forced twice however many times the button is pressed or re-rendered.
 * @param {string|null|undefined} fight_id @param {bigint|number|string|null|undefined} turn_deadline_ms
 * @returns {string|null} null when there is nothing to latch (no fight / no deadline)
 */
export function force_pass_key(fight_id, turn_deadline_ms) {
  const deadline = Number(turn_deadline_ms ?? 0)
  return fight_id && deadline > 0 ? `${fight_id}:${deadline}` : null
}
