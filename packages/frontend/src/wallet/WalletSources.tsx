// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'

import { WalletRow, WalletRowButton } from '../components/WalletPickerModal.tsx'
import { truncate_address } from '../components/SuiTransferResult.tsx'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { error_text } from '../i18n/error_text.ts'

import type { WalletSession, WalletView } from './model.ts'
import { WALLET_NETWORK } from './WalletControl.tsx'

const SourceList = ({
  wallet,
  copy,
  busy,
  keep,
}: Readonly<{ wallet: WalletView; copy: AppCopy; busy: boolean; keep: () => void }>) => {
  const { state, dispatch } = wallet
  const authorized = new Set(state.accounts.map(({ wallet_name }) => wallet_name))
  const providers = state.wallets.filter((provider) => !provider.family && !authorized.has(provider.name))
  const requested = state.request?.kind === 'authorize' ? state.request.wallet.name : null
  const select = (wallet_name: string, address: string): void =>
    state.session?.wallet_name === wallet_name && state.session.address === address
      ? keep()
      : dispatch({ type: 'external_wallet/select', wallet_name, address })
  return (
    <div className="flex flex-col gap-2.5">
      {state.accounts.map(({ wallet_name, address }) => (
        <WalletRowButton
          key={`${wallet_name}:${address}`}
          name={wallet_name}
          detail={truncate_address(address)}
          identity={`${wallet_name} ${address}`}
          label={copy.kares_page.select_wallet}
          disabled={busy}
          onClick={() => select(wallet_name, address)}
          remove={{
            label: `${copy.kares_page.disconnect} ${wallet_name}`,
            run: () => dispatch({ type: 'external_wallet/forget', wallet_name, address }),
          }}
        />
      ))}
      {providers.map((provider) => (
        <WalletRowButton
          key={provider.name}
          name={provider.name}
          detail={WALLET_NETWORK.sui}
          label={copy.kares_page.connect}
          busy={requested === provider.name}
          disabled={busy}
          onClick={() => dispatch({ type: 'external_wallet/authorize', wallet_name: provider.name })}
        />
      ))}
      {wallet.connect_other && (
        <WalletRowButton
          name="Privy"
          detail={`${WALLET_NETWORK.evm} · ${WALLET_NETWORK.solana}`}
          label={copy.kares_page.connect}
          disabled={busy}
          onClick={wallet.connect_other}
        />
      )}
    </div>
  )
}

/** Funding sources: the chosen wallet collapses to one row; changing it reopens every provider and account. */
export const WalletSources = ({
  wallet,
  copy,
  locked,
}: Readonly<{ wallet: WalletView; copy: AppCopy; locked: boolean }>) => {
  const { state } = wallet
  const [changing, set_changing] = useState<WalletSession | null>(null)
  const busy = locked || !!wallet.busy
  const text = copy_text(copy.wallet_legacy)
  const { session } = state
  return (
    <section className="flex flex-col gap-2" data-wallet-sources="">
      <span className="text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">{text('funding_source')}</span>
      {session && changing !== session ? (
        <WalletRow name={session.wallet_name} detail={truncate_address(session.address)} selected>
          <button className="aui-wallet-row-action" type="button" disabled={busy} onClick={() => set_changing(session)}>
            {text('funding_change')}
          </button>
        </WalletRow>
      ) : (
        <SourceList wallet={wallet} copy={copy} busy={busy} keep={() => set_changing(null)} />
      )}
      {state.error && (
        <p className="text-xs text-rose-300" role="alert">
          {state.error.startsWith('funding_') ? text(state.error) : error_text(copy.kares_page, state.error)}
        </p>
      )}
    </section>
  )
}
