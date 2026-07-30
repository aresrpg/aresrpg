// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// EFFECT BOARD — the persistent on-board combat bookkeeping (traps / glyphs / DoT), a mirror of
// aresrpg_foundation::spell_board.move (S-16 parity). Two maps: CELL ENTRIES (cell → trap|glyph) and FIGHTER
// STATUSES (fighter → DoT|buff|state). Pure primitives; the §5d tick ORDERING is the deterministic contract the
// turn machine composes (start: DoT + start-glyph → act: trap on-enter → end: end-glyph → decrement durations).
//
// RNG-dependent damage rolls are NOT here (crit draws stay server-truth) — this layer is the ordered collection
// of which effects fire when, byte-for-byte with the Move twin.

import { in_zone } from './combat_grid.js'
import {
  K_PLACE_TRAP,
  K_PLACE_GLYPH,
  K_APPLY_DOT,
  K_REMOVE_POINTS,
  K_GIVE_POINTS,
  K_ALTER_STAT,
  K_ALTER_RESIST,
  K_REDUCE_DAMAGE,
  K_POOL_SHIELD,
  K_REFLECT_DAMAGE,
  K_INVISIBILITY,
  PHASE_ON_ENTER,
  PHASE_START,
  PHASE_END,
  kind,
  phase,
  turns,
  stat,
  value,
} from './spell_effect.js'

/**
 * @typedef {{ cell:number, owner_team:number, kind:number, phase:number, zone_shape:number, zone_size:number,
 *   remaining_turns:number, payload:import('./spell_effect.js').Effect[] }} CellEntry
 * @typedef {{ fighter:number, kind:number, effect:import('./spell_effect.js').Effect, remaining_turns:number,
 *   source:number }} FighterStatus
 * @typedef {{ cell_entries: CellEntry[], statuses: FighterStatus[] }} BoardState
 */

/** A fresh empty board. Mirrors spell_board::empty. @returns {BoardState} */
export const empty = () => ({ cell_entries: [], statuses: [] })

export const entry_count = board => board.cell_entries.length
export const status_count = board => board.statuses.length

// Zone containment — delegates to combat_grid::in_zone (EXACT for point/circle/cross/ring/allmap).
const zone_contains = (shape, size, anchor, cell) =>
  in_zone(shape, size, anchor, cell)

// Move `swap_remove(i)`: remove element i, backfilling with the last element, then shrink. Preserves the exact
// post-removal ordering the on-chain vector produces (matters when multiple entries coexist).
const swap_remove = (arr, i) => {
  const last = arr.length - 1
  const removed = arr[i]
  arr[i] = arr[last]
  arr.pop()
  return removed
}

// ╔════════════════ [ Placement ] ══════════════════════════════════════════════════ ]

/** Place an INVISIBLE, timerless, on-enter trap. Mirrors spell_board::place_trap. */
export const place_trap = (
  board,
  cell,
  owner_team,
  zone_shape,
  zone_size,
  payload,
) => {
  board.cell_entries.push({
    cell,
    owner_team,
    kind: K_PLACE_TRAP,
    phase: PHASE_ON_ENTER,
    zone_shape,
    zone_size,
    remaining_turns: 0,
    payload,
  })
}

/** Place a VISIBLE, timed glyph (end_of_turn selects the end-phase class). Mirrors spell_board::place_glyph. */
export const place_glyph = (
  board,
  cell,
  owner_team,
  zone_shape,
  zone_size,
  duration,
  end_of_turn,
  payload,
) => {
  board.cell_entries.push({
    cell,
    owner_team,
    kind: K_PLACE_GLYPH,
    phase: end_of_turn ? PHASE_END : PHASE_START,
    zone_shape,
    zone_size,
    remaining_turns: duration,
    payload,
  })
}

/** Apply a DoT to a fighter (its Effect.turns = duration; ticks at the victim's turn start). Mirrors apply_dot. */
export const apply_dot = (board, fighter, source, dot_effect) => {
  board.statuses.push({
    fighter,
    kind: K_APPLY_DOT,
    remaining_turns: turns(dot_effect),
    effect: dot_effect,
    source,
  })
}

/** Attach a generic fighter status (buff/debuff/state). Mirrors spell_board::add_status. */
export const add_status = (board, fighter, source, effect) => {
  board.statuses.push({
    fighter,
    kind: kind(effect),
    remaining_turns: turns(effect),
    effect,
    source,
  })
}

/** First active status row of `kind` on `fighter`, matching Move's ordered lookup. */
export const fighter_status_of = (board, fighter, status_kind) =>
  board.statuses.find(
    status => status.fighter === fighter && status.kind === status_kind,
  )?.effect

/** Remove every matching kind on one fighter, preserving unrelated rows and other fighters. */
export const clear_fighter_status_kind = (board, fighter, status_kind) => {
  const kept = []
  while (board.statuses.length > 0) {
    const status = board.statuses.pop()
    if (!(status.fighter === fighter && status.kind === status_kind))
      kept.push(status)
  }
  board.statuses = kept.reverse()
}

// ╔════════════════ [ Triggers ] ═══════════════════════════════════════════════════ ]

/**
 * Is a LIVE trap ANCHORED on `cell`? The 1.29 no-stack read: the cast layer refuses a trap placement on an
 * already-trapped cell (one trap per anchor; a detonated trap frees it). Checks the ANCHOR, never the zone —
 * overlapping blast ZONES stay legal (the 1.29 trap-chain). Mirrors spell_board::has_trap_at.
 * @param {BoardState} board @param {number} cell @returns {boolean}
 */
export const has_trap_at = (board, cell) =>
  board.cell_entries.some(e => e.kind === K_PLACE_TRAP && e.cell === cell)

/**
 * A fighter ENTERS `mover_cell`: detonate the FIRST trap whose zone covers it, SELF-REMOVING before returning
 * its payload (no team check — detonates for anyone). Empty ⇒ no trap. Mirrors spell_board::on_enter.
 */
export const on_enter = (board, mover_cell) => {
  const n = board.cell_entries.length
  for (let i = 0; i < n; i++) {
    const e = board.cell_entries[i]
    if (
      e.kind === K_PLACE_TRAP &&
      zone_contains(e.zone_shape, e.zone_size, e.cell, mover_cell)
    ) {
      return swap_remove(board.cell_entries, i).payload
    }
  }
  return []
}

/**
 * START-of-turn tick for `fighter_id` on `fighter_cell`: every start-phase glyph payload it stands in, plus its
 * start-phase DoT effects (§5d). Read-only. Mirrors spell_board::tick_start.
 */
export const tick_start = (board, fighter_id, fighter_cell) => {
  const out = collect_glyph_payloads(board, fighter_cell, PHASE_START)
  for (const s of board.statuses) {
    if (
      s.fighter === fighter_id &&
      s.kind === K_APPLY_DOT &&
      phase(s.effect) === PHASE_START
    )
      out.push(s.effect)
  }
  return out
}

/** END-of-turn tick: every end-phase glyph payload the fighter stands in. Mirrors spell_board::tick_end. */
export const tick_end = (board, fighter_cell) =>
  collect_glyph_payloads(board, fighter_cell, PHASE_END)

const collect_glyph_payloads = (board, fighter_cell, trigger_phase) => {
  const out = []
  for (const e of board.cell_entries) {
    if (
      e.kind === K_PLACE_GLYPH &&
      e.phase === trigger_phase &&
      zone_contains(e.zone_shape, e.zone_size, e.cell, fighter_cell)
    ) {
      for (const p of e.payload) out.push(p)
    }
  }
  return out
}

// ╔════════════════ [ Duration decrement (the separate end-of-turn step) ] ═══════════ ]

/** Tick down glyph durations, expiring those reaching 0 (traps have no timer). Mirrors decrement_glyphs. */
export const decrement_glyphs = board => {
  const kept = []
  while (board.cell_entries.length > 0) {
    const e = board.cell_entries.pop()
    if (e.kind === K_PLACE_GLYPH) {
      if (e.remaining_turns > 1) {
        e.remaining_turns -= 1
        kept.push(e)
      }
      // else: expire (dropped)
    } else {
      kept.push(e) // trap: no timer
    }
  }
  board.cell_entries = kept
}

/**
 * Tick down a fighter's status durations, expiring those reaching 0. An EXPIRING revert-class row (timed
 * stat/resist buff, armor/reflect accumulator, invisibility) returns its applied Effect so the caller can undo
 * the delta; every other expiring kind just drops. Mirrors spell_board::decrement_fighter_statuses.
 * @returns {import('./spell_effect.js').Effect[]} the effects whose deltas must be reverted
 */
export const decrement_fighter_statuses = (board, fighter_id) => {
  const kept = []
  const expired = []
  while (board.statuses.length > 0) {
    const s = board.statuses.pop()
    if (s.fighter === fighter_id) {
      if (s.remaining_turns > 1) {
        s.remaining_turns -= 1
        kept.push(s)
      } else if (status_needs_revert(s.kind)) {
        expired.push(s.effect)
      }
      // else: drop
    } else {
      kept.push(s)
    }
  }
  board.statuses = kept
  return expired
}

/** The status kinds whose applied delta must be UNDONE when the row leaves. Mirrors status_needs_revert. */
const status_needs_revert = k =>
  k === K_ALTER_STAT ||
  k === K_ALTER_RESIST ||
  k === K_REDUCE_DAMAGE ||
  k === K_POOL_SHIELD ||
  k === K_REFLECT_DAMAGE ||
  k === K_INVISIBILITY

/**
 * The ACTIVE point-drain DEBT on `fighter_id` for pool `point_kind` (0 AP / 1 MP): the sum of every live
 * k_remove_points row's post-dodge value. The turn machine subtracts it from the pool's base at the next
 * begin_turn refill (the retrait contract). Mirrors spell_board::fighter_point_debt.
 * @returns {number}
 */
export const fighter_point_debt = (board, fighter_id, point_kind) =>
  sum_point_rows(board, fighter_id, K_REMOVE_POINTS, point_kind)

/**
 * The ACTIVE give CREDIT on `fighter_id` for pool `point_kind` — the debt fold's opposite-sign twin
 * (MOB_DEBUFF_HAT P1 #2): summed k_give_points rows, ADDED at the next begin_turn refill.
 * Mirrors spell_board::fighter_point_credit.
 * @returns {number}
 */
export const fighter_point_credit = (board, fighter_id, point_kind) =>
  sum_point_rows(board, fighter_id, K_GIVE_POINTS, point_kind)

const sum_point_rows = (board, fighter_id, row_kind, point_kind) => {
  let sum = 0
  for (const s of board.statuses)
    if (
      s.fighter === fighter_id &&
      s.kind === row_kind &&
      stat(s.effect) === point_kind
    )
      sum += value(s.effect)
  return sum
}

/**
 * PURGE every status row on `fighter_id` — the DEATH fold (a corpse's rows can never expire; rows it SOURCED on
 * others persist). pop/push like the Move twin so the surviving rows land in the SAME (reversed) order —
 * first-of-kind reads (`fighter_status_of` class) and tick emission order stay byte-identical.
 * Mirrors spell_board::clear_fighter.
 */
export const clear_fighter = (board, fighter_id) => {
  const kept = []
  while (board.statuses.length > 0) {
    const s = board.statuses.pop()
    if (s.fighter !== fighter_id) kept.push(s)
  }
  board.statuses = kept
}

/**
 * Every LIVE timed alter row (stat/resist) on `fighter_id`. Mirrors spell_board::fighter_alter_rows.
 * @returns {import('./spell_effect.js').Effect[]}
 */
export const fighter_alter_rows = (board, fighter_id) => {
  const out = []
  for (const s of board.statuses)
    if (
      s.fighter === fighter_id &&
      (s.kind === K_ALTER_STAT || s.kind === K_ALTER_RESIST)
    )
      out.push(s.effect)
  return out
}
