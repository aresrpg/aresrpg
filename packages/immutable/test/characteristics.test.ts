// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  characteristic_allocation_quote,
  characteristic_cost_step,
  characteristic_ladders,
  characteristic_spending_quote,
  characteristic_value_cost,
} from '../src/characteristics.ts'
import { characteristic_names, class_names } from '../src/identity.ts'

describe('official characteristic ladders', () => {
  test('keeps the exact unusual client thresholds instead of smoothing them', () => {
    expect(characteristic_ladders.shugo.strength).toEqual([
      { from: 0, cost: 2, gain: 1 },
      { from: 50, cost: 3, gain: 1 },
      { from: 150, cost: 4, gain: 1 },
      { from: 250, cost: 5, gain: 1 },
    ])
    expect(characteristic_ladders.rojin.intelligence.at(-1)).toEqual({ from: 150, cost: 5, gain: 1 })
    expect(characteristic_ladders.mori.strength[2]).toEqual({ from: 250, cost: 3, gain: 1 })
  })

  test('quotes every staged click across a boundary from the current natural value', () => {
    const quote = characteristic_allocation_quote(
      'senshi',
      { vitality: 0, wisdom: 0, strength: 0, intelligence: 19, chance: 0, agility: 0 },
      { intelligence: 2 }
    )

    expect(quote).toEqual({
      cost: 3,
      costs: { vitality: 0, wisdom: 0, strength: 0, intelligence: 3, chance: 0, agility: 0 },
      gains: { vitality: 0, wisdom: 0, strength: 0, intelligence: 2, chance: 0, agility: 0 },
    })
  })

  test('spends exact capital and refuses an unusable remainder', () => {
    const current = { vitality: 0, wisdom: 0, strength: 0, intelligence: 19, chance: 0, agility: 0 }

    expect(characteristic_spending_quote('senshi', current, { intelligence: 3 })?.gains.intelligence).toBe(2)
    expect(characteristic_spending_quote('senshi', current, { intelligence: 2 })).toBeNull()
  })

  test('Ikari vitality spends one point for two vitality and only even values are reachable', () => {
    const quote = characteristic_allocation_quote(
      'ikari',
      { vitality: 0, wisdom: 0, strength: 0, intelligence: 0, chance: 0, agility: 0 },
      { vitality: 3 }
    )

    expect(quote?.cost).toBe(3)
    expect(quote?.gains.vitality).toBe(6)
    expect(characteristic_value_cost('ikari', 'vitality', 6)).toBe(3)
    expect(characteristic_value_cost('ikari', 'vitality', 5)).toBeNull()
  })

  test('Shusen stops at three-for-one while Wisdom remains three-for-one forever', () => {
    expect(characteristic_value_cost('shusen', 'strength', 201)).toBe(353)
    expect(characteristic_value_cost('shusen', 'wisdom', 100)).toBe(300)
  })

  test('matches the Move twin at every threshold edge', () => {
    const values = [
      0, 19, 20, 39, 40, 49, 50, 59, 60, 79, 80, 99, 100, 149, 150, 199, 200, 229, 230, 249, 250, 299, 300, 329, 330,
      349, 350, 399, 400, 500,
    ]
    let fingerprint = 0n
    class_names.forEach((classe, class_index) =>
      characteristic_names.forEach((stat, stat_index) => {
        for (const value of values) {
          const { cost, gain } = characteristic_cost_step(classe, stat, value)
          fingerprint += BigInt((class_index + 1) * (stat_index + 1) * (value + 1) * (cost * 10 + gain))
        }
      })
    )

    expect(fingerprint).toBe(366_013_424n)
  })
})
