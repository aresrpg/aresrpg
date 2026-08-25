// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Runtime mirror of move-math/rune_catalog.move. The immutable test parses the Move vectors so drift reds.

import { is_stat_name, stat_names, type StatName } from './identity.ts'

export type RuneTier = 'ba' | 'pa' | 'ra'

export type RuneEffect = Readonly<{
  stat: StatName
  tier: RuneTier
  amount: number
}>

const rune_amounts = Object.freeze({
  ba: Object.freeze([3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
  pa: Object.freeze([10, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 3, 3, 3, 3]),
  ra: Object.freeze([30, 10, 10, 10, 10, 10, 0, 0, 0, 0, 0, 10, 10, 10, 10]),
} satisfies Readonly<Record<RuneTier, readonly number[]>>)

export const rune_weight_scale = 20
const rune_unit_weights_scaled = Object.freeze([5, 60, 20, 20, 20, 20, 1020, 1800, 2000, 600, 400, 80, 80, 80, 80])

export const rune_unit_weight = (stat: StatName): number =>
  rune_unit_weights_scaled[stat_names.indexOf(stat)]! / rune_weight_scale

export const rune_unit_weights = Object.freeze(
  Object.fromEntries(stat_names.map((stat) => [stat, rune_unit_weight(stat)])) as Record<StatName, number>
)

/** Hard per-item application cap (0 = uncapped) — rune_catalog.move MAX_APPS. */
const rune_apps_caps = Object.freeze([0, 0, 0, 0, 0, 0, 1, 1, 1, 10, 0, 0, 0, 0, 0])

export const rune_max_apps = (stat: StatName): number => rune_apps_caps[stat_names.indexOf(stat)] ?? 0

const rune_pattern = /^rune_(.+)_(ba|pa|ra)$/

export const rune_effect = (item_type: string): RuneEffect | null => {
  const match = rune_pattern.exec(item_type)
  const stat = match?.[1]
  const tier = match?.[2] as RuneTier | undefined
  if (!stat || !tier || !is_stat_name(stat)) return null
  const amount = rune_amounts[tier][stat_names.indexOf(stat)] ?? 0
  return amount > 0 ? Object.freeze({ stat, tier, amount }) : null
}
