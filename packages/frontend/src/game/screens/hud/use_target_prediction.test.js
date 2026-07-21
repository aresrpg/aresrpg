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
import { WEAPON_ATTACK_ID } from '@aresrpg/fight/weapon'

import { seed_fight_core, reset_fight_core } from '../../../test_helpers/fight_core_harness.js'
import { compute_target_prediction, crit_percent, EMPTY_PREDICTION } from './target_prediction_core.js'
import { predicted_target_outcome } from './target_outcome.js'
import { SPELLS_SEED_AVAILABLE } from '../../../test_helpers/spells_fixture.js'

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

// MISSING-ARTIFACT (#117): warcleave is part of the full on-chain seed corpus (seed/mainnet/spells), absent
// by design in this public repo — sdk/spells.json's hand-authored senshi set has no 'warcleave' entry, so
// the fight core cannot resolve its real base/crit damage or crit_rate here. See test_helpers/spells_fixture.js.
describe('compute_target_prediction — the live hover card', () => {
  test.skipIf(!SPELLS_SEED_AVAILABLE)('RED-at-cell-bug → GREEN: a hovered mob with Warcleave armed shows the EXACT non-crit damage', () => {
    const out = outcome_of(armed_hover(30))
    // THE REPRO: at the {x,y}-cell bug this is 0 (no Hit → silent); encoded, Warcleave lands its exact base 7.
    expect(out.delta).toBe(-7) // "(30 −7)" red — the exact life reduction, never a range
    expect(out.remaining_hp).toBe(23)
    expect(out.kills).toBe(false)
  })

  test.skipIf(!SPELLS_SEED_AVAILABLE)('the crit branch rides alongside: crit outcome + its chance (never a guessed number)', () => {
    const out = outcome_of(armed_hover(30))
    expect(out.crit).toEqual({ delta: -9, kills: false }) // crit swaps to the authored crit base 9
    expect(out.crit_chance).toBe(crit_percent(40)) // 2.5% — mirrors the turn-seed crit threshold
    expect(out.crit_chance).toBeGreaterThan(0)
  })

  test.skipIf(!SPELLS_SEED_AVAILABLE)('KILLS THE MOB when the non-crit outcome is lethal', () => {
    const out = outcome_of(armed_hover(5)) // 5 hp, base 7 → dead
    expect(out.kills).toBe(true)
    expect(out.remaining_hp).toBeLessThanOrEqual(0)
  })

  test.skipIf(!SPELLS_SEED_AVAILABLE)('CRIT KILLS — the honest split: the base leaves it alive, only the crit is lethal', () => {
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

// CRIT-DISPLAY BUG (live prod v1.12.37: "Razkin (8 −4)" / "CRITICAL 3.33% → −6" shown against a target the
// maintainer had already just hit that turn) — armed_spell_id survives turns AND spent AP by design (store.js
// clears it ONLY on an actual Cast, a re-arm-free convenience for your next turn), so the hover card kept
// forecasting a crit CHANCE for an action that was no longer actually castable: mid the opponent's turn, or the
// instant your own last action spent the AP this one needed. A crit-chance line is legitimate ONLY as a genuine
// pre-cast preview — never a stand-in for what a landed hit's own (already-resolved, fact-based) combat-log /
// floating-damage-number rendering already states honestly. Weapon-armed (not a seed spell) so these run
// unconditionally — no SPELLS_SEED_AVAILABLE gate; the #117 missing-artifact class doesn't touch the weapon path.
describe('compute_target_prediction — the CASTABLE-NOW gate (crit-display bug)', () => {
  const WEAPON = { ap_cost: 2, damage: 5, crit_rate: 10, reach: 2 } // affordable at ap:6, NOT at ap:1
  const armed_weapon_hover = ({ active, ap }) => {
    seed_fight_core({
      seats: [{ character: '0xme', cell: CASTER_CELL, ap, mp: 3, weapon: WEAPON }],
      mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: MOB_CELL, ap: 4, mp: 3, level: 1 }],
      active,
    })
    fight_store.getState().input({ type: 'arm', spell_id: WEAPON_ATTACK_ID })
    const state = fight_store.getState()
    return compute_target_prediction({ fight: engine_view(state), hover: { entity_id: 'mob-0' }, dungeon: board_view(state) })
  }

  test('sanity: armed + affordable + my turn → a live forecast, crit chance included', () => {
    const out = armed_weapon_hover({ active: '0xme', ap: 6 })
    expect(out).not.toBe(EMPTY_PREDICTION)
    expect(out.target_ref).toEqual({ is_mob: true, idx: 0 })
    expect(out.crit_chance).toBe(crit_percent(WEAPON.crit_rate)) // 10% — never a guessed number
  })

  test('RED: armed weapon during the MOB turn must NOT forecast a crit chance (not my turn)', () => {
    const out = armed_weapon_hover({ active: 'mob-0', ap: 6 }) // fully affordable — ONLY the turn is wrong
    expect(out).toBe(EMPTY_PREDICTION) // pre-fix: no turn-ownership check → returns a live prediction instead
  })

  test('RED: armed weapon with insufficient AP must NOT forecast a crit chance (spent on something else)', () => {
    const out = armed_weapon_hover({ active: '0xme', ap: 1 }) // my turn — ONLY the AP (weapon costs 2) is short
    expect(out).toBe(EMPTY_PREDICTION) // pre-fix: no affordability check on this path → returns a live prediction
  })
})
