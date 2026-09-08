// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Runtime mirror of move-math/rune_catalog.move. The immutable test parses the Move vectors so drift reds.

import { is_stat_name, stat_names, type StatName } from './identity.ts'
import { item_stat_center } from './item.ts'

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

/** Whole-line and combined excess limit, mirrored from forge.move. Inputs are signed points. */
export const rune_max_weight = 101
export const rune_can_apply = (
  current: Readonly<Partial<Record<StatName, number>>>,
  maximum: Readonly<Partial<Record<StatName, number>>>,
  rune: RuneEffect
): boolean => {
  const value = current[rune.stat] ?? 0
  const natural = maximum[rune.stat] ?? 0
  const price = rune_unit_weight(rune.stat)
  const next = value + rune.amount
  const ceiling = Math.max(natural, Math.floor(rune_max_weight / price))
  if (next > ceiling || next > 65_535 - item_stat_center) return false
  const over = stat_names.reduce(
    (sum, stat) => sum + Math.max(0, (current[stat] ?? 0) - (maximum[stat] ?? 0)) * rune_unit_weight(stat),
    0
  )
  const next_over = over - Math.max(0, value - natural) * price + Math.max(0, next - natural) * price
  return next_over <= rune_max_weight || next_over <= over
}

export const format_rune_weight = (scaled: string): string => {
  const value = BigInt(scaled)
  const scale = BigInt(rune_weight_scale)
  const whole = value / scale
  const fraction = ((value % scale) * 100n) / scale
  return fraction === 0n ? String(whole) : `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`
}

const rune_pattern = /^rune_(.+)_(ba|pa|ra)$/

export const rune_effect = (item_type: string): RuneEffect | null => {
  const match = rune_pattern.exec(item_type)
  const stat = match?.[1]
  const tier = match?.[2] as RuneTier | undefined
  if (!stat || !tier || !is_stat_name(stat)) return null
  const amount = rune_amounts[tier][stat_names.indexOf(stat)] ?? 0
  return amount > 0 ? Object.freeze({ stat, tier, amount }) : null
}
