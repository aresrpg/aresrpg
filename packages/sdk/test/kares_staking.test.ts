// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  plan_staking_withdrawal,
  staking_claim_batch,
  staking_withdrawal_batch,
  STAKING_POSITION_BATCH_LIMIT,
} from '../src/kares_staking.ts'

import { id } from './helpers/transport.ts'

test('withdrawals span positions exactly and prefer fewer object writes', () => {
  const positions = [
    { id: id(1), amount: 10n },
    { id: id(2), amount: 20n },
    { id: id(3), amount: 0n },
  ]
  expect(plan_staking_withdrawal(positions, 25n)).toEqual([
    { id: id(2), amount: 20n },
    { id: id(1), amount: 5n },
  ])
  expect(plan_staking_withdrawal(positions, 30n)).toEqual([
    { id: id(2), amount: 20n },
    { id: id(1), amount: 10n },
  ])
  expect(plan_staking_withdrawal(positions, 11n)).toEqual([{ id: id(2), amount: 11n }])
  expect(() => plan_staking_withdrawal(positions, 31n)).toThrow('Insufficient staked')
  expect(() => plan_staking_withdrawal(positions, 0n)).toThrow('positive u64')
  expect(() => plan_staking_withdrawal([positions[0], positions[0]], 1n)).toThrow('Duplicate')
})

test('bounded claims visit the entire old backlog even while previously claimed positions accrue again', () => {
  const positions = Array.from({ length: 257 }, (_, index) => ({
    id: id(index + 100),
    version: String(index + 1),
    amount: index === 0 ? 0n : 1n,
    pending_kares: 1n,
    pending_sui: 0n,
  }))
  const claimed = new Set<string>()
  let current = positions
  for (let batch = 0; batch < 6; batch += 1) {
    const plan = staking_claim_batch(current)
    expect(plan.ids.length).toBeLessThanOrEqual(STAKING_POSITION_BATCH_LIMIT)
    plan.ids.forEach((id) => claimed.add(id))
    current = current.map((position) =>
      plan.ids.includes(position.id) ? { ...position, version: String(1_000 + batch) } : position
    )
  }
  expect(claimed.size).toBe(257)
  expect(claimed.has(positions[0].id)).toBe(true)
  expect(staking_claim_batch([{ ...positions[0], pending_kares: 0n }])).toEqual({ ids: [], total: 0 })
  expect(staking_claim_batch([{ ...positions[0], pending_kares: 0n, pending_sui: 1n }]).ids).toEqual([positions[0].id])
})

test('withdrawal batches expose their exact capacity and never silently withdraw less than requested', () => {
  const positions = Array.from({ length: 257 }, (_, index) => ({ id: id(index + 100), amount: BigInt(index + 1) }))
  const batch = staking_withdrawal_batch(positions)
  const capacity = batch.reduce((sum, position) => sum + position.amount, 0n)
  expect(batch).toHaveLength(STAKING_POSITION_BATCH_LIMIT)
  expect(batch[0].amount).toBe(257n)
  expect(plan_staking_withdrawal(positions, capacity)).toHaveLength(STAKING_POSITION_BATCH_LIMIT)
  expect(() => plan_staking_withdrawal(positions, capacity + 1n)).toThrow('50')
  expect(staking_withdrawal_batch([{ id: id(1), amount: 0n }])).toEqual([])
})
