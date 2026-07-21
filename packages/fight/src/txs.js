// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/txs.js — the transaction seam: staged intents → a chain turn batch, and every authoritative receipt
// (my own commit, a liquidation, a poll catch-up) → back through the ONE input door. No fight state is written
// here — txs only STAGES drafts and PIPES receipts into `input()`; the reducer owns all state.
//
// REUSE: `stage_to_batch` / `turn_commit_key` from world-shell/turn_commit.js are generic, context-free turn
// helpers (no dungeon/kolizeum coupling) — reused verbatim. The LIVE submit
// (world-shell/dungeon_actions.js `commit_turn_batch` / `settle_and_open`) is the S2 wiring point: a thin context
// shim calls it with the fight/kiosk ids it owns, then feeds the returned receipt to `apply_receipt` — the core
// never imports the context submit itself (keeps the fight/ import graph hermetic; ares test fightcore gate a).

import { stage_to_batch, turn_submit_epoch } from './turn_commit.js'
import * as project from './project.js'

/** Stage a local intent (a click) as a pre-commit draft on the store. Optimistic prediction paints immediately
 *  via a separate `input({type:'intent'})`; staging only accumulates what the eventual PTB will carry. */
export const stage_intent = (store, intent) => store.getState().input({ type: 'stage', intent })

export const clear_staged = (store) => store.getState().input({ type: 'clear_staged' })

/**
 * Subscribe the one transaction edge to the reducer's level-triggered commit_due projection. The playable-turn
 * epoch is claimed BEFORE submit: busy is the normal in-flight suppression, while the epoch makes a rejection or
 * executed failure non-reentrant even if busy later clears before its latch/receipt feedback is observed.
 * @param {import('zustand').StoreApi<any>} store
 * @param {{ submit: () => unknown | Promise<unknown>, on_error?: (error: unknown) => void }} deps
 */
export function subscribe_commit_due(store, { submit, on_error = () => {} }) {
  const observe = () => {
    const state = store.getState()
    const epoch = turn_submit_epoch(state)
    if (!project.commit_due(state) || !epoch || state.commit_attempt_epoch === epoch) return
    state.input({ type: 'busy', value: true, attempt_epoch: epoch })
    // A reverted/failed submit leaves my optimistic prediction UNCONFIRMED — dispatch `rollback` so the reducer
    // removes exactly those predicted entries and recomputes to committed truth (B-F03: the sticky predicted
    // HP/cell/AP class the register convicts here). Rollback is NOT a retry — it never resubmits (the
    // executed-failure burn law: a digest means gas spent); the next authoritative read reconciles.
    const rollback = () => store.getState().input({ type: 'rollback' })
    try {
      Promise.resolve(submit())
        .then((result) => {
          const failed = result === false || (result != null && typeof result === 'object' && result.ok === false)
          if (!failed) return
          rollback()
          const { error = null } = result && typeof result === 'object' ? result : {}
          on_error(error ?? new Error('Turn execution failed'))
        })
        .catch((error) => {
          rollback()
          on_error(error)
        })
        .finally(() => store.getState().input({ type: 'busy', value: false }))
    } catch (error) {
      rollback()
      on_error(error)
      store.getState().input({ type: 'busy', value: false })
    }
  }
  const stop = store.subscribe(observe)
  observe(store.getState())
  return stop
}

/**
 * Subscribe the one lost-turn edge to the reducer's `turn_lost` output (a drafted turn that expired
 * uncommitted — missed/latched/burned). Fires `on_lost` ONCE per lost turn, then marks it consumed through
 * the door (`turn_lost_shown`) so a remounted subscriber can never re-toast the same loss — the same
 * reducer-owned idempotency shape as the commit edge above.
 * @param {import('zustand').StoreApi<any>} store
 * @param {{ on_lost: (lost: { key: string, reason: string }) => void }} deps
 */
export function subscribe_turn_lost(store, { on_lost }) {
  const observe = () => {
    const lost = store.getState().turn_lost
    if (!lost || lost.shown) return
    store.getState().input({ type: 'turn_lost_shown', key: lost.key })
    on_lost(lost)
  }
  const stop = store.subscribe(observe)
  observe()
  return stop
}

/** Surface each receipt-vs-prediction delta mismatch once; consumption is reducer-owned and remount-safe. */
export function subscribe_divergence(store, { on_divergence }) {
  const observe = () => {
    const { divergence } = store.getState()
    if (divergence?.kind !== 'action' || divergence.shown) return
    store.getState().input({ type: 'divergence_shown', version: divergence.version, action: divergence.action })
    on_divergence(divergence)
  }
  const stop = store.subscribe(observe)
  observe()
  return stop
}

/** Reducer-owned draft queue projected back into the board's legacy move/cast path shape. */
export const staged_turn_paths = (store) => {
  const staged = store.getState().staged ?? []
  const first_move = staged.findIndex((action) => action.kind === 0)
  const first_cast = staged.findIndex((action) => action.kind === 1 || action.kind === 2)
  return {
    move_path: staged.filter((action) => action.kind === 0).map((action) => action.target),
    cast_path: staged
      .filter((action) => action.kind === 1 || action.kind === 2)
      .map((action) => ({ cell: action.target, spell_key: action.spell_key ?? null })),
    cast_first: first_cast >= 0 && (first_move < 0 || first_cast < first_move),
  }
}

/** Turn the store's staged intents into the chain turn batch a PTB submits (reuses turn_commit's builder). */
export const build_turn_batch = (store, to_cell = null) => {
  const staged = store.getState().staged ?? []
  return stage_to_batch(staged, to_cell)
}

/**
 * LEG 0a — CAST AUTO-RETARGET ON INVALIDATION (the "cast not committed because target no longer
 * valid"). At flush a drafted cast whose target FIGHTER has moved off the drafted cell is RECOMPOSED against the
 * target's CURRENT committed cell when the spell still legally reaches it — reusing the EXACT legality the draft/
 * click gate painted (`reaches` = the caller's own cast_range_set_dungeon footprint membership: one home, never a
 * re-implementation of range/LoS). When it can't reach, the cast is DROPPED and the ONE decoder is asked for the
 * clear feedback toast (the additive i18n key, surfaced by the flush edge — the fight core is hermetic, so it
 * REQUESTS the toast, never renders it). A void cast or a still-valid target composes the drafted cell unchanged.
 * Pure: the caller resolves the drafted cast's target fighter → its committed cell (committed_state, my drafts
 * excluded — the chain base the PTB fires against), and passes the reach predicate it already owns.
 * @param {{ target_cell:number, committed_cell:number|null|undefined, reaches:(cell:number)=>boolean }} params
 * @returns {{ target:number } | { dropped:true, toast_key:string }}
 */
export const retarget_cast = ({ target_cell, committed_cell, reaches }) => {
  if (committed_cell == null || Number(committed_cell) === Number(target_cell)) return { target: Number(target_cell) }
  return reaches(Number(committed_cell))
    ? { target: Number(committed_cell) }
    : { dropped: true, toast_key: 'dungeons.cast_target_unreachable' }
}

/**
 * Feed an authoritative receipt back through the ONE door. Every submit path (my turn commit, a peer relay, a
 * liquidation crank, a poll catch-up) lands here — `source` scopes its merge priority (see store.js).
 * @param {import('zustand').StoreApi<any>} store
 * @param {any} receipt          { events: [{ type, parsedJson }] } (or a bare event array)
 * @param {{ version: number, source?: 'receipt'|'poll'|'p2p', fight_id?: string, resolve_seat?: Function }} opts
 */
export const apply_receipt = (store, receipt, { version, source = 'receipt', fight_id = null, resolve_seat = null }) =>
  store.getState().input({ type: source, receipt, version, fight_id, resolve_seat })

/** A liquidation / overdue-crank receipt is just another authoritative segment — same door, `poll` priority. */
export const apply_liquidation = (store, receipt, { version, fight_id = null, resolve_seat = null }) =>
  store.getState().input({ type: 'poll', receipt, version, fight_id, resolve_seat })

// ── THE COURTESY CHANNEL (#334) — publish/receive seam ────────────────────────────────────────────────────────
// PURE projections + one door-dispatch each: the transport (the fight-scoped Trystero room) lives in the frontend
// p2p layer and only carries these payloads — packages/fight stays promise-free (L-P4), never importing transport.

/** THE BROADCAST PAYLOAD: my drafted turn as normalized actions, read straight off the store's OWN optimistic
 *  intent entries — the SAME vocabulary the receipt/journal carry (one home, never a parallel format). Fired at
 *  the commit (the PTB submit) by the fight-room transport; a peer re-enters it via `apply_peer_batch`. The
 *  transport keys (version/event_idx/source/resolve_seat/peer) are stripped — the receiver re-keys onto its own
 *  floor. `intent_id` is stable per my turn so a re-delivery dedupes on the receiver (peer_seen). */
// The receiver assigns these — they never ride the wire (it re-keys onto its own floor, re-sources as a peer intent).
const TRANSPORT_KEYS = new Set(['version', 'event_idx', 'source', 'resolve_seat', 'peer'])
const on_wire = (entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => !TRANSPORT_KEYS.has(key)))

export const drafted_batch = (store) => {
  const s = store.getState()
  const actions = Object.values(s.entries ?? {})
    .filter((entry) => entry.source === 'intent')
    .sort((a, b) => a.version - b.version || a.event_idx - b.event_idx)
    .map(on_wire)
  return { intent_id: `${s.fight_id}:${s.my_key}:${s.my_turn_no}`, actions }
}

/** RECEIVE a peer's courtesy batch through the ONE door as a legality-gated peer prediction. `peer` is the
 *  broadcaster's on-chain CHARACTER (the door resolves its seat on MY roster — a spoofed actor fails the gate). */
export const apply_peer_batch = (store, { peer, intent_id, actions, fight_id = null, resolve_seat = null }) =>
  store.getState().input({
    type: 'peer_predicted',
    peer,
    intent_id,
    actions,
    fight_id,
    resolve_seat,
    basis_version: store.getState().applied_version + 1,
  })

/** Surface the ILLEGAL-PEER flag once (reducer-owned consume, remount-safe) — the toast + game-log edge. The
 *  same shape as subscribe_turn_lost / subscribe_divergence: observe → mark shown through the door → notify. */
export function subscribe_peer_flag(store, { on_flag }) {
  const observe = () => {
    const { flagged } = store.getState()
    if (!flagged || flagged.shown) return
    store.getState().input({ type: 'flagged_shown', at: flagged.at })
    on_flag(flagged)
  }
  const stop = store.subscribe(observe)
  observe()
  return stop
}
