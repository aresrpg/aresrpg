// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { normalizeSuiObjectId } from '@mysten/sui/utils'

import { positive_kares_amount } from './kares_ptb.ts'
import { KARES_BATCH_SIZE } from './kares_batches.ts'

export type StakeWithdrawal = Readonly<{ id: string; amount: bigint }>

const ordered_staking_positions = (positions: readonly StakeWithdrawal[]): readonly StakeWithdrawal[] => {
  const rows = positions.map((position) => ({ ...position, id: normalizeSuiObjectId(position.id) }))
  if (new Set(rows.map(({ id }) => id)).size !== rows.length) throw new Error('Duplicate staking position')
  return rows.toSorted((left, right) =>
    left.amount === right.amount ? left.id.localeCompare(right.id) : left.amount > right.amount ? -1 : 1
  )
}

/** Largest exact principal amount that fits this application's one-transaction position bound. */
export const staking_withdrawal_limit = (positions: readonly StakeWithdrawal[]): bigint =>
  ordered_staking_positions(positions)
    .slice(0, KARES_BATCH_SIZE)
    .reduce((sum, row) => sum + row.amount, 0n)

/** Spend the largest positions first; the full requested amount remains one atomic PTB. */
export const plan_staking_withdrawal = (
  positions: readonly StakeWithdrawal[],
  amount: bigint
): readonly StakeWithdrawal[] => {
  positive_kares_amount(amount)
  const plan = ordered_staking_positions(positions).reduce(
    (state, position) => {
      const taken = position.amount < state.remaining ? position.amount : state.remaining
      return taken > 0n
        ? {
            remaining: state.remaining - taken,
            withdrawals: [...state.withdrawals, { id: position.id, amount: taken }],
          }
        : state
    },
    { remaining: amount, withdrawals: [] as readonly StakeWithdrawal[] }
  )
  if (plan.remaining !== 0n) throw new Error('Insufficient staked KARES')
  return plan.withdrawals
}
