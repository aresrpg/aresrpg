// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// EXPIRY GATE (#882) — the ONE home for "has this fight's active turn outlived its on-chain deadline?".
//
// The predicate already existed, twice and privately: fight-liquidation.js kept an `expired()` closure for the
// permissionless crank door, and NOTHING on the player's side knew about it. That is the dead end of record: a
// fight whose turn deadline passed hours ago showed `0s` forever, END TURN composed a transaction the chain can
// only abort (no advance, no feedback), and the UI never said the one true thing — nothing can advance this
// fight, forfeit is the way out.
//
// Same idiom as engage_gate.js (#875): ONE predicate, read by BOTH the action and its presentation, so the
// button and the press can never disagree about WHY. Pure by construction — callers hand in the adapted view
// (or a decoded Fight; both carry `status` + `turn_deadline_ms`), so this stays a transform over plain data.

const STATUS_ACTIVE = 1

/** The janitors need a moment: jitter (≤1.5s) + the crank tx + the 4s poll that observes its result. Only past
 *  this does an overdue turn mean the fight is genuinely STALLED (nobody is cranking it) rather than mid-heal. */
export const EXPIRY_GRACE_MS = 20_000

const ms = (/** @type {any} */ value) => Number(value ?? 0)

/**
 * PURE — how long the ACTIVE turn has been past its on-chain deadline, or null when there is no expired deadline
 * to speak of (not active / no deadline / still inside it). A bigint-decoded deadline is accepted verbatim.
 * @param {{ status?: number|string|null, turn_deadline_ms?: bigint|number|string|null } | null | undefined} view
 * @param {number} [now]
 * @returns {number | null}
 */
export function turn_overdue_ms(view, now = Date.now()) {
  if (!view || Number(view.status) !== STATUS_ACTIVE) return null
  const deadline = ms(view.turn_deadline_ms)
  if (deadline <= 0 || now < deadline) return null
  return now - deadline
}

/** The permissionless `turns::crank` door is eligible: ANY overdue active turn (the liquidation trigger). */
export const turn_liquidatable = (/** @type {any} */ view, /** @type {number} */ now = Date.now()) =>
  turn_overdue_ms(view, now) != null

/** STALLED — overdue past the grace every watcher's crank needs. This is the PLAYER-FACING state: the fight is
 *  not advancing on its own, so the UI must say so and point at the exit instead of showing a dead `0s`. */
export const turn_stalled = (/** @type {any} */ view, /** @type {number} */ now = Date.now()) =>
  (turn_overdue_ms(view, now) ?? -1) >= EXPIRY_GRACE_MS

// WHY THIS GATE NEVER BLOCKS AN ACTION — chain ground truth, `turns.move:177`: "The caller's OWN overdue turn
// still acts (grace until someone actually cranks it away)". A late END TURN is the LEGAL move that advances a
// stalled fight, so refusing it client-side would build the dead end this gate exists to remove. The gate is
// therefore PRESENTATIONAL: it says what the player cannot otherwise see (the `0s` that never moves), while the
// same predicate keeps driving the permissionless crank door. What IS blocked lives on chain, and only there:
// someone ELSE's overdue turn aborts `ESomeoneOverdue` at simulation (zero gas) and the commit path already
// auto-cranks + retries once for it.

/** The i18n key naming the stalled state and its working exit — the forfeit door FightControls already owns. */
export const TURN_STALLED_COPY_KEY = 'fights.turn_expired_exit'

/** The END TURN title while my own turn is overdue: the press still lands (chain grace) but must say it is late. */
export const TURN_OVERDUE_COPY_KEY = 'fights.turn_expired'
