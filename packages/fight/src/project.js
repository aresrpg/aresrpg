// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/project.js — the stable public projection surface. State selectors and legacy-shaped views live in
// cohesive pure helpers; render-contract decisions remain here. Consumers read this module and never fold state.

import { tackle_contest, tackle_losses } from '@aresrpg/sim/fight_tackle'
import { tackle_seed, turn_seed } from '@aresrpg/sim/turn_seed'
import { rng_next, rng_seed } from '@aresrpg/sim/prng'

import { GRID_W, GRID_H, decode as decode_xy, encode as encode_xy } from './los.js'
import { presented_reachable_cells } from './movement_candidates.js'
import { committed_truth, fight_store, presented_state } from './store.js'
import { cast_presenting } from './project_state.js'
import { engine_view, entity_id_of_key, input_armed, my_action_slot, project_board_cells } from './project_views.js'
import { next_action_slot } from './turn_action_slot.js'

export * from './project_state.js'
export { mob_entity_id, mob_entity_index } from './fight_control.js'
export {
  board_view,
  committed_mob_hp,
  engine_view,
  entity_id_of_key,
  fight_visible_view,
  // THE ROSTER IDENTITY BOOK (#1993 WP3) — the one id-keyed home for fight-visible identity, plus the one label
  // rule (`name ?? display_id`) and the one short-id shape. Every consumer reaches identity through here.
  identity_book,
  identity_label,
  short_display_id,
  // THE END-TURN PRESS LAW moved next to the projections it gates (#1993 train 0 — `fight_visible_view.turn`
  // calls the one home instead of re-deriving it). Re-exported verbatim: every importer reads them from here.
  input_armed,
  // THE NEXT ACTION SLOT (#1993 doors) moved beside the record it now IS — `fight_visible_view.controls
  // .action_slot` — so a React surface reads the slot through a door instead of a raw-core selector. Still the
  // ONE derivation (#1224); re-exported verbatim for the non-React callers (the dev bot's `ahead` bank).
  my_action_slot,
  turn_input_armed,
} from './project_views.js'
export { read_fight_traps } from './trap_ledger.js'

// One memoized synchronous surface shared by every consumer.
const VIEWS = new WeakMap()

/** Memoized engine_view of a core state — the selector consumers subscribe with. */
export const engine_view_of = (s) => {
  if (!VIEWS.has(s)) VIEWS.set(s, engine_view(s))
  return VIEWS.get(s)
}

/** The live fight view — synchronous core truth, never a lagging copy. */
export const fight_view = () => engine_view_of(fight_store.getState())

// ── M3 RENDER-CONTRACT PROJECTIONS (D768/D769 clause 3: the renderer consumes {object, timing} and computes
//    NOTHING — every which-cells / may-I-input DECISION below moved here from the board adapter) ─────────────

/** Encoded orthogonal neighbours of an encoded cell, row-safe (never wraps an edge column). */
const neighbors_of = (cell) => {
  const { x, y } = decode_xy(cell) ?? { x: 0, y: 0 }
  const out = []
  if (x > 0) out.push(encode_xy(x - 1, y))
  if (x < GRID_W - 1) out.push(encode_xy(x + 1, y))
  if (y > 0) out.push(encode_xy(x, y - 1))
  if (y < GRID_H - 1) out.push(encode_xy(x, y + 1))
  return out
}

/** Legacy first-kind classification retained for compatibility diagnostics. The #398 commit path no longer
 *  groups on this value: `commit_turn_ptb` executes the staged sequence exactly. */
export const draft_cast_first = (log) => {
  const first = (kind) =>
    Math.min(
      Infinity,
      ...(log ?? [])
        .filter((e) => e.source === 'intent' && (e.kind === kind || (kind === 'Cast' && e.kind === 'CastAnchor')))
        .map((e) => e.event_idx)
    )
  return first('Cast') <= first('Moved')
}

/** THE TACKLE ZONE SCAN (chain twin — tackle.move locker_agilities): the agilities of every living enemy
 *  orthogonally adjacent to ME at the eye's fold. Enemies of a seat = every living mob ∪ every living
 *  OTHER-team seat (PvP). Death exempts a tackler; invisibility does NOT (bodies stay physical — the chain
 *  rule, verbatim). Agility rides the view rows (board_state escrow/mob `agility`, the raw chain stats).
 *  #398: the NEXT move is appended after the entire current draft prefix, so both the runner and its enemies read
 *  the presented prefix. A preceding push/death has already resolved; a later action does not exist yet. */
const tackle_lockers = (s, me, my_team) => {
  const enemies = presented_state(s)
  const adjacent = new Set(neighbors_of(me.cell))
  const lockers = []
  for (const f of Object.values(enemies.fighters ?? {})) {
    if (f.key === s.my_key || !f.alive || f.cell == null || !adjacent.has(f.cell)) continue
    const idx = Number(String(f.key).slice(1))
    if (f.is_mob) lockers.push(Number(s.view.mobs?.[idx]?.agility ?? 0))
    else if (Number(s.view.escrow?.[idx]?.team ?? 0) !== my_team)
      lockers.push(Number(s.view.escrow?.[idx]?.agility ?? 0))
  }
  return lockers
}

const my_next_move_slot = (s, seat, row) => next_action_slot({ base: row.casts_this_turn, events: s.log, seat })

/** The presentation-truth blocked set for movement: board terrain (obstacles ∪ holes ∪ out-of-shape) plus every
 *  OTHER living presented body — the same truth the committed move charges, at the eye's fold. */
const wash_blocked = (view, p, my_key) => {
  const cells = project_board_cells(view)
  const blocked = new Set()
  for (let i = 0; i < cells.length; i++) if (cells[i]) blocked.add(i)
  for (const f of Object.values(p.fighters ?? {}))
    if (f.key !== my_key && f.alive && f.cell != null) blocked.add(f.cell)
  return blocked
}

/** ONE deterministic tackle roll — the chain twin of actions.move: spell_formula::tackle_seed(turn_seed, slot,
 *  live mp) → prng::rng_next → the move ESCAPES iff draw % den < num. Returns the pool forfeit fight_tackle
 *  strips on a FAILED escape (tackle_losses, golden-pinned), or null when the roll escapes. Pure; the SINGLE
 *  home for the roll+loss contest — both `move_wash` (reads mp_lost to bound the green band) and
 *  `next_move_tackle` (reads both pools) call it exactly ONCE per move, because the chain rolls exactly once
 *  per move. No copy: the sim primitives compose here and nowhere else. */
const tackle_roll = (tseed, slot, mp, ap, num, den) => {
  const draw = rng_next(rng_seed(tackle_seed(tseed, slot, mp))).value
  if (draw % den < num) return null // this roll escapes — the move walks free
  return tackle_losses(ap, mp, num, den)
}

/**
 * THE MOVE WASH — the which-cells decision for the board's movement paint, in the core (M3; the adapter maps
 * encoded → {x,y} and calls set_cell_state, deciding nothing).
 *
 * TACKLE LAW: the tackle-lost band shows ONLY while ACTUALLY tackled, covers ONLY "the MP
 * we can't spend or WILL loose by trying", respects max range (green ∪ band = the live-MP reach — the full
 * range is always DESCRIBED, never truncated away, #1659), and NEVER
 * triggers on plain MP spending. A PLAYER move's contest is DETERMINISTIC + PREVIEWABLE (actions.move:
 * tackle_seed(turn_seed, casts_this_turn, live mp) — the golden-pinned sim mirror), so "actually tackled" is
 * a FACT, not a probability: the wash PREVIEWS the exact roll — an escaping roll paints NO band
 * (the move walks free, exactly as the chain will resolve it); a failing one strips ceil(mp·lost/den) ≥ 1 MP
 * and the green band is the reach of what SURVIVES the toll (#239), which is exactly what the chain walks.
 * A view without world_seed/spawn_id (legacy/partial read) can't derive the roll — it keeps the fraction
 * risk-band as the honest degraded paint.
 *
 * `targeting` is an edge input: an AFFORDABLE armed spell puts the board in cast mode (the blue ranges own it)
 * — its truth needs the frontend seed row (AP cost), unavailable core-side; the adapter passes the verdict of
 * its existing pure fold (wash_armed_spell). `busy` = the run store's single-flight flag (see input_armed).
 *
 * @param {any} s the fight store state
 * @param {{ busy?: boolean, targeting?: boolean }} [edge]
 * @returns {{ armed: boolean, tackled: boolean, reach: number[], tackle_lost: number[] }} encoded cell arrays:
 *   `reach` = green (what the first ESCAPING attempt still reaches), `tackle_lost` = light red (the remainder).
 */
export const move_wash = (s, { busy = false, targeting = false } = {}) => {
  // RULING 2026-07-19 (misclick-to-move guard): MY OWN cast/weapon-strike VFX disarms the wash too — see
  // cast_presenting's doc for why this is narrower than `draining` and orthogonal to `presenting`/`input_armed`.
  const armed = input_armed(s, { busy }) && !cast_presenting(s)
  if (!armed || targeting || !s.view) return { armed, tackled: false, reach: [], tackle_lost: [] }
  const p = presented_state(s)
  const me = p.fighters?.[s.my_key]
  const seat = Number(String(s.my_key ?? '').slice(1))
  const row = s.view.escrow?.[seat]
  if (!me || me.cell == null || !row) return { armed, tackled: false, reach: [], tackle_lost: [] }
  const blocked = wash_blocked(s.view, p, s.my_key)
  // The presented pool is the exact ordered prefix. Any drafted grant it contains ran before the NEXT move; any
  // earlier move cost/tackle forfeit is already subtracted. No first-kind regrouping is legal here.
  const mp = Math.max(0, Math.floor(me.mp ?? 0))
  const reach_full = presented_reachable_cells({
    start: me.cell,
    movement_points: mp,
    blocked,
  })
  const lockers = tackle_lockers(s, me, Number(row.team ?? 0))
  if (!lockers.length) return { armed, tackled: false, reach: reach_full, tackle_lost: [] }
  // THE EXACT CONTEST (sim fight_tackle == spell_formula.move, golden-pinned): num/den prices the escape;
  // num == den (dodge ≥ 2·lock) escapes every roll — the certain-escape case falls out of the uniform rule.
  const { num, den } = tackle_contest(Number(row.agility ?? 0), lockers)
  const ap = Math.max(0, Math.floor(me.ap ?? 0))
  const free = { armed, tackled: false, reach: reach_full, tackle_lost: [] }
  const { world_seed, spawn_id } = s.view
  // THE CHAIN turn-seed inputs, read off the VIEW only. `s.turn_ordinal` is a different fact under the same
  // name — the core fold's turn ANCHOR token (a string) — so the old `s.X ?? view.X` fallback would seed the
  // preview with the anchor and diverge from the chain. One home for the seed inputs: the decoded Fight.
  const { turn_ordinal, turn_entropy } = s.view
  if (world_seed != null && spawn_id != null && turn_ordinal) {
    // EXACT PREVIEW (the chain twin, byte-for-byte): ONE contest per move via the shared roll. #239 made the
    // tackle a TOLL — a failed escape taxes both pools and the move then WALKS what survives — so there is no
    // failure chain left to fold: the chain's `actions::apply_move` rolls once and caps the route at the
    // post-toll pool, and this is the same arithmetic. Only mp_lost bounds the reach (ap_lost is the
    // EXECUTION's forfeit, not the paint's — so no ap thread here).
    const tseed = turn_seed({ world_seed, spawn_id, turn_entropy, turn_ordinal, seat })
    const slot = my_next_move_slot(s, seat, row)
    const bite = tackle_roll(tseed, slot, mp, ap, num, den)
    if (!bite) return free // the next move walks free — NO red (the "red then walked free" killer)
    const mp_now = Math.max(0, mp - bite.mp_lost)
    const keep = new Set(
      presented_reachable_cells({
        start: me.cell,
        movement_points: mp_now,
        blocked,
      })
    )
    return {
      armed,
      tackled: true,
      reach: reach_full.filter((c) => keep.has(c)),
      tackle_lost: reach_full.filter((c) => !keep.has(c)),
    }
  }
  // DEGRADED (seed-less view): the fraction risk-band — one failed escape's bite as the at-risk remainder.
  const { mp_lost } = tackle_losses(ap, mp, num, den)
  if (!(mp_lost > 0)) return free
  const keep = new Set(
    presented_reachable_cells({
      start: me.cell,
      movement_points: Math.max(0, mp - mp_lost),
      blocked,
    })
  )
  return {
    armed,
    tackled: true,
    reach: reach_full.filter((c) => keep.has(c)),
    tackle_lost: reach_full.filter((c) => !keep.has(c)),
  }
}

/**
 * THE MOVE'S TACKLE — the deterministic forfeit MY next move's escape roll WILL take, or null when the move
 * walks free (no living enemy locks me, the roll escapes, I have no MP to spend, or a seed-less view can't
 * derive the roll — then the receipt rules). The chain twin of ONE actions.move roll, the SAME contest
 * move_wash previews, EXPOSED so the optimistic execution obeys the tackle law. Tackles are deterministic, so
 * this is a FACT about the next move, and #239 makes it a TOLL: a bitten move still walks, but only as far as
 * `mp − mp_lost` buys. The client folds this forfeit AND the truncated walk, which is exactly the sim's
 * `apply_move` resolution — so the receipt confirms rather than corrects. Shares `tackle_roll`.
 * @param {any} s the fight store state @returns {{ ap_lost: number, mp_lost: number } | null}
 */
export const next_move_tackle = (s) => {
  if (!s?.view || !s.my_key) return null
  const p = presented_state(s)
  const me = p.fighters?.[s.my_key]
  const seat = Number(String(s.my_key ?? '').slice(1))
  const row = s.view.escrow?.[seat]
  if (!me || me.cell == null || !row) return null
  const mp = Math.max(0, Math.floor(me.mp ?? 0))
  if (mp <= 0) return null // no MP ⇒ no move ⇒ no contest
  const lockers = tackle_lockers(s, me, Number(row.team ?? 0))
  if (!lockers.length) return null // not tackled ⇒ the move walks free
  const { world_seed, spawn_id } = s.view
  // THE CHAIN turn-seed inputs, read off the VIEW only. `s.turn_ordinal` is a different fact under the same
  // name — the core fold's turn ANCHOR token (a string) — so the old `s.X ?? view.X` fallback would seed the
  // preview with the anchor and diverge from the chain. One home for the seed inputs: the decoded Fight.
  const { turn_ordinal, turn_entropy } = s.view
  if (world_seed == null || spawn_id == null || !turn_ordinal) return null // seed-less ⇒ the receipt rules
  const { num, den } = tackle_contest(Number(row.agility ?? 0), lockers)
  const ap = Math.max(0, Math.floor(me.ap ?? 0))
  const tseed = turn_seed({ world_seed, spawn_id, turn_entropy, turn_ordinal, seat })
  const slot = my_next_move_slot(s, seat, row)
  return tackle_roll(tseed, slot, mp, ap, num, den)
}

/**
 * MY SEAT'S DECLARED PLACEMENT BAND — the ONE home for "which start cells are mine". The chain declares both
 * zones (`placement_cells` is keyed BY TEAM, #1093) and a seat is NOT always team 0: a PvP/Kolizeum seat sits on
 * team 1, so every reader must resolve the band through its OWN seat. Reading `[0]` unconditionally reports an
 * EMPTY band to a team-1 seat, which is indistinguishable from "the board never rendered" — a probe that does it
 * lies about the very symptom it was built to witness (#1645). Empty when there is no seat / no placement zone.
 * @param {any} view an engine view @returns {{ x: number, y: number }[]}
 */
export const my_placement_zone = (view) => {
  const me = view?.my_entity_id ? view.fighters?.get(view.my_entity_id) : null
  return me ? (view.placement_cells?.[me.team] ?? []) : []
}

/**
 * PLACEMENT CLICK LEGALITY — the pick-vs-deny decision for a placement-phase board click (M3: moved from the
 * adapter's cell_click; the adapter relays 'pick' → the local pick stash and renders 'deny' as pulse+sfx+nudge).
 * 'pick' = a FREE start cell of MY team (my own current cell re-picks); 'deny' = off-zone or taken; null = not
 * a placement fight / no seat (the relay does nothing).
 * @param {any} s the fight store state @param {{ x: number, y: number }} cell
 * @returns {'pick' | 'deny' | null}
 */
export const placement_click = (s, cell) => {
  const view = engine_view_of(s)
  if (!view || !view.placement || view.winner !== -1 || !cell) return null
  const me = view.my_entity_id ? view.fighters.get(view.my_entity_id) : null
  if (!me) return null
  const on_zone = my_placement_zone(view).some((c) => c.x === cell.x && c.y === cell.y)
  if (!on_zone) return 'deny'
  for (const [key, fighter] of Object.entries(committed_truth(s).fighters ?? {})) {
    if (fighter.alive === false || entity_id_of_key(s.view, key) === me.id || fighter.cell == null) continue
    const occupied = decode_xy(fighter.cell)
    if (occupied.x === cell.x && occupied.y === cell.y) return 'deny'
  }
  return 'pick'
}
