// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// bot/read.js — the SHARED VOCABULARY of the scripted fight bot (#1100): the pure derivations both the
// policy (what to do) and the assertions (did it happen) take over ONE `__ARES_DEV_READ()` snapshot.
//
// It re-implements NOTHING. Range/LoS/linearity/free-cell legality is `@aresrpg/sim/spell_targeting`'s
// `can_target` — the SIM's own gate, the twin the chain enforces — and pathing is `los.js`'s BFS, the
// byte-identical `combat_grid::bfs_path_cost` port the board already draws with. A bot that judged
// legality by its own rules would fail on exactly the divergences it exists to catch.

import { effect_hits, can_target } from '@aresrpg/sim/spell_targeting'

import { bfsPathCost, bfsReachable, decode, encode } from '../los.js'
import { entity_id_of_key } from '../project_views.js'

/**
 * THE RESULT-FOLD READ (#2044) — the fight's committed truth AFTER its last enemy fell, in the same shape
 * `__ARES_DEV_READ()` publishes so every assertion reads one vocabulary.
 *
 * A fight-ending cast cannot be graded off the live roster: the fight is over, `fight_view()` is null, and the
 * seam's post-commit read carries no fighters at all. The COMMITTED FOLD outlives the view — it is folded from
 * the chain's own event log, not from the adopted snapshot — so the killing blow is graded off the result the
 * client already holds instead of off three coerced defaults and a NaN.
 *
 * HP, LIFE and CELL only, and that is the whole point: this is the settled outcome of the turn, never a live
 * board. The fold keys fighters `p<seat>` / `m<idx>`; the read speaks ENTITY ids, so seats are named through
 * `entity_id_of_key` — the ONE home for that mapping — and a seat the roster cannot name is dropped, never guessed.
 *
 * @param {{ board: any, escrow?: Array<any>, my_key?: string | null }} args the committed fold (`project_board`),
 *   the adopted roster that names its seats, and my own fold key — exactly what `dev_read().result_fold` ships
 * @returns {object | null} null when the fold holds no fighters — an empty projection standing in for a missing
 *   read would be the same lie in a new coat, and the caller must report a gap instead.
 */
export const result_fold_read = ({ board, escrow = [], my_key = null }) => {
  const roster = { escrow }
  const fighters = Object.entries(board?.fighters ?? {}).flatMap(([key, fighter]) => {
    const id = entity_id_of_key(roster, key)
    if (!id) return []
    return [
      {
        id,
        hp_committed: fighter.hp,
        alive_committed: !!fighter.alive,
        cell_committed: fighter.cell == null ? null : decode(Number(fighter.cell)),
        effects: (fighter.statuses ?? []).map((status) => ({
          kind: status.kind,
          remaining_turns: status.remaining_turns,
          value: status.value ?? null,
          stat: status.stat ?? null,
          element: status.element ?? null,
        })),
      },
    ]
  })
  if (!fighters.length) return null
  return {
    ok: true,
    terminal: true,
    my_id: my_key ? entity_id_of_key(roster, my_key) : null,
    winner: board.winner ?? -1,
    turn_number: board.turn_ordinal ?? 0,
    fighters,
  }
}

/** `arena.cells` is indexed by the canonical encoded cell (project.js `board_cells`), so this IS the index. */
export const cell_index = (cell) => encode(cell.x, cell.y)

/** Board cells this read marks non-walkable (obstacles ∪ holes ∪ off-shape), as encoded ids. */
export const blocked_cells = (read) =>
  read.arena.cells.reduce((out, value, index) => (value === 1 ? [...out, index] : out), [])

/** Every living fighter, read off the SETTLED fold — never the eye's presented/display values. */
export const living = (read) => read.fighters.filter((f) => f.alive_committed && f.cell_committed)

/** The seat the bot plays. */
export const me_of = (read) => read.fighters.find((f) => f.id === read.my_id) ?? null

/** Living fighters on the other side of `me`. */
export const enemies_of = (read) => {
  const me = me_of(read)
  return me ? living(read).filter((f) => f.team !== me.team) : []
}

/** Living fighters on my side, me included. */
export const allies_of = (read) => {
  const me = me_of(read)
  return me ? living(read).filter((f) => f.team === me.team) : []
}

/** Manhattan distance — the metric the sim's `is_in_range` uses. ONE home: `@aresrpg/sim/combat_grid`.
 *  It is also the tackle-adjacency metric: `fight_tackle.js` scans ORTHOGONAL neighbors only, so
 *  "in the tackle ring" is `manhattan(a, b) <= 1` — never a king-move (chebyshev) test, which would
 *  count diagonal enemies the chain never does. */
export { manhattan } from '@aresrpg/sim/combat_grid'

/**
 * The `TargetingContext` `can_target` takes: terrain occlusion + body occupancy, both off committed truth.
 * `ignore_id` drops one fighter from the occupancy mask (the caster never blocks its own line).
 */
export const targeting_context = (read, { ignore_id = null, at = null } = {}) => {
  const blocked = new Set(blocked_cells(read))
  const bodies = new Set(
    living(read)
      .filter((f) => f.id !== ignore_id)
      .map((f) => cell_index(f.cell_committed))
  )
  // The caster standing somewhere other than its committed cell (a planned reposition) occupies THAT cell.
  if (at) bodies.add(cell_index(at))
  return {
    blocks_los: (cell) => blocked.has(cell_index(cell)),
    is_occupied: (cell) => bodies.has(cell_index(cell)),
  }
}

/** Cells a mover at `from` can reach on `mp` movement points, around terrain and living bodies. */
export const reachable_cells = (read, from, mp, ignore_id) => {
  const blocked = new Set([
    ...blocked_cells(read),
    ...living(read)
      .filter((f) => f.id !== ignore_id)
      .map((f) => cell_index(f.cell_committed)),
  ])
  return bfsReachable(cell_index(from), mp, blocked).map(decode)
}

/** MP a move from `from` to `to` costs, or null when it is not reachable inside `mp`. */
export const path_cost = (read, from, to, mp, ignore_id) => {
  const blocked = new Set([
    ...blocked_cells(read),
    ...living(read)
      .filter((f) => f.id !== ignore_id)
      .map((f) => cell_index(f.cell_committed)),
  ])
  const cost = bfsPathCost(cell_index(from), cell_index(to), blocked, mp)
  return cost > mp ? null : cost
}

/** Does `spell` legally reach `target_cell` from `from`? The SIM's own gate, verbatim. */
export const spell_reaches = (read, spell, from, target_cell, ignore_id) =>
  can_target(spell, from, target_cell, targeting_context(read, { ignore_id, at: from }))

/** Which of `spell`'s effects actually land on a fighter of `same_team`-ness (Move's `effect_hits` twin). */
export const landing_effects = (spell, { is_caster, same_team }) =>
  spell.effects.filter((effect) => effect_hits(effect.target_filter ?? 0, is_caster, same_team))

/** The status kinds currently riding a fighter, as a sorted multiset key — the buff assertion's baseline. */
export const status_signature = (fighter) =>
  (fighter?.effects ?? [])
    .map((e) => Number(e.kind))
    .sort((a, b) => a - b)
    .join(',')
