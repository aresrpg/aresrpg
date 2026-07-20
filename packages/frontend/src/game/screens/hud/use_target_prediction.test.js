// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LIVE-FLOW repro (hovering a mob with a spell must show what will happen: damage taken,
// critical chance, effects, kill). Drives the REAL fight core (seed_fight_core → the ONE input door) + the real
// board_view/engine_view projections + the real senshi spell corpus, then exercises compute_target_prediction —
// the wiring the shipped tooltip runs. RED at the cell-format bug: engine_view fighter cells are DECODED {x,y},
// but predict_cast's target_cell is an ENCODED int (it decode()s it), so passing the raw {x,y} decode()s to NaN →
// an off-board target → no Hit → the hover card shows nothing. GREEN once the hook
// encodes the cell: the card gets the exact non-crit damage, the crit branch, and the kill split.

import { afterEach, describe, expect, test } from 'bun:test'

import { board_view, engine_view } from '@aresrpg/fight/project'
import { fight_store } from '@aresrpg/fight/store'

import { seed_fight_core, reset_fight_core } from '../../../test_helpers/fight_core_harness.js'
import { compute_target_prediction, crit_percent } from './target_prediction_core.js'
import { predicted_target_outcome } from './target_outcome.js'

// senshi Warcleave (seed corpus): base 7 / crit 9 earth damage, crit_rate 40, range [1,2].
const WARCLEAVE = 'warcleave'
const CASTER_CELL = 100 // (0,5) on a 20-wide board
const MOB_CELL = 101 // (1,5) — chebyshev 1 from the caster, inside Warcleave's [1,2] range

// Seed a live senshi-vs-one-mob fight, my turn, arm Warcleave, hover the mob — then hand the pure core the SAME
// three live slices the hook reads (engine_view, the fight_hover, board_view).
const armed_hover = (mob_hp) => {
  seed_fight_core({
    seats: [{ character: '0xme', cell: CASTER_CELL, class: 'senshi', ap: 6, mp: 3 }],
    mobs: [{ template: '0xabc', hp: mob_hp, max_hp: Math.max(mob_hp, 30), cell: MOB_CELL, ap: 4, mp: 3, level: 1 }],
  })
  fight_store.getState().input({ type: 'arm', spell_id: WARCLEAVE })
  const state = fight_store.getState()
  return {
    fight: engine_view(state),
    hover: { entity_id: 'mob-0' },
    dungeon: board_view(state),
    mob_hp,
  }
}

const outcome_of = ({ fight, hover, dungeon, mob_hp }) => {
  const { base, crit, target_ref, crit_chance, effects } = compute_target_prediction({ fight, hover, dungeon })
  return { ...predicted_target_outcome(base, crit, target_ref, mob_hp), crit_chance, effects }
}

afterEach(() => reset_fight_core())

describe('compute_target_prediction — the live hover card', () => {
  test('RED-at-cell-bug → GREEN: a hovered mob with Warcleave armed shows the EXACT non-crit damage', () => {
    const out = outcome_of(armed_hover(30))
    // THE REPRO: at the {x,y}-cell bug this is 0 (no Hit → silent); encoded, Warcleave lands its exact base 7.
    expect(out.delta).toBe(-7) // "(30 −7)" red — the exact life reduction, never a range
    expect(out.remaining_hp).toBe(23)
    expect(out.kills).toBe(false)
  })

  test('the crit branch rides alongside: crit outcome + its chance (never a guessed number)', () => {
    const out = outcome_of(armed_hover(30))
    expect(out.crit).toEqual({ delta: -9, kills: false }) // crit swaps to the authored crit base 9
    expect(out.crit_chance).toBe(crit_percent(40)) // 2.5% — mirrors the turn-seed crit threshold
    expect(out.crit_chance).toBeGreaterThan(0)
  })

  test('KILLS THE MOB when the non-crit outcome is lethal', () => {
    const out = outcome_of(armed_hover(5)) // 5 hp, base 7 → dead
    expect(out.kills).toBe(true)
    expect(out.remaining_hp).toBeLessThanOrEqual(0)
  })

  test('CRIT KILLS — the honest split: the base leaves it alive, only the crit is lethal', () => {
    const out = outcome_of(armed_hover(8)) // base 7 → 1 hp (alive); crit 9 → dead
    expect(out.kills).toBe(false)
    expect(out.crit).toEqual({ delta: -8, kills: true }) // 8 − 9 clamps at ≤0; crit-only kill
  })

  test('unarmed / unhovered → empty (name+hp only, no preview)', () => {
    seed_fight_core({ seats: [{ character: '0xme', cell: CASTER_CELL }], mobs: [{ template: '0xabc', hp: 30, cell: MOB_CELL }] })
    const state = fight_store.getState()
    const nothing = compute_target_prediction({ fight: engine_view(state), hover: null, dungeon: board_view(state) })
    expect(nothing.base).toBeNull()
    expect(nothing.target_ref).toBeNull()
  })
})
