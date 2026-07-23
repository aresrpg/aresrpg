// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// v2/project.js — §④ PROJECTIONS (Fight V2 build step 2): board · presentation · HUD, each a PURE function of
// (state, clock, policy). Presentation is a projection, never state (consensus §Unanimous). The eye is a CLOCK-DRIVEN
// CURSOR over a beat queue derived from the fold's per-event facts; beats advance by CLOCK ONLY — an animation
// completing is NOT an input, so a slow renderer misses beats and truth never waits. Past `max_lag` the projection
// COALESCES/SNAPS: the cursor jumps toward the frontier so it can never fall unboundedly behind (the starve state —
// truth-frontier ≫ presentation-cursor — renders as a LEGAL board, exactly the owner's acceptance bar).
//
// Rider R2: the §7b envelope/beat-grammar (present.js `produce_receipt_render_turns` / `pace_segment`) remains the
// ORACLE for beat CONTENT + timing in normal operation (every beat plays whole). This module models the cursor
// MECHANICS the headless core owns — which beat the eye has reached, and the snap when it lags — over that queue.
// The pacing POLICY is versioned (a bump is a visible pacing change, never a silent drift).

import { apply_action } from '../inputs.js'

import { canonical_base, fold_canonical, sorted_tail } from './fold.js'
import { truth_version } from './inbox.js'

/**
 * The versioned pacing policy. `version` pins it (a change is deliberate); `beat_ms` is the eye's per-beat cadence;
 * `max_lag`/`snap_to` are the coalesce rule (once the cursor is more than `max_lag` beats behind the frontier, it
 * snaps to within `snap_to` beats of it). Presentation-only knobs — they never touch committed truth.
 * @typedef {{ version: number, beat_ms: number, max_lag: number, snap_to: number }} PacingPolicy
 */
export const PACING_POLICY = { version: 1, beat_ms: 400, max_lag: 24, snap_to: 6 }

/**
 * One presentation-consumable fact per admitted event — the beat queue the cursor plays. Derived from the fold's
 * ordered tail (each chain event is a beat); the fact names the event kind and the fighter it touches, the minimum
 * the eye needs to pace. The §7b oracle owns the rich beat body; this is the cursor's spine.
 * @param {import('./state.js').InboxState} inbox
 * @returns {Array<{ index: number, version: number, ordinal: number, kind: string }>}
 */
export const beat_queue = (inbox) =>
  sorted_tail(inbox).map((action, index) => ({
    index,
    version: Number(action.version),
    ordinal: Number(action.event_idx),
    kind: action.kind,
  }))

/**
 * The effective presentation cursor: the eye's beat position, clamped to the queue and SNAPPED forward when it lags
 * the frontier by more than `max_lag`. Pure — the coalesce is a projection rule, not a stored jump.
 * @param {number} beat_count total beats available (the truth frontier, in beats)
 * @param {number} cursor the clock-advanced raw cursor
 * @param {PacingPolicy} policy
 * @returns {number} the beat index the presented projection folds up to
 */
export const present_cursor = (beat_count, cursor, policy = PACING_POLICY) => {
  const clamped = Math.max(0, Math.min(cursor, beat_count))
  return beat_count - clamped > policy.max_lag ? beat_count - policy.snap_to : clamped
}

/**
 * Advance the clock cursor by elapsed wall time — the ONLY cursor driver (clock ticks, never animation acks). Returns
 * a fresh clock. The raw cursor is stored monotonic; `present_cursor` applies the snap at projection time so the
 * stored cursor never loses the fact that time passed.
 * @param {import('./state.js').ClockState} clock
 * @param {number} now_ms
 * @param {number} beat_count
 * @param {PacingPolicy} policy
 * @returns {import('./state.js').ClockState}
 */
export const advance_cursor = (clock, now_ms, beat_count, policy = PACING_POLICY) => {
  const elapsed = clock.now_ms > 0 ? Math.max(0, now_ms - clock.now_ms) : 0
  const stepped = clock.cursor + Math.floor(elapsed / policy.beat_ms)
  // The stored cursor only ever advances by CLOCK and clamps to the frontier — the coalesce/snap is a PROJECTION
  // rule (present_cursor), never baked into the stored value, so the eye never loses the fact that time passed.
  return { now_ms, cursor: Math.max(0, Math.min(stepped, beat_count)) }
}

/**
 * project_board — the COMMITTED board at the truth frontier: base + the WHOLE admitted tail. Legality, reach, and
 * turn logic read this (truth never waits on the eye). Pure. THE canonical fold (issue #549) — no private
 * re-implementation; this IS `fold_canonical(state.inbox)`.
 * @param {import('./state.js').CoreState} state
 */
export const project_board = (state) => fold_canonical(state.inbox)

/**
 * project_presentation — the board AS THE EYE SEES IT: base + the tail up to the (clock-driven, snap-corrected)
 * cursor. Always a legal prefix fold, even when the cursor is far behind the frontier (the starve state). Pure.
 * Shares `canonical_base` with `fold_canonical` (issue #549) — the same snapshot half, folded to a shorter tail.
 * @param {import('./state.js').CoreState} state
 * @param {PacingPolicy} policy
 */
export const project_presentation = (state, policy = PACING_POLICY) => {
  const tail = sorted_tail(state.inbox)
  const cursor = present_cursor(tail.length, state.clock.cursor, policy)
  return tail.slice(0, cursor).reduce(apply_action, canonical_base(state.inbox))
}

/**
 * project_hud — the compact facts a HUD reads: my seat's vitals, whose turn, phase, and the pacing posture (how far
 * the eye lags truth, whether it is snapping). Read off the committed board (my own intents live in the forecast,
 * folded by the ledger — see intents.js). Pure.
 * @param {import('./state.js').CoreState} state
 * @param {PacingPolicy} policy
 */
export const project_hud = (state, policy = PACING_POLICY) => {
  const board = project_board(state)
  const beats = sorted_tail(state.inbox).length
  const cursor = present_cursor(beats, state.clock.cursor, policy)
  const me = state.my_seat ? (board.fighters[state.my_seat] ?? null) : null
  return {
    fight_id: state.fight_id,
    phase: board.phase,
    winner: board.winner,
    active: board.active,
    my_turn: board.active != null && board.active === state.my_seat,
    me: me ? { cell: me.cell, hp: me.hp, ap: me.ap ?? null, mp: me.mp ?? null, alive: me.alive } : null,
    truth_version: truth_version(state.inbox),
    lag_beats: Math.max(0, beats - cursor),
    snapping: beats - cursor > policy.max_lag,
    failures: state.failures.length,
  }
}

/**
 * is_legal_board — the coherence predicate the starve property asserts: a projected board is LEGAL when it is a
 * well-formed fight state (a known phase, a numeric winner, and every fighter carrying finite, non-negative,
 * self-consistent vitals — a dead fighter is never alive, hp is never NaN/negative). A legal board is one the
 * renderer can draw without lying; the cursor lagging the frontier never makes it illegal. Pure.
 * @param {ReturnType<typeof apply_action>} board
 * @returns {boolean}
 */
export const is_legal_board = (board) => {
  if (!board || typeof board !== 'object') return false
  if (!['active', 'victory', 'defeat'].includes(board.phase)) return false
  if (!Number.isFinite(Number(board.winner))) return false
  return Object.values(board.fighters ?? {}).every((f) => {
    if (f.hp != null && (!Number.isFinite(Number(f.hp)) || Number(f.hp) < 0)) return false
    if (f.hp != null && Number(f.hp) <= 0 && f.alive === true) return false // a corpse is never alive
    if (f.cell != null && !Number.isFinite(Number(f.cell))) return false
    return true
  })
}
