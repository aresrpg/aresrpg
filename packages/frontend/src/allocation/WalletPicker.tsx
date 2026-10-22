// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useId, useRef } from 'react'
import { ArrowRight, ShieldCheck, WalletCards, X } from 'lucide-react'

import type { CopyText } from '../i18n/copy.ts'

import { short_address } from './view.ts'

export const WalletPicker = ({
  open,
  close,
  text,
  busy,
  wallets,
  accounts,
  choose,
  select,
  google,
  google_label,
  error,
}: Readonly<{
  open: boolean
  close: () => void
  text: CopyText
  busy: boolean
  wallets: readonly string[]
  accounts: readonly Readonly<{ wallet_name: string; address: string }>[]
  choose: (name: string) => void
  select: (account: Readonly<{ wallet_name: string; address: string }>) => void
  google: () => void
  google_label: string
  error: boolean
}>) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const title_id = useId()
  useEffect(() => {
    if (open) dialog.current?.showModal()
    else dialog.current?.close()
  }, [open])
  return (
    <dialog
      className="wallet-picker allocation-signin-picker"
      ref={dialog}
      aria-labelledby={title_id}
      onCancel={close}
      onClose={close}
    >
      <header>
        <span className="signin-picker-mark" aria-hidden="true">
          <WalletCards size={24} />
        </span>
        <h2 id={title_id}>{text('add_wallet')}</h2>
        <button type="button" className="btn-icon" aria-label={text('close')} onClick={close}>
          <X size={18} />
        </button>
      </header>
      <div className="choices">
        <button className="signin-wallet-choice" type="button" disabled={busy} onClick={google}>
          <span className="signin-wallet-icon" aria-hidden="true">
            G
          </span>
          <span>{google_label}</span>
          <ArrowRight size={20} aria-hidden="true" />
        </button>
        {wallets.map((name) => (
          <button
            className="signin-wallet-choice"
            type="button"
            key={name}
            disabled={busy}
            onClick={() => choose(name)}
          >
            <span className="signin-wallet-icon" aria-hidden="true">
              <WalletCards size={22} />
            </span>
            <span>{name}</span>
            <ArrowRight size={20} aria-hidden="true" />
          </button>
        ))}
        {accounts.map((account) => (
          <button
            className="btn"
            key={`${account.wallet_name}:${account.address}`}
            disabled={busy}
            onClick={() => select(account)}
          >
            {account.wallet_name} · {short_address(account.address)}
          </button>
        ))}
        {!wallets.length && <p className="signin-wallet-empty">{text('no_wallet_app')}</p>}
      </div>
      {error && (
        <p role="alert" className="error">
          {text('wallet_failed')}
        </p>
      )}
      <footer>
        <ShieldCheck size={18} aria-hidden="true" />
        <p>{text('signature_note')}</p>
      </footer>
    </dialog>
  )
}
