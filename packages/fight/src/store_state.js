// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/store_state.js — state shape and projections shared by the single fight-store write door.

import { project_board } from './core_project.js'
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

export const PLAYER_TURN_FLOOR_MS = 3000
export const MIN_ACTION_MS = 5000

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
  // Compatibility projection for the journal walker. This is derived from the core inbox's delivered seq; it is
  // not an admission cursor or a second state home.
  accept_state: { head: null, digests: {} },
  journal_gap: null,
  protocol_fault: null,
  // Accepted silent budget facts and prediction evidence are bounded, non-canonical overlays.
  claimed_budget: [],
  budget_predictions: [],
  view: null,
  view_version: -1,
  ctx: {},
  sim: null,
  wave: [],
  // Renderer/prediction accumulators. They are never an alternate canonical chain fold.
  my_traps: [],
  my_glyphs: [],
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
  session_generation: 0,
  refused: null,
  divergence: null,
})
