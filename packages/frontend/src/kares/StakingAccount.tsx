// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { type ReactNode } from 'react'
import { Gamepad2, WalletCards } from 'lucide-react'

import { env } from '../env.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { KaresLogo } from '../components/KaresLogo.tsx'

import { FinanceStatus, finance_empty_message } from './components.tsx'
import { format_amount, type FinanceInput, type FinanceSnapshot, type FinanceState } from './model.ts'
import { daily_amount, staking_gains } from './staking_model.ts'
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
  const copy = app_copy.kares_page
  const stats = staking_gains(snapshot)
  const locked = !!state.request || !state.address
  return (
    <div className="staking-account-content" data-kares-staking="">
      <div className="staking-principal">
        <KaresLogo size={54} />
        <span className="staking-micro">{copy.your_stake}</span>
        <span className="staking-principal-value">
          {format_amount(stats.stake)} <small>KARES</small>
        </span>
      </div>
      <div className="staking-yields">
        <div>
          <span>{copy.daily_kares}</span>
          <strong className="text-gold">{daily_amount(stats.kares)}</strong>
        </div>
        <div>
          <span>{copy.daily_sui}</span>
          <strong className="text-cyan">{daily_amount(stats.sui)}</strong>
        </div>
      </div>
      {!snapshot.pool.active && <p className="staking-notice">{copy.inactive}</p>}
      <section className="staking-rewards" aria-label={copy.claimable}>
        <div>
          <h3>{copy.claimable}</h3>
          <div className="staking-accrued">
            <span className="text-gold">{format_amount(stats.accrued_kares, 3)} KARES</span>
            <span className="text-cyan">{format_amount(stats.accrued_sui, 3)} SUI</span>
          </div>
        </div>
        <button
          className="staking-claim"
          type="button"
          disabled={locked || stats.accrued_kares + stats.accrued_sui === 0n}
          onClick={() =>
            dispatch({
              type: 'request',
              request: {
                kind: 'execute',
                action: { kind: 'claim_rewards', ids: snapshot.positions.map(({ id }) => id) },
              },
            })
          }
        >
          {copy.claim_rewards}
        </button>
      </section>
      <StakingForm copy={copy} balance={balance} locked={locked} snapshot={snapshot} dispatch={dispatch} />
    </div>
  )
}

export const StakingAccount = ({
  copy,
  title,
  state,
  dispatch,
  balance,
  external = false,
  empty,
  wallet_control,
}: Readonly<{
  copy: AppCopy
  title: string
  state: FinanceState
  dispatch: (input: FinanceInput) => void
  balance: bigint | null
  external?: boolean
  empty?: ReactNode
  wallet_control?: ReactNode
}>) => (
  <section
    className={`staking-account ${external ? 'staking-external' : ''}`}
    data-staking-account={state.address ?? ''}
  >
    <header className="staking-account-header">
      {external ? <WalletCards size={15} /> : <Gamepad2 size={15} />}
      <h2>{title}</h2>
      {wallet_control}
    </header>
    {empty ??
      (state.snapshot ? (
        <StakingContent copy={copy} dispatch={dispatch} snapshot={state.snapshot} state={state} balance={balance} />
      ) : (
        <p className="staking-empty-message">
          {finance_empty_message(state, copy.kares_page, copy.kares_page.staking_unavailable)}
        </p>
      ))}
    <FinanceStatus network={env.network} copy={copy.kares_page} state={state} />
  </section>
)
