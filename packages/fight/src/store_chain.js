// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/store_chain.js — presentation adapter for normalized results from the single core ingress.
//
// This module never decodes raw fight events or chain objects and never writes the Zustand store. It receives the
// already-ingested core atom and returns the next legacy-shaped presentation state to the store's one write door.

import { enrich_actions, sorted_tail } from './core_fold.js'
import { fold_chain_offset } from './draft_budget.js'
import { price_hit } from './fight_render_prims.js'
import { fold_key_entity_id, merge_entries, paced_wave_turns, presented_state, recompute } from './fold.js'
import { actor_from_key } from './inputs.js'
import { claim_predictions, retain_budget_predictions, update_claimed_budget } from './store_prediction.js'
import { committed_health, COURTESY_EVENT_BASE, observer_ctx } from './store_state.js'

/**
 * Project a normalized receipt/journal result into prediction retirement and renderer pacing.
 *
 * Prediction claims come from the pure prediction transition module; this adapter still owns no decoder or
 * state-write door.
 */
/**
 * THE CORRECTION AN ADOPTED DIVERGENCE CARRIES (#2151). My own turn is painted at the click and its
 * AUTHORITATIVE rows never become a wave turn (`wave_turns_of` filters them out — replaying them would double
 * every floater), so when the chain disagrees, nothing downstream could re-reach the history the prediction
 * wrote: the combat log kept the predicted number forever. The divergence answers that here — a REPLACEMENT
 * instruction (who, what kind, how much), never a second beat.
 *
 * It is priced through the SAME home and the SAME pre-receipt committed oracle the wave pricer uses
 * (`price_hit` + `committed_health`), which is what makes the corrected line and a peer's own line the same
 * number by construction rather than by coincidence. Non-Hit divergences carry no correction: a wrong
 * destination or a wrong drain has no optimistic amount in the history to replace.
 */
const divergence_correction = (state, divergence) => {
  const { applied_action: action, ...rest } = divergence ?? {}
  if (!divergence) return divergence
  if (action?.kind !== 'Hit') return rest
  const key = `${action.victim_is_mob ? 'm' : 'p'}${Number(action.victim_idx)}`
  const target_id = fold_key_entity_id(state.view?.escrow ?? [], key)
  if (!target_id) return rest
  const { kind, amount } = price_hit(action, committed_health(state)(target_id))
  return { ...rest, correction: { target_id, kind, amount } }
}

export const reduce_chain_input = (state, msg, next_core, now) => {
  const read = next_core.last_read ?? { actions: [], changed: [], owed: [] }
  const actions = enrich_actions(next_core.inbox, read.actions ?? [])
  const changed = enrich_actions(next_core.inbox, read.changed ?? [])
  // PRESENTATION-OWED rows (#2124) — settled for the fold, unpaid for the eye. They are enriched through the same
  // door as `changed` so their beats are byte-identical to the ones the un-raced ordering produces.
  const owed = enrich_actions(next_core.inbox, read.owed ?? [])
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

  // Renderer pacing is the explicit sibling seam. It receives the already-decoded changed actions; WHAT paces —
  // and under which chain version and entry window — is decided in ONE home off the ROWS (fold.paced_wave_turns),
  // never off this envelope: a journal batch names no chain version, and an observing seat is fed nothing else.
  // Poll/p2p stay out: a poll is a wholesale re-read of settled truth and p2p is unverified courtesy.
  const pace_opts = { trap_cells: msg.trap_cells ?? [], fighter_health: committed_health(state) }
  const paces = msg.type === 'receipt' || msg.type === 'journal'
  // The OWED segment paces first — its rows are older, and it can never share a version with the admitted ones, so
  // the two are two batches by construction. The second call paces off the seq the first allocated: `wave_seq` is
  // an IDENTITY allocator read straight off the draft, and two calls against one draft mint colliding seqs, which
  // the renderer's monotonic drain then swallows whole (the #2124 drop-point-A class, already paid for once).
  // `fold_inert` is the whole difference between the two segments: an owed turn PLAYS and holds nothing — the
  // adopted base already contains its rows, so masking, death holds and the turn gate all skip it (present.js
  // `holds_the_fold`). Without that mark a raced beat would spend the player's turn clock replaying the board.
  const owed_turns = paces
    ? paced_wave_turns(state, owed, pace_opts).map((turn) => ({ ...turn, fold_inert: true }))
    : []
  const new_turns = paces
    ? paced_wave_turns(owed_turns.length ? { ...state, wave_seq: owed_turns.at(-1).seq } : state, changed, pace_opts)
    : []
  const wave = [...state.wave, ...owed_turns, ...new_turns]
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
      // THE CHAIN CLOCK (#2099) — an OBSERVED PAIR, folded through this door like every other chain fact: the
      // page's `chain_now_ms` (the indexer's latest checkpoint timestamp) against this message's own arrival
      // instant. Absent on every other chain source (a receipt/poll/p2p carries no server clock) ⇒ unchanged.
      chain_offset_ms: fold_chain_offset(state.chain_offset_ms, msg.batch?.chain_now_ms, now),
      commit_due: false,
      receipt_seq: msg.type === 'receipt' ? state.receipt_seq + 1 : state.receipt_seq,
      staged: msg.type === 'receipt' && ended_my_turn ? [] : state.staged,
      divergence: reconcile?.divergence ? divergence_correction(state, reconcile.divergence) : state.divergence,
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
 * Mirror an ahead snapshot that the core's one bootstrap/re-adopt door accepted. A refused adoption never
 * reaches here: the store's door gates on `last_read.adopted` and publishes the refusal's typed reason on its
 * rejections channel instead (#1689), so this adapter has exactly one job and no silent branch.
 */
export const reduce_snapshot_input = (state, msg, next_core, now) => {
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
      // `wave_seq` is an IDENTITY allocator, never a count of what is pending — it does NOT rewind here (#2124).
      // The renderer's drain (world-shell/voxel_fight_adapter.js) skips `turn.seq <= last_enqueued_seq`, a
      // monotonic high-water mark that exists so a seq it has already played can never play twice; rewinding the
      // allocator minted the NEXT batch's turns on seqs it had already consumed, and a whole peer turn — cast
      // beat, combat-log line and vfx alike — was dropped in silence while the fold stayed correct (an observing
      // seat watched its partner cast nothing at all). Emptying `wave` above is the entire supersession: nothing
      // reads `wave_seq` against `presented_seq` — `presenting` reads the wave itself (project_state.js).
      last_action_ms: Math.max(state.last_action_ms, Number(view?.last_action_ms ?? 0)),
    },
    now
  )
}
