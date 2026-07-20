import { describe, expect, test } from 'bun:test'

import {
  ITEM_STAT_CATALOG_ORDER,
  ITEM_STAT_FOLD_MAPPING,
  ITEM_STAT_SHIFT,
  fold_equipment_snapshot,
} from '../src/equipment_stats.js'
import { advance_turn } from '../src/fight_actions.js'
import {
  apply_resistance,
  calculate_final_damage,
  calculate_heal,
  calculate_raw_damage,
  effective_critical_denominator,
  is_critical,
} from '../src/spell_calculator.js'
import { rng_seed } from '../src/prng.js'
import { crit_at } from '../src/turn_seed.js'

import golden from './vectors/equipment_stats_golden.json' with { type: 'json' }

const damage_effect = input => ({
  type: /** @type {const} */ ('DAMAGE'),
  min: input.base,
  max: input.base,
  element: input.element,
})

const run_damage = input => {
  const effect = damage_effect(input)
  const result = calculate_final_damage(
    rng_seed(input.seed ?? 1),
    /** @type {import('../src/spell_templates.js').DamageEffect} */ (effect),
    input.stats,
    input.target_stats ?? {},
    input.level,
    [],
  )
  return {
    raw_range: calculate_raw_damage(
      /** @type {import('../src/spell_templates.js').DamageEffect} */ (effect),
      input.stats,
    ),
    damage: result.damage,
  }
}

const run_heal = input => ({
  heal: calculate_heal(
    rng_seed(input.seed ?? 1),
    { type: 'HEAL', min: input.base, max: input.base },
    input.stats,
  ).value,
})

const run_critical = input => ({
  denominator: effective_critical_denominator(input.rate, input.bonus),
  critical: is_critical(rng_seed(input.seed), input.rate, input.bonus).value,
})

const run_fold = input =>
  fold_equipment_snapshot(
    input.base_stats,
    input.base_ap,
    input.base_mp,
    input.items,
  )

const run_fold_refill = input => {
  const folded = run_fold(input)
  const entity = {
    id: 'equipped',
    ap: 0,
    ap_max: folded.ap_max,
    mp: 0,
    mp_max: folded.mp_max,
    ap_used: 1,
    mp_used: 1,
    stats: folded.stats,
    effects: [],
  }
  const state = advance_turn({
    started: true,
    turn_order: [entity.id],
    current_turn_idx: 0,
    turn_number: 1,
    team0: [entity],
    team1: [],
  })
  const [refilled] = state.team0
  return {
    ap_bonus: folded.stats.ap_bonus,
    mp_bonus: folded.stats.mp_bonus,
    ap_max: folded.ap_max,
    mp_max: folded.mp_max,
    refilled_ap: refilled.ap,
    refilled_mp: refilled.mp,
  }
}

const run_vector = vector => {
  if (vector.scenario === 'damage') return run_damage(vector.input)
  if (vector.scenario === 'heal') return run_heal(vector.input)
  if (vector.scenario === 'critical') return run_critical(vector.input)
  if (vector.scenario === 'critical_slot_fold') {
    const old_critical = crit_at(vector.input.roll, vector.input.rate, 0)
    const new_critical = crit_at(
      vector.input.roll,
      vector.input.rate,
      vector.input.bonus,
    )
    return {
      old_critical,
      new_critical,
      selected_damage: new_critical
        ? vector.input.critical_damage
        : vector.input.normal_damage,
    }
  }
  if (vector.scenario === 'fold_refill') return run_fold_refill(vector.input)
  if (vector.scenario === 'fold_order') {
    const forward = run_fold(vector.input)
    const reverse = run_fold({
      ...vector.input,
      items: [...vector.input.items].reverse(),
    })
    return {
      strength: forward.stats.strength,
      reverse_strength: reverse.stats.strength,
    }
  }
  if (vector.scenario === 'fold') {
    const folded = run_fold(vector.input)
    return { strength: folded.stats.strength }
  }
  if (vector.scenario === 'fold_critical_keys') {
    const folded = run_fold(vector.input)
    return { critical_hit: folded.stats.critical_hit }
  }
  if (vector.scenario === 'resistance') {
    return {
      damage: apply_resistance(vector.input.damage, vector.input.element, {
        [`${vector.input.element.toLowerCase()}_resistance`]:
          vector.input.resistance,
      }),
    }
  }
  throw new Error(`Unknown equipment/stat golden scenario: ${vector.scenario}`)
}

describe('equipment/stat shared golden vectors', () => {
  test('declares the centered corpus key mapping consumed by combat', () => {
    expect(ITEM_STAT_SHIFT).toBe(golden.mapping.centered_shift)
    expect(ITEM_STAT_CATALOG_ORDER).toEqual(golden.mapping.catalog_order)
    expect(ITEM_STAT_FOLD_MAPPING).toEqual(golden.mapping.fold)
  })

  for (const vector of golden.cases) {
    test(vector.id, () => {
      expect(run_vector(vector)).toEqual(vector.expected)
    })
  }
})
