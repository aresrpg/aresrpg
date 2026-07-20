// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  apply_incoming_damage,
  process_turn_effects,
} from '../src/fight_actions.js'
import { effective_stats, find_entity } from '../src/fight_state.js'
import {
  K_DAMAGE,
  K_DAMAGE_REDIRECT,
  K_EROSION,
  K_NAMED_DAMAGE_STACK,
  K_REACTIVE_PUNISHMENT,
} from '../src/spell_effect.js'

import {
  active,
  cast,
  fighter,
  raw_effect,
  spell_of,
  state_of,
} from './missing_effect_helpers.js'
import golden from './vectors/missing_effect_reactions_golden.json' with { type: 'json' }

const fresh_rows = () => {
  const fresh = state_of(
    [fighter('p0', { x: 2, y: 2 }, true)],
    [fighter('m0', { x: 3, y: 2 }, false)],
    1,
    'fresh_fight',
  )
  return find_entity(fresh, 'm0').effects.length
}

const run_named_stack = vector => {
  const caster = fighter('p0', { x: 2, y: 2 }, true, {
    stats: { strength: vector.input.strength },
  })
  const aimed = fighter('m0', { x: 4, y: 2 }, false)
  const other = fighter('m1', { x: 4, y: 3 }, false)
  const spell = spell_of(vector.id, [
    raw_effect(K_DAMAGE, {
      value: vector.input.base,
      area_shape: 1,
      area_size: 1,
    }),
    raw_effect(K_NAMED_DAMAGE_STACK, {
      value: vector.input.rider,
      turns: vector.input.turns,
      area_shape: 1,
      area_size: 1,
    }),
  ])
  const first = cast(
    state_of([caster], [aimed, other]),
    caster.id,
    spell,
    aimed.cell,
  )
  const second = cast(first.state, caster.id, spell, aimed.cell)
  const twice_aimed = find_entity(second.state, aimed.id)
  const twice_other = find_entity(second.state, other.id)
  const tick1 = process_turn_effects(first.state, aimed.id)
  const tick2 = process_turn_effects(tick1.state, aimed.id)
  const before = find_entity(tick2.state, aimed.id).health
  const after_expiry = cast(tick2.state, caster.id, spell, aimed.cell)
  return {
    aimed_hp_after_two: twice_aimed.health,
    other_hp_after_two: twice_other.health,
    aimed_stack_rows: twice_aimed.effects.filter(
      effect => effect.type === 'NAMED_DAMAGE_STACK',
    ).length,
    other_stack_rows: twice_other.effects.filter(
      effect => effect.type === 'NAMED_DAMAGE_STACK',
    ).length,
    hit_after_expiry: before - find_entity(after_expiry.state, aimed.id).health,
    fresh_fight_rows: fresh_rows(),
  }
}

const punishment_row = (id, stat, value, trigger_turns) =>
  active('REACTIVE_PUNISHMENT', {
    id,
    stat,
    value,
    trigger_turns,
    turns_remaining: 3,
  })

const run_punishment = vector => {
  const attacker = fighter('p0', { x: 2, y: 2 }, true)
  const target = fighter('m0', { x: 3, y: 2 }, false, {
    effects: [
      punishment_row(10, 'strength', 10, 2),
      punishment_row(11, 'percent_damage', 6, 2),
      punishment_row(12, 'vitality', 8, 1),
    ],
  })
  const hit = apply_incoming_damage(
    state_of([attacker], [target]),
    target.id,
    vector.input.hit,
    attacker.id,
  )
  const after = find_entity(hit.state, target.id)
  const expired = process_turn_effects(hit.state, target.id)
  const killed_target = fighter('m0', { x: 3, y: 2 }, false, {
    health: 5,
    effects: [punishment_row(20, 'strength', 10, 2)],
  })
  const killed = apply_incoming_damage(
    state_of([attacker], [killed_target]),
    killed_target.id,
    10,
    attacker.id,
  )
  return {
    health: after.health,
    health_max: after.health_max,
    strength: effective_stats(after).strength,
    percent_damage: effective_stats(after).percent_damage,
    bonus_rows: after.effects.filter(effect => effect.type === 'STAT_BUFF')
      .length,
    max_after_expiry: find_entity(expired.state, target.id).health_max,
    killed_bonus_rows: find_entity(
      killed.state,
      killed_target.id,
    ).effects.filter(effect => effect.type === 'STAT_BUFF').length,
    fresh_fight_rows: fresh_rows(),
  }
}

const run_erosion = vector => {
  const attacker = fighter('p0', { x: 2, y: 2 }, true)
  const target = fighter('m0', { x: 3, y: 2 }, false, {
    effects: vector.input.percentages.map((value, index) =>
      active('EROSION', { id: 10 + index, value }),
    ),
  })
  const hit = apply_incoming_damage(
    state_of([attacker], [target]),
    target.id,
    vector.input.hit,
    attacker.id,
  )
  const after = find_entity(hit.state, target.id)
  return {
    health: after.health,
    health_max: after.health_max,
    fresh_fight_rows: fresh_rows(),
  }
}

const run_redirect = vector => {
  const attacker = fighter('p0', { x: 2, y: 2 }, true)
  const guard = fighter('g0', { x: 2, y: 3 }, true, {
    effects: [
      active('EROSION', { value: 100 }),
      punishment_row(11, 'strength', 20, 2),
    ],
  })
  const target = fighter('m0', { x: 3, y: 2 }, false, {
    effects: [
      active('DAMAGE_REDIRECT', { source_id: guard.id, value: 0 }),
      active('DAMAGE_REDIRECT', { id: 12, source_id: 'm0', value: 50 }),
    ],
  })
  const full_hit = apply_incoming_damage(
    state_of([attacker, guard], [target]),
    target.id,
    vector.input.hit,
    attacker.id,
  )
  const reflected_attacker = fighter('p0', { x: 2, y: 2 }, true, {
    effects: [active('DAMAGE_REDIRECT', { source_id: 'm0', value: 100 })],
  })
  const reflected_target = fighter('m0', { x: 3, y: 2 }, false, {
    effects: [
      active('DAMAGE_REDIRECT', { source_id: 'm0', value: 25 }),
      active('DAMAGE_REDIRECT', { id: 11, source_id: 'm0', value: 25 }),
    ],
  })
  const reflected = apply_incoming_damage(
    state_of([reflected_attacker], [reflected_target]),
    reflected_target.id,
    vector.input.hit,
    reflected_attacker.id,
  )
  const guard_after = find_entity(full_hit.state, guard.id)
  return {
    full: {
      target_hp: find_entity(full_hit.state, target.id).health,
      guard_hp: guard_after.health,
      guard_max: guard_after.health_max,
      attacker_hp: find_entity(full_hit.state, attacker.id).health,
      triggered_bonus_rows: guard_after.effects.filter(
        effect => effect.type === 'STAT_BUFF',
      ).length,
    },
    reflect: {
      target_hp: find_entity(reflected.state, reflected_target.id).health,
      attacker_hp: find_entity(reflected.state, reflected_attacker.id).health,
      reflected:
        reflected.effects.find(effect => effect.status === 'DAMAGE_REFLECT')
          ?.damage ?? 0,
    },
    fresh_fight_rows: fresh_rows(),
  }
}

const run_normalize = vector => {
  const spell = spell_of(vector.id, [
    raw_effect(K_REACTIVE_PUNISHMENT, {
      stat: 8,
      value: 12,
      area_size: 3,
      turns: 2,
    }),
    raw_effect(K_EROSION, { value: 20, turns: 2 }),
    raw_effect(K_DAMAGE_REDIRECT, { value: 25, turns: 2 }),
  ])
  const effects = spell.levels[0].base_effects
  return {
    types: effects.map(effect => effect.type),
    punishment_stat: effects[0].stat,
    trigger_turns: effects[0].trigger_turns,
  }
}

const runners = {
  named_stack: run_named_stack,
  punishment: run_punishment,
  erosion: run_erosion,
  redirect: run_redirect,
  normalize: run_normalize,
}

describe('wave 12 reaction golden vectors', () => {
  for (const vector of golden.cases)
    test(vector.id, () => {
      expect(runners[vector.scenario](vector)).toEqual(vector.expected)
    })
})
