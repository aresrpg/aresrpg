// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2154 — the co-op JOIN's click→seat-visible trace, the sibling engage_timing.js had no counterpart to. The
// three stages are the three honest legs of a join: the press, the join transaction's certified receipt, and the
// first read that actually CONTAINS MY SEAT (world_fight_receipt.js's convergence predicate — not merely a
// readable Fight document, which is the very read that used to end the walk with the joiner still invisible).
// The trace is keyed by the joined fight id, so a create/resume/spectate entry can never close it.

import { create_latency_trace } from './latency_trace.js'

export const JOIN_STAGES = Object.freeze(['click', 'receipt-ready', 'seat-visible'])

const trace = create_latency_trace({
  prefix: 'fight-join',
  stages: JOIN_STAGES,
  namespace: 'join-perf',
  label: 'coop join',
})

export const JOIN_MARK_NAMES = trace.names.marks
export const JOIN_MEASURE_NAMES = trace.names.measures

/** The join press, for the exact fight id the row offers. */
export const start_join_timing = (fight_id, source = 'fights-modal') => trace.start(fight_id, source)

/** The join transaction executed and its receipt is normalized — everything after this is read latency. */
export const mark_join_receipt = (fight_id) => trace.stage('receipt-ready', fight_id)

/** MY SEAT is in the read: the joiner can see themselves on the board. Returns the durations (test seam). */
export const finish_join_timing = (fight_id) => trace.finish(fight_id)

/** A refused/failed join cannot finish; its partial marks stay inspectable until the next press. */
export const cancel_join_timing = () => trace.cancel()

/** Unit seam: the fight id whose join is currently being measured, or null. */
export const join_timing_fight_id = () => trace.key()
