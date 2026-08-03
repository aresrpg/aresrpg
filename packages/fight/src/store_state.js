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
 * into `turn_deadline_ms`) plus the floor, while `turn_started_at` is the instant the turn was HANDED OVER.
 * Since #1808 that handover already waits out the chain's mob-resolution budget (fold.js `turn_is_playable`), so
 * the local arm normally rules and the two agree — the chain arm stays as the belt against a fold that has not
 * re-run under a freshly widened deadline: never submit before BOTH clocks allow, because an early guess aborts
 * ETurnTooFast and costs the player a turn they legitimately spent 3+ seconds on. Null off my playable turn.
 *
 * ONE FRAME (#2113) — the two arms were `Math.max`'d across DIFFERENT clocks: `turn_started_at` is a LOCAL
 * instant, `chain_min_turn_at` a CHAIN one, so a skewed client mixed frames and the max picked the wrong arm.
 * The chain arm is carried into local time (`chain − offset`) and the result is a LOCAL instant, which is what
 * every consumer compares against its own `Date.now()`. The estimator converges from BELOW (`offset_hat ≤
 * offset`), so `chain − offset_hat` lands LATE — and late is the SAFE side here: submitting early means the tx
 * EXECUTES, aborts ETurnTooFast, and burns gas that the burn law forbids retrying, while waiting longer
 * pre-sign costs nothing at all. The deadline hatch below is what stops that late bias from eating a turn.
 * @param {any} state @returns {number | null}
 */
export const min_turn_ready_at = (state) => {
  if (state.turn_started_at == null) return null
  const { active } = committed_truth(state)
  if (active == null || active !== state.my_key) return null
  const chain_floor = chain_min_turn_at(state.turn_deadline_ms, state.view?.turn_ms)
  return Math.max(
    state.turn_started_at + PLAYER_TURN_FLOOR_MS,
    // 0 is the starved read's honest refusal to fabricate a floor — never shift it into a real instant.
    chain_floor > 0 ? chain_floor - (state.chain_offset_ms ?? 0) : chain_floor
  )
}

/**
 * How long an end-turn SUBMIT must wait before the chain will accept its terminal pass — 0 when it may go now.
 * The ONE answer both submit doors read (the optimistic intent door and the PTB door), so neither re-derives it:
 * the min-turn remainder above, MINUS the deadline escape hatch. A turn about to expire submits immediately —
 * losing it to the timer is strictly worse than an ETurnTooFast refusal, and the chain grants the late press
 * its own grace. Waiting this out PRE-SIGN costs zero gas and leaves no digest, which is the whole point: an
 * executed abort is never auto-retried (the burn law), so the turn must simply never be submitted early.
 *
 * THE HATCH ERRS THE OTHER WAY (#2113). `turn_deadline_ms` is a CHAIN instant and `now` is local, so the escape
 * hatch needed the offset too — but NOT the same bias as the floor above. The floor may safely open late (worst
 * case: a wasted pre-sign wait). The hatch may NOT: it exists precisely to beat the deadline, and opening it
 * late is how a turn gets FORFEITED — which this function's own ranking calls strictly worse than an
 * ETurnTooFast refusal. Since `offset_hat ≤ offset`, correcting it symmetrically would push the hatch later,
 * the one direction it must never move. So it takes the MORE URGENT of the two frames: `max(0, offset)` shifts
 * the hatch EARLIER when the chain is ahead of this client, and leaves it exactly where it is otherwise — a
 * lower-bound estimate can never be trusted to grant extra time it may not have.
 * @param {any} state @param {number} [now] @returns {number}
 */
export const submit_wait_ms = (state, now = Date.now()) => {
  const deadline = Number(state.turn_deadline_ms ?? 0)
  const chain_ahead_ms = Math.max(0, state.chain_offset_ms ?? 0)
  if (deadline > 0 && deadline - now - chain_ahead_ms <= PLAYER_TURN_FLOOR_MS) return 0
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
  // THE CHAIN-CLOCK OFFSET (#2099) — `chain_now ≈ Date.now() + this`, folded from observed (chain_now_ms,
  // arrival) pairs the chain reads carry (draft_budget `fold_chain_offset`). Per FIGHT: `init` clears it with
  // the rest of this state. null = nothing observed yet ⇒ no correction.
  chain_offset_ms: null,
  // THE TURN-HANDOVER FACT (#1808) — folded, never a UI-side flag: my turn is genuinely playable (chain seat,
  // nothing replaying, the chain's mob-resolution budget spent). Every turn surface mounts on this.
  turn_playable: false,
  my_turn_no: 0,
  pending_end_turn: null,
  intent_seq: 0,
  settlement: settle_input.empty_settlement(),
  provider: 'idle_wait',
  refused: null,
  divergence: null,
})
