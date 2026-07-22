// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// v2/intents.js — §③ INTENTS + FORECAST (Fight V2 build step 2). The intent ledger (codex's model, consensus §2)
// and the derivation it drives: PREDICTION IS NOT STATE. The forecast is a pure twin-reduce of the ACTIVE intents on
// top of canonical truth; any relevant change rebuilds the WHOLE scenario. There is NO per-effect rollback and NO
// persistent overlay type anywhere — a refusal deactivates the intent and the forecast rebuilds from scratch.
//
// THE LEDGER. Each intent is one optimistic commit, carried through a lifecycle:
//   draft → queued → submitted → observed | refused | stale
// `effect_id` (the commit's `intent_id`) is the IDEMPOTENCE key: the same effect re-arriving folds ONCE (an upsert,
// not a second row). ACTIVE = {queued, submitted} (these fold into the forecast); observed/refused/stale are inert.
// A verified receipt at/past an intent's basis marks it `observed` and it leaves the forecast (the chain now carries
// that truth); a read that jumps the floor without a confirming receipt marks it `stale`; a rollback/refusal marks
// it `refused`. All three are "deactivate + rebuild", never a targeted un-apply.
//
// THE FORECAST is the SAME `apply_action` fold as canonical (the twin: prediction and truth are one math) — the
// active intents' chain-shaped actions reduced onto the committed base. Its resolver is attached at fold time, so a
// character-keyed intent resolves against the LIVE view, never a stale one.
//
// PURE, NO THROW. Intents arrive already normalized to chain-shaped pure-data actions (the door calls
// `normalize_intent`); this module only keeps the ledger and folds the active set.

import { apply_action } from '../inputs.js'

import { inbox_resolver } from './inbox.js'

const ACTIVE = new Set(['queued', 'submitted'])

/** The active intents — the ones that fold into the forecast (a pure derivation, never stored). */
export const active_intents = (ledger) => ledger.filter((intent) => ACTIVE.has(intent.status))

/**
 * Upsert an intent into the ledger by `effect_id` (idempotence): a re-armed effect replaces its row rather than
 * doubling it; an effect_id-less commit (a bare click) appends. Fresh rows enter `queued`. Pure.
 * @param {import('./state.js').Intent[]} ledger
 * @param {{ effect_id: string|null, basis_version: number, actions: Array<Record<string, any>> }} row
 * @returns {import('./state.js').Intent[]}
 */
export const queue_intent = (ledger, { effect_id, basis_version, actions }) => {
  const fresh = { effect_id: effect_id ?? null, status: 'queued', basis_version: Number(basis_version) || 0, actions }
  if (effect_id == null) return [...ledger, fresh]
  const at = ledger.findIndex((intent) => intent.effect_id === effect_id)
  if (at < 0) return [...ledger, fresh]
  return ledger.map((intent, i) =>
    i === at ? { ...fresh, status: intent.status === 'submitted' ? 'submitted' : 'queued' } : intent
  )
}

/** Advance every still-active `queued` intent to `submitted` — the tx left the client (tx_submitted). Pure. */
export const mark_submitted = (ledger) =>
  ledger.map((intent) => (intent.status === 'queued' ? { ...intent, status: 'submitted' } : intent))

/**
 * Deactivate intents as `refused` — a reverted/failed tx or an explicit rollback. `match` selects rows (by
 * effect_id, by predicted cells, or all active when the rollback names nothing — the whole optimistic turn). Only
 * ACTIVE rows flip; an already-resolved intent is immutable. Pure.
 * @param {import('./state.js').Intent[]} ledger
 * @param {(intent: import('./state.js').Intent) => boolean} match
 */
export const refuse_intents = (ledger, match) =>
  ledger.map((intent) => (ACTIVE.has(intent.status) && match(intent) ? { ...intent, status: 'refused' } : intent))

/**
 * Resolve intents the chain has now spoken past: every ACTIVE intent whose basis is at/below the newly-advanced
 * truth `version` leaves the forecast. A RECEIPT advance (my own tx proof) marks them `observed`; a snapshot/poll
 * advance that jumped the floor marks them `stale`. Both deactivate + let the forecast rebuild whole. Pure.
 * @param {import('./state.js').Intent[]} ledger
 * @param {number} version the truth version just reached
 * @param {'observed'|'stale'} how
 */
export const resolve_intents = (ledger, version, how) =>
  ledger.map((intent) =>
    ACTIVE.has(intent.status) && intent.basis_version <= Number(version) ? { ...intent, status: how } : intent
  )

/**
 * fold_forecast — the predicted scenario: canonical truth with every ACTIVE intent's actions folded on top through
 * the SAME `apply_action` reducer (recompute-whole; no overlay). The resolver comes from the live base view.
 * @param {ReturnType<typeof apply_action>} canonical the committed chain-truth state (fold_canonical output)
 * @param {import('./state.js').Intent[]} ledger
 * @param {import('./state.js').InboxState} inbox for the current seat resolver
 * @returns {ReturnType<typeof apply_action>} the forecast state (canonical when no intent is active)
 */
export const fold_forecast = (canonical, ledger, inbox) => {
  const resolve_seat = inbox_resolver(inbox)
  const actions = active_intents(ledger)
    .flatMap((intent) => intent.actions)
    .map((action) => ({ ...action, resolve_seat }))
  return actions.reduce(apply_action, canonical)
}

/** Prune the inert tail so the ledger cannot grow without bound across a long session — observed/refused/stale rows
 *  carry no forecast weight, and once truth has advanced a full version past them they are also beyond any late
 *  correlation, so they are dropped. Kept generous (nothing at/above the live floor is touched). Pure. */
export const compact_ledger = (ledger, floor_version) =>
  ledger.filter((intent) => ACTIVE.has(intent.status) || intent.basis_version >= Number(floor_version))
