// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Dofus 1.29 donor-fitted gear envelope. Shape and variance come from the donor corpus;
// the level-105 anchor is the last certified healthy Ares band (owner ruling 2026-07-26).

import { is_stat_name, type StatName } from './identity.ts'

export const item_budget_stat_weights = Object.freeze({
  action: 100,
  movement: 90,
  range: 50,
  critical: 40,
  raw_damage: 20,
  fire_resistance: 10,
  water_resistance: 10,
  earth_resistance: 10,
  air_resistance: 10,
  wisdom: 5,
  strength: 3,
  intelligence: 3,
  chance: 3,
  agility: 3,
  vitality: 1,
} satisfies Readonly<Record<StatName, number>>)

export const item_damage_line_weight = 2

export type ItemBudgetEnvelope = Readonly<{
  median: number
  p10: number
  p90: number
  hard_max: number
}>

type Band = Readonly<{
  from: number
  to: number
  median: number
}>

type VarianceBand = Readonly<{
  from: number
  to: number
  p90_ratio: number
  hard_max_ratio: number
}>

const ANCHOR_LEVEL = 105.5
const ANCHOR_MEDIAN = 945
const DONOR_EXPONENT = 1.2817
const P10_RATIO = 0.621

const median_bands: readonly Band[] = Object.freeze([
  { from: 101, to: 110, median: 945 },
  { from: 111, to: 120, median: 1061 },
  { from: 121, to: 130, median: 1180 },
  { from: 131, to: 140, median: 1302 },
  { from: 141, to: 150, median: 1427 },
  { from: 151, to: 160, median: 1554 },
  { from: 161, to: 170, median: 1683 },
  { from: 171, to: 180, median: 1814 },
  { from: 181, to: 190, median: 1948 },
  { from: 191, to: 200, median: 2083 },
])

const variance_bands: readonly VarianceBand[] = Object.freeze([
  { from: 1, to: 120, p90_ratio: 2.192, hard_max_ratio: 5.04 },
  { from: 121, to: 140, p90_ratio: 2.029, hard_max_ratio: 3.834 },
  { from: 141, to: 200, p90_ratio: 2.089, hard_max_ratio: 3.596 },
])

const median_for_level = (level: number): number => {
  const band = median_bands.find(({ from, to }) => level >= from && level <= to)
  return band?.median ?? ANCHOR_MEDIAN * (Math.max(level, 1) / ANCHOR_LEVEL) ** DONOR_EXPONENT
}

export const item_budget_envelope = (level: number): ItemBudgetEnvelope => {
  const median = median_for_level(level)
  const spread_level = Math.max(1, Math.min(level, 200))
  const spread = variance_bands.find(({ from, to }) => spread_level >= from && spread_level <= to)!
  return Object.freeze({
    median: Math.round(median),
    p10: Math.round(median * P10_RATIO),
    p90: Math.round(median * spread.p90_ratio),
    hard_max: Math.round(median * spread.hard_max_ratio),
  })
}

export const item_budget_stat_weight = (stat: string, maximum: number): number =>
  maximum * (is_stat_name(stat) ? item_budget_stat_weights[stat] : 1)
