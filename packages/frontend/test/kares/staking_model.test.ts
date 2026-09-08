// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { daily_amount, staking_gains, staking_preset } from '../../src/kares/staking_model.ts'

import { finance_snapshot } from './fixture.ts'

test('additional daily gains account for dilution instead of multiplying the old rate', () => {
  const base = finance_snapshot()
  const snapshot = {
    ...base,
    pool: { ...base.pool, total_staked: 100n, daily_kares: 1_000n, daily_sui: 100n },
    positions: [{ ...base.positions[0], amount: 25n }],
  }
  expect(staking_gains(snapshot, 25n)).toMatchObject({
    stake: 25n,
    kares: 250n,
    sui: 25n,
    additional_kares: 150n,
    additional_sui: 15n,
  })
  const all = { ...snapshot, pool: { ...snapshot.pool, total_staked: 25n } }
  expect(staking_gains(all, 25n)).toMatchObject({ additional_kares: 0n, additional_sui: 0n })
  const empty = { ...snapshot, pool: { ...snapshot.pool, total_staked: 0n }, positions: [] }
  expect(staking_gains(empty, 1n)).toMatchObject({ kares: 0n, sui: 0n, additional_kares: 1_000n, additional_sui: 100n })
  expect(staking_gains(empty)).toMatchObject({ additional_kares: 0n, additional_sui: 0n })
})

test('percentage shortcuts preserve exact base units and daily displays have exactly three decimals', () => {
  expect(staking_preset(9_007_199_254_740_993n, 100)).toBe('9007199.254740993')
  expect(staking_preset(9_007_199_254_740_993n, 25)).toBe('2251799.813685248')
  expect(staking_preset(1_000_000_001n, 50)).toBe('0.500000000')
  expect(daily_amount(0n)).toBe('0.000')
  expect(daily_amount(1_500_000_000n)).toBe('1.500')
  expect(daily_amount(1_234_567_890n)).toBe('1.234')
})
