// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Empirical Dofus Retro monster-grade cohorts.

import { DOFUS_MOB_GRADES } from './dofus_mob_power_corpus.gen.ts'

export type MobPowerCohort = 'regular' | 'archi' | 'protector' | 'boss'
export type MobPowerBand = Readonly<{ average: number; p25: number; median: number; p75: number; p90: number }>
export type MobPowerEnvelope = Readonly<{
  requested_cohort: MobPowerCohort
  cohort: MobPowerCohort
  sample_count: number
  output_sample_count: number
  level_min: number
  level_max: number
  hp: MobPowerBand
  xp: MobPowerBand
  damage: MobPowerBand
  ap: MobPowerBand
  mp: MobPowerBand
  resistances: Readonly<Record<'earth' | 'fire' | 'water' | 'air', MobPowerBand>>
}>

type Grade = (typeof DOFUS_MOB_GRADES)[number]
const cohort_code: Readonly<Record<MobPowerCohort, number>> = Object.freeze({
  regular: 0,
  archi: 1,
  protector: 2,
  boss: 3,
})
export const mob_power_cohort_of_role = (role: string): MobPowerCohort =>
  role === 'archi' ? 'archi' : role === 'protector' ? 'protector' : role === 'boss' ? 'boss' : 'regular'

const nearest_grades = (level: number, cohort: MobPowerCohort, value_index?: number): readonly Grade[] => {
  const rows = DOFUS_MOB_GRADES.filter(
    (grade) => grade[8] === cohort_code[cohort] && (value_index === undefined || grade[value_index]! >= 0)
  )
  const exact = rows.filter(([donor_level]) => donor_level === level)
  if (exact.length > 0) return exact
  const distance = Math.min(...rows.map(([donor_level]) => Math.abs(donor_level - level)))
  return rows.filter(([donor_level]) => Math.abs(donor_level - level) === distance)
}

const nearest_distance = (level: number, cohort: MobPowerCohort, value_index?: number): number =>
  Math.abs(nearest_grades(level, cohort, value_index)[0]![0] - level)

const reference_cohort = (level: number, requested: MobPowerCohort): MobPowerCohort => {
  if (requested === 'regular') return requested
  const role_distance = nearest_distance(level, requested)
  const role_output_distance = nearest_distance(level, requested, 9)
  const regular_distance = nearest_distance(level, 'regular')
  const regular_output_distance = nearest_distance(level, 'regular', 9)
  return role_distance <= regular_distance && role_output_distance <= regular_output_distance ? requested : 'regular'
}

const quantile = (values: readonly number[], percentile: number): number => {
  const sorted = values.slice().sort((left, right) => left - right)
  const position = (sorted.length - 1) * percentile
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return Math.round(sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower))
}

const band = (rows: readonly Grade[], index: number): MobPowerBand => {
  const values = rows.map((row) => row[index]!)
  return Object.freeze({
    average: Math.round(values.reduce<number>((sum, value) => sum + value, 0) / values.length),
    p25: quantile(values, 0.25),
    median: quantile(values, 0.5),
    p75: quantile(values, 0.75),
    p90: quantile(values, 0.9),
  })
}

export const dofus_mob_power_envelope = (level: number, role = 'normal'): MobPowerEnvelope => {
  const safe_level = Math.max(1, Math.min(255, Math.floor(level)))
  const requested_cohort = mob_power_cohort_of_role(role)
  const cohort = reference_cohort(safe_level, requested_cohort)
  const rows = nearest_grades(safe_level, cohort)
  const output_rows = nearest_grades(safe_level, cohort, 9)
  return Object.freeze({
    requested_cohort,
    cohort,
    sample_count: rows.length,
    output_sample_count: output_rows.length,
    level_min: Math.min(...rows.map(([donor_level]) => donor_level)),
    level_max: Math.max(...rows.map(([donor_level]) => donor_level)),
    hp: band(rows, 1),
    xp: band(output_rows, 9),
    damage: band(output_rows, 10),
    ap: band(rows, 2),
    mp: band(rows, 3),
    resistances: Object.freeze({ earth: band(rows, 4), fire: band(rows, 5), water: band(rows, 6), air: band(rows, 7) }),
  })
}
