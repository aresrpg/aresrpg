// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// core_fold.js — §② THE FOLD: TOTAL and UNCONDITIONAL. The committed observable state is a
// pure re-fold of the snapshot base + the sorted admitted log — nothing gates it. There is NO readiness flag, render
// ack, animation condition, or optional signal anywhere in this module's inputs or outputs; the ONLY wait that
// exists is the explicit next-coordinate gap in the inbox (a buffered future row), and even then earlier rows still
// reduce. `state = base ⊕ fold(tail)` — the design's core identity, restated pure for the headless core.
//
// ── THE VOCABULARY DECISION (step-0 finding, decided + documented — the judgment this build was asked to make) ──
// The consensus §4 names `apply_canonical_event` (the sim evolver) as the "chain-shared canonical evolver" both the
// prediction and the chain truth would fold through. Step 0 revealed the two do NOT share an event vocabulary:
//   · the sim evolver `apply_canonical_event` consumes the sim's OWN emission set — `fight_moved` (a PATH),
//     `fight_cast` (an `effects[]` array bundling every hit/push), `fight_turn_start`, … — and evolves an
//     ObservableState of {cell, health, alive, active_id, winner} and NOTHING more.
//   · the chain journal / the capsules carry the FLAT event vocabulary — `Moved` (a to_cell), separate `Cast`,
//     `Hit`, `Displaced`, `MobMoved`, `Placed`, `TurnStarted`, `Tackled`, `Drain`/`Granted`, … — folded by the
//     production-proven `apply_action` (inputs.js) into a committed state that ALSO carries ap · mp · ready ·
//     invisible — the exact fields the desync capsules turn on.
// The evolver's ObservableState is therefore STRICTLY WEAKER than the capsules need to replay (it has no ap/mp/
// ready/invisible), and its event vocabulary would require a lossy multi-event assembly (buffer a `Cast`, gather the
// trailing `Hit`/`Displaced` into a synthetic `effects[]`) that inputs.js's own law forbids ("the client never
// re-guesses events"). So:
//   THE CHAIN FOLD CONSUMES THE CAPSULES' FLAT CHAIN VOCABULARY THROUGH `apply_action` (consumed, never forked).
//   `apply_canonical_event` REMAINS THE PREDICTION-SIDE TWIN (the sim's leaf-side fold of its own emissions); the two
//   meet at the OBSERVABLE PROJECTION (positions · health · liveness · turn · winner) — the twin contract the CI
//   coherence property already pins — NOT at a shared event fold. One observable, two folders.
// The newer chain ActionStarted/ActionEffect/ActionResolved envelope model IS present in the corpus (the receipt
// stream), but it carries no observable-board delta the flat Cast/Hit/Moved/Displaced rows do not already carry, so
// `apply_action` treats it as a no-op (its `default` arm). Adapter NOTE, not an implementation — exactly as the
// brief scoped it.
//
// PURE, NO THROW. `base_from_view` + `apply_action` are the existing homes; this module only composes them over the
// inbox, attaching the current seat resolver at fold time (never baked stale into the log).

import { apply_action, empty_state, fighter_key } from './inputs.js'
import { base_from_view, base_budget } from './fold.js'
import { inbox_resolver } from './core_inbox.js'

/** The rows that close a cast's effect segment — anything past one belongs to another action. */
const SEGMENT_END = new Set(['Cast', 'TurnStarted', 'TurnEnded'])

/**
 * The indices of the Cast rows whose segment hits somebody other than their caster. A DERIVATION over the ordered
 * event stream, not a property of the Cast row: the chain emits no reveal event, so `apply_action` mirrors
 * `statuses::reveal` off this mark (inputs.js). It lives HERE, with the fold's other derivations, because a
 * derivation baked into an admitted log row gets hashed as chain content and makes one row's two transport twins
 * conflict (#1700) — and because the fold sees the whole ordered tail, not one delivery window.
 * @param {Array<Record<string, any>>} actions in coordinate order
 * @returns {Set<number>}
 */
const damaging_casts = (actions) => {
  const marked = new Set()
  actions.forEach((action, index) => {
    if (action.kind !== 'Cast') return
    const caster = fighter_key({ is_mob: action.caster_is_mob, idx: action.caster_idx })
    for (let ahead = index + 1; ahead < actions.length; ahead++) {
      const row = actions[ahead]
      if (SEGMENT_END.has(row.kind)) break
      if (row.kind !== 'Hit') continue
      if (fighter_key({ is_mob: row.victim_is_mob, idx: row.victim_idx }) !== caster) {
        marked.add(index)
        break
      }
    }
  })
  return marked
}

/** The sorted authoritative tail: every admitted log action above the snapshot base, in coordinate order, with the
 *  derived enrichment attached at FOLD time (never baked into the log, where it would ride the content hash): the
 *  CURRENT seat resolver (character-keyed events resolve against the live base view), the deterministic
 *  turn-start budget (a player `TurnStarted` carries no ap/mp — the begin_turn refill is predicted from the base
 *  view's escrow, exactly as V1 injects it, so the projected budget is not the stale pre-refill snapshot), and the
 *  `damaging` mark that drives the invisibility reveal. */
export const enrich_actions = (inbox, actions) => {
  const resolve_seat = inbox_resolver(inbox)
  const budget_of = base_budget(inbox.base_view)
  const damaging = damaging_casts(actions)
  const enrich = (action, index) => {
    const marked = damaging.has(index) ? { damaging: true } : {}
    if (action.kind !== 'TurnStarted' || action.is_mob || action.ap != null)
      return { ...action, ...marked, resolve_seat }
    const budget = budget_of(Number(action.idx))
    return budget ? { ...action, resolve_seat, ap: budget.ap, mp: budget.mp } : { ...action, resolve_seat }
  }
  return actions.map(enrich)
}

export const sorted_tail = (inbox) =>
  enrich_actions(
    inbox,
    Object.values(inbox.log)
      .filter((action) => Number(action.version) > inbox.base_version)
      .sort((a, b) => a.version - b.version || a.event_idx - b.event_idx)
  )

/**
 * canonical_base — the snapshot half of the canonical fold (issue #549: the ONE home for this fact — project.js's
 * board/presentation projections share it rather than re-deriving their own). `fight_id` comes ONLY from the
 * adopted snapshot's own id, never from an external caller: before the first snapshot lands there IS no known
 * base identity yet, whatever the session/caller already knows — this is the corpus-proven behavior (9,829
 * replayed envelopes), pinned by `test/core_fold.test.js`.
 * @param {import('./core_state.js').InboxState} inbox
 * @returns {ReturnType<typeof empty_state>}
 */
export const canonical_base = (inbox) =>
  inbox.base_view ? base_from_view(inbox.base_view, inbox.base_view.id) : empty_state(null)

/**
 * fold_canonical — the committed chain truth: the snapshot base with the sorted admitted tail folded on top through
 * `apply_action`. Total and unconditional (every admitted row reduces; nothing waits on presentation). Intents are
 * NOT here — canonical is chain-only (the ledger's forecast folds them separately, §③). THE single fold (issue
 * #549) — project.js's board/presentation projections fold through this, never a second private implementation.
 * @param {import('./core_state.js').InboxState} inbox
 * @returns {ReturnType<typeof empty_state>} the committed observable state (fighters · active · phase · winner)
 */
export const fold_canonical = (inbox) => sorted_tail(inbox).reduce(apply_action, canonical_base(inbox))
