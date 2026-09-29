// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { KARES_SUPPLY, KARES_UNIT } from '@aresrpg/sdk/kares-economics'
import { Workspace, ConfirmDialog } from '@aresrpg/ui'
import { Coins } from 'lucide-react'

import { KaresPageView } from '../../kares/KaresPage.tsx'
import { initial_wallet_state } from '../../wallet/model.ts'
import { initial_finance, type FinanceSnapshot } from '../../kares/model.ts'
import type { AppCopy } from '../../i18n/copy.ts'

import { WorkshopSurface } from './shared.tsx'
import '../../kares/staking.css'

const snapshot = (address: string, stake: bigint): FinanceSnapshot => ({
  network: 'testnet',
  address,
  clock_ms: 0n,
  total_supply: KARES_SUPPLY,
  contributions: [],
  combat_pot: { id: 'preview', version: '1', balance: 0n, quota: 20000n, spent: 0n },
  offering: {
    id: 'preview',
    version: '1',
    started: false,
    duration_ms: 0n,
    opens_ms: 0n,
    closes_ms: 0n,
    min_raise: 1n,
    max_raise: 1n,
    total_contributed: 0n,
    accepted: 0n,
    settled: false,
    settled_ms: 0n,
    community_remaining: 0n,
    community_claimable: 0n,
    treasury: 'preview',
    liquidity: 'preview',
  },
  pool: {
    id: 'preview',
    version: '1',
    active: true,
    total_staked: 100000n * KARES_UNIT,
    active_ms: 0n,
    initial_remaining: 200000n * KARES_UNIT,
    kares_rewards: 100n * KARES_UNIT,
    sui_rewards: 100n * KARES_UNIT,
    daily_kares: 54800000000n,
    daily_sui: 1200000000n,
  },
  positions: [
    { id: address, version: '1', amount: stake * KARES_UNIT, pending_kares: 12500000000n, pending_sui: 42000000n },
  ],
})
export const StakingExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [review, set_review] = useState(false)
  return (
    <WorkshopSurface copy={copy} title={copy.kares_page.staking_title} icon={<Coins />}>
      {(header) => (
        <>
          <Workspace {...header} className="aui-feature-port aui-staking-port">
            <KaresPageView
              copy={copy}
              account={{
                state: { ...initial_finance('game'), snapshot: snapshot('game', 2500n) },
                dispatch: () => set_review(true),
              }}
              external={{
                state: {
                  ...initial_finance('external'),
                  snapshot: snapshot('external', 800n),
                  balances: { kares_balance: 1200n * KARES_UNIT, sui_balance: 0n },
                },
                dispatch: () => set_review(true),
              }}
              account_balance={600n * KARES_UNIT}
              wallet={{
                state: {
                  ...initial_wallet_state(),
                  loaded: true,
                  session: { address: 'external', wallet_name: 'Preview wallet', disconnect: async () => {} },
                },
                dispatch: () => set_review(true),
              }}
            />
          </Workspace>
          {review && (
            <ConfirmDialog
              title={copy.kares_page.staking_title}
              description={copy.ui.preview_only}
              confirm_label={copy.wallet_close}
              cancel_label={copy.cancel}
              close_label={copy.wallet_close}
              on_cancel={() => set_review(false)}
              on_confirm={() => set_review(false)}
            />
          )}
        </>
      )}
    </WorkshopSurface>
  )
}
