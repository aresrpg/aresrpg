// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'
import { ChevronDown, WalletCards } from 'lucide-react'

import {
  WalletChoices,
  WalletConnectButton,
  WalletPickerModal,
  WalletRowButton,
} from '../components/WalletPickerModal.tsx'
import { error_text } from '../i18n/error_text.ts'
import type { KaresCopy } from '../kares/copy.ts'

import type { WalletSelection, WalletView } from './model.ts'

/** Network names are proper nouns, identical in every locale. */
export const WALLET_NETWORK = { sui: 'Sui', evm: 'EVM', solana: 'Solana' } as const

const account_key = ({ wallet_name, address }: WalletSelection): string => `${wallet_name}:${address}`

const WalletAccountSelect = ({
  wallet,
  copy,
  busy,
  connect,
}: Readonly<{
  wallet: WalletView
  copy: KaresCopy
  busy: boolean
  connect?: () => void
}>) => {
  const { state, dispatch } = wallet
  const providers = [...new Set(state.accounts.map(({ wallet_name }) => wallet_name))].toSorted()
  const select = (value: string): void => {
    if (value === 'connect') return connect?.()
    if (value === 'disconnect') return dispatch({ type: 'external_wallet/disconnect' })
    const account = state.accounts.find((entry) => account_key(entry) === value)
    if (account) dispatch({ type: 'external_wallet/select', ...account })
  }
  return (
    <div className="relative w-full max-w-sm min-w-0 text-cyan" data-wallet-accounts="">
      <WalletCards className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" size={15} />
      <select
        aria-label={copy.select_wallet}
        className="h-12 w-full cursor-pointer appearance-none rounded-sm border border-cyan/40 bg-surface pl-10 pr-10 font-mono text-[10px] font-semibold tracking-[0.08em] text-cyan shadow-[0_0_22px_rgba(72,207,207,0.06)] outline-none transition-colors hover:border-cyan/70 focus-visible:border-cyan focus-visible:ring-1 focus-visible:ring-cyan/40 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy}
        onChange={(event) => select(event.target.value)}
        value={state.session ? account_key(state.session) : ''}
      >
        <option disabled value="">
          {copy.select_wallet}
        </option>
        {providers.map((provider) => (
          <optgroup key={provider} label={provider}>
            {state.accounts
              .filter(({ wallet_name }) => wallet_name === provider)
              .toSorted((a, b) => a.address.localeCompare(b.address))
              .map((account) => (
                <option key={account_key(account)} value={account_key(account)}>
                  {provider} · {account.address.slice(0, 8)}…{account.address.slice(-6)}
                </option>
              ))}
          </optgroup>
        ))}
        {connect && <option value="connect">＋ {copy.connect}</option>}
        {state.session && <option value="disconnect">{copy.disconnect}</option>}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2" size={14} />
    </div>
  )
}

const WalletConnectionOptions = ({
  wallet,
  copy,
  busy,
  close,
}: Readonly<{ wallet: WalletView; copy: KaresCopy; busy: boolean; close: () => void }>) => (
  <>
    <WalletChoices
      choices={wallet.state.wallets.map(({ name, family }) => ({ name, detail: WALLET_NETWORK[family ?? 'sui'] }))}
      busy={busy}
      select={(wallet_name) => wallet.dispatch({ type: 'external_wallet/authorize', wallet_name })}
      empty_label={wallet.state.loaded ? copy.no_wallet : copy.loading}
      select_label={copy.connect}
    />
    {wallet.connect_other && (
      <WalletRowButton
        name={copy.other_networks}
        label={copy.connect}
        disabled={busy}
        onClick={() => {
          close()
          wallet.connect_other!()
        }}
      />
    )}
  </>
)

export const WalletControl = ({
  wallet,
  copy,
  subtitle,
  locked = false,
  require_sui = true,
}: Readonly<{ wallet: WalletView; copy: KaresCopy; subtitle?: string; locked?: boolean; require_sui?: boolean }>) => {
  const [open, set_open] = useState(false)
  const { state, dispatch } = wallet
  useEffect(() => {
    if (state.accounts.length) set_open(false)
  }, [state.accounts])
  const busy = locked || (wallet.busy ?? state.request !== null)
  const error = state.error && (
    <p className="text-[10px] text-rose-300" role="alert">
      {error_text(copy, state.error)}
    </p>
  )
  return (
    <div className="flex min-w-0 flex-col gap-2" data-wallet-menu="">
      {require_sui && state.session?.family && <p className="text-xs text-muted">{copy.sui_wallet_required}</p>}
      {state.accounts.length ? (
        <WalletAccountSelect wallet={wallet} copy={copy} busy={busy} connect={() => set_open(true)} />
      ) : (
        <WalletConnectButton disabled={busy} label={copy.connect} open={() => set_open(true)} />
      )}
      {open ? (
        <WalletPickerModal
          title={copy.external_wallet}
          subtitle={subtitle}
          close_label={copy.close}
          close={() => {
            set_open(false)
            dispatch({ type: 'external_wallet/cancel' })
          }}
        >
          <WalletConnectionOptions wallet={wallet} copy={copy} busy={busy} close={() => set_open(false)} />
          {error}
        </WalletPickerModal>
      ) : (
        error
      )}
    </div>
  )
}
