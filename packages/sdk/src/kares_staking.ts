// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { normalizeSuiObjectId } from '@mysten/sui/utils'

import { positive_kares_amount } from './kares_ptb.ts'
import type { KaresPositionSnapshot } from './kares_snapshot.ts'

export type StakeWithdrawal = Readonly<{ id: string; amount: bigint }>
export const STAKING_POSITION_BATCH_LIMIT = 50

export const assert_staking_batch = (count: number): void => {
  if (count < 1 || count > STAKING_POSITION_BATCH_LIMIT)
    throw new Error(`Select 1..${STAKING_POSITION_BATCH_LIMIT} staking positions per transaction`)
}

/** Claim oldest eligible writes first: each claim advances its position's on-chain version. */
export const staking_claim_batch = (positions: readonly KaresPositionSnapshot[]) => {
  const eligible = positions.filter(({ pending_kares, pending_sui }) => pending_kares + pending_sui > 0n)
  const selected = eligible
    .toSorted((left, right) => {
      const a = BigInt(left.version),
        b = BigInt(right.version)
      return a === b ? left.id.localeCompare(right.id) : a < b ? -1 : 1
    })
    .slice(0, STAKING_POSITION_BATCH_LIMIT)
  return { ids: selected.map(({ id }) => id), total: eligible.length }
}

const ordered_principal = (positions: readonly StakeWithdrawal[]): readonly StakeWithdrawal[] =>
  positions
    .filter(({ amount }) => amount > 0n)
    .toSorted((left, right) =>
      left.amount === right.amount ? left.id.localeCompare(right.id) : left.amount > right.amount ? -1 : 1
    )

/** The form's Max is the principal withdrawable in this one bounded transaction. */
export const staking_withdrawal_batch = (positions: readonly StakeWithdrawal[]): readonly StakeWithdrawal[] =>
  ordered_principal(positions)
    .slice(0, STAKING_POSITION_BATCH_LIMIT)
    .map(({ id, amount }) => ({ id, amount }))

/** Spend the largest positions first; never silently truncate a requested amount. */
export const plan_staking_withdrawal = (
  positions: readonly StakeWithdrawal[],
  amount: bigint
): readonly StakeWithdrawal[] => {
  positive_kares_amount(amount)
  const rows = positions.map((position) => ({ ...position, id: normalizeSuiObjectId(position.id) }))
  if (new Set(rows.map(({ id }) => id)).size !== rows.length) throw new Error('Duplicate staking position')
  const plan = ordered_principal(rows).reduce(
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
  assert_staking_batch(plan.withdrawals.length)
  return plan.withdrawals
}
