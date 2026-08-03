// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2031 INSTRUMENT — a live 7–12 trap band resolved as 10 forever because its stored endpoints were equal.
// Cured-era provenance: first wave digest Hh9ytJWoq5MfE5qZpWpyjc1UjyP6h6eVm2aFHWhuKNhF.
//
// The production door pinned here is fight_actions.js:498-512: every DoT row reaches calculate_final_damage with
// slot_damage_roll(tick_seed, ordinal), whose authored-band mapper is turn_seed.js:76-82. The Move twin pins the
// same door at packages/move/engine/sources/cast.move:1864-1876.
//
// N=10 independent DoT rows over the six-value [7,12] band. Under a fair roll the false pass "all N values are
// identical" has probability 6 * (1/6)^10 = 6^-9 = 1/10,077,696 ≈ 9.92e-8, safely below 1e-6.

import { describe, expect, test } from 'bun:test'

import { process_turn_effects } from '../src/fight_actions.js'
import { create_fight_state } from '../src/reduce.js'

const N = 10
const BAND_MIN = 7
const BAND_MAX = 12
// create_fight's Move scaffold: world_seed=12345, spawn_id=1, pre-first-turn entropy/ordinal=0, mob fid=1000.
const TICK_SEED = 3_049_140_046
const DEAD_ROLL =
  'dead-roll instrument: expected more than one distinct resolved value'

const ARENA = {
  width: 9,
  height: 9,
  radius: 4,
  center: { x: 4, y: 4 },
  cells: new Uint8Array(81),
  spawns_a: [{ x: 2, y: 4 }],
  spawns_b: [{ x: 4, y: 4 }],
}

const fighter = (id, is_player, cell, effects = []) => ({
  id,
  name: id,
  cell,
  health: 1_000,
  health_max: 1_000,
  ap: 10,
  ap_max: 10,
  mp: 5,
  mp_max: 5,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'roll-distribution-instrument',
  level: 1,
  stats: {},
  effects,
  spell_levels: {},
  ap_reserve: 0,
})

const dot_rows = (min, max) =>
  Array.from({ length: N }, (_, index) => ({
    id: index + 1,
    type: /** @type {const} */ ('DAMAGE'),
    timing: /** @type {const} */ ('TURN_START'),
    source_id: 'p0',
    element: /** @type {const} */ ('EARTH'),
    value: min,
    value_max: max,
    dot: true,
    turns_remaining: 5,
  }))

const trigger_values = (min, max) => {
  const state = {
    ...create_fight_state({
      fight_id: 'roll-distribution-instrument',
      arena_seed: 1,
      arena_radius: 4,
      arena: ARENA,
      team0: [fighter('p0', true, { x: 2, y: 4 })],
      team1: [fighter('m0', false, { x: 4, y: 4 }, dot_rows(min, max))],
    }),
    started: true,
    turn_order: ['p0', 'm0'],
    turn_number: 1,
  }
  return process_turn_effects(state, 'm0', TICK_SEED).effects.map(
    effect => effect.damage,
  )
}

const assert_varies = values => {
  if (new Set(values).size <= 1) throw new Error(DEAD_ROLL)
}

describe('#2031 dead-roll distribution instrument', () => {
  test('ten independent DoT triggers resolve more than one distinct value', () => {
    const values = trigger_values(BAND_MIN, BAND_MAX)
    expect(values).toEqual([9, 7, 9, 12, 7, 12, 12, 9, 10, 12])
    assert_varies(values)
  })

  test('negative control: a degenerate band fails exactly at the distinct-count assertion', () => {
    const values = trigger_values(10, 10)
    expect(values).toEqual(Array(N).fill(10))
    expect(() => assert_varies(values)).toThrow(DEAD_ROLL)
  })
})
