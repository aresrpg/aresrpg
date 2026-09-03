// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  dofus_weapon_damage_envelope,
  item_budget_envelope,
  item_budget_standing,
  item_budget_stat_weight,
  type ItemBudgetEnvelope,
  type ItemBudgetStanding,
  type WeaponDamageEnvelope,
} from '@aresrpg/immutable'
import { WEAPON_PHYSICS } from '@aresrpg/fight/move_contract'

import type { JsonValue } from './seed_editor.ts'

export type ItemPowerStatus = 'weak' | 'balanced' | 'high' | 'beyond'

export type WeaponPowerSummary = WeaponDamageEnvelope &
  Readonly<{
    average_per_ap: number
    maximum_per_ap: number
    status: ItemPowerStatus
  }>

export type ItemPowerSummary = ItemBudgetEnvelope &
  ItemBudgetStanding &
  Readonly<{
    level: number
    category: string
    stat_power: number
    status: ItemPowerStatus
    stat_contributions: Readonly<Record<string, number>>
    weapon: WeaponPowerSummary | null
  }>

const json_record = (value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : null

const finite_number = (value: JsonValue | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const status_of = (value: number, p10: number, p90: number, maximum: number): ItemPowerStatus =>
  value < p10 ? 'weak' : value <= p90 ? 'balanced' : value <= maximum ? 'high' : 'beyond'

export const item_power_budget = (level: number, category = ''): number =>
  level > 0 ? item_budget_envelope(level, category).median : 0

export const item_stat_weight = item_budget_stat_weight

const weapon_power = (level: number, category: string, damages: readonly JsonValue[]): WeaponPowerSummary | null => {
  const physics = (WEAPON_PHYSICS as Readonly<Record<string, Readonly<{ ap: bigint }>>>)[category]
  if (!physics || damages.length === 0) return null
  const ap = Number(physics.ap)
  const envelope = dofus_weapon_damage_envelope(level, category, ap)
  if (!envelope) return null
  const totals = damages.reduce<Readonly<{ average: number; maximum: number }>>(
    (sum, damage) => {
      const line = json_record(damage)
      const from = finite_number(line?.from)
      const to = finite_number(line?.to)
      return { average: sum.average + (from + to) / 2, maximum: sum.maximum + to }
    },
    { average: 0, maximum: 0 }
  )
  const average_per_ap = Math.round((totals.average / ap) * 100) / 100
  const maximum_per_ap = Math.round((totals.maximum / ap) * 100) / 100
  return Object.freeze({
    ...envelope,
    average_per_ap,
    maximum_per_ap,
    status: status_of(average_per_ap, envelope.average_p10, envelope.average_p90, envelope.average_max),
  })
}

const supports_item_power = (
  category: string,
  stats: Readonly<Record<string, JsonValue>> | null,
  damages: readonly JsonValue[]
): boolean => category !== 'pet' && (stats !== null || damages.length > 0)

export const item_power_summary = (value: JsonValue): ItemPowerSummary | null => {
  const item = json_record(value)
  if (!item) return null
  const level = finite_number(item.level)
  const category = typeof item.category === 'string' ? item.category : ''
  const stats = json_record(item.stats)
  const damages = Array.isArray(item.damages) ? item.damages : []
  if (!supports_item_power(category, stats, damages)) return null
  const maximum = json_record(stats?.max)
  const stat_contributions = Object.freeze(
    Object.fromEntries(
      Object.entries(maximum ?? {}).map(([stat, amount]) => [stat, item_stat_weight(stat, finite_number(amount))])
    )
  )
  const stat_power = Object.values(stat_contributions).reduce((sum, weight) => sum + weight, 0)
  const envelope = item_budget_envelope(level, category)
  return Object.freeze({
    ...envelope,
    ...item_budget_standing(level, category, stat_power),
    level,
    category,
    stat_power,
    status: status_of(stat_power, envelope.p10, envelope.p90, envelope.corpus_max),
    stat_contributions,
    weapon: weapon_power(level, category, damages),
  })
}
