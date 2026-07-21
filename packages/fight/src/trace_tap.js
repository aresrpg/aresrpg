// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TRACE TAP — the effect-edge holder for trace_recorder.js. store.js's `make_input` calls `tap_trace_input`
// as its FIRST line, before any set() or gate: pure data capture, zero behavior change, no store writes (the
// recorder box lives OUTSIDE fight state — the same class as fight.js's `combat_log_seq`, presentation/
// forensics, never sim/store truth). `dump_current_trace` is the only other consumer (the frontend export
// action reads it directly — no prop threading, same pattern as `arm_spell`/`hover_spell` reading the store).

import { create_trace_recorder, record_input, dump_trace } from './trace_recorder.js'

let rec = create_trace_recorder()

/**
 * Capture one input VERBATIM, before it folds. Call from make_input's door, first line, unconditionally —
 * including inputs the provider/identity gate later refuses (a refusal is itself diagnostic signal for the
 * bug classes this trace exists to catch). Total: a plain object spread + array slice, structurally unable to
 * throw into the game.
 * @param {{ fight_id: string|null, applied_version: number, view_version: number, receipt_seq: number }} state
 * @param {object} msg
 * @param {number} now
 */
export const tap_trace_input = (state, msg, now) => {
  const fight_id = msg.type === 'init' ? (msg.fight_id ?? null) : (msg.fight_id ?? state.fight_id ?? null)
  rec = record_input(rec, {
    fight_id,
    msg,
    at: now,
    anchors: {
      applied_version: state.applied_version,
      view_version: state.view_version,
      receipt_seq: state.receipt_seq,
    },
  })
}

/** Dump the current (or given) fight's trace — null when nothing is dumpable (no captured 'init' survives the
 *  ring buffer for that fight yet). @param {string} app_version @param {number} captured_at @param {string} [fight_id] */
export const dump_current_trace = (app_version, captured_at, fight_id) =>
  dump_trace(rec, app_version, captured_at, fight_id)

/** TEST-ONLY: the tap is a module-level singleton (every store instance in the process shares it, exactly like
 *  fight.js's combat_log_seq), so a test that asserts on IT (not just on a store's own projected state) must
 *  reset first. Never called from production code. */
export const _reset_trace_for_test = (capacity) => {
  rec = create_trace_recorder(capacity)
}
