// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AresRPG damage / heal / shield / crit math. Rolls use the threaded PRNG; every stored result is integer-only.
// The value layer mirrors the chain's reference-corpus formula: element characteristic + percent damage amplify
// the authored base, flat damage lands afterward, target resistance is capped at 60%, and crit odds cap at 1/2.

import { rng_int } from './prng.js'
import { roll_in_range } from './turn_seed.js'

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

const RESISTANCE_CAP = 60

const nonnegative = value => Math.max(0, value ?? 0)

const is_physical_element = element => element === 'EARTH' || element === 'NONE'

/** Does this element NAME one element (rather than "neutral / unstated")? `NONE` is neutral, never a name. */
const is_elemental = element => !!element && element !== 'NONE'

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
 * #577 — scalar §5h amplification of an already-ROLLED base: `base × (100 + primary + percent)/100 + raw`
 * (+physical on earth/neutral). Mirrors spell_formula::amplify_damage. The roll happens BEFORE amplification
 * (canonical order in BOTH twins), so the chain and client pick the identical number from the identical roll.
 * @param {number} base @param {import("./fight_state.js").Element} element @param {import("./fight_state.js").Stats} caster_stats
 * @returns {number}
 */
export const amplify_damage = (base, element, caster_stats) => {
  const primary = nonnegative(caster_stats[ELEMENT_STAT[element]])
  const percent = nonnegative(caster_stats.percent_damage)
  return (
    Math.floor((base * (100 + primary + percent)) / 100) +
    flat_damage_bonus(element, caster_stats)
  )
}

/**
 * K_PUNISHMENT_DAMAGE's rolled base, scaled by the caster's MISSING life: `base × (2·max − hp) / max` — identity
 * at full HP, double at zero, linear between. The kind is declared "damage scaling UP as caster HP drops"
 * (spell_effect.move:30) and BOTH twins used to resolve it as a plain damage line, so the scaling half of the
 * kind existed only in its own comment. Mirrors spell_formula::punishment_base — the scale lands on the ROLLED
 * base, before amplification and before any named-damage bonus, so both twins pick the same integer.
 * @param {number} base the already-rolled authored base
 * @param {{ health: number, health_max: number }} caster
 * @returns {number}
 */
export const punishment_base = (base, caster) => {
  const maximum = Math.floor(caster?.health_max ?? 0)
  // A fighter with no max HP has no missing fraction to read — the base passes through, exactly as the chain's
  // `if (max_hp == 0) return base` does. Anything else would divide by zero on one twin and not the other.
  if (!(maximum > 0)) return base
  const health = Math.min(maximum, Math.max(0, Math.floor(caster?.health ?? 0)))
  return Math.floor((base * (2 * maximum - health)) / maximum)
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
 * Resistance reduction with the chain's 60% applied-resistance cap (owner ruling 2026-07-23).
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
 * Fold matching-element mitigation in deterministic kind order: every kind-24 SHIELD is a per-hit flat and
 * remains unchanged; then kind-40 POOL_SHIELD rows absorb and report what must be spent.
 * @param {number} damage
 * @param {import("./fight_state.js").Element} element
 * @param {import("./fight_state.js").ActiveEffect[]} effects
 * @returns {{ damage: number, shields_consumed: { id: number, absorbed: number }[] }}
 */
export const apply_shields = (damage, element, effects) => {
  let remaining = Math.max(0, Math.floor(damage))
  const shields_consumed = []

  // D1 — the hit property first. Multiple flat rows stack, but never mutate or enter `shields_consumed`.
  for (const shield of effects) {
    if (shield.type !== 'SHIELD') continue
    if (is_elemental(shield.element) && shield.element !== element) continue
    remaining = Math.max(0, remaining - nonnegative(shield.value))
  }
  if (remaining === 0) return { damage: 0, shields_consumed }

  // The reservoir second. NONE/missing is the established wildcard spelling; named elements match exactly.
  for (const shield of effects) {
    if (shield.type !== 'POOL_SHIELD') continue
    if (is_elemental(shield.element) && shield.element !== element) continue
    const absorbed = Math.min(nonnegative(shield.value), remaining)
    remaining -= absorbed
    shields_consumed.push({ id: shield.id, absorbed })
    if (remaining <= 0) break
  }
  return { damage: Math.max(0, remaining), shields_consumed }
}

/**
 * #577 — chain-parity damage pipeline, RNG-FREE: roll the base in `[min, max]` from the turn-seed `roll` fraction
 * → §5h amplify → resistance → shields. The client-local rng damage roll is DEAD; the roll is the same public
 * turn-seed value the chain uses (`spell_formula::roll_in_range` + `final_damage`), so preview == settlement.
 * @param {import("./spell_templates.js").DamageEffect} effect
 * @param {import("./fight_state.js").Stats} caster_stats
 * @param {import("./fight_state.js").Stats} target_stats
 * @param {number} roll  the [0,10000) turn-seed (player) / crank (mob) damage roll fraction
 * @param {import("./fight_state.js").ActiveEffect[]} target_shields
 * @returns {{ damage: number, shields_consumed: { id: number, absorbed: number }[] }}
 */
export const calculate_final_damage = (
  effect,
  caster_stats,
  target_stats,
  roll,
  target_shields = [],
) => {
  const base = roll_in_range(
    effect.min ?? 0,
    effect.max ?? effect.min ?? 0,
    roll,
  )
  const amplified = amplify_damage(base, effect.element, caster_stats)
  const resisted = apply_resistance(amplified, effect.element, target_stats)
  const { damage, shields_consumed } = apply_shields(
    resisted,
    effect.element,
    target_shields,
  )
  return { damage, shields_consumed }
}

/**
 * #577 — Heal amount, RNG-FREE: roll base in `[min, max]` from `roll`, then `base × (100 + intelligence)/100 +
 * flat heal`. Mirrors spell_formula::heal_amount applied to the rolled base.
 * @param {import("./spell_templates.js").HealEffect} effect
 * @param {import("./fight_state.js").Stats} caster_stats
 * @param {number} roll  the [0,10000) turn-seed / crank damage roll fraction
 * @returns {{ value: number }}
 */
export const calculate_heal = (effect, caster_stats, roll) => {
  const base = roll_in_range(
    effect.min ?? 0,
    effect.max ?? effect.min ?? 0,
    roll,
  )
  const intelligence = nonnegative(caster_stats.intelligence)
  const flat_heal = nonnegative(caster_stats.heal)
  return { value: Math.floor((base * (100 + intelligence)) / 100) + flat_heal }
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
  // BOTH certainties short-circuit WITHOUT drawing — `cast::effect_proc`'s own two guards
  // (`chance >= 100 → true`, `chance == 0 → false`) come before its `prng::rng_int`, so a certain OR impossible
  // line leaves the thread byte-identical on chain. The sim used to draw for chance 0 and desynchronise every
  // later roll of the same cast against the chain's stream.
  if (chance >= 100) return { rng, value: true }
  if (chance <= 0) return { rng, value: false }
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
