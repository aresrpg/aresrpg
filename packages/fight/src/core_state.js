// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// core_state.js — the ONE headless-core state atom. Plain immutable data; every field is a
// pure fold output of the input log, nothing is a latch. `ingest` (the serialized door) is the ONLY writer, and it
// only ever RETURNS a fresh atom — no store, no mutation, no async. Consumers read PROJECTIONS (core_project.js),
// never these internals.
//
// The atom carries three concerns, each a pure reduction of the same input log (consensus §① / §③ / §④):
//   · the INBOX      — admitted chain truth (log + adopted snapshot base + the truth frontier) + unverified courtesy
//   · the LEDGER     — the intent ledger (my optimistic commits, statuses draft→…→observed/refused/stale)
//   · the CLOCK      — the presentation cursor (clock-driven; beats advance by clock, never by an animation ack)
// plus FAILURES-AS-DATA and outbound EFFECT REQUESTS (refetch) — errors and side-effect needs are DATA the shell
// drains, never thrown or performed in the core.

/**
 * @typedef {import('./core_wire.js').EventCoord} EventCoord
 * @typedef {Record<string, any>} Action a chain-vocabulary action (inputs.js normalize_events output)
 *
 * @typedef {object} InboxState
 * @property {Record<string, Action>} log admitted VERIFIED chain events, keyed `"<version>:<ordinal>"`
 * @property {Record<string, Action>} courtesy UNVERIFIED courtesy (p2p) rows — never advance the frontier alone
 * @property {any} base_view the adopted snapshot's rich board view (SNAPSHOT+TAIL base) — null until first read
 * @property {number} base_version the object version of `base_view` (the fold floor)
 * @property {number} seq_head the highest journal `head` seq observed (chain-index provenance; see wire.js)
 * @property {number} delivered_seq the highest journal seq whose BODY actually arrived (head ≫ this = a gap finding)
 *
 * The truth FRONTIER is not stored — it is DERIVED from (log ∪ base) by `truth_frontier` (inbox.js), never a latch,
 * so it is order-independent by construction (a stored watermark drifts when a snapshot prunes the log it counted).
 *
 * @typedef {object} Intent one row of the intent ledger (§③)
 * @property {string|null} effect_id idempotence key (the commit's intent_id) — a re-observed effect folds once
 * @property {'draft'|'queued'|'submitted'|'observed'|'refused'|'stale'} status lifecycle state
 * @property {number} basis_version the canonical floor this intent predicts on top of
 * @property {Action[]} actions the chain-shaped actions this intent forecasts (source 'intent')
 *
 * @typedef {object} ClockState the presentation cursor (§④)
 * @property {number} now_ms last observed wall clock (the ONLY time source — clock_observed envelopes)
 * @property {number} cursor the beat index the eye has reached (advances by clock; snaps past max_lag)
 *
 * @typedef {object} CoreState
 * @property {string|null} fight_id the open fight (null between sessions)
 * @property {number} session_generation bumped per boot — a superseded-session async input drops at the door
 * @property {Record<string, any>} ctx session context (roster, beat_ctx, my_entity_id) — NEVER folded/hashed
 * @property {string|null} my_seat which seat I am (`p<idx>`), resolved from ctx.my_entity_id against the base view
 * @property {InboxState} inbox
 * @property {Intent[]} ledger the intent ledger
 * @property {ClockState} clock
 * @property {object} ingestion cumulative delivery accounting + the last input/event cursor observation
 * @property {Array<Record<string, any>>} failures failure-as-data records (hash conflict, gap age, refusal)
 * @property {Array<Record<string, any>>} effects outbound effect REQUESTS the shell performs (refetch a version)
 */

/** The empty inbox — no base, no log; the frontier derives to COORD_ZERO here (see inbox.js `truth_frontier`). */
export const empty_inbox = () => ({
  log: {},
  courtesy: {},
  base_view: null,
  base_version: -1,
  seq_head: -1,
  delivered_seq: -1,
})

/** Per-session instrumentation. `buffered` is the unverified p2p lane; it is neither canonical-folded nor dropped. */
export const empty_ingestion = () => ({
  received: 0,
  folded: 0,
  dropped: 0,
  buffered: 0,
  input_cursor: null,
  last: null,
})

/**
 * empty_core_state — a fresh headless core. `fight_id` opens with a session (session_opened); everything else is a
 * pure fold of the inputs that follow. `session_generation` starts at 0 and bumps per boot.
 * @param {string|null} [fight_id]
 * @returns {CoreState}
 */
export const empty_core_state = (fight_id = null) => ({
  fight_id,
  session_generation: 0,
  ctx: {},
  my_seat: null,
  inbox: empty_inbox(),
  ledger: [],
  clock: { now_ms: 0, cursor: 0 },
  ingestion: empty_ingestion(),
  failures: [],
  effects: [],
})
