// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// envelope.js — the SHARED input-envelope shape (V2 build step 1, consensus §① / build-order 1).
//
// ONE serialized ingress: every source the fight machinery consumes (journal poll, courtesy, tx
// results, drafts/commits, clock ticks, lifecycle) is wrapped as ONE `input_envelope` carrying ONE
// `fight_input` union payload. This is the SHARED shape the recorder tee stamps on the CURRENT client
// today and the V2 core will consume later — the corpus exists before the core (strangler migration).
//
// Types + pure constructors ONLY. No side effects, no store reads, node-clean. `ENVELOPE_VERSION` is
// the wire contract — a reader keys decode on it, so it is bumped (never silently reshaped) on any
// breaking change to the envelope or a union member.

export const ENVELOPE_VERSION = 1

// Drop keys whose value is `undefined` so a capsule carries ONLY what its source actually observed
// (a poll that saw no version omits `version` rather than pinning `version: undefined`). `null` is a
// real observation (e.g. `my_key: null` at init) and is kept.
const observed = (fields) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))

// Every union member is a `kind`-tagged plain record — the discriminator a total fold switches on.
const tagged = (kind, fields) => ({ kind, ...observed(fields) })

/**
 * input_envelope — wrap ONE fight_input `payload` with its provenance. `input_seq` is the recorder's
 * monotonic capture ordinal (NOT the chain event index — that rides inside the payload); `observed_at_ms`
 * is wall-clock at the tap (the ONE home for the tap timestamp — clock_observed never re-stamps it).
 * @param {{ session_id?: string|null, input_seq: number, observed_at_ms: number, payload: object }} fields
 */
export const input_envelope = ({ session_id = null, input_seq, observed_at_ms, payload }) => ({
  envelope_version: ENVELOPE_VERSION,
  session_id,
  input_seq,
  observed_at_ms,
  payload,
})

// ── the fight_input union — one pure constructor per member ─────────────────────────────────────

/** A chain-read delivery. `source` discriminates the read (receipt | poll | p2p | snapshot | journal |
 *  terminal); `rows` carries that source's native data (a receipt object, an events array, the decoded
 *  fight object, or a journal batch) — the V2 inbox dedupes/orders by the chain event index inside it.
 *  Snapshot reads additionally carry their own event-count cursor plus the reducer's accepted seq floor, so
 *  reconciliation compares like with like instead of mistaking object version for event progress. */
export const journal_rows_received = ({ source, fight_id, version, rows, snapshot_head, accepted_head } = {}) =>
  tagged('journal_rows_received', { source, fight_id, version, rows, snapshot_head, accepted_head })

/** A signed transaction left the client. */
export const tx_submitted = ({ turn_key, signal, phase, action_count, background, digest } = {}) =>
  tagged('tx_submitted', { turn_key, signal, phase, action_count, background, digest })

/** A transaction was refused — locally (busy/no-fight), at simulation, or an EXECUTED failure (a
 *  `digest` exists ⇒ gas burned ⇒ never auto-retried; the digest is the audit trail). */
export const tx_refused = ({ turn_key, signal, phase, reason, verdict, digest, message } = {}) =>
  tagged('tx_refused', { turn_key, signal, phase, reason, verdict, digest, message })

/** A transaction lifecycle transition that is neither a fresh submit nor a refusal (in-flight cleared,
 *  settlement verdict, request consumed). */
export const tx_status = ({ turn_key, signal, phase, busy, latch, verdict, digest, status } = {}) =>
  tagged('tx_status', { turn_key, signal, phase, busy, latch, verdict, digest, status })

/** A pre-commit UI selection — never fight truth. `draft_kind` names the surface (arm | hover_spell |
 *  board_click | stage | clear_staged | hand_update | placement_ghost). */
export const player_draft = ({ draft_kind, spell_id, cell, targetable, hand, intent, character, fight_id } = {}) =>
  tagged('player_draft', { draft_kind, spell_id, cell, targetable, hand, intent, character, fight_id })

/** An optimistic commit into the local prediction log (intent | predicted) or its reversal (rollback |
 *  drop_traps | drop_glyphs). `commit_kind` discriminates; predictions are purged by the confirming receipt. */
export const player_commit = ({
  commit_kind,
  intent,
  actions,
  intent_id,
  basis_version,
  version,
  event_idx,
  beats,
  place_traps,
  place_glyphs,
  cells,
  draft_ids,
  predicts,
} = {}) =>
  tagged('player_commit', {
    commit_kind,
    intent,
    actions,
    intent_id,
    basis_version,
    version,
    event_idx,
    beats,
    place_traps,
    place_glyphs,
    cells,
    draft_ids,
    predicts,
  })

/** A clock tick — the ONLY time source. The reading is the envelope's `observed_at_ms`; this payload
 *  carries the tick's chain-floor context (never a second timestamp). */
export const clock_observed = ({ last_action_ms, draft_count, enabled, latch } = {}) =>
  tagged('clock_observed', { last_action_ms, draft_count, enabled, latch })

/** A non-chain, non-tx session signal — context merge, presentation ack, UI-consumption idempotency
 *  (presented | ctx | presented | error | turn_lost_shown | divergence_shown | flush | unknown). */
export const lifecycle = ({ phase, fight_id, version, action, seq, key, message, ctx, type } = {}) =>
  tagged('lifecycle', { phase, fight_id, version, action, seq, key, message, ctx, type })

/** A fight/session opened — the ONE boot path (mid-fight refresh replays from here). */
export const session_opened = ({ fight_id, my_key, ctx } = {}) => tagged('session_opened', { fight_id, my_key, ctx })

/** A fight/session closed or reset (init with no fight id). */
export const session_closed = ({ fight_id, reason } = {}) => tagged('session_closed', { fight_id, reason })
