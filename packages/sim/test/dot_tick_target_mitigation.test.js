// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1873 — A DoT TICK IS A DAMAGE LINE, NOT A RAW SUBTRACTION.
//
// The chain ticks a DoT through the SAME board sink a trap/glyph payload uses
// (`cast::apply_board_batch_from`): `retro_effects::hit_elemental(fight, .., spell_formula::final_damage(
// board_damage, element, &caster_stats, &target_stats), element, board_roll)` — and `hit_elemental` opens
// with `spell_board::mitigate_damage`. So the chain's per-tick magnitude is:
//
//     roll_in_range(value, value_max, slot_damage_roll(turn_seed, e))   [#1826, landed]
//       → amplify off the SOURCE's CURRENT stats  (#1999 / D41 — `cast::board_caster_stats`)
//       → the TARGET's element resistance         (spell::apply_resistance)
//       → the TARGET's shields                    (kind-24 flat, then kind-40 pool)
//
// The sim rolled the band (#1826) and then handed the raw number straight to `apply_incoming_damage`, which
// takes an ALREADY-final amount — so a DoT ignored the victim's resistances and walked through shields (the
// magnitude divergence #1873 reported). #1999 then ruled the caster half: a poison scales with whoever cast it,
// read at EVERY application, and the tests below pin both halves and the order they compose in.
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

  test('the tick AMPLIFIES off the DoT source, then the victim resists (#1999 / D41)', () => {
    // p0 carries +100 strength, which DOUBLES an earth line: 20 × (100+100)/100 = 40, then the victim's 40%
    // earth resist takes it to floor(40 × 60/100) = 24. Caster first, target second — the flat-DoT status quo
    // read 12 here, and a target-first order would read 24 only by coincidence at these numbers, which is why
    // the buffed-mid-DoT case below is the discriminator the ruling actually names.
    const { dealt } = tick_cost(
      state_with_dot({
        caster_stats: { strength: 100 },
        victim_stats: { earth_resistance: 40 },
      }),
    )
    expect(dealt).toBe(24)
  })

  test('THE DISCRIMINATOR: buffing the caster mid-poison raises the NEXT tick (#1999 clause 1)', () => {
    // A cast-time snapshot and a per-tick read agree on every tick until the caster's stats MOVE between two of
    // them. Same row, same victim: 20 × 150/100 = 30, then the caster gains another 50 strength and the very
    // next tick of that same row reads 20 × 200/100 = 40. A snapshot repeats 30; a flat DoT repeats 20.
    const state = state_with_dot({ caster_stats: { strength: 50 } })
    const first = tick_cost(state)
    expect(first.dealt).toBe(30)

    const buffed = {
      ...first.state,
      team0: first.state.team0.map(entity =>
        entity.id === 'p0'
          ? { ...entity, stats: { ...entity.stats, strength: 100 } }
          : entity,
      ),
    }
    expect(tick_cost(buffed).dealt).toBe(40)
  })

  test('a row whose source is gone from the fight amplifies off nothing (the zero-caster fallback)', () => {
    // The chain's out-of-range guard in `cast::board_caster_stats`: a fid naming no fighter of this fight — a
    // glyph payload's `spell_board::no_source()`, or a stale id — takes the zero block, never an abort.
    const state = state_with_dot({ caster_stats: { strength: 100 } })
    const orphaned = {
      ...state,
      team1: state.team1.map(entity => ({
        ...entity,
        effects: entity.effects.map(effect =>
          effect.type === 'DAMAGE'
            ? { ...effect, source_id: 'nobody' }
            : effect,
        ),
      })),
    }
    expect(tick_cost(orphaned).dealt).toBe(20)
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
