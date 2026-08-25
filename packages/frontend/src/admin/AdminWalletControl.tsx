// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'

import { dispatch_app, useAppStore } from '../store.ts'

const short_address = (address: string): string => `${address.slice(0, 7)}…${address.slice(-5)}`

export const AdminWalletControl = ({ copy }: Readonly<{ copy: Readonly<Record<string, string>> }>) => {
  const wallet = useAppStore((state) => state.admin.wallet)
  const [show_wallets, set_show_wallets] = useState(false)
  const text = (key: string, fallback: string): string => copy[key] || fallback
  if (wallet.session)
    return (
      <div className="flex h-8 shrink-0 items-center gap-2.5 border border-white/10 bg-white/[0.025] px-3">
        <span className="h-1.5 w-1.5 bg-[#5ecf8d]/80 shadow-[0_0_7px_rgba(94,207,141,0.45)]" />
        <span className="font-mono text-[8px] text-[#a9bad0]" title={wallet.session.address}>
          {short_address(wallet.session.address)}
        </span>
        <button
          className="ml-2 cursor-pointer px-1 py-1 text-[7px] tracking-[0.1em] text-[#626873] uppercase transition hover:text-[#c9c4bb]"
          disabled={wallet.status === 'connecting'}
          onClick={() => dispatch_app({ type: 'admin/wallet_disconnect' })}
          type="button"
        >
          {text('disconnect_admin_wallet', 'Disconnect')}
        </button>
      </div>
    )
  return (
    <div className="flex shrink-0 items-center gap-1">
      {wallet.status === 'ready' && wallet.wallets.length > 0 && (
        <button
          className="h-9 cursor-pointer border border-[#c8963c]/35 bg-gradient-to-r from-[#c8963c]/12 to-[#4a9eff]/8 px-3 text-[8px] tracking-[0.13em] text-[#efc15a] uppercase hover:border-[#efbd45]/60 disabled:opacity-40"
          onClick={() => set_show_wallets(true)}
          type="button"
        >
          {text('connect_admin_wallet', 'Connect wallet')}
        </button>
      )}
      {wallet.status === 'connecting' && (
        <span className="text-[8px] text-[#686c76]">{text('connecting', 'Connecting…')}</span>
      )}
      {wallet.status === 'loading' && (
        <span className="text-[8px] text-[#686c76]">{text('loading_wallets', 'Loading wallets…')}</span>
      )}
      {wallet.status === 'ready' && wallet.wallets.length === 0 && (
        <span className="text-[8px] text-[#686c76]">{text('no_admin_wallet', 'No browser wallet')}</span>
      )}
      {(show_wallets || wallet.status === 'selecting') && (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-end bg-black/55 p-5 pt-16 backdrop-blur-[2px]"
          onClick={() => {
            if (wallet.status === 'selecting') dispatch_app({ type: 'admin/wallet_picker_cancel' })
            set_show_wallets(false)
          }}
          role="presentation"
        >
          <div
            aria-label="Admin wallet selection"
            className="w-full max-w-sm border border-[#c8963c]/35 bg-[#181c1f] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.58)]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="mb-4 flex items-center justify-between gap-4 border-b border-white/8 pb-3">
              <div>
                <p className="text-[9px] tracking-[0.16em] text-[#efc15a] uppercase">
                  {wallet.status === 'selecting'
                    ? text('choose_admin_address', 'Choose address')
                    : text('choose_admin_wallet', 'Choose wallet')}
                </p>
                {wallet.requested_wallet && (
                  <p className="mt-1 text-[7px] tracking-[0.1em] text-[#686c76] uppercase">{wallet.requested_wallet}</p>
                )}
              </div>
              <button
                className="cursor-pointer text-[8px] text-[#737985] uppercase hover:text-[#ff8caa]"
                onClick={() => {
                  if (wallet.status === 'selecting') dispatch_app({ type: 'admin/wallet_picker_cancel' })
                  set_show_wallets(false)
                }}
                type="button"
              >
                {text('cancel_wallet_selection', 'Cancel')}
              </button>
            </div>
            <div className="grid gap-2">
              {wallet.status === 'selecting'
                ? wallet.accounts.map((address) => (
                    <button
                      className="flex h-11 cursor-pointer items-center justify-between border border-white/10 px-3 text-left hover:border-[#4a9eff]/50 hover:bg-[#4a9eff]/7"
                      key={address}
                      onClick={() => dispatch_app({ type: 'admin/wallet_account_select', address })}
                      title={address}
                      type="button"
                    >
                      <span className="text-[7px] tracking-[0.1em] text-[#777d88] uppercase">
                        {text('wallet_account', 'Account')}
                      </span>
                      <span className="font-mono text-[9px] text-[#b9d8ff]">{short_address(address)}</span>
                    </button>
                  ))
                : wallet.wallets.map((wallet_name) => (
                    <button
                      className="flex h-11 cursor-pointer items-center justify-between border border-white/10 px-3 text-left hover:border-[#c8963c]/50 hover:bg-[#c8963c]/7"
                      key={wallet_name}
                      onClick={() => {
                        dispatch_app({ type: 'admin/wallet_connect', wallet_name })
                        set_show_wallets(false)
                      }}
                      type="button"
                    >
                      <span className="text-[9px] text-[#ded9d0]">{wallet_name}</span>
                      <span className="text-[7px] text-[#777d88] uppercase">{text('select_wallet', 'Select')}</span>
                    </button>
                  ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
