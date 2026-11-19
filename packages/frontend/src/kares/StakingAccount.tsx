// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button, StakingRewards } from '@aresrpg/ui'
import { staking_claim_batch } from '@aresrpg/sdk/kares'

import { useNumbers } from '../i18n/useNumbers.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { KaresLogo } from '../components/KaresLogo.tsx'
import { SuiLogo } from '../components/SuiLogo.tsx'

import { FinanceStatus, finance_empty_message } from './components.tsx'
import { type FinanceInput, type FinanceSnapshot, type FinanceState } from './model.ts'
import { staking_gains } from './staking_model.ts'
import { StakingForm } from './StakingForm.tsx'

export const StakingContent = ({
  copy: app_copy,
  state,
  dispatch,
  snapshot,
  balance,
}: Readonly<{
  copy: AppCopy
  state: FinanceState
  dispatch: (input: FinanceInput) => void
  snapshot: FinanceSnapshot
  balance: bigint | null
}>) => {
  const { amount: format_amount } = useNumbers()
  const claims = staking_claim_batch(snapshot.positions)
  const copy = app_copy.kares_page
  const stats = staking_gains(snapshot)
  const locked = !!state.request || !state.address
  return (
    <div className="staking-desk-columns" data-kares-staking="">
      <StakingRewards
        icon={<KaresLogo size={32} />}
        stake_label={copy.your_stake}
        stake={format_amount(stats.stake)}
        unit="KARES"
        notice={snapshot.pool.active ? null : copy.inactive}
        accrued_label={copy.claimable}
        lanes={[
          {
            asset: 'KARES',
            hue: 'gold',
            icon: <KaresLogo size={16} />,
            accrued: format_amount(stats.accrued_kares, 3),
          },
          { asset: 'SUI', hue: 'sky', icon: <SuiLogo size={16} />, accrued: format_amount(stats.accrued_sui, 3) },
        ]}
        action={
          <Button
            tone="primary"
            type="button"
            disabled={locked || stats.accrued_kares + stats.accrued_sui === 0n}
            onClick={() =>
              dispatch({
                type: 'request',
                request: { kind: 'execute', action: { kind: 'claim_rewards', ids: claims.ids } },
              })
            }
          >
            {claims.total > claims.ids.length
              ? copy.claim_batch
                  .replace('{{count}}', String(claims.ids.length))
                  .replace('{{total}}', String(claims.total))
              : copy.claim_rewards}
          </Button>
        }
      />
      <StakingForm copy={copy} balance={balance} locked={locked} snapshot={snapshot} dispatch={dispatch} />
    </div>
  )
}

/** The desk of one wallet: its stake and rewards beside the form, or why there is nothing to show. */
export const StakingAccount = ({
  copy,
  state,
  dispatch,
  balance,
}: Readonly<{
  copy: AppCopy
  state: FinanceState
  dispatch: (input: FinanceInput) => void
  balance: bigint | null
}>) => (
  <section className="staking-desk" data-staking-account={state.address ?? ''}>
    {state.snapshot ? (
      <StakingContent copy={copy} dispatch={dispatch} snapshot={state.snapshot} state={state} balance={balance} />
    ) : state.request ? (
      // The chain read is in flight: hold the desk's shape instead of a line of text.
      <div className="staking-desk-columns" aria-busy="true" aria-label={copy.kares_page.loading}>
        <div className="staking-skeleton">
          <span className="aui-skeleton aui-skeleton--title" />
          <span className="aui-skeleton aui-skeleton--block" />
        </div>
        <div className="staking-skeleton staking-action-box">
          <span className="aui-skeleton aui-skeleton--block" />
          <span className="aui-skeleton aui-skeleton--block" />
          <span className="aui-skeleton aui-skeleton--short" />
        </div>
      </div>
    ) : (
      <p className="staking-empty-message">{finance_empty_message(state, copy.kares_page)}</p>
    )}
    <FinanceStatus copy={copy.kares_page} state={state} />
  </section>
)
