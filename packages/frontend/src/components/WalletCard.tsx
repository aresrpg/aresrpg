// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Check, Copy, LogOut, Plus, Send, Wallet } from 'lucide-react'
import { Button, IconButton, WalletBalances } from '@aresrpg/ui'
import { useCallback, useId, useRef, useState, type ReactNode } from 'react'
import { display_suins_name } from '@aresrpg/immutable'

import { useNumbers } from '../i18n/useNumbers.ts'
import type { AppCopy } from '../i18n/copy.ts'
import type { SessionState } from '../modules/session.ts'
import { dispatch_app, useAppStore } from '../store.ts'

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
}: Readonly<{
  copy: AppCopy
  disconnect: () => void
  session: SessionState
  embedded?: boolean
}>) => {
  const localized_numbers = useNumbers()
  const default_name = useAppStore((state) => state.suins.snapshot?.default_name ?? null)
  const [send_open, set_send_open] = useState(false)
  const { wallet } = session
  const resolve_character = useCallback(
    (name: string): Promise<Readonly<{ address: string; name: string }>> =>
      new Promise((resolve, reject) => dispatch_app({ type: 'wallet/resolve_character', name, resolve, reject })),
    []
  )

  return (
    <>
      <WalletMenu
        copy={copy}
        label={copy.account}
        address={wallet?.address ?? null}
        name={default_name}
        sui_balance_mist={session.sui_balance_mist}
        kares_balance={session.kares_balance}
        embedded={embedded}
        send={wallet ? () => set_send_open(true) : null}
        funds={wallet ? () => dispatch_app({ type: 'dialog/open', dialog: 'top_up' }) : null}
      >
        <div className="wallet-popover__gas">
          <span>{copy.wallet_gas_spent}</span>
          <strong>{localized_numbers.sui(session.gas_spent_mist, 4)} SUI</strong>
        </div>
        {wallet ? (
          <Button onClick={disconnect}>
            <LogOut size={16} />
            {copy.wallet_disconnect}
          </Button>
        ) : (
          <a className="aui-button aui-button--primary" href="/">
            {copy.sign_in}
          </a>
        )}
      </WalletMenu>

      {wallet && (
        <>
          {send_open && (
            <SendSuiModal
              balance_mist={session.sui_balance_mist}
              close={() => set_send_open(false)}
              copy={copy}
              on_sent={() => dispatch_app({ type: 'wallet/refresh' })}
              open_funds={() => dispatch_app({ type: 'dialog/open', dialog: 'top_up' })}
              resolve_character={resolve_character}
              wallet={wallet}
            />
          )}
        </>
      )}
    </>
  )
}

/** Shared wallet menu; callers provide the authorized sender and funding destination. */
export const WalletMenu = ({
  copy,
  label,
  address,
  name = null,
  sui_balance_mist,
  kares_balance,
  icon,
  embedded = false,
  send,
  funds,
  children,
}: Readonly<{
  copy: AppCopy
  label: string
  address: string | null
  name?: string | null
  sui_balance_mist: bigint | null
  kares_balance?: bigint | null
  icon?: ReactNode
  embedded?: boolean
  send: (() => void) | null
  funds: (() => void) | null
  children?: ReactNode
}>) => {
  const numbers = useNumbers()
  const menu_id = useId()
  const menu = useRef<HTMLElement>(null)
  const [copied, set_copied] = useState(false)
  const open = (action: (() => void) | null) => {
    if (!embedded) menu.current?.hidePopover()
    action?.()
  }
  const copy_address = () => {
    if (!address) return
    void navigator.clipboard.writeText(address).then(() => {
      set_copied(true)
      setTimeout(() => set_copied(false), 2_000)
    })
  }
  const panel_attributes = embedded
    ? { className: 'wallet-panel' }
    : { className: 'aui-panel wallet-panel wallet-popover', popover: 'auto' as const, role: 'dialog' }
  const balances = [
    { label: 'SUI', value: balance_label(sui_balance_mist, numbers.sui), icon: <SuiLogo size={24} /> },
    ...(kares_balance === undefined
      ? []
      : [{ label: 'KARES', value: balance_label(kares_balance, numbers.amount), icon: <KaresLogo size={24} /> }]),
  ]
  return (
    <>
      {!embedded && (
        <WalletBalanceBox
          label={label}
          sui_balance_mist={sui_balance_mist}
          kares_balance={kares_balance}
          popover_target={menu_id}
          icon={icon}
        />
      )}
      <section {...panel_attributes} id={menu_id} ref={menu} aria-label={label} data-wallet-card="">
        <header className="wallet-popover__identity">
          {icon ?? <Wallet size={20} aria-hidden="true" />}
          <strong>{wallet_identity(address, name, copy.sign_in_to_play)}</strong>
          <IconButton
            label={copy.wallet_copy_address}
            disabled={!address}
            onClick={copy_address}
            icon={copied ? <Check size={16} /> : <Copy size={16} />}
          />
        </header>
        <WalletBalances balances={balances} />
        <div className="wallet-popover__actions" data-wallet-actions="">
          <Button disabled={!send} onClick={() => open(send)}>
            <Send size={16} />
            {copy.wallet_send}
          </Button>
          <Button tone="primary" disabled={!funds} onClick={() => open(funds)}>
            <Plus size={16} />
            {copy.wallet_add_funds}
          </Button>
        </div>
        {children}
      </section>
    </>
  )
}

/** One compact balance presentation for both wallets. */
export const WalletBalanceBox = ({
  label,
  sui_balance_mist,
  kares_balance,
  popover_target,
  icon,
}: Readonly<{
  label: string
  sui_balance_mist: bigint | null
  kares_balance?: bigint | null
  popover_target?: string
  icon?: ReactNode
}>) => {
  const numbers = useNumbers()
  const sui = balance_label(sui_balance_mist, numbers.sui)
  const kares = balance_label(kares_balance ?? null, numbers.amount)
  const Container = popover_target ? 'button' : 'div'
  const controls = popover_target
    ? { popoverTarget: popover_target, type: 'button' as const, 'aria-haspopup': 'dialog' as const }
    : {}
  return (
    <Container
      {...controls}
      className="wallet-trigger"
      data-wallet-trigger=""
      aria-label={label}
      aria-description={`${sui} SUI${kares_balance === undefined ? '' : ` · ${kares} KARES`}`}
      title={label}
    >
      {icon}
      <span className="wallet-trigger__balance" title={`${sui} SUI`}>
        <SuiLogo size={16} />
        <span>{sui}</span>
      </span>
      {kares_balance !== undefined && (
        <span className="wallet-trigger__balance wallet-trigger__balance--kares" title={`${kares} KARES`}>
          <KaresLogo size={16} />
          <span>{kares}</span>
        </span>
      )}
    </Container>
  )
}
