// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { plan_staking_withdrawal } from '../src/kares_staking.ts'

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
