// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Exact natural-characteristic ladders extracted from the installed official bank-612
// classes_fr_1383.swf (`b10`…`b15`). A row starts at `from`; one allocation click
// spends `cost` capital and grants `gain`. Equipment and future scroll bonuses never enter.

import { characteristic_names, type CharacteristicName, type ClassName } from './identity.ts'

export type CharacteristicCostStep = Readonly<{ from: number; cost: number; gain: number }>
export type CharacteristicLadder = readonly CharacteristicCostStep[]
export type CharacteristicValues = Readonly<Record<CharacteristicName, number>>
export type CharacteristicQuote = Readonly<{
  cost: number
  costs: CharacteristicValues
  gains: CharacteristicValues
}>

const ladder = (...rows: readonly (readonly [from: number, cost: number, gain?: number])[]): CharacteristicLadder =>
  Object.freeze(rows.map(([from, cost, gain = 1]) => Object.freeze({ from, cost, gain })))

const VITALITY = ladder([0, 1])
const WISDOM = ladder([0, 3])
const STANDARD = ladder([0, 1], [100, 2], [200, 3], [300, 4], [400, 5])
const SHORT = ladder([0, 1], [20, 2], [40, 3], [60, 4], [80, 5])
const EXPENSIVE = ladder([0, 2], [50, 3], [150, 4], [250, 5])
const FIFTY = ladder([0, 1], [50, 2], [150, 3], [250, 4], [350, 5])
const AGILITY_FIFTY = ladder([0, 1], [50, 2], [100, 3], [150, 4], [200, 5])
const THREE_CAP = ladder([0, 1], [50, 2], [200, 3])
const BERSERKER = ladder([0, 3], [100, 4], [150, 5])
const DOUBLE_VITALITY = ladder([0, 1, 2])

const costs = (
  strength: CharacteristicLadder,
  intelligence: CharacteristicLadder,
  chance: CharacteristicLadder,
  agility: CharacteristicLadder,
  vitality = VITALITY,
  wisdom = WISDOM
): Readonly<Record<CharacteristicName, CharacteristicLadder>> =>
  Object.freeze({ vitality, wisdom, strength, intelligence, chance, agility })

export const characteristic_ladders: Readonly<
  Record<ClassName, Readonly<Record<CharacteristicName, CharacteristicLadder>>>
> = Object.freeze({
  shugo: costs(EXPENSIVE, STANDARD, SHORT, SHORT),
  tomoda: costs(EXPENSIVE, STANDARD, STANDARD, SHORT),
  rojin: costs(
    FIFTY,
    ladder([0, 1], [20, 2], [60, 3], [100, 4], [150, 5]),
    ladder([0, 1], [100, 2], [150, 3], [230, 4], [330, 5]),
    SHORT
  ),
  yajin: costs(STANDARD, EXPENSIVE, SHORT, STANDARD),
  tokei: costs(EXPENSIVE, STANDARD, SHORT, SHORT),
  asobi: costs(STANDARD, SHORT, SHORT, AGILITY_FIFTY),
  iyashi: costs(EXPENSIVE, STANDARD, SHORT, SHORT),
  senshi: costs(STANDARD, SHORT, SHORT, SHORT),
  yogan: costs(FIFTY, FIFTY, SHORT, AGILITY_FIFTY),
  mori: costs(ladder([0, 1], [50, 2], [250, 3], [300, 4], [400, 5]), STANDARD, STANDARD, SHORT),
  ikari: costs(BERSERKER, BERSERKER, BERSERKER, BERSERKER, DOUBLE_VITALITY),
  shusen: costs(THREE_CAP, THREE_CAP, THREE_CAP, THREE_CAP),
})

const step_at = (rows: CharacteristicLadder, value: number): CharacteristicCostStep =>
  rows.reduce((match, row) => (row.from <= value ? row : match), rows[0]!)

export const characteristic_cost_step = (
  classe: ClassName,
  stat: CharacteristicName,
  value: number
): CharacteristicCostStep => step_at(characteristic_ladders[classe][stat], value)

export const characteristic_allocation_quote = (
  classe: ClassName,
  current: CharacteristicValues,
  allocations: Readonly<Partial<Record<CharacteristicName, number>>>
): CharacteristicQuote | null => {
  const gains = Object.fromEntries(characteristic_names.map((stat) => [stat, 0])) as Record<CharacteristicName, number>
  const costs = Object.fromEntries(characteristic_names.map((stat) => [stat, 0])) as Record<CharacteristicName, number>
  let cost = 0
  for (const stat of characteristic_names) {
    const value = current[stat]
    const clicks = allocations[stat] ?? 0
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(clicks) || clicks < 0) return null
    for (let click = 0; click < clicks; click += 1) {
      const step = characteristic_cost_step(classe, stat, value + gains[stat])
      cost += step.cost
      costs[stat] += step.cost
      gains[stat] += step.gain
    }
  }
  return Object.freeze({ cost, costs: Object.freeze(costs), gains: Object.freeze(gains) })
}

/** Quote exact capital spending. A remainder that cannot buy a whole natural point is invalid. */
export const characteristic_spending_quote = (
  classe: ClassName,
  current: CharacteristicValues,
  spending: Readonly<Partial<Record<CharacteristicName, number>>>
): CharacteristicQuote | null => {
  const gains = Object.fromEntries(characteristic_names.map((stat) => [stat, 0])) as Record<CharacteristicName, number>
  const costs = Object.fromEntries(characteristic_names.map((stat) => [stat, 0])) as Record<CharacteristicName, number>
  let cost = 0
  for (const stat of characteristic_names) {
    const value = current[stat]
    let left = spending[stat] ?? 0
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(left) || left < 0) return null
    costs[stat] = left
    cost += left
    while (left > 0) {
      const step = characteristic_cost_step(classe, stat, value + gains[stat])
      if (left < step.cost) return null
      left -= step.cost
      gains[stat] += step.gain
    }
  }
  return Object.freeze({ cost, costs: Object.freeze(costs), gains: Object.freeze(gains) })
}

export const characteristic_value_cost = (
  classe: ClassName,
  stat: CharacteristicName,
  wanted: number
): number | null => {
  if (!Number.isSafeInteger(wanted) || wanted < 0) return null
  let value = 0
  let cost = 0
  const rows = characteristic_ladders[classe][stat]
  for (let index = 0; index < rows.length && value < wanted; index += 1) {
    const step = rows[index]!
    const target = Math.min(wanted, rows[index + 1]?.from ?? wanted)
    const gain = target - value
    if (gain % step.gain !== 0) return null
    cost += (gain / step.gain) * step.cost
    value = target
  }
  return value === wanted ? cost : null
}

export const characteristic_values_cost = (classe: ClassName, values: CharacteristicValues): number | null => {
  let cost = 0
  for (const stat of characteristic_names) {
    const value_cost = characteristic_value_cost(classe, stat, values[stat])
    if (value_cost === null) return null
    cost += value_cost
  }
  return cost
}
