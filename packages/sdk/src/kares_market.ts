// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The market pool's reserves, read for display only. A price from here never sizes or authorizes a payment.
import { normalizeStructTag, SUI_TYPE_ARG } from '@mysten/sui/utils'

import { KARES_MARKET } from './kares_economics.ts'

/** What the pool holds, in each coin's base units. */
export type KaresMarket = Readonly<{ sui: bigint; kares: bigint }>
type Json = Readonly<Record<string, unknown>>

/** Aftermath's fee wrapper names the pool it holds. */
export const market_pool_id = (wrapper: Json): string => {
  if (typeof wrapper.pool_id !== 'string') throw new Error('The market wrapper names no pool')
  return wrapper.pool_id
}

const strings = (value: unknown, name: string): readonly string[] => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new Error(`The market pool has no ${name}`)
  return value
}

/** Aftermath stores each balance multiplied by its coin's scalar, in the pool's own coin order. */
export const decode_market_pool = (pool: Json, coin_type: string): KaresMarket => {
  const types = strings(pool.type_names, 'coin types').map((type) => normalizeStructTag(`0x${type}`))
  const balances = strings(pool.normalized_balances, 'balances')
  const scalars = strings(pool.decimal_scalars, 'scalars')
  const reserve = (type: string): bigint => {
    const index = types.indexOf(normalizeStructTag(type))
    if (index < 0 || !balances[index] || !scalars[index] || BigInt(scalars[index]) === 0n)
      throw new Error('The market pool does not hold the expected coins')
    return BigInt(balances[index]) / BigInt(scalars[index])
  }
  return Object.freeze({ sui: reserve(SUI_TYPE_ARG), kares: reserve(coin_type) })
}

/** One KARES in SUI at the pool's spot price: (SUI / SUI weight) ÷ (KARES / KARES weight). Null while the pool is empty. */
export const kares_price_sui = ({ sui, kares }: KaresMarket): number | null => {
  const kares_weight = Number(KARES_MARKET.kares_weight_bps)
  return kares === 0n ? null : (Number(sui) * kares_weight) / (Number(kares) * (10_000 - kares_weight))
}
