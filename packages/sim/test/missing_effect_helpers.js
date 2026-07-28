// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { process_spell_cast } from '../src/fight_spells.js'
import { create_fight_state } from '../src/reduce.js'
import { SHAPE_POINT, TF_NOT_TEAM } from '../src/spell_effect.js'
import { normalize_spell_templates } from '../src/spell_templates.js'

export const arena = {
  width: 9,
  height: 9,
  radius: 4,
  center: { x: 4, y: 4 },
  cells: new Uint8Array(81),
  spawns_a: [],
  spawns_b: [],
}

export const fighter = (
  id,
  cell,
  is_player,
  { health = 100, health_max = 100, stats = {}, effects = [], hand = [] } = {},
) => ({
  id,
  name: id,
  cell,
  health,
  health_max,
  ap: 10,
  ap_max: 10,
  mp: 6,
  mp_max: 6,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'wave_12_vector',
  level: 1,
  stats,
  effects,
  hand,
  spell_levels: Object.fromEntries(hand.map(spell_id => [spell_id, 1])),
  ap_reserve: 0,
})

export const state_of = (team0, team1, seed = 1, fight_id = 'wave_12') => ({
  ...create_fight_state({
    fight_id,
    arena_seed: seed,
    arena_radius: 4,
    arena,
    team0,
    team1,
  }),
  started: true,
  turn_order: [...team0, ...team1].map(entity => entity.id),
  turn_number: 1,
  last_total_hp: [...team0, ...team1].reduce(
    (sum, entity) => sum + entity.health,
    0,
  ),
})

export const active = (type, overrides = {}) => ({
  id: overrides.id ?? 10,
  type,
  timing: 'TURN_START',
  source_id: overrides.source_id ?? 'p0',
  value: overrides.value ?? 0,
  turns_remaining: overrides.turns_remaining ?? 2,
  ...overrides,
})

export const raw_effect = (kind, overrides = {}) => ({
  kind,
  value: overrides.value ?? 0,
  element: overrides.element ?? 2,
  target_filter: overrides.target_filter ?? TF_NOT_TEAM,
  chance: overrides.chance ?? 100,
  turns: overrides.turns ?? 0,
  stat: overrides.stat ?? 0,
  flags: overrides.flags ?? 0,
  area_shape: overrides.area_shape ?? SHAPE_POINT,
  area_size: overrides.area_size ?? 0,
  ...overrides,
})

export const spell_of = (id, effects, overrides = {}) =>
  normalize_spell_templates([
    {
      id,
      levels: [
        {
          ap_cost: overrides.ap_cost ?? 0,
          range_min: 0,
          range_max: overrides.range_max ?? 8,
          modifiable_range: overrides.modifiable_range ?? false,
          line_launch: false,
          line_of_sight: false,
          free_cell: false,
          casts_per_turn: overrides.casts_per_turn ?? 255,
          casts_per_target: overrides.casts_per_target ?? 255,
          cooldown_turns: 0,
          crit_rate: 0,
          effects,
          crit_effects: [],
        },
      ],
    },
  ]).get(id)

export const cast = (state, caster_id, spell, target) =>
  process_spell_cast(state, caster_id, spell, 1, target, {
    blocks_los: () => false,
    is_occupied: () => false,
  })
