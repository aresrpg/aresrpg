// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { staking_gains, staking_preset, staking_reward_batches } from '../../src/kares/staking_model.ts'

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

test('percentage shortcuts preserve exact base units', () => {
  expect(staking_preset(9_007_199_254_740_993n, 100)).toBe('9007199.254740993')
  expect(staking_preset(9_007_199_254_740_993n, 25)).toBe('2251799.813685248')
  expect(staking_preset(1_000_000_001n, 50)).toBe('0.500000000')
})

test('reward batches retain zero-principal earnings and skip only positions with no payable units', () => {
  const positions = Array.from({ length: 51 }, (_, index) => ({
    id: `0x${index.toString(16).padStart(64, '0')}`,
    version: '1',
    amount: 0n,
    pending_kares: 1n,
    pending_sui: 0n,
  }))
  const batches = staking_reward_batches([
    ...positions,
    { id: '0xffff', version: '1', amount: 100n, pending_kares: 0n, pending_sui: 0n },
  ])
  expect(batches.map((batch) => batch.length)).toEqual([50, 1])
  expect(batches.flat()).toEqual(positions)
})
