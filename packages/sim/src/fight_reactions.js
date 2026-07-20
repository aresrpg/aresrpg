// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure decision helpers for wave-12 incoming-hit reactions. The caller owns health mutations so this module
// stays acyclic with fight_actions. Ordering is fixed: inversion chooses heal/damage first; a zero-value redirect
// changes the damage recipient; actual HP loss then drives erosion and punishment; positive redirect values reflect
// a percentage to the attacker without recursively evaluating any reaction on that reflected hit.

import { rng_int } from './prng.js'

/** Resolve the first live damage-to-heal row against one already-calculated incoming hit. */
export const incoming_branch = (state, target, incoming) => {
  const status = target.effects.find(effect => effect.type === 'DAMAGE_TO_HEAL')
  if (!status) return { state, mode: 'DAMAGE', amount: incoming }
  const chance = Math.max(0, Math.min(100, Math.floor(status.chance ?? 100)))
  const draw = rng_int(state.rng, 100)
  const next = { ...state, rng: draw.state }
  if (draw.value < chance)
    return {
      state: next,
      mode: 'HEAL',
      amount: incoming * Math.max(0, Math.floor(status.heal_multiplier ?? 1)),
    }
  return {
    state: next,
    mode: 'DAMAGE',
    amount: incoming * Math.max(0, Math.floor(status.value)),
  }
}

/** A zero-value row redirects the full transformed hit to its still-living source. */
export const redirect_target = (state, target) => {
  const status = target.effects.find(
    effect => effect.type === 'DAMAGE_REDIRECT' && effect.value === 0,
  )
  if (!status || status.source_id === target.id) return target.id
  const source = [...state.team0, ...state.team1].find(
    entity => entity.id === status.source_id && entity.health > 0,
  )
  return source?.id ?? target.id
}

/** Positive rows independently add to the reflected percentage of actual HP loss. */
export const reflect_percent = target =>
  Math.max(
    0,
    Math.floor(
      target.effects.reduce(
        (sum, effect) =>
          sum +
          (effect.type === 'DAMAGE_REDIRECT' && effect.value > 0
            ? effect.value
            : 0),
        0,
      ),
    ),
  )

/** Erosion is the sum of live percentages, capped at 100% of actual HP loss. */
export const erosion_amount = (target, actual_damage) => {
  const percent = Math.min(
    100,
    target.effects.reduce(
      (sum, effect) => sum + (effect.type === 'EROSION' ? effect.value : 0),
      0,
    ),
  )
  return Math.floor((actual_damage * Math.max(0, percent)) / 100)
}

/** One timed stat bonus per live punishment row; the hit amount is capped independently by each row's value. */
export const punishment_bonuses = (target, actual_damage) =>
  target.effects
    .filter(
      effect =>
        effect.type === 'REACTIVE_PUNISHMENT' &&
        effect.stat !== undefined &&
        actual_damage > 0,
    )
    .map(effect => ({
      source_id: effect.source_id,
      stat: effect.stat,
      value: Math.min(actual_damage, Math.max(0, effect.value)),
      turns_remaining: Math.max(1, effect.trigger_turns ?? 1),
    }))
    .filter(effect => effect.value > 0)
