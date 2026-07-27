// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// core.js — the public surface of the headless fight core: the committed-truth owner every projection reads.
// A pure module family over the shared evolver/envelope/classify/fold homes. The pipeline, in one line each:
//   ingest (§①/door) → the ONE serialized writer; every source is an input envelope
//   inbox  (§①)      → journal admission by chain coordinate; courtesy unverified; failure-as-data + refetch
//   fold   (§②)      → total, unconditional committed truth (chain vocabulary via apply_action — see its header)
//   intents(§③)      → the intent ledger + recompute-whole forecast (prediction is derivation, not state)
//   project(§④)      → board/presentation/HUD; clock-driven beat cursor; snaps past max_lag (starve is legal)
//   replay (§⑤)      → the input-log-is-the-state harness the acceptance corpus rides

export { empty_core_state, empty_inbox } from './core_state.js'
export { ingest } from './core_ingest.js'
export { replay, replay_trace } from './core_replay.js'

export { fold_canonical, sorted_tail, enrich_actions } from './core_fold.js'
export { active_intents, fold_forecast, queue_intent, refuse_intents, resolve_intents } from './core_intents.js'
export {
  project_board,
  project_presentation,
  project_hud,
  beat_queue,
  present_cursor,
  advance_cursor,
  is_legal_board,
  PACING_POLICY,
} from './core_project.js'
export {
  admit_events,
  adopt_snapshot,
  buffer_courtesy,
  reconcile_courtesy,
  batch_to_actions,
  decode_fight_batch,
  journal_to_actions,
  truth_version,
  truth_frontier,
} from './core_inbox.js'
export { revive_wire, coord_key, coord_cmp, coord_after, COORD_ZERO } from './core_wire.js'
export { fingerprint_state, fight_fingerprint } from './fingerprint.js'
