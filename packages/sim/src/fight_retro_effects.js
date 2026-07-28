// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Wave-12 retro status application. AresRPG brand law keeps source-game names out of runtime vocabulary.
// Ambiguities are explicit: critical-failure rows use the smallest live positive 1-in-X denominator; named
// damage rows are independent timed stacks keyed by caster + current spell + selected fighter; stance replacement
// emits presentation data but never mutates durable character appearance. All rows live only inside FightState.

import { rng_int, rng_range } from './prng.js'
import { turn_rng_of, with_turn_rng } from './combat_clock.js'
import { critical_failure_roll } from './turn_seed.js'
import { add_effect, apply_damage } from './fight_actions.js'
import { find_entity, next_id, update_entity } from './fight_state.js'
import { FLAG_NEGATIVE } from './spell_effect.js'

const duration_of = effect => Math.max(1, Math.floor(effect.turns ?? 1))

const rolled_value = (state, effect) => {
  const min = Math.floor(effect.min ?? effect.value ?? 0)
  const max = Math.floor(effect.max ?? effect.value ?? min)
  const draw = rng_range(
    turn_rng_of(state),
    Math.min(min, max),
    Math.max(min, max),
  )
  return { state: with_turn_rng(state, draw.state), value: draw.value }
}

const append_status = (state, target_id, status) => {
  const allocated = next_id(state)
  return add_effect(allocated.state, target_id, {
    id: allocated.id,
    timing: /** @type {const} */ ('TURN_START'),
    ...status,
  })
}

/** Roll the active 1-in-X fumble stat. No live row means no draw and no failure. */
export const roll_fumble = (state, caster, turn_clock = null) => {
  const denominators = caster.effects
    .filter(effect => effect.type === 'CRITICAL_FAILURE' && effect.value > 0)
    .map(effect => Math.max(1, Math.floor(effect.value)))
  if (denominators.length === 0)
    return { state, fumbled: false, denominator: 0 }
  const denominator = Math.min(...denominators)
  if (turn_clock)
    return {
      state,
      fumbled:
        critical_failure_roll(turn_clock.seed, turn_clock.slot, denominator) ===
        0,
      denominator,
    }
  const draw = rng_int(turn_rng_of(state), denominator)
  return {
    state: with_turn_rng(state, draw.state),
    fumbled: draw.value === 0,
    denominator,
  }
}

/** Sum every still-live row for exactly this caster + spell + target. */
export const named_damage_bonus = (target, caster_id, spell_id) =>
  target.effects.reduce(
    (sum, effect) =>
      effect.type === 'NAMED_DAMAGE_STACK' &&
      effect.source_id === caster_id &&
      effect.spell_id === spell_id
        ? sum + effect.value
        : sum,
    0,
  )

/** Full forced-death immunity is a live full-health reduce-damage/invulnerability row, and nothing else. */
export const has_full_damage_immunity = target =>
  target.effects.some(
    effect => effect.type === 'SHIELD' && effect.value >= target.health_max,
  )

/**
 * Apply one of the additive wave-12 kinds after its ordinary chance gate has fired.
 * @param {import('./fight_state.js').FightState} state
 * @param {import('./spell_templates.js').SpellEffect} effect
 * @param {import('./fight_state.js').FightEntity} caster
 * @param {string} target_id
 * @param {{ spell_id:string, stack_target_id?:string }} context
 */
export const apply_retro_effect = (
  state,
  effect,
  caster,
  target_id,
  context,
) => {
  const target = find_entity(state, target_id)
  if (!target) return { handled: true, state, effects: [] }

  if (effect.type === 'FORCED_DEATH') {
    if (has_full_damage_immunity(target))
      return {
        handled: true,
        state,
        effects: [{ target_id, status: 'FORCED_DEATH_IMMUNE' }],
      }
    const killed = apply_damage(state, target_id, target.health)
    return {
      handled: true,
      state: killed.state,
      effects: [
        {
          target_id,
          damage: target.health,
          new_health: 0,
          killed: true,
          status: 'FORCED_DEATH',
        },
      ],
      direct_damage: target.health,
    }
  }

  if (effect.type === 'CRITICAL_FAILURE') {
    const rolled = rolled_value(state, effect)
    const applied = append_status(rolled.state, target_id, {
      type: /** @type {const} */ ('CRITICAL_FAILURE'),
      source_id: caster.id,
      value: Math.max(1, rolled.value),
      turns_remaining: duration_of(effect),
    })
    return {
      handled: true,
      state: applied,
      effects: [{ target_id, status: 'CRITICAL_FAILURE' }],
    }
  }

  if (effect.type === 'DAMAGE_TO_HEAL') {
    const applied = append_status(state, target_id, {
      type: /** @type {const} */ ('DAMAGE_TO_HEAL'),
      source_id: caster.id,
      value: Math.max(0, Math.floor(effect.value ?? 1)),
      heal_multiplier: Math.max(0, Math.floor(effect.raw_stat ?? 1)),
      chance: Math.max(0, Math.min(100, Math.floor(effect.chance ?? 100))),
      turns_remaining: duration_of(effect),
    })
    return {
      handled: true,
      state: applied,
      effects: [{ target_id, status: 'DAMAGE_TO_HEAL' }],
    }
  }

  if (effect.type === 'TIMED_PAYLOAD') {
    const applied = append_status(state, target_id, {
      type: /** @type {const} */ ('TIMED_PAYLOAD'),
      source_id: caster.id,
      spell_id: context.spell_id,
      value: 0,
      payload: effect.payload ?? [],
      turns_remaining: Math.max(1, Math.floor(effect.delay ?? 1)),
    })
    return {
      handled: true,
      state: applied,
      effects: [{ target_id, status: 'TIMED_PAYLOAD' }],
    }
  }

  if (effect.type === 'NAMED_DAMAGE_STACK') {
    const { stack_target_id } = context
    if (!stack_target_id || target_id !== stack_target_id)
      return { handled: true, state, effects: [] }
    const stack_target = find_entity(state, stack_target_id)
    if (!stack_target) return { handled: true, state, effects: [] }
    const applied = append_status(state, stack_target_id, {
      type: /** @type {const} */ ('NAMED_DAMAGE_STACK'),
      source_id: caster.id,
      spell_id: context.spell_id,
      value: Math.max(0, Math.floor(effect.value ?? 0)),
      turns_remaining: duration_of(effect),
    })
    return {
      handled: true,
      state: applied,
      effects: [{ target_id: stack_target_id, status: 'NAMED_DAMAGE_STACK' }],
    }
  }

  if (effect.type === 'STANCE') {
    const cleared = update_entity(state, target_id, entity => ({
      ...entity,
      effects: entity.effects.filter(active => active.type !== 'STANCE'),
    }))
    if (((effect.flags ?? 0) & FLAG_NEGATIVE) !== 0)
      return {
        handled: true,
        state: cleared,
        effects: [{ target_id, status: 'STANCE_END' }],
      }
    const applied = append_status(cleared, target_id, {
      type: /** @type {const} */ ('STANCE'),
      source_id: caster.id,
      value: Math.max(0, Math.floor(effect.value ?? 0)),
      turns_remaining: duration_of(effect),
    })
    return {
      handled: true,
      state: applied,
      effects: [
        { target_id, status: 'STANCE', stance: Math.floor(effect.value ?? 0) },
      ],
    }
  }

  if (effect.type === 'REACTIVE_PUNISHMENT') {
    if (!effect.stat) return { handled: true, state, effects: [] }
    const applied = append_status(state, target_id, {
      type: /** @type {const} */ ('REACTIVE_PUNISHMENT'),
      source_id: caster.id,
      stat: effect.stat,
      value: Math.max(0, Math.floor(effect.value ?? 0)),
      trigger_turns: Math.max(1, Math.floor(effect.trigger_turns ?? 1)),
      turns_remaining: duration_of(effect),
    })
    return {
      handled: true,
      state: applied,
      effects: [{ target_id, status: 'REACTIVE_PUNISHMENT' }],
    }
  }

  if (effect.type === 'EROSION' || effect.type === 'DAMAGE_REDIRECT') {
    const applied = append_status(state, target_id, {
      type: effect.type,
      source_id: caster.id,
      value: Math.max(0, Math.floor(effect.value ?? 0)),
      turns_remaining: duration_of(effect),
    })
    return {
      handled: true,
      state: applied,
      effects: [{ target_id, status: effect.type }],
    }
  }

  return { handled: false, state, effects: [] }
}
