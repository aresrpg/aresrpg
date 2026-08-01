// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/store_state.js — state shape and projections shared by the single fight-store write door.

import { project_board } from './core_project.js'
import { CHAIN_MIN_TURN_MS, chain_min_turn_at } from './draft_budget.js'
import { entity_fold_key } from './fold.js'
import { empty_state } from './inputs.js'
import * as settle_input from './inputs.js'

/**
 * THE COMMITTED-TRUTH DOOR (#1027) — the ONE committed board, repo-wide. It is the HEADLESS CORE's fold projected
 * by `project_board`; there is no switch, side-map overlay, or second derivation to drift from it. Presentation
 * (`presented_state` / `display_state` / `claimed_budget_state`) is a different question and remains the explicitly
 * fenced renderer/pacing seam.
 *
 * TOTAL — there is no coreless arm. A projection input carries a core (`empty_core_state(null)` is one) exactly as
 * a real store atom does.
 */
export const committed_truth = (state) => project_board(state.core)

/** The PRE-RECEIPT committed HP oracle the wave pricer needs (chain `Hit.amount` is raw authored damage while
 * `remaining_hp` is saturated, so a floater is priced from the victim's committed HP). */
export const committed_health = (state) => {
  const { fighters } = committed_truth(state)
  const escrow = state.view?.escrow ?? []
  return (source_id) => {
    const key = entity_fold_key(escrow, source_id)
    return key ? (fighters?.[key]?.hp ?? null) : null
  }
}

/** The player's per-turn floor IS the chain's `actions.move` MIN_TURN_MS — derived, never re-typed. */
export const PLAYER_TURN_FLOOR_MS = CHAIN_MIN_TURN_MS
export const MIN_ACTION_MS = 5000

/**
 * MY turn's min-turn floor as an ABSOLUTE instant — the ONE anchor the End Turn button, the intent door and the
 * kill auto-commit all read (#1484). Two clocks measure this turn and only one of them can refuse a transaction:
 * `actions::assert_min_turn` gates on the CHAIN's turn start (its 3s-per-replayed-mob widening already folded
 * into `turn_deadline_ms`) plus the floor, while `turn_started_at` is only the client's local GUESS at that same
 * instant — the moment its own mob replay drained. When the guess runs early the chain aborts ETurnTooFast and
 * the player loses a turn they legitimately spent 3+ seconds on. Take the LATER of the two: never submit before
 * BOTH clocks allow. Null when it is not my playable turn.
 * @param {any} state @returns {number | null}
 */
export const min_turn_ready_at = (state) => {
  if (state.turn_started_at == null) return null
  const { active } = committed_truth(state)
  if (active == null || active !== state.my_key) return null
  return Math.max(
    state.turn_started_at + PLAYER_TURN_FLOOR_MS,
    chain_min_turn_at(state.turn_deadline_ms, state.view?.turn_ms)
  )
}

/**
 * How much LONGER than the plain 3s floor this turn's min-turn wait runs — the chain's `3s per replayed mob`
 * widening (`resolve_from`: `deadline = start + turn_ms + 3s×N`) as the PLAYER experiences it, so the HUD can
 * say WHY the countdown reads 6s when the rule everyone knows is 3s (#1644: "some desync it seem").
 *
 * Derived from the two clocks `min_turn_ready_at` already reconciles — no new stored fact, no second reading of
 * the chain dial. It self-suppresses honestly: when the client's own anchor (`turn_started_at`, stamped as its
 * mob replay drained) is already late enough to cover the chain floor, the visible countdown IS the ordinary 3s
 * and there is nothing mysterious to explain — only the excess the chain's widening actually adds is reported.
 * @param {any} state @returns {number} 0 when the ordinary floor rules (or it is not my playable turn)
 */
export const min_turn_widened_ms = (state) => {
  const ready_at = min_turn_ready_at(state)
  if (ready_at == null) return 0
  return Math.max(0, ready_at - Number(state.turn_started_at) - PLAYER_TURN_FLOOR_MS)
}

/**
 * How long an end-turn SUBMIT must wait before the chain will accept its terminal pass — 0 when it may go now.
 * The ONE answer both submit doors read (the optimistic intent door and the PTB door), so neither re-derives it:
 * the min-turn remainder above, MINUS the deadline escape hatch. A turn about to expire submits immediately —
 * losing it to the timer is strictly worse than an ETurnTooFast refusal, and the chain grants the late press
 * its own grace. Waiting this out PRE-SIGN costs zero gas and leaves no digest, which is the whole point: an
 * executed abort is never auto-retried (the burn law), so the turn must simply never be submitted early.
 * @param {any} state @param {number} [now] @returns {number}
 */
export const submit_wait_ms = (state, now = Date.now()) => {
  const deadline = Number(state.turn_deadline_ms ?? 0)
  if (deadline > 0 && deadline - now <= PLAYER_TURN_FLOOR_MS) return 0
  const ready_at = min_turn_ready_at(state)
  return ready_at == null ? 0 : Math.max(0, ready_at - now)
}

// COURTESY event_idx lane (#334): a peer's relayed prediction retires by CLAIM, never by key, so it may sit
// pending across unrelated canonical events. Keeping courtesy keys far above the contiguous canonical sequence
// prevents merge_entries from clobbering either lane.
export const COURTESY_EVENT_BASE = 1_000_000

// Grace past a wave turn's own duration before the tick watchdog force-acks it.
export const WAVE_ACK_GRACE_MS = 6000

// Observer identity is stripped at every context ingress, not merely hidden by engine_view. Global owned-party
// focus updates remain live while WATCH is open; retaining one here would make its journal turns look local.
export const observer_ctx = (ctx = {}) =>
  ctx.spectator === true ? { ...ctx, address: null, creator: null, my_entity_id: null } : ctx

export const empty_fight = () => ({
  ...empty_state(null),
  entries: {},
  applied_version: -1,
  journal_gap: null,
  protocol_fault: null,
  // Accepted silent budget facts and prediction evidence are bounded, non-canonical overlays.
  claimed_budget: [],
  budget_predictions: [],
  // The accepted local turn's leftover pools, captured before its receipt retires the predictions/refills.
  // This is published projection evidence, never a second combat-math owner.
  post_commit_budget: {},
  view: null,
  ctx: {},
  sim: null,
  wave: [],
  // Renderer/prediction accumulators. They are never an alternate canonical chain fold.
  my_traps: [],
  my_glyphs: [],
  // The greatest CHAIN player-turn ordinal this fold has observed — the glyph ledger's clock (fold.js). Monotone
  // within one fight, reset here with the rest of the accumulators.
  glyph_clock: 0,
  placement_ghosts: {},
  courtesy_seen: {},
  flagged: null,
  // Append-only authoritative death floors, cleared only when a new fight is initialized.
  retired: {},
  optimistic_dead: {},
  wave_seq: 0,
  presented_seq: 0,
  wave_head: null,
  turn_lost: null,
  staged: [],
  armed_spell_id: null,
  hovered_spell_id: null,
  hand: [],
  busy: false,
  commit_due: false,
  commit_latch: null,
  commit_attempt_epoch: null,
  receipt_seq: 0,
  last_action_ms: 0,
  error: null,
  my_key: null,
  turn_started_at: null,
  my_turn_no: 0,
  pending_end_turn: null,
  intent_seq: 0,
  settlement: settle_input.empty_settlement(),
  provider: 'idle_wait',
  refused: null,
  divergence: null,
})
