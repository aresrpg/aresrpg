// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1873 — A DoT TICK IS A DAMAGE LINE, NOT A RAW SUBTRACTION.
//
// The chain ticks a DoT through the SAME board sink a trap/glyph payload uses
// (`cast::apply_board_batch_from`): `retro_effects::hit_elemental(fight, .., spell_formula::final_damage(
// board_damage, element, &ZERO, &target_stats), element, board_roll)` — and `hit_elemental` opens with
// `spell_board::mitigate_damage`. So the chain's per-tick magnitude is:
//
//     roll_in_range(value, value_max, slot_damage_roll(turn_seed, e))   [#1826, landed]
//       → amplify with a ZERO caster block  (the source is a stored fid, never a live stat block)
//       → the TARGET's element resistance   (spell::apply_resistance)
//       → the TARGET's shields              (kind-24 flat, then kind-40 pool)
//
// The sim rolled the band (#1826) and then handed the raw number straight to `apply_incoming_damage`, which
// takes an ALREADY-final amount — so a DoT ignored the victim's resistances and walked through shields. That is
// the magnitude divergence #1873 reported; the row's "caster stats" framing is the inverse of the chain law —
// `&ZERO` means a DoT never scales off its caster, and the tests below pin BOTH halves.
//
// Sibling of hazard_zero_caster.test.js (the trap/glyph twin of the same sink).

import { describe, test, expect } from 'bun:test'

import { process_turn_effects } from '../src/fight_actions.js'
import { find_entity } from '../src/fight_state.js'
import { create_fight_state } from '../src/reduce.js'

const ARENA = {
  width: 9,
  height: 9,
  radius: 4,
  center: { x: 4, y: 4 },
  cells: new Uint8Array(81),
  spawns_a: [],
  spawns_b: [],
}

const fighter = (id, is_player, stats, effects) => ({
  id,
  name: id,
  cell: is_player ? { x: 2, y: 4 } : { x: 4, y: 4 },
  health: 200,
  health_max: 200,
  ap: 10,
  ap_max: 10,
  mp: 5,
  mp_max: 5,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'dot',
  level: 1,
  stats,
  effects,
  spell_levels: {},
  ap_reserve: 0,
})

/** A fixed (value_max === value) EARTH DoT row on the victim, sourced from p0. Fixed so the #1826 roll is the
 *  degenerate case and the ONLY variable left is target-side mitigation. */
const dot_row = value => ({
  id: 1,
  type: /** @type {const} */ ('DAMAGE'),
  timing: /** @type {const} */ ('TURN_START'),
  source_id: 'p0',
  element: /** @type {const} */ ('EARTH'),
  value,
  value_max: value,
  dot: true,
  turns_remaining: 3,
})

/** @param {{ caster_stats?: object, victim_stats?: object, victim_effects?: object[] }} spec */
const state_with_dot = ({
  caster_stats = {},
  victim_stats = {},
  victim_effects = [],
} = {}) => ({
  ...create_fight_state({
    fight_id: 'dot_mitigation',
    arena_seed: 1,
    arena_radius: 4,
    arena: ARENA,
    team0: [fighter('p0', true, caster_stats, [])],
    team1: [
      fighter('m0', false, victim_stats, [dot_row(20), ...victim_effects]),
    ],
  }),
  started: true,
  turn_order: ['p0', 'm0'],
  turn_number: 1,
})

const tick_cost = state => {
  const before = find_entity(state, 'm0').health
  const ticked = process_turn_effects(state, 'm0', null)
  return {
    dealt: before - find_entity(ticked.state, 'm0').health,
    state: ticked.state,
    effects: ticked.effects,
  }
}

describe('#1873 — a DoT tick resolves through the chain board sink, not a raw subtraction', () => {
  test("the victim's element resistance reduces the tick (spell::apply_resistance)", () => {
    // 40% earth resist on a fixed 20 base: floor(20 × (100−40)/100) = 12. The pre-fix sim dealt the flat 20.
    const { dealt } = tick_cost(
      state_with_dot({ victim_stats: { earth_resistance: 40 } }),
    )
    expect(dealt).toBe(12)
  })

  test('the tick NEVER amplifies off the DoT source — the chain block is &ZERO', () => {
    // p0 carries +100 strength, which would DOUBLE an earth line if the source amplified. `apply_board_batch_from`
    // builds `spell::new_stats(0, …)` and hands THAT to `final_damage`, so the tick stays the resisted base.
    const { dealt } = tick_cost(
      state_with_dot({
        caster_stats: { strength: 100 },
        victim_stats: { earth_resistance: 40 },
      }),
    )
    expect(dealt).toBe(12)
  })

  test('shields absorb a tick and are SPENT by it (hit_elemental → mitigate_damage)', () => {
    // No resistance; a 5-point EARTH pool shield eats 5 of the 20 → 15 through, and the emptied pool row is gone.
    const { dealt, state } = tick_cost(
      state_with_dot({
        victim_effects: [
          {
            id: 2,
            type: 'POOL_SHIELD',
            timing: 'PERMANENT',
            source_id: 'm0',
            element: 'EARTH',
            value: 5,
            turns_remaining: 3,
          },
        ],
      }),
    )
    expect(dealt).toBe(15)
    expect(
      find_entity(state, 'm0').effects.some(e => e.type === 'POOL_SHIELD'),
    ).toBe(false)
  })

  test('an unresisted, unshielded victim is unchanged (the pre-#1873 baseline holds)', () => {
    const { dealt } = tick_cost(state_with_dot())
    expect(dealt).toBe(20)
  })
})
