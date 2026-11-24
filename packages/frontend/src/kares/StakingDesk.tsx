// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'
import { Gamepad2, WalletCards } from 'lucide-react'
import { StakingWalletRow, type StakingRowFigure } from '@aresrpg/ui'

import { external_wallet_view } from '../wallet/view.ts'
import { sui_session } from '../wallet/external_session.ts'
import { env } from '../env.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { dispatch_app, useSiteStore } from '../store.ts'
import { WalletControl } from '../wallet/WalletControl.tsx'
import type { WalletView } from '../wallet/model.ts'

import type { FinanceSession, FinanceState } from './model.ts'
import { staking_gains } from './staking_model.ts'
import { StakingAccount } from './StakingAccount.tsx'
import { useFinance } from './useFinance.ts'

type Finance = ReturnType<typeof useFinance>
type Source = 'game' | 'external'

/** A wallet's stake and daily rates as row figures; null while it has no snapshot. */
const useRowFigures = (copy: AppCopy['kares_page']) => {
  const { amount, daily } = useNumbers()
  return ({ snapshot }: FinanceState): readonly StakingRowFigure[] | null => {
    if (!snapshot) return null
    const gains = staking_gains(snapshot)
    return [
      { value: amount(gains.stake), label: 'KARES' },
      { value: daily(gains.kares), label: copy.daily_kares, hue: 'gold' },
      { value: daily(gains.sui), label: copy.daily_sui, hue: 'sky' },
    ]
  }
}

/** Why an external wallet has no line of figures: it is not connected, or it is the game account itself. */
const external_status = (text: AppCopy['kares_page'], connected: boolean, same_account: boolean): string | null => {
  if (connected) return null
  return same_account ? text.same_account : text.external_wallet_hint
}

/** Both wallets as two single lines. The external one is selectable only while a distinct wallet is connected. */
const WalletRows = ({
  text,
  account,
  external,
  wallet,
  source,
  connected,
  same_account,
  pick,
}: Readonly<{
  text: AppCopy['kares_page']
  account: Finance
  external: Finance
  wallet: WalletView
  source: Source
  connected: boolean
  same_account: boolean
  pick: (source: Source) => void
}>) => {
  const figures = useRowFigures(text)
  return (
    <div className="grid [&_[data-wallet-accounts]]:w-auto [&_[data-wallet-accounts]]:max-w-65">
      <StakingWalletRow
        icon={<Gamepad2 size={15} />}
        name={text.game_account}
        selected={source === 'game'}
        on_select={() => pick('game')}
        figures={figures(account.state)}
      />
      <StakingWalletRow
        icon={<WalletCards size={15} />}
        name={text.external_wallet}
        selected={source === 'external'}
        on_select={connected ? () => pick('external') : undefined}
        figures={connected ? figures(external.state) : null}
        status={external_status(text, connected, same_account)}
        control={<WalletControl copy={text} wallet={wallet} locked={external.state.request?.kind === 'execute'} />}
      />
    </div>
  )
}

/**
 * The staking desk. Both wallets stay visible as two single lines, so they compare at a glance; the
 * selected line opens its stake and its form below. An external wallet that is not connected, or is
 * the game account itself, cannot be selected: its line says why and offers the wallet control.
 */
export const StakingDeskView = ({
  copy,
  account,
  external,
  account_balance,
  wallet,
}: Readonly<{
  copy: AppCopy
  account: Finance
  external: Finance
  wallet: WalletView
  account_balance: bigint | null
}>) => {
  const text = copy.kares_page
  const [picked, set_picked] = useState<Source>('game')
  const same_account = wallet.state.session?.address === account.state.address
  const connected = external.state.address !== null && !same_account
  const source: Source = picked === 'external' && connected ? 'external' : 'game'
  const desks = {
    game: { finance: account, balance: account_balance },
    external: { finance: external, balance: external.state.balances?.kares_balance ?? null },
  }
  const { finance, balance } = desks[source]
  return (
    <section className="grid w-full grid-cols-1 gap-5 p-5.5 text-text max-[760px]:p-4">
      <p className="max-w-[62ch] text-[13px]/normal text-soft">{text.staking_revenue}</p>
      <WalletRows
        text={text}
        account={account}
        external={external}
        wallet={wallet}
        source={source}
        connected={connected}
        same_account={same_account}
        pick={set_picked}
      />
      <StakingAccount key={source} copy={copy} state={finance.state} dispatch={finance.dispatch} balance={balance} />
      <p className="text-[11px]/normal text-faint">{text.daily_estimate_note}</p>
    </section>
  )
}

/** The staking desk of the signed-in account. Its finance reader follows the account's session. */
const StakingDesk = ({ copy, session }: Readonly<{ copy: AppCopy; session: FinanceSession | null }>) => {
  const account = useFinance(
    { network: env.network, rpc_url: env.sui_rpc_url, managed: true },
    session,
    copy.kares_page.confirmed
  )
  const wallet_state = useSiteStore((state) => state.external_wallet)
  const selected_sui = sui_session(wallet_state.session)
  const external_session = selected_sui?.address === session?.address ? null : selected_sui
  const external = useFinance(
    { network: env.network, rpc_url: env.sui_rpc_url },
    external_session,
    copy.kares_page.confirmed
  )
  const balance = useSiteStore((state) => state.session.kares_balance)
  useEffect(() => {
    if (account.state.digest) dispatch_app({ type: 'wallet/refresh' })
  }, [account.state.digest])
  return (
    <StakingDeskView
      copy={copy}
      account={account}
      external={external}
      wallet={external_wallet_view(wallet_state)}
      account_balance={balance}
    />
  )
}
export default StakingDesk
