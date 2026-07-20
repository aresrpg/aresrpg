// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { process_spell_cast } from '../src/fight_spells.js'
import { find_entity } from '../src/fight_state.js'
import { create_fight_state } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import {
  K_PLACE_TRAP,
  K_PULL,
  K_PUSH,
  SHAPE_CROSS,
  SHAPE_POINT,
  TF_NOT_TEAM,
} from '../src/spell_effect.js'

const level = effects => ({
  min_char_level: 1,
  ap_cost: 3,
  range_min: 1,
  range_max: 6,
  modifiable_range: true,
  line_launch: false,
  line_of_sight: true,
  free_cell: false,
  casts_per_turn: 255,
  casts_per_target: 1,
  cooldown_turns: 2,
  crit_rate: 30,
  effects,
  crit_effects: [
    {
      kind: K_PULL,
      value: 3,
      target_filter: TF_NOT_TEAM,
      chance: 100,
      area_shape: SHAPE_POINT,
      area_size: 0,
    },
  ],
})

const fighter = (id, cell, is_player) => ({
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
  template_id: 'parity',
  level: 50,
  stats: {},
  effects: [],
  deck: [],
  hand: [],
  discard: [],
  spell_levels: {},
  ap_reserve: 0,
})

describe('current numeric spell adapter', () => {
  test('maps PUSH/PULL value cells, lists, target filter, and per-effect area', () => {
    const templates = normalize_spell_templates([
      {
        id: 'parity_push',
        name: 'Parity Push',
        levels: [
          level([
            {
              kind: K_PUSH,
              value: 2,
              target_filter: TF_NOT_TEAM,
              chance: 100,
              area_shape: SHAPE_CROSS,
              area_size: 1,
            },
          ]),
        ],
      },
    ])
    const [normalized] = templates.get('parity_push').levels
    expect(normalized.cost).toBe(3)
    expect(normalized.range).toEqual([1, 6])
    expect(normalized.critical_chance).toBe(30)
    expect(normalized.cooldown_turns).toBe(2)
    expect(normalized.base_effects).toEqual([
      expect.objectContaining({
        kind: K_PUSH,
        type: 'PUSH',
        distance: 2,
        target_filter: TF_NOT_TEAM,
        area_shape: SHAPE_CROSS,
        area_size: 1,
      }),
    ])
    expect(normalized.crit_effects).toEqual([
      expect.objectContaining({
        kind: K_PULL,
        type: 'PULL',
        distance: 3,
        target_filter: TF_NOT_TEAM,
        area_shape: SHAPE_POINT,
      }),
    ])
  })

  test('turns PLACE_TRAP siblings into deferred payload only', () => {
    const templates = normalize_spell_templates({
      spells: [
        {
          id: 'springjaw_shape',
          name: 'Springjaw Shape',
          levels: [
            {
              ...level([]),
              free_cell: true,
              crit_effects: [],
              effects: [
                {
                  kind: K_PLACE_TRAP,
                  value: 1,
                  target_filter: TF_NOT_TEAM,
                  chance: 100,
                  area_shape: SHAPE_CROSS,
                  area_size: 1,
                },
                {
                  kind: K_PUSH,
                  value: 2,
                  target_filter: TF_NOT_TEAM,
                  chance: 100,
                },
              ],
            },
          ],
        },
      ],
    })
    const effects = templates.get('springjaw_shape').levels[0].base_effects
    expect(effects).toHaveLength(1)
    expect(effects[0]).toEqual(
      expect.objectContaining({
        type: 'PLACE_TRAP',
        area_shape: SHAPE_CROSS,
        area_size: 1,
      }),
    )
    expect(effects[0].payload).toEqual([
      expect.objectContaining({ type: 'PUSH', distance: 2 }),
    ])
  })

  test('applies a current effect target_filter before resolving its AoE targets', () => {
    const templates = normalize_spell_templates([
      {
        id: 'filtered_push',
        levels: [
          {
            ...level([
              {
                kind: K_PUSH,
                value: 1,
                target_filter: TF_NOT_TEAM,
                chance: 100,
                area_shape: SHAPE_CROSS,
                area_size: 1,
              },
            ]),
            crit_rate: 0,
          },
        ],
      },
    ])
    const arena = {
      width: 9,
      height: 9,
      radius: 4,
      center: { x: 4, y: 4 },
      cells: new Uint8Array(81),
      spawns_a: [],
      spawns_b: [],
    }
    const state = {
      ...create_fight_state({
        fight_id: 'filter',
        arena_seed: 1,
        arena_radius: 4,
        arena,
        team0: [
          fighter('caster', { x: 2, y: 4 }, true),
          fighter('ally', { x: 4, y: 5 }, true),
        ],
        team1: [fighter('enemy', { x: 4, y: 4 }, false)],
      }),
      started: true,
    }
    const cast = process_spell_cast(
      state,
      'caster',
      templates.get('filtered_push'),
      1,
      { x: 4, y: 4 },
      { blocks_los: () => false, is_occupied: () => false },
    )

    expect(cast.success).toBe(true)
    expect(find_entity(cast.state, 'enemy').cell).toEqual({ x: 5, y: 4 })
    expect(find_entity(cast.state, 'ally').cell).toEqual({ x: 4, y: 5 })
    expect(cast.effects).toEqual([
      { target_id: 'enemy', cell: { x: 5, y: 4 }, has_cell: true },
    ])
  })
})
