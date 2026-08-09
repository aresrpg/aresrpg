// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure seed mob-stat normalization. The returned object mirrors foundation spell::Stats' constructor order and
// uses only its canonical snake_case field names; transaction builders derive their positional arguments from it.

const STAT_SOURCES = [
  ['strength', ['str', 'strength'], false],
  ['intelligence', ['int', 'intelligence'], false],
  ['chance', ['chance'], false],
  ['agility', ['agility'], false],
  ['raw_damage', ['raw', 'raw_damage'], false],
  ['critical_hit', ['crit', 'critical_hit'], false],
  ['range', ['range'], false],
  ['fire_resistance', ['fire_resistance', 'fireRes'], true],
  ['water_resistance', ['water_resistance', 'waterRes'], true],
  ['earth_resistance', ['earth_resistance', 'earthRes'], true],
  ['air_resistance', ['air_resistance', 'airRes'], true],
]

export const MOB_STAT_FIELDS = STAT_SOURCES.map(([field]) => field)
export const MOB_RESISTANCE_FIELDS = STAT_SOURCES.filter(([, , centered]) => centered).map(([field]) => field)

const first_authored = (stats, keys) => keys.map((key) => stats[key]).find((value) => value != null) ?? 0

const normalize_field = (stats, resistance_bias, [field, keys, centered]) => {
  const authored = Number(first_authored(stats, keys))
  const value = authored + (centered ? resistance_bias : 0)
  if (centered && value < 0) throw new Error(`${field} seed ${authored} underflows the ${resistance_bias} centering`)
  return [field, value]
}

export const normalize_seed_mob_stats = (stats, resistance_bias) =>
  Object.fromEntries(STAT_SOURCES.map((source) => normalize_field(stats ?? {}, resistance_bias, source)))

export const seed_mob_stat_values = (stats, resistance_bias) => {
  const normalized = normalize_seed_mob_stats(stats, resistance_bias)
  return MOB_STAT_FIELDS.map((field) => normalized[field])
}
