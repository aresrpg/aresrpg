// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// v2/replay.js — §⑤ THE REPLAY HARNESS (Fight V2 build step 2). The input log IS the state (consensus §Unanimous):
// a capsule replays byte-stable through the ONE door. `replay(capsules)` folds a capsule's envelope stream through
// `ingest` from a fresh core to the final state — the acceptance-suite entry point and the shape every historical
// desync becomes a corpus row of. PURE, NO THROW: `ingest` is total, so a capsule that "won't replay" surfaces as
// failure DATA on the returned state (a FINDING), never an exception.

import { empty_core_state } from './state.js'
import { ingest } from './ingest.js'
import { truth_frontier } from './inbox.js'

/** The envelope list of a capsule — a trace_format-2 file (`{ capsules: [...] }`) or a bare envelope array. */
const envelopes_of = (capsule) => (Array.isArray(capsule) ? capsule : (capsule?.capsules ?? []))

/**
 * replay — fold a capsule's whole envelope stream through the door to the final core state.
 * @param {{ capsules: any[] } | any[]} capsule a trace_format-2 capsule (or bare envelope array)
 * @param {import('./state.js').CoreState} [seed] an initial core (defaults to a fresh one)
 * @returns {import('./state.js').CoreState}
 */
export const replay = (capsule, seed = empty_core_state()) =>
  envelopes_of(capsule).reduce((state, envelope) => ingest(state, envelope), seed)

/**
 * replay_trace — replay + a compact verdict, the acceptance-suite row shape: did it fold clean, how far did truth
 * reach, what failures surfaced. `final_index` is the max chain-event coordinate the fold reached (the "final journal
 * index" the corpus test asserts against the stream's own max).
 * @param {{ capsules: any[] } | any[]} capsule
 * @returns {{ state: import('./state.js').CoreState, envelopes: number, final_index: { version: number, ordinal: number },
 *            base_version: number, failures: any[] }}
 */
export const replay_trace = (capsule) => {
  const envelopes = envelopes_of(capsule)
  const state = replay(capsule)
  return {
    state,
    envelopes: envelopes.length,
    final_index: truth_frontier(state.inbox),
    base_version: state.inbox.base_version,
    failures: state.failures,
  }
}
