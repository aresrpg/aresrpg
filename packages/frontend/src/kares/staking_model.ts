// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { kares_price_sui, type KaresMarket } from '@aresrpg/sdk/kares-market'

import type { FinanceSnapshot } from './model.ts'

const UNIT = 1_000_000_000n

/** Keep amount presets exact, including balances above Number.MAX_SAFE_INTEGER. */
export const staking_preset = (balance: bigint, percent: 25 | 50 | 100): string => {
  const amount = (balance * BigInt(percent)) / 100n
  return `${amount / UNIT}.${(amount % UNIT).toString().padStart(9, '0')}`
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

/** A day's estimated rewards in dollars. Null while a price is unknown. A display aid, never a payment amount. */
export const daily_usd = (
  gains: Readonly<{ kares: bigint; sui: bigint }>,
  market: KaresMarket | null,
  sui_usd: number | null
): Readonly<{ kares: number | null; sui: number | null }> => {
  const kares_sui = market ? kares_price_sui(market) : null
  const tokens = (amount: bigint) => Number(amount) / Number(UNIT)
  return {
    kares: sui_usd === null || kares_sui === null ? null : tokens(gains.kares) * kares_sui * sui_usd,
    sui: sui_usd === null ? null : tokens(gains.sui) * sui_usd,
  }
}
