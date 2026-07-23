// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { effective_stats, find_entity } from '../src/fight_state.js'
import { apply_stat_effect } from '../src/fight_stat_effects.js'
import { calculate_final_damage } from '../src/spell_calculator.js'
import { reduce } from '../src/reduce.js'
import {
  FLAG_DODGE,
  FLAG_NEGATIVE,
  K_ALTER_STAT,
  K_DAMAGE,
  K_REMOVE_POINTS,
  POINT_AP,
  POINT_MP,
  TF_NOT_TEAM,
} from '../src/spell_effect.js'

import {
  active,
  arena,
  cast,
  fighter,
  raw_effect,
  spell_of,
  state_of,
} from './missing_effect_helpers.js'
import golden from './vectors/missing_effect_stats_golden.json' with { type: 'json' }

const run_normalize_stats = vector => {
  const spell = spell_of(
    vector.id,
    vector.input.ids.map(stat => raw_effect(K_ALTER_STAT, { stat, value: 5 })),
  )
  return {
    types: spell.levels[0].base_effects.map(effect => effect.type),
    stats: spell.levels[0].base_effects.map(effect => effect.stat),
  }
}

const drain_result = (vector, dodge, point) => {
  const caster = fighter('p0', { x: 2, y: 2 }, true, {
    stats: { wisdom: vector.input.caster_wisdom },
  })
  const target = fighter('m0', { x: 3, y: 2 }, false, {
    stats: {
      agility: vector.input.target_agility,
      [point === POINT_AP ? 'ap_dodge' : 'mp_dodge']: dodge,
    },
  })
  const state = state_of([caster], [target], vector.input.seed)
  const spell = spell_of('drain', [
    raw_effect(K_REMOVE_POINTS, {
      stat: point,
      value: vector.input.requested,
      flags: FLAG_DODGE,
      turns: 1,
    }),
  ])
  const [effect] = spell.levels[0].base_effects
  const applied = apply_stat_effect(state, effect, caster, target)
  const pool = point === POINT_AP ? 'ap' : 'mp'
  return target[pool] - find_entity(applied.state, target.id)[pool]
}

const run_ap_dodge = vector => ({
  without_explicit: drain_result(vector, 0, POINT_AP),
  with_explicit: drain_result(vector, vector.input.explicit_ap_dodge, POINT_AP),
})

const run_mp_dodge = vector => ({
  without_explicit: drain_result(vector, 0, POINT_MP),
  with_explicit: drain_result(vector, vector.input.explicit_mp_dodge, POINT_MP),
})

const run_negative_ap_dodge = vector => {
  const caster = fighter('p0', { x: 2, y: 2 }, true)
  const target = fighter('m0', { x: 3, y: 2 }, false, {
    stats: { ap_dodge: vector.input.base_ap_dodge },
  })
  const spell = spell_of(vector.id, [
    raw_effect(K_ALTER_STAT, {
      stat: 12,
      value: vector.input.debuff,
      flags: FLAG_NEGATIVE,
      turns: 1,
    }),
  ])
  const result = cast(
    state_of([caster], [target]),
    caster.id,
    spell,
    target.cell,
  )
  const after = find_entity(result.state, target.id)
  return {
    normalized_type: spell.levels[0].base_effects[0].type,
    event: result.effects[0]?.status,
    effective_ap_dodge: effective_stats(after).ap_dodge,
  }
}

const run_fumble = vector => {
  const caster = fighter('p0', { x: 2, y: 2 }, true, {
    hand: [vector.id],
    effects: [
      active('CRITICAL_FAILURE', {
        source_id: 'p0',
        value: vector.input.denominator,
      }),
    ],
  })
  const target = fighter('m0', { x: 3, y: 2 }, false)
  const state = state_of([caster], [target])
  const spell = spell_of(
    vector.id,
    [
      raw_effect(K_DAMAGE, {
        value: vector.input.damage,
        target_filter: TF_NOT_TEAM,
      }),
    ],
    { ap_cost: vector.input.ap_cost, casts_per_turn: 1, casts_per_target: 1 },
  )
  const result = reduce(
    state,
    {
      type: 'cast',
      entity_id: caster.id,
      spell_id: vector.id,
      target: target.cell,
    },
    { arena, spell_templates: new Map([[vector.id, spell]]) },
  )
  const after = find_entity(result.state, caster.id)
  const cast_event = result.events.find(event => event.type === 'fight_cast')
  return {
    fumbled: cast_event?.effects[0]?.status === 'CRITICAL_FAILURE_FUMBLE',
    caster_ap: after.ap,
    caster_ap_used: after.ap_used,
    history_rows:
      Object.keys(result.state.cast_history).length +
      Object.keys(result.state.target_history).length,
    target_hp: find_entity(result.state, target.id).health,
    hand: after.hand.length,
    discard: after.discard.length,
  }
}

const damage = (base, element, bonus) =>
  calculate_final_damage(
    { type: 'DAMAGE', min: base, max: base, element },
    { physical_damage: bonus },
    {},
    0, // #577 — fixed effect (min==max): roll-independent
  ).damage

const run_physical_damage = vector => ({
  earth: damage(vector.input.base, 'EARTH', vector.input.bonus),
  neutral: damage(vector.input.base, 'NONE', vector.input.bonus),
  fire: damage(vector.input.base, 'FIRE', vector.input.bonus),
})

const runners = {
  normalize_stats: run_normalize_stats,
  ap_dodge: run_ap_dodge,
  mp_dodge: run_mp_dodge,
  negative_ap_dodge: run_negative_ap_dodge,
  fumble: run_fumble,
  physical_damage: run_physical_damage,
}

describe('wave 12 stat-like golden vectors', () => {
  for (const vector of golden.cases)
    test(vector.id, () => {
      expect(runners[vector.scenario](vector)).toEqual(vector.expected)
    })
})
