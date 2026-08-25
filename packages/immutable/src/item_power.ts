// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Empirical Dofus Retro cohorts measured in the exact rune-weight unit shared with Move.

import { DOFUS_GEAR_POWER, DOFUS_POWER_SCALE, DOFUS_WEAPON_POWER } from './dofus_item_power_corpus.gen.ts'
import { is_stat_name } from './identity.ts'
import { rune_unit_weights } from './rune.ts'

export const item_budget_stat_weights = rune_unit_weights

export type ItemBudgetEnvelope = Readonly<{
  median: number
  p10: number
  p90: number
  corpus_max: number
  sample_count: number
  level_min: number
  level_max: number
  comparison: string
}>

export type ItemBudgetStanding = Readonly<{
  percentile: number
  exact_level_power_donors: number
}>

export type WeaponDamageEnvelope = Readonly<{
  average_p10: number
  average_median: number
  average_p90: number
  average_max: number
  maximum_p10: number
  maximum_median: number
  maximum_p90: number
  maximum_max: number
  sample_count: number
  level_min: number
  level_max: number
}>

type GearDonor = readonly [level: number, power_scaled: number]
type WeaponDonor = readonly [
  level: number,
  stat_power_scaled: number,
  average_per_ap_scaled: number,
  max_per_ap_scaled: number,
]

const MIN_COHORT = 20
const LEVEL_RADIUS = 10
const gear_by_category = DOFUS_GEAR_POWER as Readonly<Record<string, readonly GearDonor[]>>
const weapon_by_category = DOFUS_WEAPON_POWER as Readonly<Record<string, readonly WeaponDonor[]>>
const all_gear = Object.freeze(Object.values(gear_by_category).flat())

const gear_rows = (category: string): readonly GearDonor[] =>
  gear_by_category[category] ?? weapon_by_category[category]?.map(([level, power]) => [level, power]) ?? all_gear

const cohort = <T extends readonly number[]>(rows: readonly T[], level: number): readonly T[] => {
  const local = rows.filter(([donor_level]) => Math.abs(donor_level - level) <= LEVEL_RADIUS)
  if (local.length >= MIN_COHORT) return local
  return rows
    .map((row) => row)
    .sort((left, right) => Math.abs(left[0] - level) - Math.abs(right[0] - level) || left[0] - right[0])
    .slice(0, MIN_COHORT)
}

const quantile = (values: readonly number[], percentile: number): number => {
  const sorted = values.slice().sort((left, right) => left - right)
  if (!sorted.length) return 0
  const position = (sorted.length - 1) * percentile
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const value = sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
  return Math.round((value / DOFUS_POWER_SCALE) * 100) / 100
}

const bounds = (rows: readonly (readonly number[])[]): Readonly<{ level_min: number; level_max: number }> => ({
  level_min: Math.min(...rows.map(([level]) => level)),
  level_max: Math.max(...rows.map(([level]) => level)),
})

export const item_budget_envelope = (level: number, category = ''): ItemBudgetEnvelope => {
  const gear = gear_by_category[category]
  const weapon = weapon_by_category[category]
  const comparison = gear ? category : weapon ? category : 'all gear'
  const rows = gear_rows(category)
  const selected = cohort(rows, Math.max(1, level))
  const values = selected.map(([, power]) => power)
  return Object.freeze({
    median: quantile(values, 0.5),
    p10: quantile(values, 0.1),
    p90: quantile(values, 0.9),
    corpus_max: Math.max(...values) / DOFUS_POWER_SCALE,
    sample_count: selected.length,
    ...bounds(selected),
    comparison,
  })
}

export const item_budget_standing = (level: number, category: string, maximum: number): ItemBudgetStanding => {
  const selected = cohort(gear_rows(category), Math.max(1, level))
  const scaled = Math.round(maximum * DOFUS_POWER_SCALE)
  const below = selected.filter(([, power]) => power < scaled).length
  const equal = selected.filter(([, power]) => power === scaled).length
  const direct = gear_by_category[category] ?? weapon_by_category[category]
  return Object.freeze({
    percentile: Math.round(((below + equal / 2) / selected.length) * 100),
    exact_level_power_donors:
      direct?.filter(([donor_level, power]) => donor_level === level && power === scaled).length ?? 0,
  })
}

export const dofus_weapon_damage_envelope = (level: number, category: string): WeaponDamageEnvelope | null => {
  const rows = weapon_by_category[category]
  if (!rows?.length) return null
  const selected = cohort(rows, Math.max(1, level))
  const average = selected.map(([, , value]) => value)
  const maximum = selected.map(([, , , value]) => value)
  return Object.freeze({
    average_p10: quantile(average, 0.1),
    average_median: quantile(average, 0.5),
    average_p90: quantile(average, 0.9),
    average_max: Math.max(...average) / DOFUS_POWER_SCALE,
    maximum_p10: quantile(maximum, 0.1),
    maximum_median: quantile(maximum, 0.5),
    maximum_p90: quantile(maximum, 0.9),
    maximum_max: Math.max(...maximum) / DOFUS_POWER_SCALE,
    sample_count: selected.length,
    ...bounds(selected),
  })
}

export const item_budget_stat_weight = (stat: string, maximum: number): number =>
  maximum * (is_stat_name(stat) ? item_budget_stat_weights[stat] : 1)
