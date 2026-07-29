// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// VITALITY / MAX_HP ALTERS (#1628) — the sim half of a CROSS-TWIN pin. The expectations below are transcribed
// from the MOVE SOURCE, not from the sim's own behaviour:
//
//   · `packages/move/engine/sources/cast.move` — `land_alter_player` / `land_alter_mob`, the one home an alter
//     row arrives through, end in `retro_effects::apply_max_hp_alter`.
//   · `packages/move/engine/sources/retro_effects.move` — `is_max_hp_alter` (kind ALTER_STAT and stat 5 or 10),
//     `apply_max_hp_alter` (positive → `add_max_hp_bonus`: capacity ONLY, current HP does not ride the gain;
//     negative → `remove_max_hp_bonus`: capacity floors at 1 and current HP is clamped down to it) and
//     `revert_expired_max_hp`, its exact inverse, folded at the bearer's own turn-end
//     (`cast::tick_turn_end`) and on dispel.
//   · `packages/move/foundation/sources/spell.move:175-205` — `add_stat`/`sub_stat` have no branch for field 5
//     or 10, which is WHY the capacity leg exists at all: for those two ids the alter's `Stats` fold is a no-op
//     and the capacity move is the entire effect.
//
// The Move twin of this file is `packages/move/engine/tests/alter_max_hp_tests.move`.

import { describe, test, expect } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import { find_entity } from '../src/fight_state.js'

const flat_arena = (width = 11) => ({
  width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width),
  spawns_a: [
    { x: 1, y: 5 },
    { x: 1, y: 6 },
  ],
  spawns_b: [
    { x: 9, y: 5 },
    { x: 9, y: 6 },
  ],
})

/** min===max on every line so the roll is fixed and the capacity delta is a known integer. */
const spell_templates = normalize_spell_templates({
  senshi: {
    fortify: {
      name: 'Fortify',
      description: '+60 vitality for two turns',
      levels: [
        {
          cost: 2,
          range: [0, 6],
          critical_chance: 0,
          area: 0,
          area_type: 'cell',
          modifiable_range: false,
          line_of_sight: true,
          linear: false,
          free_cell: false,
          base_effects: [
            {
              type: 'add',
              statistic: 'vitality',
              min: 60,
              max: 60,
              turns: 2,
              target: 'self',
              chance: 100,
            },
          ],
          critical_effects: [],
        },
      ],
    },
    reinforce: {
      name: 'Reinforce',
      description:
        '+25 max hp for one turn (stat id 10, the same capacity fact)',
      levels: [
        {
          cost: 2,
          range: [0, 6],
          critical_chance: 0,
          area: 0,
          area_type: 'cell',
          modifiable_range: false,
          line_of_sight: true,
          linear: false,
          free_cell: false,
          base_effects: [
            {
              type: 'add',
              statistic: 'max_hp',
              min: 25,
              max: 25,
              turns: 1,
              target: 'self',
              chance: 100,
            },
          ],
          critical_effects: [],
        },
      ],
    },
    wither: {
      name: 'Wither',
      description: '-30 vitality on an enemy for one turn',
      levels: [
        {
          cost: 2,
          range: [0, 6],
          critical_chance: 0,
          area: 0,
          area_type: 'cell',
          modifiable_range: false,
          line_of_sight: true,
          linear: false,
          free_cell: false,
          base_effects: [
            {
              type: 'remove',
              statistic: 'vitality',
              min: 30,
              max: 30,
              turns: 1,
              target: 'enemies',
              chance: 100,
            },
          ],
          critical_effects: [],
        },
      ],
    },
  },
})

const make_entity = (id, cell, is_player, spells, overrides = {}) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
  ap: 10,
  ap_max: 10,
  mp: 3,
  mp_max: 3,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'senshi',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0 },
  effects: [],
  spell_levels: spells,
  ap_reserve: 0,
  ...overrides,
})

/** One player, one mob, adjacent enough for every spell above; the player opens. */
const duel = (player_spells = { fortify: 1, reinforce: 1, wither: 1 }) => {
  const arena = flat_arena()
  const ctx = { spell_templates, arena }
  const state = create_fight_state({
    fight_id: 'f',
    arena_seed: 7,
    arena_radius: arena.radius,
    arena,
    team0: [make_entity('p0', { x: 4, y: 5 }, true, player_spells)],
    team1: [make_entity('m0', { x: 6, y: 5 }, false, {})],
  })
  let acc = reduce(state, { type: 'start' }, ctx).state
  for (let i = 0; i < 4 && !current_actor(acc)?.is_player; i++)
    acc = end_current_turn(acc, ctx)
  return { state: acc, ctx }
}

const current_actor = state => {
  const id = state.turn_order?.[state.current_turn_idx]
  return id ? find_entity(state, id) : null
}

const end_current_turn = (state, ctx) => {
  const actor = current_actor(state)
  expect(actor).not.toBeNull()
  return reduce(
    state,
    actor.is_player
      ? { type: 'end_turn', entity_id: actor.id }
      : { type: 'ai_turn', entity_id: actor.id },
    ctx,
  ).state
}

const of = (state, id) => find_entity(state, id)

describe('a vitality / max-hp alter moves HP CAPACITY (#1628)', () => {
  test('a +60 vitality self-buff raises max HP for its life and gives it back at expiry', () => {
    const { state, ctx } = duel()
    expect(of(state, 'p0').health_max).toBe(100)

    const cast = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'fortify',
        target: { x: 4, y: 5 },
      },
      ctx,
    ).state
    // add_max_hp_bonus: capacity only — the buff is not a heal.
    expect(of(cast, 'p0').health_max).toBe(160)
    expect(of(cast, 'p0').health).toBe(100)

    // The row is 2 turns: it survives the mob's turn and dies at the bearer's own second turn start.
    let acc = end_current_turn(cast, ctx)
    while (!current_actor(acc)?.is_player) acc = end_current_turn(acc, ctx)
    expect(of(acc, 'p0').health_max).toBe(160)
    acc = end_current_turn(acc, ctx)
    while (!current_actor(acc)?.is_player) acc = end_current_turn(acc, ctx)
    expect(of(acc, 'p0').health_max).toBe(100)
  })

  test('stat id 10 (max_hp) is the same capacity fact — the arm never keys off vitality alone', () => {
    const { state, ctx } = duel()
    const cast = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'reinforce',
        target: { x: 4, y: 5 },
      },
      ctx,
    ).state
    expect(of(cast, 'p0').health_max).toBe(125)
    expect(of(cast, 'p0').health).toBe(100)
  })

  test('a NEGATIVE vitality line shaves capacity, drags current HP down, and hands it back at expiry', () => {
    const { state, ctx } = duel()
    const cast = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'wither',
        target: { x: 6, y: 5 },
      },
      ctx,
    ).state
    // remove_max_hp_bonus: capacity down, and current HP clamped to it.
    expect(of(cast, 'm0').health_max).toBe(70)
    expect(of(cast, 'm0').health).toBe(70)

    let acc = end_current_turn(cast, ctx)
    while (!current_actor(acc)?.is_player) acc = end_current_turn(acc, ctx)
    // Expiry restores exactly the shaved capacity — and the clamp is not a heal on the way back.
    expect(of(acc, 'm0').health_max).toBe(100)
    expect(of(acc, 'm0').health).toBe(70)
  })
})
