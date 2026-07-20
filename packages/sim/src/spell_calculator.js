// AresRPG damage / heal / shield / crit math. Rolls use the threaded PRNG; every stored result is integer-only.
// The value layer mirrors the chain's reference-corpus formula: element characteristic + percent damage amplify
// the authored base, flat damage lands afterward, target resistance is capped at 50%, and crit odds cap at 1/2.

import { rng_range, rng_int } from './prng.js'

// Types are referenced inline via `import('./module.js').Type` so this module re-exports no type names
// (the barrel `export *`s every file; duplicate exported typedef names would collide). The canonical
// homes: Stats/Element/ActiveEffect — fight_state.js; Rng — prng.js; Damage/Heal/SpellEffect — spell_templates.js.

/** Element -> the caster characteristic that percentage-amplifies its damage. @type {Record<import('./fight_state.js').Element, keyof import('./fight_state.js').Stats>} */
const ELEMENT_STAT = {
  FIRE: 'intelligence',
  WATER: 'chance',
  EARTH: 'strength',
  AIR: 'agility',
  NONE: 'strength',
}

const RESISTANCE_CAP = 50

const nonnegative = value => Math.max(0, value ?? 0)

const is_physical_element = element => element === 'EARTH' || element === 'NONE'

/**
 * @typedef {{ min: number, max: number }} DamageRange
 */

/**
 * Percentage-amplified base range, before flat damage. This helper is kept internal so the live pipeline can
 * preserve the chain ordering even while the public raw-range compatibility helper includes flats.
 * @param {import("./spell_templates.js").DamageEffect} effect
 * @param {import("./fight_state.js").Stats} caster_stats
 * @returns {DamageRange}
 */
const calculate_amplified_range = (effect, caster_stats) => {
  const primary = nonnegative(caster_stats[ELEMENT_STAT[effect.element]])
  const percent = nonnegative(caster_stats.percent_damage)
  const factor = 100 + primary + percent
  return {
    min: Math.floor((effect.min * factor) / 100),
    max: Math.floor((effect.max * factor) / 100),
  }
}

const flat_damage_bonus = (element, caster_stats) =>
  nonnegative(caster_stats.raw_damage) +
  (is_physical_element(element) ? nonnegative(caster_stats.physical_damage) : 0)

/**
 * Chain-level raw range: characteristic/percent amplification, then raw damage and earth/neutral physical damage.
 * @param {import("./spell_templates.js").DamageEffect} effect
 * @param {import("./fight_state.js").Stats} caster_stats
 * @returns {DamageRange}
 */
export const calculate_raw_damage = (effect, caster_stats) => {
  const amplified = calculate_amplified_range(effect, caster_stats)
  const flat_bonus = flat_damage_bonus(effect.element, caster_stats)
  return {
    min: amplified.min + flat_bonus,
    max: amplified.max + flat_bonus,
  }
}

/**
 * Roll a value in [min, max] off the AresRPG PRNG thread.
 * @param {import("./prng.js").Rng} rng
 * @param {DamageRange} range
 * @returns {{ rng: import("./prng.js").Rng, value: number }}
 */
export const roll_damage = (rng, range) => {
  const { state, value } = rng_range(rng, range.min, range.max)
  return { rng: state, value }
}

/**
 * Legacy compatibility helper: +1% damage per level, integer-floored. The live chain-parity pipeline does not
 * call this function.
 * @param {number} damage
 * @param {number} caster_level
 * @returns {number}
 */
export const apply_level_scaling = (damage, caster_level) =>
  Math.floor((damage * (100 + (caster_level - 1))) / 100)

/**
 * Resistance reduction with the chain's 50% applied-resistance cap.
 * @param {number} damage
 * @param {import("./fight_state.js").Element} element
 * @param {import("./fight_state.js").Stats} target_stats
 * @returns {number}
 */
export const apply_resistance = (damage, element, target_stats) => {
  // Elementless damage (e.g. a STEAL effect that takes a stat, not an element — flying_soul) applies NO
  // element resistance. Guard the missing element: without it `undefined.toLowerCase()` THREW, escaping
  // reduce() to an unhandledRejection that crashed the whole server (the cast->freeze P0).
  if (!element) return Math.floor(damage)
  const key = /** @type {keyof import("./fight_state.js").Stats} */ (
    element === 'NONE'
      ? 'neutral_resistance'
      : `${element.toLowerCase()}_resistance`
  )
  const resistance = Math.min(RESISTANCE_CAP, nonnegative(target_stats[key]))
  return Math.floor((damage * (100 - resistance)) / 100)
}

/**
 * Absorb damage against matching-element or neutral shield effects.
 * @param {number} damage
 * @param {import("./fight_state.js").Element} element
 * @param {import("./fight_state.js").ActiveEffect[]} effects
 * @returns {{ damage: number, shields_consumed: { id: number, absorbed: number }[] }}
 */
export const apply_shields = (damage, element, effects) => {
  let remaining = damage
  const shields_consumed = []
  for (const shield of effects) {
    if (shield.type !== 'SHIELD') continue
    if (shield.element && shield.element !== element) continue
    const absorbed = Math.min(shield.value, remaining)
    remaining -= absorbed
    shields_consumed.push({ id: shield.id, absorbed })
    if (remaining <= 0) break
  }
  return { damage: Math.max(0, remaining), shields_consumed }
}

/**
 * Full chain-parity damage pipeline: amplify base -> roll -> add flats -> resistance -> shields. `caster_level`
 * remains in the signature for compatibility, but the reference-corpus damage formula never level-scales.
 * @param {import("./prng.js").Rng} rng
 * @param {import("./spell_templates.js").DamageEffect} effect
 * @param {import("./fight_state.js").Stats} caster_stats
 * @param {import("./fight_state.js").Stats} target_stats
 * @param {number} caster_level
 * @param {import("./fight_state.js").ActiveEffect[]} target_shields
 * @returns {{ rng: import("./prng.js").Rng, damage: number, shields_consumed: { id: number, absorbed: number }[] }}
 */
export const calculate_final_damage = (
  rng,
  effect,
  caster_stats,
  target_stats,
  caster_level = 1,
  target_shields = [],
) => {
  void caster_level
  const amplified = calculate_amplified_range(effect, caster_stats)
  const rolled = roll_damage(rng, amplified)
  const with_flats =
    rolled.value + flat_damage_bonus(effect.element, caster_stats)
  const resisted = apply_resistance(with_flats, effect.element, target_stats)
  const { damage, shields_consumed } = apply_shields(
    resisted,
    effect.element,
    target_shields,
  )
  return { rng: rolled.rng, damage, shields_consumed }
}

/**
 * Heal amount: base × (100 + intelligence)/100 + flat heal, matching the chain formula.
 * @param {import("./prng.js").Rng} rng
 * @param {import("./spell_templates.js").HealEffect} effect
 * @param {import("./fight_state.js").Stats} caster_stats
 * @returns {{ rng: import("./prng.js").Rng, value: number }}
 */
export const calculate_heal = (rng, effect, caster_stats) => {
  const { state, value } = rng_range(rng, effect.min, effect.max)
  const intelligence = nonnegative(caster_stats.intelligence)
  const flat_heal = nonnegative(caster_stats.heal)
  return {
    rng: state,
    value: Math.floor((value * (100 + intelligence)) / 100) + flat_heal,
  }
}

/**
 * Roll whether a chance-gated effect fires: `rng_int(rng, 100) < chance`.
 * @param {import("./prng.js").Rng} rng
 * @param {import("./spell_templates.js").SpellEffect} effect
 * @returns {{ rng: import("./prng.js").Rng, value: boolean }}
 */
export const effect_triggers = (rng, effect) => {
  const chance =
    'chance' in effect && effect.chance !== undefined ? effect.chance : 100
  if (chance >= 100) return { rng, value: true }
  const { state, value } = rng_int(rng, 100)
  return { rng: state, value: value < chance }
}

/**
 * Effective 1-in-X critical denominator. A zero base chance remains disabled; otherwise odds floor at 1-in-2.
 * @param {number} critical_chance
 * @param {number} [crit_bonus]
 * @returns {number}
 */
export const effective_critical_denominator = (
  critical_chance,
  crit_bonus = 0,
) => (critical_chance <= 0 ? 0 : Math.max(2, critical_chance - crit_bonus))

/**
 * Roll a critical hit from the effective 1-in-X denominator.
 * @param {import("./prng.js").Rng} rng
 * @param {number} critical_chance
 * @param {number} [crit_bonus]
 * @returns {{ rng: import("./prng.js").Rng, value: boolean }}
 */
export const is_critical = (rng, critical_chance, crit_bonus = 0) => {
  if (critical_chance <= 0) return { rng, value: false }
  const effective_chance = effective_critical_denominator(
    critical_chance,
    crit_bonus,
  )
  const { state, value } = rng_int(rng, effective_chance)
  return { rng: state, value: value === 0 }
}
