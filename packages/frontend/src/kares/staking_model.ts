// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { kares_price_sui, type KaresMarket } from '@aresrpg/sdk/kares-market'

import type { FinanceSnapshot } from './model.ts'

const UNIT = 1_000_000_000n
const tokens = (amount: bigint): number => Number(amount) / Number(UNIT)

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
  return {
    kares: sui_usd === null || kares_sui === null ? null : tokens(gains.kares) * kares_sui * sui_usd,
    sui: sui_usd === null ? null : tokens(gains.sui) * sui_usd,
  }
}

/**
 * The pool's yearly return at today's funded rates, as a fraction of what is staked. Both rewards are valued in
 * SUI at the pool's spot price, and nothing compounds: a claimed reward is not staked again. Null while the price
 * is unknown or nobody stakes. A display aid: the rates change as the schedule and the stake move.
 */
export const staking_apr = (
  pool: Readonly<Pick<FinanceSnapshot['pool'], 'total_staked' | 'daily_kares' | 'daily_sui'>>,
  market: KaresMarket | null
): number | null => {
  const price = market ? kares_price_sui(market) : null
  if (price === null || price <= 0 || pool.total_staked <= 0n) return null
  const yearly_sui = 365 * (tokens(pool.daily_kares) * price + tokens(pool.daily_sui))
  return yearly_sui / (tokens(pool.total_staked) * price)
}
