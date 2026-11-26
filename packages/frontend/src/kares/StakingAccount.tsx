// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button, StakingRewards, SuiLogo } from '@aresrpg/ui'
import { staking_claim_batch } from '@aresrpg/sdk/kares'

import { useNumbers } from '../i18n/useNumbers.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { KaresLogo } from '../components/KaresLogo.tsx'

import { type FinanceInput, type FinanceSnapshot, type FinanceState } from './model.ts'
import { staking_gains } from './staking_model.ts'
import { ACTION_BOX, StakingForm } from './StakingForm.tsx'

/** The stake and rewards beside the form; one column on a phone. */
const COLUMNS = 'grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start gap-6 max-[760px]:grid-cols-1'

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
    <div className={COLUMNS} data-kares-staking="">
      <StakingRewards
        icon={<KaresLogo size={32} />}
        stake_label={copy.your_stake}
        stake={format_amount(stats.stake, 0)}
        unit="KARES"
        notice={snapshot.pool.active ? null : copy.inactive}
        accrued_label={copy.claimable}
        lanes={[
          {
            asset: 'KARES',
            hue: 'gold',
            icon: <KaresLogo size={16} />,
            accrued: format_amount(stats.accrued_kares, 0),
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

/** The desk of one wallet: its stake and rewards beside the form, its boxes until the chain answers, or
 * that staking is unavailable when the read failed or found no pool. */
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
  <section className="grid min-w-0 grid-cols-1 gap-3.5" data-staking-account={state.address ?? ''}>
    {state.snapshot ? (
      <StakingContent copy={copy} dispatch={dispatch} snapshot={state.snapshot} state={state} balance={balance} />
    ) : !state.error && !state.unfunded ? (
      <div className={COLUMNS} aria-busy="true" aria-label={copy.kares_page.loading}>
        <div className="grid content-start gap-3.5">
          <span className="aui-skeleton aui-skeleton--title" />
          <span className="aui-skeleton aui-skeleton--block" />
        </div>
        <div className={`${ACTION_BOX} content-start gap-3.5`}>
          <span className="aui-skeleton aui-skeleton--block" />
          <span className="aui-skeleton aui-skeleton--block" />
          <span className="aui-skeleton aui-skeleton--short" />
        </div>
      </div>
    ) : (
      <p className="flex items-center gap-2.5 text-soft before:size-1.5 before:flex-none before:rounded-full before:bg-faint">
        {copy.kares_page.staking_unavailable}
      </p>
    )}
  </section>
)
