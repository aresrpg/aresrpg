// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { KARES_ALLOCATION, KARES_SUPPLY } from '@aresrpg/sdk/kares-economics'
import { campaign } from '@aresrpg/immutable/allocation'

import type { KaresCopy } from './copy.ts'

export const kares_distribution = (copy: KaresCopy) =>
  [
    { label: `${copy.community} (${copy.vested_five_years})`, amount: KARES_ALLOCATION.community, color: '#b395dd' },
    { label: `${copy.five_years} (${copy.vested_five_years})`, amount: KARES_ALLOCATION.rewards, color: '#4a9eff' },
    { label: copy.combat_rewards, amount: KARES_ALLOCATION.combat, color: '#bd795c' },
    { label: copy.team, amount: KARES_ALLOCATION.team, color: '#899097' },
    { label: copy.token_sale, amount: (KARES_SUPPLY * BigInt(campaign.sale_bps)) / 10_000n, color: '#60bca9' },
    {
      label: copy.locked_liquidity,
      amount: (KARES_SUPPLY * BigInt(campaign.liquidity_bps)) / 10_000n,
      color: '#d4ad63',
    },
  ].map((row) => ({ ...row, share: Number((row.amount * 100n) / KARES_SUPPLY) }))
