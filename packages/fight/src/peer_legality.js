// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/peer_legality.js — the COURTESY CHANNEL's legality gate (#334). A peer's committed draft, relayed real-
// time over the mesh, is a PREDICTION on my board (source 'intent' → excluded from committed truth, retired by
// the canonical receipt's claim, #308) — so it costs LATENCY, never correctness. But a prediction still paints,
// so an INJECTED illegal action must never reach the eye: this pure gate REDUCES the peer's batch over MY
// committed state with the SAME spatial primitive the local draft/chain use (`bfsPathCost` — the verbatim port
// of combat_grid::bfs_path_cost, los.js), and a batch that could not legally be that fighter's turn is DROPPED
// and FLAGGED, never painted. PURE: no store, no transport, no promises (L-P4) — the store's ONE door calls it.
//
// WHAT IT GATES (robust, timing-independent — reads only committed positions + the turn-start budget):
//   · the actor is a LIVING player fighter present on my committed board (a dead/absent author can't act),
//   · every Moved is the actor's OWN move (a peer authoring ANOTHER fighter's move is a spoof) AND reachable
//     within the actor's cumulative turn-start MP (the over-budget teleport — the owner's "illegal moves"),
//   · every Cast is by the actor (a peer authoring another's cast is a spoof); a mob-move in a player turn is a spoof.
// WHAT IT DOESN'T (by design): a cast's damage/range needs the private spell corpus the receiver never holds —
// its EFFECTS (Hit/Displaced/Drain/…) ride as presentation and the authoritative receipt is their correctness.
// The source:'intent' exclusion is the STRUCTURAL guarantee underneath: even an un-gated effect never touches
// committed truth, targeting, or victory — the gate is the eye's first line, not the correctness boundary.

import { GRID_CELLS, bfsPathCost } from './los.js'
import { actor_from_key } from './inputs.js'

/** character id → its `p{seat}` key on MY roster (chain-consistent: seat order is the shared Fight object). */
const seat_key = (character, resolve_seat) => {
  const seat = character != null && resolve_seat ? resolve_seat(character) : null
  return seat == null ? null : `p${seat}`
}

/**
 * Verdict on a peer's relayed draft batch against my committed state.
 * @param {object} params
 * @param {{ fighters?: Record<string, { cell:number, alive:boolean }>, active?: string|null }} params.committed
 * @param {{ escrow?: Array<{ base_mp?: number|null }>, obstacles?: number[], holes?: number[] }|null} params.view
 * @param {string|null} params.actor_key   the peer's `p{seat}` on MY roster (resolved from its character)
 * @param {Array<object>} params.actions   the peer's normalized actions (receipt/journal vocabulary)
 * @param {((character:string)=>number|null)|null} [params.resolve_seat]
 * @returns {{ legal: true } | { legal: false, reason: string }}
 */
export const peer_batch_legality = ({ committed, view, actor_key, actions = [], resolve_seat = null }) => {
  const actor = actor_from_key(actor_key)
  if (!actor || actor.is_mob) return { legal: false, reason: 'no_actor' }
  const me = committed?.fighters?.[actor_key]
  if (!me || me.alive === false || me.cell == null) return { legal: false, reason: 'dead_or_absent_actor' }
  // Blocked = every OTHER living body + terrain; the actor's own cell is its origin, never a blocker.
  const blocked = new Set()
  for (const [key, fighter] of Object.entries(committed.fighters ?? {}))
    if (key !== actor_key && fighter.alive !== false && fighter.cell != null) blocked.add(Number(fighter.cell))
  for (const cell of view?.obstacles ?? []) blocked.add(Number(cell))
  for (const cell of view?.holes ?? []) blocked.add(Number(cell))
  // The LEGAL MP ceiling is the turn-start REFILL (escrow base_mp — one home, fold.base_budget), NOT the committed
  // pool (a stale pre-refill leftover until the turn commits, #14). Unknown budget ⇒ reachability only (never
  // false-flag an honest move for a datum I lack): GRID_CELLS is larger than any real path.
  const base_mp = Number(view?.escrow?.[actor.idx]?.base_mp)
  let remaining = Number.isFinite(base_mp) ? base_mp : GRID_CELLS
  let cell = Number(me.cell)
  for (const action of actions) {
    if (action?.kind === 'MobMoved') return { legal: false, reason: 'mob_move_in_player_turn' }
    if (action?.kind === 'Moved') {
      if (seat_key(action.character, resolve_seat) !== actor_key) return { legal: false, reason: 'spoofed_mover' }
      const to = Number(action.to_cell)
      const cost = bfsPathCost(cell, to, blocked, remaining) // GRID_CELLS ⇒ unreachable OR over the remaining budget
      if (cost >= GRID_CELLS) return { legal: false, reason: 'over_budget_move' }
      remaining -= cost
      cell = to
    } else if (action?.kind === 'Cast') {
      if (!!action.caster_is_mob !== !!actor.is_mob || Number(action.caster_idx) !== Number(actor.idx))
        return { legal: false, reason: 'spoofed_caster' }
    }
  }
  return { legal: true }
}
