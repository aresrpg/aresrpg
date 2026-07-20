// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { ai_choose_turn } from '../src/fight_ai.js'
import {
  clear_fighter_status_kind,
  fighter_status_of,
} from '../src/effect_board.js'
import { process_spell_cast } from '../src/fight_spells.js'
import { fighter_is_invisible, is_invisible } from '../src/fight_statuses.js'
import { find_entity, get_current_turn_entity } from '../src/fight_state.js'
import { check_traps } from '../src/fight_traps.js'
import { create_fight_state, reduce } from '../src/reduce.js'
import {
  K_DAMAGE,
  K_INVISIBILITY,
  K_REVEAL,
  SHAPE_POINT,
  TF_NOT_TEAM,
  TF_ONLY_CASTER,
} from '../src/spell_effect.js'
import { normalize_spell_templates } from '../src/spell_templates.js'

import golden from './vectors/statuses_golden.json' with { type: 'json' }

const WIDTH = 9
const arena = {
  width: WIDTH,
  height: WIDTH,
  radius: 4,
  center: { x: 4, y: 4 },
  cells: new Uint8Array(WIDTH * WIDTH),
  spawns_a: [],
  spawns_b: [],
}
const targeting = { blocks_los: () => false, is_occupied: () => false }
const encode = cell => cell.y * WIDTH + cell.x

const invisibility = (id = 80, turns = 3, source_id = 'p0') => ({
  id,
  type: /** @type {const} */ ('INVISIBILITY'),
  timing: /** @type {const} */ ('TURN_START'),
  source_id,
  value: 0,
  turns_remaining: turns,
})

const mp_rider = (id = 81, source_id = 'p0') => ({
  id,
  type: /** @type {const} */ ('STAT_BUFF'),
  timing: /** @type {const} */ ('TURN_START'),
  source_id,
  stat: /** @type {const} */ ('mp'),
  value: 2,
  turns_remaining: 3,
})

const ap_rider = (id = 82, source_id = 'p0') => ({
  id,
  type: /** @type {const} */ ('STAT_BUFF'),
  timing: /** @type {const} */ ('TURN_START'),
  source_id,
  stat: /** @type {const} */ ('ap'),
  value: 1,
  turns_remaining: 2,
})

const fighter = (
  id,
  cell,
  is_player,
  { effects = [], hand = [], level = 1 } = {},
) => ({
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
  template_id: 'status_vector',
  level,
  stats: {},
  effects,
  deck: [],
  hand,
  discard: [],
  spell_levels: Object.fromEntries(hand.map(id => [id, 1])),
  ap_reserve: 0,
})

const state_of = (team0, team1, turn_order) => ({
  ...create_fight_state({
    fight_id: 'status_golden',
    arena_seed: 7,
    arena_radius: 4,
    arena,
    team0,
    team1,
  }),
  started: true,
  turn_order: turn_order ?? [...team0, ...team1].map(entity => entity.id),
  turn_number: 1,
  last_total_hp: [...team0, ...team1].reduce(
    (sum, entity) => sum + entity.health,
    0,
  ),
})

const status_names = entity =>
  entity.effects.map(effect =>
    effect.type === 'INVISIBILITY'
      ? 'INVISIBILITY'
      : effect.stat === 'mp'
        ? 'MP_RIDER'
        : effect.stat === 'ap'
          ? 'AP_RIDER'
          : effect.type,
  )

const raw_effect = input => ({
  kind: input.effect_kind,
  value: input.value ?? 0,
  element: 2,
  target_filter: input.target_filter ?? TF_NOT_TEAM,
  chance: 100,
  turns: input.turns ?? 0,
  area_shape: input.area_shape ?? SHAPE_POINT,
  area_size: input.area_size ?? 0,
})

const spell_of = (
  id,
  effects,
  { ap_cost = 0, range_max = 8, tracked = false } = {},
) =>
  normalize_spell_templates([
    {
      id,
      levels: [
        {
          ap_cost,
          range_min: 0,
          range_max,
          modifiable_range: false,
          line_launch: false,
          line_of_sight: false,
          free_cell: false,
          casts_per_turn: tracked ? 1 : 255,
          casts_per_target: tracked ? 1 : 255,
          cooldown_turns: 0,
          crit_rate: 0,
          effects,
          crit_effects: [],
        },
      ],
    },
  ]).get(id)

const run_normalize = vector => {
  const spell = spell_of(vector.id, vector.input.effects)
  return { types: spell.levels[0].base_effects.map(effect => effect.type) }
}

const run_explicit_reveal = vector => {
  const caster = fighter('p0', { x: 2, y: 2 }, true)
  const target = fighter('m0', { x: 4, y: 2 }, false, {
    effects: [invisibility(), mp_rider(), ap_rider()],
  })
  const state = state_of([caster], [target])
  const spell = spell_of(vector.id, [raw_effect(vector.input)])
  const cast = process_spell_cast(
    state,
    caster.id,
    spell,
    1,
    { x: 3, y: 2 },
    targeting,
  )
  return { target_statuses: status_names(find_entity(cast.state, target.id)) }
}

const run_direct_hidden = vector => {
  const caster = fighter('p0', { x: 2, y: 2 }, true)
  const target = fighter('m0', { x: 3, y: 2 }, false, {
    effects: [invisibility()],
  })
  const state = state_of([caster], [target])
  const spell = spell_of(vector.id, [raw_effect(vector.input)], {
    ap_cost: vector.input.ap_cost,
    tracked: true,
  })
  const cast = process_spell_cast(
    state,
    caster.id,
    spell,
    1,
    target.cell,
    targeting,
  )
  return {
    error: cast.error,
    caster_ap: find_entity(cast.state, caster.id).ap,
    history_rows:
      Object.keys(cast.state.cast_history).length +
      Object.keys(cast.state.target_history).length,
    state_unchanged: cast.state === state,
    target_hp: find_entity(cast.state, target.id).health,
  }
}

const run_aoe_hidden = vector => {
  const caster = fighter('p0', { x: 2, y: 2 }, true)
  const target = fighter('m0', { x: 4, y: 2 }, false, {
    effects: [invisibility()],
  })
  const state = state_of([caster], [target])
  const spell = spell_of(vector.id, [raw_effect(vector.input)])
  const cast = process_spell_cast(
    state,
    caster.id,
    spell,
    1,
    { x: 3, y: 2 },
    targeting,
  )
  const after = find_entity(cast.state, target.id)
  return {
    target_hp: after.health,
    target_statuses: status_names(after),
  }
}

const run_direct_damage = vector => {
  const caster = fighter('p0', { x: 2, y: 2 }, true, {
    effects: [invisibility(), mp_rider()],
  })
  const target = fighter('m0', { x: 3, y: 2 }, false)
  const state = state_of([caster], [target])
  const spell = spell_of(vector.id, [raw_effect(vector.input)])
  const cast = process_spell_cast(
    state,
    caster.id,
    spell,
    1,
    target.cell,
    targeting,
  )
  return {
    caster_statuses: status_names(find_entity(cast.state, caster.id)),
    target_hp: find_entity(cast.state, target.id).health,
  }
}

const run_trap_damage = vector => {
  const owner = fighter('p0', { x: 2, y: 2 }, true, {
    effects: [invisibility(), mp_rider()],
  })
  const target = fighter('m0', { x: 3, y: 2 }, false)
  const state = state_of([owner], [target])
  const payload = spell_of(`${vector.id}_payload`, [raw_effect(vector.input)])
    .levels[0].base_effects
  const trapped = {
    ...state,
    traps: [
      {
        id: 1,
        source_id: owner.id,
        anchor: target.cell,
        cells: [target.cell],
        payload,
      },
    ],
  }
  const triggered = check_traps(trapped, target.cell, target.id)
  return {
    owner_statuses: status_names(find_entity(triggered.state, owner.id)),
    target_hp: find_entity(triggered.state, target.id).health,
  }
}

const run_push_collision = vector => {
  const caster = fighter('p0', { x: 2, y: 2 }, true, {
    effects: [invisibility(), mp_rider()],
    level: vector.input.caster_level,
  })
  const blocker = fighter('p1', { x: 4, y: 2 }, true)
  const target = fighter('m0', { x: 3, y: 2 }, false)
  const state = state_of([caster, blocker], [target])
  const spell = spell_of(vector.id, [raw_effect(vector.input)])
  const cast = process_spell_cast(
    state,
    caster.id,
    spell,
    1,
    target.cell,
    targeting,
  )
  return {
    caster_statuses: status_names(find_entity(cast.state, caster.id)),
    target_hp: find_entity(cast.state, target.id).health,
  }
}

const ai_spell_state = vector => {
  const spell_id = `${vector.id}_attack`
  const templates = normalize_spell_templates([])
  templates.set(
    spell_id,
    spell_of(
      spell_id,
      [
        raw_effect({
          effect_kind: K_DAMAGE,
          value: 20,
          area_shape: SHAPE_POINT,
        }),
      ],
      { range_max: 4 },
    ),
  )
  return { spell_id, templates }
}

const run_mob_targeting = vector => {
  const { spell_id, templates } = ai_spell_state(vector)
  const hidden = fighter('p0', { x: 5, y: 4 }, true, {
    effects: [invisibility()],
  })
  const visible = fighter('p1', { x: 5, y: 5 }, true)
  const mob = fighter('m0', { x: 4, y: 4 }, false, { hand: [spell_id] })
  const state = state_of(
    [hidden, visible],
    [mob],
    [mob.id, hidden.id, visible.id],
  )
  const plan = ai_choose_turn(state, mob.id, templates, () => true, targeting)
  const cast = plan.find(action => action.type === 'cast')
  return { cast_target: cast ? encode(cast.target) : -1 }
}

const run_all_hidden = vector => {
  const { spell_id, templates } = ai_spell_state(vector)
  const hidden = fighter('p0', { x: 5, y: 4 }, true, {
    effects: [invisibility(80, vector.input.hidden_turns)],
  })
  const mob = fighter('m0', { x: 4, y: 4 }, false, { hand: [spell_id] })
  const state = state_of([hidden], [mob], [mob.id, hidden.id])
  const result = reduce(
    state,
    { type: 'ai_turn', entity_id: mob.id },
    { arena, spell_templates: templates },
  )
  return {
    next_actor: get_current_turn_entity(result.state)?.id,
    hidden_remaining: fighter_is_invisible(result.state, hidden.id),
    mob_moved: result.events.some(event => event.type === 'fight_moved'),
    mob_cast: result.events.some(event => event.type === 'fight_cast'),
  }
}

const run_mob_damage = vector => {
  const player = fighter('p0', { x: 2, y: 2 }, true)
  const mob = fighter('m0', { x: 3, y: 2 }, false)
  const state = state_of([player], [mob])
  const hide_spell = spell_of(`${vector.id}_hide`, [
    raw_effect({
      effect_kind: K_INVISIBILITY,
      turns: 3,
      target_filter: TF_ONLY_CASTER,
    }),
  ])
  const hidden = process_spell_cast(
    state,
    mob.id,
    hide_spell,
    1,
    mob.cell,
    targeting,
  )
  expect(is_invisible(find_entity(hidden.state, mob.id))).toBe(true)
  const damage_spell = spell_of(vector.id, [raw_effect(vector.input)])
  const hit = process_spell_cast(
    hidden.state,
    mob.id,
    damage_spell,
    1,
    player.cell,
    targeting,
  )
  return {
    mob_statuses: status_names(find_entity(hit.state, mob.id)),
    target_hp: find_entity(hit.state, player.id).health,
  }
}

const run_vector = vector => {
  switch (vector.scenario) {
    case 'normalize':
      return run_normalize(vector)
    case 'explicit_reveal':
      return run_explicit_reveal(vector)
    case 'direct_hidden':
      return run_direct_hidden(vector)
    case 'aoe_hidden':
      return run_aoe_hidden(vector)
    case 'direct_damage':
      return run_direct_damage(vector)
    case 'trap_damage':
      return run_trap_damage(vector)
    case 'push_collision':
      return run_push_collision(vector)
    case 'mob_targeting':
      return run_mob_targeting(vector)
    case 'all_hidden':
      return run_all_hidden(vector)
    case 'mob_damage':
      return run_mob_damage(vector)
    default:
      throw new Error(`Unknown status vector scenario: ${vector.scenario}`)
  }
}

describe('U6 invisibility status golden vectors', () => {
  for (const vector of golden.cases) {
    test(vector.id, () => {
      expect(run_vector(vector)).toMatchObject(vector.expected)
    })
  }
})

test('status vector vocabulary stays pinned to additive kinds 27 and 28', () => {
  expect(golden.rules.invisibility_kind).toBe(K_INVISIBILITY)
  expect(golden.rules.reveal_kind).toBe(K_REVEAL)
})

test('numeric status-board reveal clears every kind-27 row only', () => {
  const keep_first = { kind: 6, stat: 1 }
  const keep_second = { kind: 6, stat: 0 }
  const board = {
    cell_entries: [],
    statuses: [
      {
        fighter: 0,
        kind: K_INVISIBILITY,
        effect: { kind: 27 },
        remaining_turns: 3,
        source: 0,
      },
      {
        fighter: 0,
        kind: K_INVISIBILITY,
        effect: { kind: 27 },
        remaining_turns: 2,
        source: 0,
      },
      {
        fighter: 0,
        kind: 6,
        effect: keep_first,
        remaining_turns: 3,
        source: 0,
      },
      {
        fighter: 0,
        kind: 6,
        effect: keep_second,
        remaining_turns: 2,
        source: 0,
      },
      {
        fighter: 1,
        kind: K_INVISIBILITY,
        effect: { kind: 27 },
        remaining_turns: 3,
        source: 0,
      },
    ],
  }
  clear_fighter_status_kind(board, 0, K_INVISIBILITY)
  expect(fighter_status_of(board, 0, K_INVISIBILITY)).toBeUndefined()
  expect(fighter_status_of(board, 0, 6)).toBe(keep_first)
  expect(fighter_status_of(board, 1, K_INVISIBILITY)).toBeDefined()
})
