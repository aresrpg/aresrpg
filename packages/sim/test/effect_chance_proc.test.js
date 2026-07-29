// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// EFFECT PROC CHANCE — the sim half of a CROSS-TWIN pin. An authored `chance` under 100 is a die roll, one draw
// per admitted target, and BOTH twins must roll it in the same place off the same stream. The expectations are
// transcribed from the Move source:
//
//   · `packages/move/engine/sources/cast.move` — `apply_effect` walks its zone and, for each fighter the target
//     filter admits, calls `effect_proc(...)` BEFORE any write; the sim's `apply_spell_effect` opens with
//     `effect_triggers` at exactly that position, once per entity in its resolved target list.
//   · `cast::effect_proc` — `chance >= 100 → true` and `chance == 0 → false` both return WITHOUT drawing;
//     everything between draws one `prng::rng_int(rng, 100)` and lands on `roll < chance`.
//
// Before this pair landed, the chain's ordinary dispatch never consulted `chance` at all: 216 authored effect
// rows across 20 spells (the Asobi "Cold Deck" shape — two 50%-chance damage lines — among them) resolved at an
// effective 100% on chain while the client predicted a coin flip off the sim.
//
// The Move twin of this file is `packages/move/engine/tests/effect_chance_tests.move`.

import { describe, test, expect } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import { find_entity } from '../src/fight_state.js'
import { effect_triggers } from '../src/spell_calculator.js'
import { rng_seed } from '../src/prng.js'

const flat_arena = (width = 11) => ({
  width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width),
  spawns_a: [{ x: 1, y: 5 }],
  spawns_b: [{ x: 9, y: 5 }],
})

/** One certain line and one impossible line, both 20 damage — the two deterministic ends of the die. */
const templates = (chance_a, chance_b) =>
  normalize_spell_templates({
    senshi: {
      cold_deck: {
        name: 'Cold Deck',
        description: 'two chanced strikes',
        levels: [
          {
            cost: 2,
            range: [1, 6],
            critical_chance: 0,
            area: 0,
            area_type: 'cell',
            modifiable_range: false,
            line_of_sight: true,
            linear: false,
            free_cell: false,
            base_effects: [
              {
                type: 'damage',
                min: 20,
                max: 20,
                element: 'earth',
                target: 'enemies',
                chance: chance_a,
              },
              {
                type: 'damage',
                min: 20,
                max: 20,
                element: 'earth',
                target: 'enemies',
                chance: chance_b,
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
  health: 1000,
  health_max: 1000,
  ap: 100,
  ap_max: 100,
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

const current_actor = state => {
  const id = state.turn_order?.[state.current_turn_idx]
  return id ? find_entity(state, id) : null
}

/** Player vs one mob on the player's own turn; `arena_seed` varies the stream between runs. */
const duel = (spell_templates, arena_seed = 7) => {
  const arena = flat_arena()
  const ctx = { spell_templates, arena }
  let acc = reduce(
    create_fight_state({
      fight_id: `f${arena_seed}`,
      arena_seed,
      arena_radius: arena.radius,
      arena,
      team0: [make_entity('p0', { x: 4, y: 5 }, true, { cold_deck: 1 })],
      team1: [make_entity('m0', { x: 6, y: 5 }, false, {})],
    }),
    { type: 'start' },
    ctx,
  ).state
  for (let i = 0; i < 4 && !current_actor(acc)?.is_player; i++)
    acc = reduce(
      acc,
      { type: 'ai_turn', entity_id: current_actor(acc).id },
      ctx,
    ).state
  return { state: acc, ctx }
}

const strike = (spell_templates, arena_seed) => {
  const { state, ctx } = duel(spell_templates, arena_seed)
  const before = find_entity(state, 'm0').health
  const after = reduce(
    state,
    {
      type: 'cast',
      entity_id: 'p0',
      spell_id: 'cold_deck',
      target: { x: 6, y: 5 },
    },
    ctx,
  ).state
  return (before - find_entity(after, 'm0').health) / 20
}

describe('an authored chance under 100 is a die, on both twins', () => {
  test('chance 0 never lands and chance 100 always does — the two deterministic ends', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(strike(templates(0, 0), seed)).toBe(0)
      expect(strike(templates(100, 100), seed)).toBe(2)
      // The mixed spell is the Cold Deck shape with the die removed from one side: exactly one line lands.
      expect(strike(templates(100, 0), seed)).toBe(1)
    }
  })

  test('BOTH certainties short-circuit without drawing (cast::effect_proc returns before prng::rng_int)', () => {
    const rng = rng_seed(12345)
    for (const chance of [0, 100, 255]) {
      const rolled = effect_triggers(rng, { chance })
      expect(rolled.rng).toBe(rng) // the thread is untouched — byte-identical to no roll at all
      expect(rolled.value).toBe(chance !== 0)
    }
    // …and a genuine chance DOES advance it.
    expect(effect_triggers(rng, { chance: 50 }).rng).not.toBe(rng)
  })

  test('a 50/50 line lands sometimes and misses sometimes over a seed sweep', () => {
    const spell_templates = templates(50, 50)
    const landings = Array.from({ length: 40 }, (_, i) =>
      strike(spell_templates, i + 1),
    )
    const total = landings.reduce((sum, n) => sum + n, 0)
    expect(total).toBeGreaterThan(0)
    expect(total).toBeLessThan(80) // 40 casts × 2 lines — never the unconditional 100% the chain used to give
    expect(landings.some(n => n < 2)).toBe(true)
  })
})
