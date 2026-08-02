// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  apply_incoming_damage,
  expire_turn_effects,
  collect_spent_turn_effects,
  process_turn_effects,
} from '../src/fight_actions.js'
import { find_entity } from '../src/fight_state.js'
import { reduce } from '../src/reduce.js'
import {
  FLAG_NEGATIVE,
  K_DAMAGE,
  K_FORCED_DEATH,
  K_HEAL,
  K_STANCE,
  K_TIMED_PAYLOAD,
  TF_ONLY_CASTER,
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
import golden from './vectors/missing_effect_statuses_golden.json' with { type: 'json' }

const inversion_state = (vector, chance) => {
  const caster = fighter('p0', { x: 2, y: 2 }, true)
  const target = fighter('m0', { x: 3, y: 2 }, false, {
    health: vector.input.health,
    effects: [
      active('DAMAGE_TO_HEAL', {
        value: vector.input.damage_multiplier,
        heal_multiplier: vector.input.heal_multiplier,
        chance,
      }),
    ],
  })
  return { caster, target, state: state_of([caster], [target]) }
}

const inversion_result = (vector, chance) => {
  const { caster, target, state } = inversion_state(vector, chance)
  const result = apply_incoming_damage(
    state,
    target.id,
    vector.input.incoming,
    caster.id,
  )
  return {
    health: find_entity(result.state, target.id).health,
    damage: result.damage_dealt,
    heal: result.heal_dealt,
  }
}

const run_damage_to_heal = vector => ({
  success: inversion_result(vector, 100),
  failure: inversion_result(vector, 0),
})

const run_dot_inversion = vector => {
  const caster = fighter('p0', { x: 2, y: 2 }, true)
  const target = fighter('m0', { x: 3, y: 2 }, false, {
    health: vector.input.health,
    effects: [
      active('DAMAGE_TO_HEAL', {
        value: 1,
        heal_multiplier: vector.input.heal_multiplier,
        chance: 100,
      }),
      active('DAMAGE', {
        id: 11,
        value: vector.input.tick,
        source_id: caster.id,
      }),
    ],
  })
  const result = process_turn_effects(state_of([caster], [target]), target.id)
  return {
    health: find_entity(result.state, target.id).health,
    event_heal: result.effects.find(effect => effect.heal)?.heal ?? 0,
    damage_rows: result.effects.filter(effect => (effect.damage ?? 0) > 0)
      .length,
  }
}

const forced_result = (vector, shield, type = 'SHIELD') => {
  const caster = fighter('p0', { x: 2, y: 2 }, true)
  const target = fighter('m0', { x: 3, y: 2 }, false, {
    health: vector.input.health,
    health_max: vector.input.health_max,
    effects: [active(type, { value: shield })],
  })
  const spell = spell_of(vector.id, [raw_effect(K_FORCED_DEATH)])
  const result = cast(
    state_of([caster], [target]),
    caster.id,
    spell,
    target.cell,
  )
  return {
    health: find_entity(result.state, target.id).health,
    status: result.effects[0]?.status,
  }
}

const run_forced_death = vector => ({
  partial_shield: forced_result(vector, vector.input.health_max - 1),
  full_shield: forced_result(vector, vector.input.health_max),
  pool_shield: forced_result(vector, vector.input.health_max, 'POOL_SHIELD'),
})

const run_timed_normalize = vector => {
  const spell = spell_of(vector.id, [
    raw_effect(K_TIMED_PAYLOAD, {
      stat: vector.input.linked_count,
      turns: vector.input.delay,
      target_filter: TF_ONLY_CASTER,
    }),
    raw_effect(K_DAMAGE, { value: 10 }),
    raw_effect(K_HEAL, { value: 5 }),
    raw_effect(K_DAMAGE, { value: 99 }),
  ])
  const effects = spell.levels[0].base_effects
  return {
    types: effects.map(effect => effect.type),
    payload_types: effects[0].payload.map(effect => effect.type),
  }
}

const run_timed_turn_start = vector => {
  const caster = fighter('p0', { x: 2, y: 2 }, true)
  const enemy = fighter('m0', { x: 3, y: 2 }, false)
  const spell = spell_of(vector.id, [
    raw_effect(K_TIMED_PAYLOAD, {
      stat: 1,
      turns: vector.input.delay,
      target_filter: TF_ONLY_CASTER,
    }),
    raw_effect(K_DAMAGE, {
      value: vector.input.damage,
      target_filter: TF_ONLY_CASTER,
    }),
  ])
  const placed = cast(
    state_of([caster], [enemy]),
    caster.id,
    spell,
    caster.cell,
  )
  const ctx = { arena, spell_templates: new Map() }
  const enemy_first = reduce(
    placed.state,
    { type: 'end_turn', entity_id: caster.id },
    ctx,
  )
  const caster_first = reduce(
    enemy_first.state,
    { type: 'end_turn', entity_id: enemy.id },
    ctx,
  )
  const after_first = find_entity(caster_first.state, caster.id)
  const enemy_second = reduce(
    caster_first.state,
    { type: 'end_turn', entity_id: caster.id },
    ctx,
  )
  const caster_second = reduce(
    enemy_second.state,
    { type: 'end_turn', entity_id: enemy.id },
    ctx,
  )
  const after_second = find_entity(caster_second.state, caster.id)
  const tick = caster_second.events
    .find(event => event.type === 'fight_turn_effects')
    ?.effects.find(effect => effect.damage)
  return {
    after_first_start: {
      health: after_first.health,
      remaining:
        after_first.effects.find(effect => effect.type === 'TIMED_PAYLOAD')
          ?.turns_remaining ?? 0,
    },
    after_second_start: {
      health: after_second.health,
      remaining: after_second.effects.filter(
        effect => effect.type === 'TIMED_PAYLOAD',
      ).length,
      event_damage: tick?.damage ?? 0,
    },
  }
}

const run_stance_lifecycle = vector => {
  const caster = fighter('p0', { x: 2, y: 2 }, true)
  const enemy = fighter('m0', { x: 3, y: 2 }, false)
  const state = state_of([caster], [enemy])
  const on = spell_of(`${vector.id}_on`, [
    raw_effect(K_STANCE, {
      value: vector.input.stance,
      turns: 2,
      target_filter: TF_ONLY_CASTER,
    }),
  ])
  const applied = cast(state, caster.id, on, caster.cell)
  const off = spell_of(`${vector.id}_off`, [
    raw_effect(K_STANCE, {
      value: vector.input.stance,
      flags: FLAG_NEGATIVE,
      target_filter: TF_ONLY_CASTER,
    }),
  ])
  const cleared = cast(applied.state, caster.id, off, caster.cell)
  const one_turn = spell_of(`${vector.id}_expiry`, [
    raw_effect(K_STANCE, {
      value: vector.input.stance,
      turns: 1,
      target_filter: TF_ONLY_CASTER,
    }),
  ])
  const expiring = cast(state, caster.id, one_turn, caster.cell)
  // #2000/#2033 — the authored 1 covers the bearer's next turn; the STANCE_END fires when that turn ends.
  const expired = collect_spent_turn_effects(
    expire_turn_effects(expiring.state, caster.id),
    caster.id,
  )
  const fresh = state_of(
    [fighter('p0', { x: 2, y: 2 }, true)],
    [fighter('m0', { x: 3, y: 2 }, false)],
    1,
    'fresh_fight',
  )
  return {
    applied_rows: find_entity(applied.state, caster.id).effects.filter(
      effect => effect.type === 'STANCE',
    ).length,
    apply_event: applied.effects[0]?.status,
    cleared_rows: find_entity(cleared.state, caster.id).effects.filter(
      effect => effect.type === 'STANCE',
    ).length,
    clear_event: cleared.effects[0]?.status,
    expiry_event: expired.effects.find(effect => effect.status)?.status,
    fresh_fight_rows: find_entity(fresh, caster.id).effects.length,
  }
}

const runners = {
  damage_to_heal: run_damage_to_heal,
  dot_inversion: run_dot_inversion,
  forced_death: run_forced_death,
  timed_normalize: run_timed_normalize,
  timed_turn_start: run_timed_turn_start,
  stance_lifecycle: run_stance_lifecycle,
}

describe('wave 12 status golden vectors', () => {
  for (const vector of golden.cases)
    test(vector.id, () => {
      expect(runners[vector.scenario](vector)).toEqual(vector.expected)
    })
})
