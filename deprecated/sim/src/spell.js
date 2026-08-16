// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPELL — Stats + element vocabulary, the deterministic subset of aresrpg_foundation::spell.move.
//
// PARITY MIRROR (S-16): byte-for-byte the on-chain `spell` module's Stats block + saturating stat/resist
// mutators. The RNG damage pipeline (roll_damage / is_critical / calculate_final_damage) is OUT OF SCOPE here
// (crit draws stay server-truth); the existing `spell_calculator.js` owns the sim's damage math. This file
// mirrors ONLY the pure integer stat state.

// ── Elements. Discriminants match spell.move exactly (FIRE→int, WATER→chance, EARTH→str, AIR→agility). ──
export const EL_FIRE = 0
export const EL_WATER = 1
export const EL_EARTH = 2
export const EL_AIR = 3
export const EL_NONE = 255

export const el_fire = () => EL_FIRE
export const el_water = () => EL_WATER
export const el_earth = () => EL_EARTH
export const el_air = () => EL_AIR
export const el_none = () => EL_NONE

/**
 * The full combat Stats block — mirrors spell.move `Stats` (11 constructor fields + the appended §5h / D149 /
 * D172 extension fields, all defaulting to 0). All values are non-negative integers.
 * @typedef {Record<string, number>} Stats
 */

/**
 * The 11-arg constructor — mirrors spell::new_stats. The 11 extension fields default to 0 (buffs set them via
 * the add_stat / sub_stat mutators, keeping the constructor signature frozen exactly like the Move side).
 * @returns {Stats}
 */
export const new_stats = (
  strength,
  intelligence,
  chance,
  agility,
  raw_damage,
  critical_hit,
  range,
  fire_resistance,
  water_resistance,
  earth_resistance,
  air_resistance,
) => ({
  strength,
  intelligence,
  chance,
  agility,
  raw_damage,
  critical_hit,
  range,
  fire_resistance,
  water_resistance,
  earth_resistance,
  air_resistance,
  percent_damage: 0,
  physical_damage: 0,
  wisdom: 0,
  flat_resist: 0,
  neutral_resistance: 0,
  ap_dodge: 0,
  mp_dodge: 0,
  heal: 0,
  ap_bonus: 0,
  mp_bonus: 0,
  vitality: 0,
})

/** A structural copy — the callers that fold rows over a base block must not alias it. */
export const clone_stats = s => ({ ...s })

// Saturating subtraction — floors at 0 (no negative combat stats). Mirrors spell::sat_sub.
const sat_sub = (a, b) => (a > b ? a - b : 0)

/**
 * Buff a stat by `field` id — mirrors spell::add_stat EXACTLY (id map: 0 str · 1 int · 2 chance · 3 agility ·
 * 4 wisdom · 6 range · 7 crit · 8 percent_damage · 9 raw_damage · 11 heal). Ids 5 (vitality) / 10 (max_hp) have
 * no Stats home → no-op (the caller routes max_hp separately), matching the Move fall-through.
 * @param {Stats} s
 */
export const add_stat = (s, field, delta) => {
  if (field === 0) s.strength += delta
  else if (field === 1) s.intelligence += delta
  else if (field === 2) s.chance += delta
  else if (field === 3) s.agility += delta
  else if (field === 4) s.wisdom += delta
  else if (field === 6) s.range += delta
  else if (field === 7) s.critical_hit += delta
  else if (field === 8) s.percent_damage += delta
  else if (field === 9) s.raw_damage += delta
  else if (field === 11) s.heal += delta
}

/** Debuff a stat by `field` id (saturating at 0) — mirrors spell::sub_stat. @param {Stats} s */
export const sub_stat = (s, field, delta) => {
  if (field === 0) s.strength = sat_sub(s.strength, delta)
  else if (field === 1) s.intelligence = sat_sub(s.intelligence, delta)
  else if (field === 2) s.chance = sat_sub(s.chance, delta)
  else if (field === 3) s.agility = sat_sub(s.agility, delta)
  else if (field === 4) s.wisdom = sat_sub(s.wisdom, delta)
  else if (field === 6) s.range = sat_sub(s.range, delta)
  else if (field === 7) s.critical_hit = sat_sub(s.critical_hit, delta)
  else if (field === 8) s.percent_damage = sat_sub(s.percent_damage, delta)
  else if (field === 9) s.raw_damage = sat_sub(s.raw_damage, delta)
  else if (field === 11) s.heal = sat_sub(s.heal, delta)
}

/** AlterResist by element (FIRE/WATER/EARTH/AIR/NONE→neutral) — mirrors spell::add_resist. @param {Stats} s */
export const add_resist = (s, element, delta) => {
  if (element === EL_FIRE) s.fire_resistance += delta
  else if (element === EL_WATER) s.water_resistance += delta
  else if (element === EL_EARTH) s.earth_resistance += delta
  else if (element === EL_AIR) s.air_resistance += delta
  else if (element === EL_NONE) s.neutral_resistance += delta
}

/** AlterResist debuff (saturating at 0) — mirrors spell::sub_resist. @param {Stats} s */
export const sub_resist = (s, element, delta) => {
  if (element === EL_FIRE) s.fire_resistance = sat_sub(s.fire_resistance, delta)
  else if (element === EL_WATER)
    s.water_resistance = sat_sub(s.water_resistance, delta)
  else if (element === EL_EARTH)
    s.earth_resistance = sat_sub(s.earth_resistance, delta)
  else if (element === EL_AIR)
    s.air_resistance = sat_sub(s.air_resistance, delta)
  else if (element === EL_NONE)
    s.neutral_resistance = sat_sub(s.neutral_resistance, delta)
}

// ── Getters (parity with spell::stat_* — the fields the fight side reads live) ──
export const stat_strength = s => s.strength
export const stat_intelligence = s => s.intelligence
export const stat_chance = s => s.chance
export const stat_agility = s => s.agility
export const stat_fire_resistance = s => s.fire_resistance
export const stat_water_resistance = s => s.water_resistance
export const stat_earth_resistance = s => s.earth_resistance
export const stat_air_resistance = s => s.air_resistance
