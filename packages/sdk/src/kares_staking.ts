// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { normalizeSuiObjectId } from '@mysten/sui/utils'

import { positive_kares_amount } from './kares_ptb.ts'

export type StakeWithdrawal = Readonly<{ id: string; amount: bigint }>

/** Spend the largest positions first; the full withdrawal is one atomic PTB. */
export const plan_staking_withdrawal = (
  positions: readonly StakeWithdrawal[],
  amount: bigint
): readonly StakeWithdrawal[] => {
  positive_kares_amount(amount)
  const rows = positions.map((position) => ({ ...position, id: normalizeSuiObjectId(position.id) }))
  if (new Set(rows.map(({ id }) => id)).size !== rows.length) throw new Error('Duplicate staking position')
  const plan = rows
    .toSorted((left, right) =>
      left.amount === right.amount ? left.id.localeCompare(right.id) : left.amount > right.amount ? -1 : 1
    )
    .reduce(
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
