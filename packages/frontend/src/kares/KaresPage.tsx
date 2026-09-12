// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect } from 'react'
import { WalletCards } from 'lucide-react'

import { env } from '../env.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { WalletControl } from '../wallet/WalletControl.tsx'
import type { WalletView } from '../wallet/model.ts'

import type { FinanceSession } from './model.ts'
import { StakingAccount } from './StakingAccount.tsx'
import { useFinance } from './useFinance.ts'

import './staking.css'

export const KaresPageView = ({
  copy,
  account,
  external,
  account_balance,
  wallet,
}: Readonly<{
  copy: AppCopy
  account: ReturnType<typeof useFinance>
  external: ReturnType<typeof useFinance>
  wallet: WalletView
  account_balance: bigint | null
}>) => {
  const same_account = wallet.state.session?.address === account.state.address
  const connected = !!wallet.state.session && !same_account
  const wallet_control = (
    <WalletControl copy={copy.kares_page} wallet={wallet} locked={external.state.request?.kind === 'execute'} />
  )
  return (
    <section className="staking-page">
      <header className="staking-page-header">
        <div className="staking-eyebrow">KARES / {copy.kares}</div>
        <h1>{copy.kares_page.staking_title}</h1>
        <p>{copy.kares_page.staking_revenue}</p>
      </header>
      <div className="staking-account-pair">
        <StakingAccount
          copy={copy}
          title={copy.kares_page.game_account}
          state={account.state}
          dispatch={account.dispatch}
          balance={account_balance}
        />
        <StakingAccount
          copy={copy}
          title={copy.kares_page.external_wallet}
          state={external.state}
          dispatch={external.dispatch}
          balance={external.state.balances ? external.state.balances.kares_balance : null}
          external
          wallet_control={connected ? wallet_control : undefined}
          empty={
            connected ? undefined : (
              <div className="staking-wallet-placeholder">
                <WalletCards size={28} />
                <h3>{copy.kares_page.external_wallet}</h3>
                <p>{wallet.state.session ? copy.kares_page.same_account : copy.kares_page.external_wallet_hint}</p>
                {wallet_control}
              </div>
            )
          }
        />
      </div>
      <p className="staking-daily-note">{copy.kares_page.daily_estimate_note}</p>
    </section>
  )
}

export default function KaresPage({
  copy,
  initial_session,
}: Readonly<{ copy: AppCopy; initial_session?: FinanceSession | null }>) {
  const account = useFinance({ network: env.network, rpc_url: env.sui_rpc_url, managed: true }, initial_session)
  const wallet_state = useAppStore((state) => state.external_wallet)
  const external_session = wallet_state.session?.address === initial_session?.address ? null : wallet_state.session
  const external = useFinance({ network: env.network, rpc_url: env.sui_rpc_url }, external_session)
  const balance = useAppStore((state) => state.session.kares_balance)
  useEffect(() => {
    if (account.state.digest) dispatch_app({ type: 'wallet/refresh' })
  }, [account.state.digest])
  return (
    <KaresPageView
      copy={copy}
      account={account}
      external={external}
      wallet={{ state: wallet_state, dispatch: dispatch_app }}
      account_balance={balance}
    />
  )
}
