// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'

import { WalletChoices, WalletConnectButton, WalletPickerModal } from '../components/WalletPickerModal.tsx'
import type { KaresCopy } from '../kares/copy.ts'

import type { WalletView } from './model.ts'

const OPEN_WALLET_PICKER = 'external-wallet/open-picker'
export const open_wallet_dialog = (): void => {
  globalThis.dispatchEvent(new Event(OPEN_WALLET_PICKER))
}

export const WalletControl = ({
  wallet,
  copy,
  subtitle,
}: Readonly<{ wallet: WalletView; copy: KaresCopy; subtitle?: string }>) => {
  const [open, set_open] = useState(false)
  const { state, dispatch } = wallet
  useEffect(() => {
    if (state.session) set_open(false)
  }, [state.session])
  useEffect(() => {
    const show = (): void => set_open(true)
    globalThis.addEventListener(OPEN_WALLET_PICKER, show)
    return () => globalThis.removeEventListener(OPEN_WALLET_PICKER, show)
  }, [])
  const busy = state.request !== null
  return (
    <div data-wallet-menu="">
      <WalletConnectButton
        label={state.session ? `${state.session.address.slice(0, 6)}…${state.session.address.slice(-4)}` : copy.connect}
        open={() => set_open(true)}
      />
      {open && (
        <WalletPickerModal
          title={state.session ? copy.account_label : copy.external_wallet}
          subtitle={subtitle}
          close_label={copy.close}
          close={() => {
            set_open(false)
            dispatch({ type: 'external_wallet/cancel' })
          }}
        >
          {state.session ? (
            <button
              type="button"
              className="border border-cyan/35 bg-cyan/7 px-4 py-3 text-[10px] text-cyan"
              onClick={() => dispatch({ type: 'external_wallet/disconnect' })}
            >
              {copy.disconnect}
            </button>
          ) : (
            <WalletChoices
              choices={state.accounts.length ? state.accounts : state.wallets.map(({ name }) => name)}
              busy={busy}
              select={(choice) =>
                dispatch(
                  state.accounts.length
                    ? { type: 'external_wallet/select', address: choice }
                    : { type: 'external_wallet/authorize', wallet_name: choice }
                )
              }
              empty_label={state.loaded ? copy.no_wallet : copy.loading}
              select_label={copy.select_wallet}
            />
          )}
          {state.error && (
            <p className="text-[10px] text-rose-300" role="alert">
              {state.error}
            </p>
          )}
        </WalletPickerModal>
      )}
    </div>
  )
}
