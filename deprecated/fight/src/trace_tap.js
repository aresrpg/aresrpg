// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TRACE TAP — the per-store effect-edge holder for trace_recorder.js. store.js's `make_input` calls its
// `tap_trace_input` as the FIRST consumer, before any set() or gate: pure data capture, zero behavior change.
// The recorder box lives OUTSIDE fight reducer state (so recording never causes a second store write), but it
// belongs to the SAME store instance as the input door. Fresh stores therefore never share trace history.

import { create_trace_recorder, record_input, dump_trace, earliest_input_at } from './trace_recorder.js'

// Re-exported so the frontend's ONE fight-package import path (this module) also carries the format's
// BigInt-safe serializer — no second package export entry for a single function (issue #209 P1 follow-up).
export { stringify_trace } from './trace_recorder.js'

/**
 * One recorder instance for one fight store. Mutable ownership stays inside this factory closure: there is no
 * module singleton for fresh stores/tests to inherit. The store's input door owns the fault boundary around
 * `tap_trace_input`, because a diagnostic consumer must never perturb reduction.
 * @param {number} [capacity]
 */
export const create_trace_tap = (capacity) => {
  let recorder = create_trace_recorder(capacity)

  /**
   * Capture one input VERBATIM, before it folds — including inputs the provider/identity gate later refuses.
   * @param {{ fight_id: string|null, applied_version: number, core: any, receipt_seq: number }} state
   * @param {object} msg
   * @param {number} now
   */
  const tap_trace_input = (state, msg, now) => {
    const fight_id = msg.type === 'init' ? (msg.fight_id ?? null) : (msg.fight_id ?? state.fight_id ?? null)
    recorder = record_input(recorder, {
      fight_id,
      msg,
      at: now,
      anchors: {
        applied_version: state.applied_version,
        // The recorded anchor keeps its trace-format name; its value is read off the ONE home (#1799).
        view_version: state.core?.inbox?.base_version ?? -1,
        receipt_seq: state.receipt_seq,
      },
    })
  }

  /** Dump the current (or given) fight's trace — null when no captured `init` survives. */
  const dump_current_trace = (app_version, captured_at, fight_id) =>
    dump_trace(recorder, app_version, captured_at, fight_id)

  /** The wall-clock moment `fight_id` was last opened, or null when no opening survives. */
  const fight_opened_at = (fight_id) => earliest_input_at(recorder, fight_id)

  /** TEST-ONLY: reset this recorder instance without affecting any other store. */
  const _reset_for_test = (next_capacity) => {
    recorder = create_trace_recorder(next_capacity)
  }

  return Object.freeze({ tap_trace_input, dump_current_trace, fight_opened_at, _reset_for_test })
}
