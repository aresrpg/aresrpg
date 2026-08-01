// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1809 — SPLASH MEMBERSHIP INTERSECTS `target_filter`. A zone effect authored enemies-only never lands on the
// caster or on the caster's allies, even when the resolved cells cover their cells. The fixture is the LIVE
// Devastating Slam row (see fixtures/aoe_splash_target_filter.json for its provenance); its chain twin reader is
// `packages/move/engine/tests/aoe_target_filter_tests.move`, driving the same geometry through
// `cast::resolve_mob_cast`.

import { describe, test, expect } from 'bun:test'

import { process_spell_cast } from '../src/fight_spells.js'
import { find_entity } from '../src/fight_state.js'
import { create_fight_state } from '../src/reduce.js'
import { get_aoe_cells } from '../src/spell_targeting.js'

import {
  MATRIX_ARENA,
  CAST_CTX,
  single_effect_spell,
} from './spell_effect_conformance_matrix.js'
import FIXTURE from './fixtures/aoe_splash_target_filter.json' with { type: 'json' }

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
  template_id: 'splash',
  level: 50,
  stats: {},
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})

// The caster mob and its ally stand in team1; the lone player is the only legal victim of an enemies-only line.
const splash_state = () => ({
  ...create_fight_state({
    fight_id: 'splash',
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

const ELEMENT = ['FIRE', 'WATER', 'EARTH', 'AIR']

describe('#1809 — an enemies-only zone never splashes its own caster', () => {
  test('the fixture geometry really does swallow the caster and its ally', () => {
    const cells = get_aoe_cells(
      {
        area_shape: FIXTURE.effect.area_shape,
        area_size: FIXTURE.effect.area_size,
      },
      decode(FIXTURE.target_cell),
      decode(FIXTURE.caster_cell),
    ).map(cell => cell.y * GRID_W + cell.x)
    expect(cells).toEqual(FIXTURE.zone_cells)
    expect(cells).toContain(FIXTURE.caster_cell)
    expect(cells).toContain(FIXTURE.ally_cell)
  })

  test('only the enemy bleeds — the caster and its ally take zero', () => {
    const state = splash_state()
    const before = Object.fromEntries(
      [...state.team0, ...state.team1].map(e => [e.id, e.health]),
    )
    const spell = single_effect_spell(
      'devastating_slam',
      {
        kind: FIXTURE.effect.kind,
        element: ELEMENT[FIXTURE.effect.element],
        value: FIXTURE.effect.value,
        value_max: FIXTURE.effect.value_max,
        area_shape: FIXTURE.effect.area_shape,
        area_size: FIXTURE.effect.area_size,
        target_filter: FIXTURE.effect.target_filter,
      },
      0,
      false,
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
    for (const id of FIXTURE.damaged)
      expect(find_entity(result.state, id).health).toBeLessThan(before[id])
    for (const id of FIXTURE.untouched)
      expect(find_entity(result.state, id).health).toBe(before[id])
  })
})
