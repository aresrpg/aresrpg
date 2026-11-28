// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { KARES_SUPPLY, KARES_UNIT } from '@aresrpg/sdk/kares-economics'
import { kares_price_sui } from '@aresrpg/sdk/kares-market'

import type { FinanceState } from './model.ts'

export type TokenomicsPhase = 'loading' | 'unavailable' | 'pre_funding' | 'ready' | 'stale' | 'error'

const tokenomics_phase = (state: FinanceState): TokenomicsPhase => {
  if (state.request) return 'loading'
  if (state.error?.includes('is not configured')) return 'unavailable'
  if (state.error) return state.stale ? 'stale' : 'error'
  if (state.unfunded) return 'pre_funding'
  return state.snapshot ? 'ready' : 'loading'
}

export const tokenomics_reading = (state: FinanceState) => {
  const phase = tokenomics_phase(state)
  const snapshot = phase === 'ready' || phase === 'stale' ? state.snapshot : null
  return {
    phase,
    snapshot,
    burned:
      snapshot && snapshot.total_supply >= 0n && snapshot.total_supply <= KARES_SUPPLY
        ? KARES_SUPPLY - snapshot.total_supply
        : null,
    // What its holders own: the supply minus what the reward pools have not paid out yet. Staked KARES
    // counts, because its owner can withdraw it at any time.
    circulating: snapshot
      ? snapshot.total_supply - snapshot.pool.kares_rewards - snapshot.combat_pot.balance - snapshot.community.remaining
      : null,
    // The part of the current supply that is staked, as a fraction. Display only.
    staked_share:
      snapshot && snapshot.total_supply > 0n
        ? Number((snapshot.pool.total_staked * 1_000_000n) / snapshot.total_supply) / 1_000_000
        : null,
  }
}

/**
 * The token's dollar readings at the pool's spot price. Fully diluted counts the whole current supply;
 * the market cap counts only what circulates. Null while a price is unknown. Display only.
 */
export const market_reading = (
  reading: Readonly<Pick<ReturnType<typeof tokenomics_reading>, 'snapshot' | 'circulating'>>,
  sui_usd: number | null
): Readonly<{ price: number | null; fdv: number | null; market_cap: number | null }> => {
  const { snapshot, circulating } = reading
  const price_sui = snapshot?.market ? kares_price_sui(snapshot.market) : null
  if (!snapshot || price_sui === null || sui_usd === null) return { price: null, fdv: null, market_cap: null }
  const price = price_sui * sui_usd
  const tokens = (amount: bigint) => Number(amount) / Number(KARES_UNIT)
  return {
    price,
    fdv: price * tokens(snapshot.total_supply),
    market_cap: circulating === null ? null : price * tokens(circulating),
  }
}
