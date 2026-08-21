// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_budget_envelope, item_budget_stat_weight, item_damage_line_weight } from '@aresrpg/immutable'

import type { JsonValue } from './seed_editor.ts'

export type ItemPowerStatus = 'weak' | 'balanced' | 'overpowered' | 'broken'

export type ItemPowerSummary = Readonly<{
  level: number
  category: string
  budget: number
  p10: number
  p90: number
  hard_max: number
  stat_weight: number
  damage_weight: number
  total_weight: number
  score: number
  status: ItemPowerStatus
  stat_contributions: Readonly<Record<string, number>>
}>

const json_record = (value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : null

const finite_number = (value: JsonValue | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

export const item_upu_budget = (level: number): number => (level > 0 ? item_budget_envelope(level).median : 0)

export const item_stat_weight = item_budget_stat_weight

export const item_power_summary = (value: JsonValue): ItemPowerSummary | null => {
  const item = json_record(value)
  if (!item) return null
  const level = finite_number(item.level)
  const category = typeof item.category === 'string' ? item.category : ''
  const stats = json_record(item.stats)
  const damages = Array.isArray(item.damages) ? item.damages : []
  if (!stats && damages.length === 0) return null
  const maximum = json_record(stats?.max)
  const stat_contributions = Object.freeze(
    Object.fromEntries(
      Object.entries(maximum ?? {}).map(([stat, amount]) => [stat, item_stat_weight(stat, finite_number(amount))])
    )
  )
  const stat_weight = Object.values(stat_contributions).reduce((sum, weight) => sum + weight, 0)
  const damage_weight = damages.reduce((sum, damage) => {
    const line = json_record(damage)
    return sum + finite_number(line?.to) * item_damage_line_weight
  }, 0)
  const envelope = item_budget_envelope(level)
  const budget = level > 0 ? envelope.median : 0
  const total_weight = stat_weight + damage_weight
  const score = budget > 0 ? Math.round((total_weight / budget) * 100) : 0
  const status: ItemPowerStatus =
    total_weight < envelope.p10
      ? 'weak'
      : total_weight <= envelope.p90
        ? 'balanced'
        : total_weight <= envelope.hard_max
          ? 'overpowered'
          : 'broken'
  return Object.freeze({
    level,
    category,
    budget,
    p10: envelope.p10,
    p90: envelope.p90,
    hard_max: envelope.hard_max,
    stat_weight,
    damage_weight,
    total_weight,
    score,
    status,
    stat_contributions,
  })
}
