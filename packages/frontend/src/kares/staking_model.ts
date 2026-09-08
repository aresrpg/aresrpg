// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { format_amount, type FinanceSnapshot } from './model.ts'

const UNIT = 1_000_000_000n

/** Keep amount presets exact, including balances above Number.MAX_SAFE_INTEGER. */
export const staking_preset = (balance: bigint, percent: 25 | 50 | 100): string => {
  const amount = (balance * BigInt(percent)) / 100n
  return `${amount / UNIT}.${(amount % UNIT).toString().padStart(9, '0')}`
}

export const daily_amount = (amount: bigint): string => {
  const [integer, decimal = ''] = format_amount(amount, 3).split('.')
  return `${integer}.${decimal.padEnd(3, '0')}`
}

/** Instant funded-emission estimate: adding principal also dilutes the existing stake share. */
export const staking_gains = (snapshot: FinanceSnapshot, additional = 0n) => {
  const stake = snapshot.positions.reduce((total, position) => total + position.amount, 0n)
  const total = snapshot.pool.total_staked
  const after_total = total + additional
  const share = (emission: bigint, principal: bigint, pool: bigint) => (pool > 0n ? (emission * principal) / pool : 0n)
  const kares = share(snapshot.pool.daily_kares, stake, total)
  const sui = share(snapshot.pool.daily_sui, stake, total)
  return {
    stake,
    accrued_kares: snapshot.positions.reduce((sum, position) => sum + position.pending_kares, 0n),
    accrued_sui: snapshot.positions.reduce((sum, position) => sum + position.pending_sui, 0n),
    kares,
    sui,
    additional_kares: share(snapshot.pool.daily_kares, stake + additional, after_total) - kares,
    additional_sui: share(snapshot.pool.daily_sui, stake + additional, after_total) - sui,
  }
}
