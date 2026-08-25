// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { dofus_mob_power_envelope, item_stat_center } from '@aresrpg/immutable'
import {
  mob_band_scaled,
  mob_centered_band_scaled,
  mob_loot_chance_scaled,
  mob_pool_scaled,
  point_removal_chance,
  tackle_contest,
} from '@aresrpg/fight'

import type { JsonValue } from './seed_editor.ts'

type Element = 'earth' | 'fire' | 'water' | 'air'
type MobLevelOutput = Readonly<{
  level: number
  hp: number
  ap: number
  mp: number
  agility: number
  dodge: number
  tackle: number
  wisdom: number
  xp: number
  damage: number
  resistances: Readonly<Record<Element, number>>
}>
export type MobPowerSummary = Readonly<{
  retro: Readonly<{
    level: number
    cohort: string
    requested_cohort: string
    donor_level_min: number
    donor_level_max: number
    sample_count: number
    hp: number
    xp: number
    damage: number
  }>
  minimum: MobLevelOutput
  maximum: MobLevelOutput
  dodge: number
  tackle: number
}>

const elements = Object.freeze(['earth', 'fire', 'water', 'air'] as const)
const record = (value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : null
const number = (value: JsonValue | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
const scaled = (value: number, low: number, high: number, level: number): number =>
  Number(mob_band_scaled(BigInt(value), BigInt(low), BigInt(high), BigInt(level)))
const pool_scaled = (value: number, low: number, high: number, level: number): number =>
  Number(mob_pool_scaled(BigInt(value), BigInt(low), BigInt(high), BigInt(level)))
const ap_mp_dodge = (wisdom: number): number =>
  100 - Number(point_removal_chance({ caster_wisdom: 200n, target_wisdom: BigInt(wisdom), current: 1n, maximum: 1n }))
const tackle_percent = (agility: number): number => {
  const { numerator, denominator } = tackle_contest(200n, [BigInt(agility)])
  return Number(((denominator - numerator) * 100n + denominator / 2n) / denominator)
}
const scaled_resistance = (value: number, low: number, high: number, level: number): number =>
  Number(mob_centered_band_scaled(BigInt(value), BigInt(item_stat_center), BigInt(low), BigInt(high), BigInt(level))) -
  item_stat_center

export const mob_loot_chance_range = (
  chance_bp: number,
  level_min: number,
  level_max: number
): Readonly<{ minimum: number; maximum: number }> => {
  const low = Math.max(1, Math.floor(level_min))
  const high = Math.max(low, Math.floor(level_max))
  const base = BigInt(Math.max(0, Math.floor(chance_bp)))
  return Object.freeze({
    minimum: Number(mob_loot_chance_scaled(base, BigInt(low), BigInt(high), BigInt(low))),
    maximum: Number(mob_loot_chance_scaled(base, BigInt(low), BigInt(high), BigInt(high))),
  })
}

const direct_damage = (effects: readonly JsonValue[], low: number, high: number, level: number): number =>
  effects
    .map(record)
    .filter((effect): effect is Readonly<Record<string, JsonValue>> => effect !== null)
    .filter((effect) => {
      const kind = number(effect.kind)
      return kind === 0 || (kind === 6 && number(effect.stat) === 12 && number(effect.turns) === 0)
    })
    .reduce((sum, effect) => {
      const from = scaled(number(effect.value), low, high, level)
      const to = scaled(number(effect.value_max), low, high, level)
      return sum + ((from + to) / 2) * (number(effect.chance_bp) / 10_000)
    }, 0)

const turn_damage = (
  mob: Readonly<Record<string, JsonValue>>,
  low: number,
  high: number,
  level: number,
  ap: number
): number => {
  const spells = Array.isArray(mob.spells) ? mob.spells : []
  const casts = spells.flatMap((value) => {
    const spell = record(value)
    const levels = Array.isArray(spell?.levels) ? spell.levels : []
    if (!spell || levels.length === 0) return []
    const details = record(levels[0])
    const cost = number(details?.ap_cost)
    if (!details || cost <= 0 || cost > ap) return []
    const normal = direct_damage(Array.isArray(details.effects) ? details.effects : [], low, high, level)
    const critical = direct_damage(Array.isArray(details.crit_effects) ? details.crit_effects : [], low, high, level)
    const quotation = number(details.crit_1_in)
    const crit_chance = quotation > 0 && critical > 0 ? 1 / quotation : 0
    const expected = normal * (1 - crit_chance) + critical * crit_chance
    const authored_cap = number(details.casts_per_turn)
    const count = Math.min(Math.floor(ap / cost), authored_cap > 0 ? authored_cap : Infinity)
    return Array.from({ length: count }, () => ({ cost, expected }))
  })
  const states = casts.reduce(
    (previous, cast) =>
      previous.map((value, spent) =>
        spent < cast.cost ? value : Math.max(value, previous[spent - cast.cost]! + cast.expected)
      ),
    Array.from({ length: ap + 1 }, (_, spent) => (spent === 0 ? 0 : -Infinity))
  )
  return Math.round(Math.max(0, ...states) * 10) / 10
}

const level_output = (
  mob: Readonly<Record<string, JsonValue>>,
  low: number,
  high: number,
  level: number
): MobLevelOutput => {
  const ap = pool_scaled(number(mob.ap), low, high, level)
  const wisdom = scaled(number(mob.wisdom), low, high, level)
  const agility = scaled(number(mob.agility), low, high, level)
  const resistance_rows = record(mob.resistances)
  return Object.freeze({
    level,
    hp: scaled(number(mob.hp), low, high, level),
    ap,
    mp: pool_scaled(number(mob.mp), low, high, level),
    agility,
    dodge: ap_mp_dodge(wisdom),
    tackle: tackle_percent(agility),
    wisdom,
    xp: scaled(number(mob.xp), low, high, level),
    damage: turn_damage(mob, low, high, level, ap),
    resistances: Object.freeze(
      Object.fromEntries(
        elements.map((element) => [
          element,
          scaled_resistance(number(resistance_rows?.[element]) || item_stat_center, low, high, level),
        ])
      ) as Record<Element, number>
    ),
  })
}

export const mob_power_summary = (value: JsonValue): MobPowerSummary | null => {
  const mob = record(value)
  if (!mob) return null
  const level_min = Math.max(1, number(mob.level_min))
  const level_max = Math.max(level_min, number(mob.level_max))
  const level = Math.floor((level_min + level_max) / 2)
  const envelope = dofus_mob_power_envelope(level, typeof mob.role === 'string' ? mob.role : 'normal')
  return Object.freeze({
    retro: Object.freeze({
      level,
      cohort: envelope.cohort,
      requested_cohort: envelope.requested_cohort,
      donor_level_min: envelope.level_min,
      donor_level_max: envelope.level_max,
      sample_count: envelope.output_sample_count,
      hp: envelope.hp.average,
      xp: envelope.xp.average,
      damage: envelope.damage.average,
    }),
    minimum: level_output(mob, level_min, level_max, level_min),
    maximum: level_output(mob, level_min, level_max, level_max),
    dodge: ap_mp_dodge(number(mob.wisdom)),
    tackle: tackle_percent(number(mob.agility)),
  })
}
