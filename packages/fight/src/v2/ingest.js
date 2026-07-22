// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// v2/ingest.js — THE SERIALIZED DOOR (Fight V2 build step 2, consensus §Unanimous): `ingest(state, envelope) →
// state` is the ONE writer. Every source — journal/receipt/poll/p2p reads, tx results, my drafts/commits, CLOCK
// ticks, lifecycle — is an `input_envelope` reduced here; nothing else mutates the core (nothing mutates at all —
// the door only ever RETURNS a fresh atom). No async, no store, no throw: an async result re-enters as an INPUT, the
// only ordering is the inbox coordinate, and every failure is DATA on `state.failures`.
//
// The door is thin by design — it routes each payload to the leg that owns it (inbox §① · ledger §③ · clock §④) and
// threads the failures/effects those legs emit. The FOLD (§②) and PROJECTIONS (§④) are pure derivations read on
// demand (v2/fold.js, v2/project.js) — the door never stores them, so they can never go stale.

import { normalize_intent, actor_from_key, seat_resolver } from '../inputs.js'

import { empty_core_state, empty_inbox } from './state.js'
import {
  admit_events,
  adopt_snapshot,
  buffer_courtesy,
  reconcile_courtesy,
  note_journal_head,
  batch_to_actions,
  journal_to_actions,
  truth_version,
} from './inbox.js'
import { queue_intent, mark_submitted, refuse_intents, resolve_intents, compact_ledger } from './intents.js'
import { advance_cursor } from './project.js'
import { sorted_tail } from './fold.js'

/** Append failure-as-data / outbound effect requests without disturbing the rest of the atom. */
const with_failures = (state, failures, effects = []) =>
  failures.length === 0 && effects.length === 0
    ? state
    : { ...state, failures: [...state.failures, ...failures], effects: [...state.effects, ...effects] }

/** Re-resolve which seat I am against the live base view (the first read is often the first moment it is knowable). */
const resolve_my_seat = (inbox, ctx, prior) => {
  const seat = seat_resolver(inbox.base_view)(ctx?.my_entity_id)
  return seat != null ? `p${seat}` : prior
}

/** The identity gate: an identity-scoped read for ANOTHER fight is dropped (a logged non-event), never folded into
 *  the wrong session. A missing id is HELD (the current session claims it) — the resume-snapshot rule. */
const IDENTITY_SCOPED = new Set(['journal_rows_received'])
const wrong_fight = (state, payload) =>
  IDENTITY_SCOPED.has(payload.kind) &&
  payload.fight_id != null &&
  state.fight_id != null &&
  String(payload.fight_id) !== String(state.fight_id)

/** Admit a VERIFIED chain-event batch, reconcile courtesy against it, and resolve intents the chain has now spoken
 *  past. `how` marks the intent resolution ('observed' for a receipt — my own tx proof; 'stale' for a read floor). */
const admit_verified = (state, actions, version, how, now) => {
  const admitted = admit_events(state.inbox, actions, now)
  const inbox = reconcile_courtesy(admitted.inbox)
  const ledger = compact_ledger(resolve_intents(state.ledger, version, how), truth_version(inbox))
  return with_failures({ ...state, inbox, ledger }, admitted.failures, admitted.effects)
}

/** Route a chain-read (`journal_rows_received`) by its source to the admission leg it belongs to. */
const ingest_chain_read = (state, payload, now) => {
  const { source, version, fight_id } = payload
  const ver = Number(version ?? 0)
  if (source === 'snapshot') {
    const inbox = adopt_snapshot(state.inbox, payload.rows, ver, state.ctx)
    const with_base = reconcile_courtesy(inbox)
    const ledger = compact_ledger(
      resolve_intents(state.ledger, with_base.base_version, 'stale'),
      truth_version(with_base)
    )
    return { ...state, inbox: with_base, ledger, my_seat: resolve_my_seat(with_base, state.ctx, state.my_seat) }
  }
  if (source === 'receipt') {
    const actions = batch_to_actions(payload.rows, { version: ver, source, fight_id })
    return admit_verified(state, actions, ver, 'observed', now)
  }
  if (source === 'poll' || source === 'terminal') {
    const actions = batch_to_actions(payload.rows, { version: ver, source: 'poll', fight_id })
    return admit_verified(state, actions, ver, 'stale', now)
  }
  if (source === 'p2p') {
    const actions = batch_to_actions(payload.rows, { version: ver, source: 'p2p', fight_id })
    return { ...state, inbox: buffer_courtesy(state.inbox, actions) }
  }
  if (source === 'journal') {
    const actions = journal_to_actions(payload.rows)
    const admitted = admit_verified(state, actions, ver, 'observed', now)
    const headed = note_journal_head(admitted.inbox, payload.rows?.head, actions, now)
    return with_failures({ ...admitted, inbox: headed.inbox }, headed.failures)
  }
  return state // an unknown source is a no-op (total; the classify bridge never emits one)
}

/** Normalize a player commit into chain-shaped, pure-data intent actions (resolver attached at forecast-fold time). */
const commit_actions = (payload, { actor, basis }) => {
  const one = (raw, event_idx) => normalize_intent(raw, { version: basis, event_idx, actor, resolve_seat: null })
  if (payload.commit_kind === 'predicted') return (payload.actions ?? []).map(one)
  if (payload.commit_kind === 'intent') return payload.intent ? [one(payload.intent, 0)] : []
  return []
}

/** Route a `player_commit` to the ledger (§③): queue an optimistic intent, or deactivate one (rollback / drop). */
const ingest_commit = (state, payload) => {
  const actor = actor_from_key(state.my_seat)
  const basis = Math.max(1, truth_version(state.inbox) + 1)
  if (payload.commit_kind === 'intent' || payload.commit_kind === 'predicted') {
    const actions = commit_actions(payload, { actor, basis })
    if (!actions.length) return state
    return {
      ...state,
      ledger: queue_intent(state.ledger, { effect_id: payload.intent_id ?? null, basis_version: basis, actions }),
    }
  }
  if (payload.commit_kind === 'rollback') {
    const match = payload.intent_id != null ? (intent) => intent.effect_id === payload.intent_id : () => true
    return { ...state, ledger: refuse_intents(state.ledger, match) }
  }
  if (payload.commit_kind === 'drop_traps' || payload.commit_kind === 'drop_glyphs') {
    const ids = new Set(payload.draft_ids ?? [])
    return {
      ...state,
      ledger: refuse_intents(state.ledger, (intent) => intent.effect_id != null && ids.has(intent.effect_id)),
    }
  }
  return state
}

/**
 * ingest — reduce ONE input envelope into the core. Total over every `fight_input` kind (classify_input's union);
 * an unmapped kind is a no-op, never a throw. `now` is the envelope's tap wall-clock (the ONE time source).
 * @param {import('./state.js').CoreState} state
 * @param {{ payload: Record<string, any>, observed_at_ms?: number, session_id?: string|null }} envelope
 * @param {number} [now]
 * @returns {import('./state.js').CoreState}
 */
export const ingest = (state, envelope, now = envelope?.observed_at_ms ?? 0) => {
  const payload = envelope?.payload
  if (!payload || typeof payload.kind !== 'string')
    return with_failures(state, [{ kind: 'malformed_envelope', at: now }])
  if (wrong_fight(state, payload))
    return with_failures(state, [
      { kind: 'wrong_fight', got: String(payload.fight_id), want: String(state.fight_id), at: now },
    ])

  switch (payload.kind) {
    case 'session_opened':
      // The ONE boot path (mid-fight refresh replays from index 0): a fresh atom keeps the session generation
      // monotonic so a superseded async input can be gated out, and adopts the opening context.
      return {
        ...empty_core_state(payload.fight_id ?? null),
        session_generation: state.session_generation + 1,
        ctx: { ...(payload.ctx ?? {}) },
        my_seat: payload.my_key ?? null,
      }
    case 'session_closed':
      return { ...empty_core_state(null), session_generation: state.session_generation + 1 }
    case 'lifecycle': {
      // Context merge (roster / beat_ctx / my_entity_id) — never folded, never hashed; only re-resolves my seat.
      if (payload.phase !== 'ctx' && payload.ctx == null) return state
      const ctx = { ...state.ctx, ...(payload.ctx ?? {}) }
      return { ...state, ctx, my_seat: resolve_my_seat(state.inbox, ctx, state.my_seat) }
    }
    case 'clock_observed': {
      // The clock — the ONLY cursor driver. Beats advance by wall time, never by an animation ack.
      const beats = sorted_tail(state.inbox).length
      return { ...state, clock: advance_cursor(state.clock, now, beats) }
    }
    case 'journal_rows_received':
      return ingest_chain_read(state, payload, now)
    case 'tx_submitted':
      return { ...state, ledger: mark_submitted(state.ledger) }
    case 'tx_refused': {
      // An executed failure (a digest exists ⇒ gas burned ⇒ never retried) or a local refusal deactivates the
      // optimistic intent it named; the forecast rebuilds whole without it.
      const match = payload.digest != null ? (intent) => intent.effect_id === payload.turn_key : () => true
      return { ...state, ledger: refuse_intents(state.ledger, match) }
    }
    case 'tx_status':
      // A settlement/busy transition that carried an executed-failure latch refuses; everything else is bookkeeping.
      return payload.latch?.digest != null ? { ...state, ledger: refuse_intents(state.ledger, () => true) } : state
    case 'player_commit':
      return ingest_commit(state, payload)
    case 'player_draft':
      // Pre-commit UI selection (arm / hover / board_click / stage / hand / placement_ghost) — never fight truth,
      // no fold impact. Recognized (total), state unchanged.
      return state
    default:
      return state
  }
}

/** A fresh core, re-exported for callers/tests that open a session by hand. */
export { empty_core_state, empty_inbox }
