// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef, useState } from 'react'
import { MAX_ALLOCATION_WALLETS } from '@aresrpg/immutable/allocation'

import type { AuthSession } from '../auth.ts'
import type { CopyText } from '../i18n/copy.ts'
import type { WalletView } from '../wallet/model.ts'

import type { AllocationRuntime, AllocationState } from './runtime.ts'
import { short_address, wallet_label } from './view.ts'

export const Wallets = ({
  state,
  runtime,
  external,
  text,
}: Readonly<{ state: AllocationState; runtime: AllocationRuntime; external: WalletView; text: CopyText }>) => {
  const [open, set_open] = useState(false)
  const initial_selection = useRef<AuthSession | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const busy = !!state.task || !!external.state.request
  const count = state.status?.wallets.length ?? 0
  const selected = external.state.session as AuthSession | null
  useEffect(() => {
    if (open) dialog.current?.showModal()
    else dialog.current?.close()
  }, [open])
  useEffect(() => {
    if (!selected || selected === initial_selection.current || state.task || !open) return
    set_open(false)
    runtime.dispatch({ type: 'request', task: { kind: 'verify', wallet: selected } })
  }, [selected, runtime, open, state.task])
  const choose = (wallet_name: string) => {
    external.dispatch({ type: 'external_wallet/authorize', wallet_name })
  }
  return (
    <section className={`step ${count ? 'is-done' : ''}`}>
      <div className="step-head">
        <span className="step-num">{count ? '✓' : '1'}</span>
        <div>
          <h2>{text('link_wallets')}</h2>
          <p>{text('wallet_rule')}</p>
        </div>
      </div>
      <div className="wallets">
        {state.status?.wallets.map((wallet) => (
          <div className="wrow" key={wallet.address} data-allocation-wallet={wallet.address}>
            <span className="mark">{wallet_label(wallet, state.session).slice(0, 1) || 'W'}</span>
            <div className="who">
              <b>{wallet_label(wallet, state.session) || text('wallet')}</b>
              <span>
                {text('verified')} · {short_address(wallet.address)}
              </span>
            </div>
            {wallet.address !== state.session?.address && (
              <button
                className="btn-icon"
                disabled={busy}
                aria-label={text('remove_wallet', { wallet: wallet.label })}
                onClick={() => runtime.dispatch({ type: 'request', task: { kind: 'remove', address: wallet.address } })}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="link-buttons">
        <button
          className="btn btn-ink"
          disabled={busy || count >= MAX_ALLOCATION_WALLETS}
          onClick={() => {
            // eslint-disable-next-line functional/immutable-data -- This owned DOM ref distinguishes a new signing session from the one present when the picker opened.
            initial_selection.current = selected
            external.dispatch({ type: 'external_wallet/cancel' })
            set_open(true)
          }}
        >
          {text('add_wallet')}
        </button>
      </div>
      <p className="xp-fine">{text('wallet_count', { count, max: MAX_ALLOCATION_WALLETS })}</p>
      <dialog className="wallet-picker" ref={dialog} onCancel={() => set_open(false)} onClose={() => set_open(false)}>
        <header>
          <h2>{text('add_wallet')}</h2>
          <button className="btn-icon" aria-label={text('close')} onClick={() => set_open(false)}>
            ×
          </button>
        </header>
        <p>{text('signature_note')}</p>
        <div className="choices">
          {external.state.wallets.map(({ name }) => (
            <button className="btn btn-ink" key={name} disabled={busy} onClick={() => choose(name)}>
              {name}
            </button>
          ))}
          {external.state.accounts.map((account) => (
            <button
              className="btn"
              key={`${account.wallet_name}:${account.address}`}
              disabled={busy}
              onClick={() => external.dispatch({ type: 'external_wallet/select', ...account })}
            >
              {account.wallet_name} · {short_address(account.address)}
            </button>
          ))}
          {!external.state.wallets.length && <p>{text('no_wallet_app')}</p>}
        </div>
        {external.state.error && (
          <p role="alert" className="error">
            {text('wallet_failed')}
          </p>
        )}
      </dialog>
    </section>
  )
}
