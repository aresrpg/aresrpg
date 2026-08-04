// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2153 — ONLY_CASTER is a caster-selection mask, not a zone-intersection mask. This follows the shared-fixture
// convention in `aoe_splash_target_filter.test.js`: the sim and Move readers drive the real resolver doors with
// the same cells and rows from `fixtures/caster_target_zone_bypass.json`.

import { describe, expect, test } from 'bun:test'

import { find_entity } from '../src/fight_state.js'
import { process_spell_cast } from '../src/fight_spells.js'
import { create_fight_state } from '../src/reduce.js'
import { TF_NOT_ENEMY, TF_ONLY_CASTER } from '../src/spell_effect.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import { get_aoe_cells } from '../src/spell_targeting.js'

import { CAST_CTX, MATRIX_ARENA } from './spell_effect_conformance_matrix.js'
import FIXTURE from './fixtures/caster_target_zone_bypass.json' with { type: 'json' }

const GRID_W = 20
const decode = cell => ({ x: cell % GRID_W, y: Math.floor(cell / GRID_W) })

const fighter = (id, cell, is_player) => ({
  id,
  name: id,
  cell: decode(cell),
  health: 500,
  health_max: 500,
  ap: 99,
  ap_max: 99,
  mp: 20,
  mp_max: 20,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'caster-zone-bypass',
  level: 50,
  stats: {},
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})

const state_of = () => ({
  ...create_fight_state({
    fight_id: 'caster-zone-bypass',
    arena_seed: 1,
    arena_radius: 4,
    arena: MATRIX_ARENA,
    team0: [fighter('enemy', FIXTURE.enemy_cell, true)],
    team1: [
      fighter('caster', FIXTURE.caster_cell, false),
      fighter('ally', FIXTURE.ally_cell, false),
    ],
  }),
  started: true,
  turn_order: ['caster', 'ally', 'enemy'],
  turn_number: 1,
})

const spell = normalize_spell_templates([
  {
    id: 'caster_zone_bypass',
    levels: [
      {
        ap_cost: 0,
        range_min: 0,
        range_max: 9,
        modifiable_range: false,
        line_launch: false,
        line_of_sight: false,
        free_cell: false,
        casts_per_turn: 255,
        casts_per_target: 255,
        cooldown_turns: 0,
        crit_rate: 0,
        effects: [FIXTURE.only_caster_effect, FIXTURE.zone_effect],
        crit_effects: [],
      },
    ],
  },
]).get('caster_zone_bypass')

describe('#2153 — caster-filtered rows bypass an enemy-targeted zone', () => {
  test('fixture control — the zone contains ally and enemy, but not caster', () => {
    const cells = get_aoe_cells(
      FIXTURE.only_caster_effect,
      decode(FIXTURE.target_cell),
      decode(FIXTURE.caster_cell),
    ).map(cell => cell.y * GRID_W + cell.x)
    expect(cells).toEqual(FIXTURE.zone_cells)
    expect(cells).toContain(FIXTURE.ally_cell)
    expect(cells).toContain(FIXTURE.enemy_cell)
    expect(cells).not.toContain(FIXTURE.caster_cell)
  })

  test('ONLY_CASTER reaches caster while TF_NOT_ENEMY still walks the zone', () => {
    expect(FIXTURE.only_caster_effect.target_filter).toBe(TF_ONLY_CASTER)
    expect(FIXTURE.zone_effect.target_filter).toBe(TF_NOT_ENEMY)
    const state = state_of()
    const before = Object.fromEntries(
      [...state.team0, ...state.team1].map(entity => [
        entity.id,
        entity.health,
      ]),
    )
    const result = process_spell_cast(
      state,
      'caster',
      spell,
      1,
      decode(FIXTURE.target_cell),
      CAST_CTX,
    )

    expect(result.success).toBe(true)
    expect(
      find_entity(result.state, 'caster').effects.some(
        effect => effect.value === FIXTURE.only_caster_effect.value,
      ),
      'the out-of-zone caster receives its named-state row',
    ).toBe(true)
    expect(find_entity(result.state, 'ally').health).toBe(
      before.ally - FIXTURE.zone_effect.value,
    )
    expect(find_entity(result.state, 'enemy').health).toBe(before.enemy)
  })
})
