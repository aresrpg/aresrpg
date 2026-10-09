// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Check, Copy, LogOut, Plus, Send, Wallet } from 'lucide-react'
import { Button, IconButton, WalletBalances } from '@aresrpg/ui'
import { useCallback, useId, useRef, useState } from 'react'
import { display_suins_name } from '@aresrpg/immutable'

import { useNumbers } from '../i18n/useNumbers.ts'
import type { AppCopy } from '../i18n/copy.ts'
import type { SessionState } from '../modules/session.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import type { Network } from '../env.ts'

import { AddFundsModal } from './AddFundsModal.tsx'
import { SendSuiModal } from './SendSuiModal.tsx'
import { SuiLogo } from './SuiLogo.tsx'
import { KaresLogo } from './KaresLogo.tsx'

const wallet_identity = (address: string | null, name: string | null, fallback: string): string => {
  if (name) return display_suins_name(name)
  return address ? `${address.slice(0, 8)}…${address.slice(-5)}` : fallback
}
const balance_label = (value: bigint | null, format: (value: bigint) => string): string =>
  value === null ? '—' : format(value)

export const WalletCard = ({
  copy,
  disconnect,
  session,
  embedded = false,
  network,
}: Readonly<{
  copy: AppCopy
  disconnect: () => void
  session: SessionState
  embedded?: boolean
  network?: Network
}>) => {
  const localized_numbers = useNumbers()
  const default_name = useAppStore((state) => state.suins.snapshot?.default_name ?? null)
  const menu_id = useId()
  const menu = useRef<HTMLElement>(null)
  const [copied, set_copied] = useState(false)
  const [modal, set_modal] = useState<'funds' | 'send' | null>(null)
  const { wallet } = session
  const resolve_character = useCallback(
    (name: string): Promise<Readonly<{ address: string; name: string }>> =>
      new Promise((resolve, reject) => dispatch_app({ type: 'wallet/resolve_character', name, resolve, reject })),
    []
  )
  const address = wallet?.address ?? null
  const panel_attributes = embedded
    ? { className: 'wallet-panel' }
    : { className: 'aui-panel wallet-panel wallet-popover', popover: 'auto' as const, role: 'dialog' }
  const sui_balance = balance_label(session.sui_balance_mist, localized_numbers.sui)
  const kares_balance = balance_label(session.kares_balance, localized_numbers.amount)
  const close_menu = (): void => {
    if (!embedded) menu.current?.hidePopover()
  }
  const open_modal = (next: 'funds' | 'send'): void => {
    close_menu()
    set_modal(next)
  }

  const copy_address = (): void => {
    if (!address) return
    void navigator.clipboard.writeText(address).then(() => {
      set_copied(true)
      setTimeout(() => set_copied(false), 2_000)
    })
  }

  return (
    <>
      {!embedded && (
        <button
          aria-label={copy.account}
          aria-description={`${sui_balance} SUI · ${kares_balance} KARES`}
          aria-haspopup="dialog"
          className="wallet-trigger"
          data-wallet-trigger=""
          popoverTarget={menu_id}
          type="button"
        >
          <span className="wallet-trigger__balance" title={`${sui_balance} SUI`}>
            <SuiLogo size={16} />
            <span>{sui_balance}</span>
          </span>
          <span className="wallet-trigger__balance wallet-trigger__balance--kares" title={`${kares_balance} KARES`}>
            <KaresLogo size={16} />
            <span>{kares_balance}</span>
          </span>
        </button>
      )}
      <section {...panel_attributes} id={menu_id} ref={menu} aria-label={copy.account} data-wallet-card="">
        <header className="wallet-popover__identity">
          <Wallet size={20} aria-hidden="true" />
          <strong>{wallet_identity(address, default_name, copy.sign_in_to_play)}</strong>
          <IconButton
            label={copy.wallet_copy_address}
            disabled={!address}
            onClick={copy_address}
            icon={copied ? <Check size={16} /> : <Copy size={16} />}
          />
        </header>
        <WalletBalances
          balances={[
            { label: 'SUI', value: sui_balance, icon: <SuiLogo size={24} /> },
            { label: 'KARES', value: kares_balance, icon: <KaresLogo size={24} /> },
          ]}
        />
        <div className="wallet-popover__actions" data-wallet-actions="">
          <Button disabled={!wallet} onClick={() => open_modal('send')}>
            <Send size={16} />
            {copy.wallet_send}
          </Button>
          <Button tone="primary" disabled={!wallet} onClick={() => open_modal('funds')}>
            <Plus size={16} />
            {copy.wallet_add_funds}
          </Button>
        </div>
        <div className="wallet-popover__gas">
          <span>{copy.wallet_gas_spent}</span>
          <strong>{localized_numbers.sui(session.gas_spent_mist, 4)} SUI</strong>
        </div>
        {wallet ? (
          <Button
            onClick={() => {
              close_menu()
              disconnect()
            }}
          >
            <LogOut size={16} />
            {copy.wallet_disconnect}
          </Button>
        ) : (
          <a className="aui-button aui-button--primary" href="/">
            {copy.sign_in}
          </a>
        )}
      </section>

      {wallet && (
        <>
          {modal === 'funds' && (
            <AddFundsModal address={wallet.address} copy={copy} network={network} on_close={() => set_modal(null)} />
          )}
          {modal === 'send' && (
            <SendSuiModal
              balance_mist={session.sui_balance_mist}
              close={() => set_modal(null)}
              copy={copy}
              on_sent={() => dispatch_app({ type: 'wallet/refresh' })}
              open_funds={() => set_modal('funds')}
              resolve_character={resolve_character}
              wallet={wallet}
            />
          )}
        </>
      )}
    </>
  )
}
