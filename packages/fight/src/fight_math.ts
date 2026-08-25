// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Reviewed integer twin of aresrpg_math::fight_math; no floating point enters this module.

import { draw, mix } from './prng.ts'
import type { FightSheet } from './types.ts'

const CRIT_SCALE = 10_000n
const DOMAIN_CRIT = 0n
const DOMAIN_TACKLE = 0x7ac1en
const DOMAIN_EFFECT = 0xefec7n
const DODGE_MIN = 10n
const DODGE_MAX = 90n

export const primary_stat = (element: string, sheet: FightSheet): bigint => {
  if (element === 'earth') return sheet.strength
  if (element === 'fire') return sheet.intelligence
  if (element === 'water') return sheet.chance
  if (element === 'air') return sheet.agility
  return 0n
}

export const amplify_damage = (base: bigint, primary: bigint, raw_damage: bigint): bigint =>
  (base * (100n + primary)) / 100n + raw_damage

export const apply_resistance = (damage: bigint, resistance_pct: bigint): bigint =>
  (damage * (100n - (resistance_pct > 50n ? 50n : resistance_pct))) / 100n

export const punishment_base = (base: bigint, hp: bigint, max_hp: bigint): bigint => {
  if (max_hp === 0n) return base
  const health = hp > max_hp ? max_hp : hp
  return (base * (2n * max_hp - health)) / max_hp
}

export const heal_amount = (base: bigint, intelligence: bigint): bigint => (base * (100n + intelligence)) / 100n

export const spell_crit_roll = (turn_seed: bigint, spell_name: string): bigint =>
  new TextEncoder().encode(spell_name).reduce((roll, byte) => mix(roll, BigInt(byte)), mix(turn_seed, DOMAIN_CRIT))

export const effect_seed = (turn_seed: bigint, slot: bigint): bigint => mix(mix(turn_seed, slot), DOMAIN_EFFECT)

export const apply_centered_resistance = (damage: bigint, centered: bigint, center: bigint): bigint =>
  centered >= center ? apply_resistance(damage, centered - center) : (damage * (100n + (center - centered))) / 100n

export const roll_in_range = (minimum: bigint, maximum: bigint, roll: bigint): bigint =>
  maximum <= minimum ? minimum : minimum + (roll * (maximum - minimum + 1n)) / CRIT_SCALE

const pow_2 = (exponent: bigint): bigint => {
  let result = 1n
  let index = 0n
  while (index < exponent) {
    result *= 2n
    index += 1n
  }
  return result
}

const log_2_e6 = (value: bigint): bigint => {
  const scale = 1_000_000n
  let remaining = value
  let integer_part = 0n
  while (remaining >= 2n) {
    remaining /= 2n
    integer_part += 1n
  }
  let result = integer_part * scale
  let y = (value * scale) / pow_2(integer_part)
  let weight = scale / 2n
  while (weight > 0n) {
    y = (y * y) / scale
    if (y >= 2n * scale) {
      y /= 2n
      result += weight
    }
    weight /= 2n
  }
  return result
}

export const ln_e6 = (value: bigint): bigint => (log_2_e6(value) * 693_147n) / 1_000_000n

export const crit_denominator = (crit_1_in: bigint, critical: bigint, agility: bigint): bigint => {
  if (crit_1_in <= 2n) return crit_1_in
  const base = crit_1_in > critical ? crit_1_in - critical : 0n
  if (base < 2n) return 2n
  const scaled = (base * 29_901n * 1_000_000n) / (10_000n * ln_e6(agility + 12n))
  const capped = scaled < base ? scaled : base
  return capped < 2n ? 2n : capped
}

export const crit_at = (crit_roll: bigint, crit_1_in: bigint, critical: bigint, agility: bigint): boolean =>
  crit_1_in !== 0n && crit_roll % crit_denominator(crit_1_in, critical, agility) === 0n

export const tackle_seed = (turn_seed: bigint, mp: bigint): bigint => mix(mix(turn_seed, mp), DOMAIN_TACKLE)

export const tackle_bucket = (agility: bigint): bigint => agility / 10n + 2n

export const tackle_contest = (
  runner_agility: bigint,
  locker_agilities: readonly bigint[]
): { numerator: bigint; denominator: bigint } => {
  const dodge = tackle_bucket(runner_agility)
  return locker_agilities.reduce(
    ({ numerator, denominator }, agility) => {
      const row_denominator = 2n * tackle_bucket(agility)
      return {
        numerator: numerator * (dodge < row_denominator ? dodge : row_denominator),
        denominator: denominator * row_denominator,
      }
    },
    { numerator: 1n, denominator: 1n }
  )
}

export const tackle_losses = (ap: bigint, mp: bigint, numerator: bigint, denominator: bigint) => {
  const lost = denominator - numerator
  return {
    ap_loss: (ap * lost + denominator - 1n) / denominator,
    mp_loss: (mp * lost + denominator - 1n) / denominator,
  }
}

export const push_collision_damage = (caster_level: bigint, blocked_cells: bigint): bigint => {
  if (blocked_cells === 0n) return 0n
  const raw = (12n * caster_level) / 50n
  return (raw < 1n ? 1n : raw) * blocked_cells
}

export const point_removal_chance = ({
  caster_wisdom,
  target_wisdom,
  current,
  maximum,
}: {
  caster_wisdom: bigint
  target_wisdom: bigint
  current: bigint
  maximum: bigint
}): bigint => {
  if (maximum === 0n) return 0n
  const wisdom = caster_wisdom / 10n < 1n ? 1n : caster_wisdom / 10n
  const resistance = target_wisdom / 10n < 1n ? 1n : target_wisdom / 10n
  const resist_rate = (50n * wisdom) / resistance
  const raw = (resist_rate * current) / maximum
  return raw < DODGE_MIN ? DODGE_MIN : raw > DODGE_MAX ? DODGE_MAX : raw
}

export const remove_points = ({
  rng,
  value,
  dodge,
  caster_wisdom,
  target_wisdom,
  current,
  maximum,
}: {
  rng: bigint
  value: bigint
  dodge: boolean
  caster_wisdom: bigint
  target_wisdom: bigint
  current: bigint
  maximum: bigint
}): { state: bigint; removed: bigint } => {
  if (!dodge) return { state: rng, removed: value < current ? value : current }
  if (maximum === 0n) return { state: rng, removed: 0n }
  const cursor = { state: rng }
  let removed = 0n
  while (removed < value && removed < current) {
    const chance = point_removal_chance({ caster_wisdom, target_wisdom, current: current - removed, maximum })
    if (draw(cursor) % 100n < chance) removed += 1n
    else break
  }
  return { state: cursor.state, removed }
}

export const RETRO_GROUP_XP_TENTHS = Object.freeze([10n, 11n, 15n, 23n, 31n, 36n])

export const retro_group_coefficient_tenths = (eligible_players: bigint): bigint => {
  if (eligible_players === 0n) return 0n
  const index = Number(eligible_players - 1n)
  return RETRO_GROUP_XP_TENTHS[Math.min(index, RETRO_GROUP_XP_TENTHS.length - 1)]!
}

export const xp_for_player = (
  base_xp: bigint,
  wisdom: bigint,
  player_level: bigint,
  player_total_level: bigint,
  mob_total_level: bigint,
  highest_mob_level: bigint,
  eligible_players: bigint
): bigint => {
  if (
    base_xp === 0n ||
    player_level === 0n ||
    player_total_level === 0n ||
    mob_total_level === 0n ||
    highest_mob_level === 0n ||
    eligible_players === 0n
  )
    return 0n

  let group_xp = (base_xp * retro_group_coefficient_tenths(eligible_players)) / 10n
  if (mob_total_level > player_total_level + 10n) group_xp = (group_xp * (player_total_level + 10n)) / mob_total_level
  if (player_total_level > mob_total_level + 5n) group_xp = (group_xp * mob_total_level) / player_total_level
  if (player_total_level * 2n > highest_mob_level * 5n)
    group_xp = (group_xp * (highest_mob_level * 5n)) / (player_total_level * 2n)

  return (((group_xp * player_level) / player_total_level) * (600n + wisdom)) / 600n
}
