// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { KARES_ALLOCATION, KARES_MARKET, KARES_RESERVE_SUPPLY, KARES_SUPPLY } from '@aresrpg/sdk/kares-economics'

import type { KaresCopy } from './copy.ts'

/** The currency's whole supply. The liquidity share is locked in the market pool at launch. */
export const kares_distribution = (copy: KaresCopy) =>
  [
    { label: `${copy.community} (${copy.vested_five_years})`, amount: KARES_ALLOCATION.community, color: '#b395dd' },
    { label: `${copy.five_years} (${copy.vested_five_years})`, amount: KARES_ALLOCATION.rewards, color: '#4a9eff' },
    { label: copy.combat_rewards, amount: KARES_ALLOCATION.combat, color: '#bd795c' },
    { label: copy.team, amount: KARES_ALLOCATION.team, color: '#899097' },
    { label: copy.locked_liquidity, amount: KARES_ALLOCATION.liquidity, color: '#d4ad63' },
  ].map((row) => ({ ...row, share: Number((row.amount * 100n) / KARES_SUPPLY) }))

/** The market's terms as text values. Every percentage comes from the SDK's constants, never from copy. */
export const kares_market_values = (decimal: (value: number) => string) => {
  const percent = (bps: bigint) => decimal(Number(bps) / 100)
  const share = (amount: bigint) => percent((amount * 10_000n) / KARES_SUPPLY)
  return Object.freeze({
    kares_weight: percent(KARES_MARKET.kares_weight_bps),
    sui_weight: percent(10_000n - KARES_MARKET.kares_weight_bps),
    treasury_fee: percent(KARES_MARKET.treasury_fee_bps),
    pool_fee: percent(KARES_MARKET.pool_fee_bps),
    liquidity: share(KARES_ALLOCATION.liquidity),
    reserves: share(KARES_RESERVE_SUPPLY),
    team: share(KARES_ALLOCATION.team),
  })
}
