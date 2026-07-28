// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// bot/read.js — the SHARED VOCABULARY of the scripted fight bot (#1100): the pure derivations both the
// policy (what to do) and the assertions (did it happen) take over ONE `__ARES_DEV_READ()` snapshot.
//
// It re-implements NOTHING. Range/LoS/linearity/free-cell legality is `@aresrpg/sim/spell_targeting`'s
// `can_target` — the SIM's own gate, the twin the chain enforces — and pathing is `los.js`'s BFS, the
// byte-identical `combat_grid::bfs_path_cost` port the board already draws with. A bot that judged
// legality by its own rules would fail on exactly the divergences it exists to catch.

import { manhattan_distance } from '@aresrpg/sim/cell'
import { effect_hits, can_target } from '@aresrpg/sim/spell_targeting'

import { bfsPathCost, bfsReachable, decode, encode } from '../los.js'

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

/** Manhattan distance — the metric the sim's `is_in_range` uses. ONE home: `@aresrpg/sim/cell` (#1536 row 4). */
export const manhattan = manhattan_distance

/** Chebyshev distance — adjacency (the tackle ring). */
export const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

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
