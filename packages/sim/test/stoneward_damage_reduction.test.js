// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1660 INSTRUMENT — Stoneward must reduce a real hit, not merely mint a decorative status row. The no-ward
// drive is the positive control: both branches land the same fixed earth hit on the same fighter, and only the
// Stoneward branch may subtract the published level-1 flat value.

import { describe, expect, test } from 'bun:test'

import { process_spell_cast } from '../src/fight_spells.js'
import { find_entity } from '../src/fight_state.js'
import { create_fight_state } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import {
  K_DAMAGE,
  K_REDUCE_DAMAGE,
  SHAPE_POINT,
  TF_NOT_ENEMY,
  TF_NOT_TEAM,
} from '../src/spell_effect.js'

const CASTER = 'stoneward-caster'
const ATTACKER = 'earth-attacker'
const CASTER_CELL = { x: 2, y: 4 }
const ATTACKER_CELL = { x: 4, y: 4 }
const HIT = 30
const ABSORB = 10

const arena = {
  width: 9,
  height: 9,
  radius: 4,
  center: { x: 4, y: 4 },
  cells: new Uint8Array(81),
  spawns_a: [CASTER_CELL],
  spawns_b: [ATTACKER_CELL],
}

const fighter = (id, cell, is_player, spells) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
  ap: 10,
  ap_max: 10,
  mp: 5,
  mp_max: 5,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'stoneward_instrument',
  level: 1,
  stats: {},
  effects: [],
  spell_levels: spells,
  ap_reserve: 0,
})

const level = effects => ({
  min_char_level: 1,
  ap_cost: 0,
  range_min: 0,
  range_max: 4,
  modifiable_range: false,
  line_launch: false,
  line_of_sight: false,
  free_cell: false,
  casts_per_turn: 255,
  casts_per_target: 255,
  cooldown_turns: 0,
  crit_rate: 0,
  effects,
  crit_effects: [],
})

const templates = normalize_spell_templates([
  {
    id: 'shugo_stoneward',
    name: 'Stoneward',
    levels: [
      level([
        {
          kind: K_REDUCE_DAMAGE,
          element: 2,
          value: ABSORB,
          value_max: ABSORB,
          area_shape: SHAPE_POINT,
          area_size: 0,
          target_filter: TF_NOT_ENEMY,
          chance: 100,
          turns: 4,
          stat: 0,
          flags: 0,
          phase: 0,
        },
      ]),
    ],
  },
  {
    id: 'earth_hit',
    name: 'Earth hit',
    levels: [
      level([
        {
          kind: K_DAMAGE,
          element: 2,
          value: HIT,
          value_max: HIT,
          area_shape: SHAPE_POINT,
          area_size: 0,
          target_filter: TF_NOT_TEAM,
          chance: 100,
          turns: 0,
          stat: 0,
          flags: 0,
          phase: 0,
        },
      ]),
    ],
  },
])

const fresh = () => ({
  ...create_fight_state({
    fight_id: 'stoneward_reduction_instrument',
    arena_seed: 1,
    arena_radius: 4,
    arena,
    team0: [fighter(CASTER, CASTER_CELL, true, { shugo_stoneward: 1 })],
    team1: [fighter(ATTACKER, ATTACKER_CELL, false, { earth_hit: 1 })],
  }),
  started: true,
  turn_order: [CASTER, ATTACKER],
  turn_number: 1,
  last_total_hp: 200,
})

const cast = (state, entity_id, spell_id, target) =>
  process_spell_cast(state, entity_id, templates.get(spell_id), 1, target, {
    blocks_los: () => false,
    is_occupied: () => true,
  })

const health = state => find_entity(state, CASTER).health

describe('#1660 Stoneward reduction instrument', () => {
  test('casting Stoneward reduces the same earth hit that the no-ward control takes in full', () => {
    const control_start = fresh()
    const control_hit = cast(control_start, ATTACKER, 'earth_hit', CASTER_CELL)
    expect(control_hit.success).toBe(true)
    const control_damage = health(control_start) - health(control_hit.state)

    const ward_start = fresh()
    const ward_cast = cast(ward_start, CASTER, 'shugo_stoneward', CASTER_CELL)
    expect(ward_cast.success).toBe(true)
    expect(find_entity(ward_cast.state, CASTER).effects).toEqual([
      expect.objectContaining({ type: 'SHIELD', value: ABSORB }),
    ])
    const ward_hit = cast(ward_cast.state, ATTACKER, 'earth_hit', CASTER_CELL)
    expect(ward_hit.success).toBe(true)
    const warded_damage = health(ward_cast.state) - health(ward_hit.state)

    expect(control_damage).toBe(HIT)
    expect(warded_damage).toBe(HIT - ABSORB)
    expect(control_damage - warded_damage).toBeGreaterThan(0)
  })
})
