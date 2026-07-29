// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/store_chain.js — presentation adapter for normalized results from the single core ingress.
//
// This module never decodes raw fight events or chain objects and never writes the Zustand store. It receives the
// already-ingested core atom and returns the next legacy-shaped presentation state to the store's one write door.

import { enrich_actions, sorted_tail } from './core_fold.js'
import { merge_entries, presented_state, recompute, wave_turns_of } from './fold.js'
import { actor_from_key } from './inputs.js'
import { claim_predictions, retain_budget_predictions, update_claimed_budget } from './store_prediction.js'
import { committed_health, COURTESY_EVENT_BASE, observer_ctx } from './store_state.js'

/**
 * Project a normalized receipt/journal result into prediction retirement and renderer pacing.
 *
 * Prediction claims come from the pure prediction transition module; this adapter still owns no decoder or
 * state-write door.
 */
export const reduce_chain_input = (state, msg, next_core, now) => {
  const read = next_core.last_read ?? { actions: [], changed: [] }
  const actions = enrich_actions(next_core.inbox, read.actions ?? [])
  const changed = enrich_actions(next_core.inbox, read.changed ?? [])
  const my_actor = actor_from_key(state.my_key)
  const ended_my_turn =
    !!my_actor &&
    actions.some(
      (action) =>
        action.kind === 'TurnEnded' &&
        !!action.is_mob === !!my_actor.is_mob &&
        Number(action.idx) === Number(my_actor.idx)
    )

  // Receipts and authoritative journal confirmation retire predictions by claim. Poll/p2p never do.
  const claim = msg.type === 'receipt' || msg.type === 'journal' ? claim_predictions(state, actions, now) : null
  const reconcile = claim?.result ?? null
  // Cast/Moved receipts deliberately omit their pool mutations, while a single receipt commonly ends my turn,
  // drives the mob, and starts my next turn (refilling both pools). Capture the accepted optimistic fold BEFORE
  // claim retirement, then publish it beside the live/refilled pool. No costs are recomputed here: prediction is
  // the sim/Move math seam, and a divergent claim publishes nothing rather than laundering a guess as truth.
  const resolved_fighter =
    ended_my_turn && claim && !reconcile?.divergence ? presented_state(state).fighters?.[state.my_key] : null
  const resolved_version = Math.max(Number(msg.version ?? -1), ...actions.map((action) => Number(action.version ?? -1)))
  const post_commit_budget =
    resolved_fighter?.ap != null && resolved_fighter?.mp != null
      ? {
          ...(state.post_commit_budget ?? {}),
          [state.my_key]: {
            ap: Number(resolved_fighter.ap),
            mp: Number(resolved_fighter.mp),
            version: resolved_version,
          },
        }
      : state.post_commit_budget
  let intents = Object.fromEntries(
    Object.entries(state.entries).filter(([key, entry]) => {
      if (entry.source !== 'intent') return false
      // A p2p chain preview is an early copy of canonical transport and retires once a verified receipt/journal
      // reaches its version. A `courtesy` input is instead a peer-authored draft: it has no such proof and retires
      // only through its own claim in reconcile_predictions.
      if (
        entry.chain_preview === true &&
        (msg.type === 'receipt' || msg.type === 'journal') &&
        actions.some((action) => Number(action.version) >= Number(entry.version))
      )
        return false
      return !reconcile?.retire.has(key)
    })
  )
  if (msg.type === 'p2p')
    intents = merge_entries(
      merge_entries(
        {},
        actions.map((action) => ({
          ...action,
          event_idx: COURTESY_EVENT_BASE + Number(action.event_idx ?? 0),
          source: 'intent',
          courtesy: true,
          chain_preview: true,
        }))
      ),
      Object.values(intents)
    )

  const budget_predictions = retain_budget_predictions(state.budget_predictions, reconcile)
  const canonical = sorted_tail(next_core.inbox)
  const claimed_budget = update_claimed_budget(state.claimed_budget, reconcile?.claimed, [...canonical, ...actions])

  // Renderer pacing is the explicit sibling seam. It receives already-decoded changed actions reshaped for the
  // existing beat producer; no state decoder or admission policy lives here.
  const raw_pace = changed.map(({ kind, version, event_idx, source, resolve_seat, ...data }) => ({
    type: kind,
    parsedJson: data,
  }))
  const base_seq = changed[0]?.event_idx ?? 0
  const new_turns =
    msg.type === 'receipt' && changed.length
      ? wave_turns_of(state, raw_pace, msg.version, msg.trap_cells ?? [], base_seq, committed_health(state))
      : []
  const wave = [...state.wave, ...new_turns]
  const seq_head = Number(next_core.inbox.seq_head)
  const delivered_seq = Number(next_core.inbox.delivered_seq)
  const journal_gap =
    seq_head > delivered_seq + 1 ? { fight_id: state.fight_id, from: String(Math.max(0, delivered_seq + 1)) } : null
  const protocol_fault =
    [...next_core.failures].reverse().find((failure) => failure.kind === 'hash_conflict') ?? state.protocol_fault

  return recompute(
    {
      ...state,
      core: next_core,
      accept_state: {
        head: delivered_seq >= 0 ? String(delivered_seq) : state.accept_state.head,
        digests: {},
      },
      commit_due: false,
      receipt_seq: msg.type === 'receipt' ? state.receipt_seq + 1 : state.receipt_seq,
      staged: msg.type === 'receipt' && ended_my_turn ? [] : state.staged,
      divergence: reconcile?.divergence ?? state.divergence,
      entries: merge_entries(intents, canonical),
      claimed_budget,
      budget_predictions,
      post_commit_budget,
      journal_gap,
      protocol_fault,
      wave,
      wave_seq: wave.length ? wave[wave.length - 1].seq : state.wave_seq,
    },
    now
  )
}

/**
 * Mirror an ahead snapshot that the core's one bootstrap/re-adopt door accepted. Behind/equal snapshots are
 * discarded by the core and return the identical presentation state.
 */
export const reduce_snapshot_input = (state, msg, next_core, now) => {
  if (next_core.last_read?.adopted !== true) return state

  const view = next_core.inbox.base_view
  const version = next_core.inbox.base_version
  const ctx = observer_ctx({ ...state.ctx, ...(msg.ctx ?? {}) })
  const intents = Object.fromEntries(
    Object.entries(state.entries).filter(([, entry]) => entry.source === 'intent' && Number(entry.version) > version)
  )

  return recompute(
    {
      ...state,
      core: next_core,
      view,
      view_version: version,
      entries: merge_entries(intents, sorted_tail(next_core.inbox)),
      retired: {},
      claimed_budget: (state.claimed_budget ?? []).filter(
        (row) => Number(row.claimed_at?.version ?? row.action?.version) > version
      ),
      budget_predictions: (state.budget_predictions ?? []).filter((row) => Number(row.action?.version) > version),
      ctx,
      my_key: ctx.spectator === true ? null : (next_core.my_seat ?? state.my_key),
      commit_due: false,
      wave: [],
      wave_seq: state.presented_seq,
      last_action_ms: Math.max(state.last_action_ms, Number(view?.last_action_ms ?? 0)),
    },
    now
  )
}
