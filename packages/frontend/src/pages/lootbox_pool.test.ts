// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure-function tests for lootbox_pool.ts's weight -> percent math. No React, no RPC.
import { describe, test, expect } from 'bun:test'

import { pool_with_percent } from './lootbox_pool'

describe('pool_with_percent — one-decimal % of the pool total weight', () => {
  test('the seeded pet_lootbox pool (70/50/25/8/8, sum 161)', () => {
    const rows = pool_with_percent([
      { pet: 'pet_bouloute', weight: 70 },
      { pet: 'pet_modni_lyk', weight: 50 },
      { pet: 'pet_tokeko', weight: 25 },
      { pet: 'pet_timon', weight: 8 },
      { pet: 'aetherwing', weight: 8 },
    ])
    expect(rows.map((r) => r.percent)).toEqual([43.5, 31.1, 15.5, 5, 5])
  })

  test('an even 50/50 split is exactly 50/50', () => {
    const rows = pool_with_percent([
      { pet: 'a', weight: 1 },
      { pet: 'b', weight: 1 },
    ])
    expect(rows.map((r) => r.percent)).toEqual([50, 50])
  })

  test('a single-row pool is 100%', () => {
    expect(pool_with_percent([{ pet: 'a', weight: 5 }])[0].percent).toBe(100)
  })

  test('a zero-weight-sum pool never divides by zero (returns 0, not NaN)', () => {
    const rows = pool_with_percent([
      { pet: 'a', weight: 0 },
      { pet: 'b', weight: 0 },
    ])
    expect(rows.map((r) => r.percent)).toEqual([0, 0])
  })

  test('rows keep their original pet/weight fields alongside percent', () => {
    const [row] = pool_with_percent([{ pet: 'pet_doris', weight: 70 }])
    expect(row.pet).toBe('pet_doris')
    expect(row.weight).toBe(70)
  })

  test('an empty pool returns an empty list', () => {
    expect(pool_with_percent([])).toEqual([])
  })
})
