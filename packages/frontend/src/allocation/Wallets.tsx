// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef, useState } from 'react'
import { MAX_ALLOCATION_WALLETS } from '@aresrpg/immutable/allocation'

import type { AuthSession } from '../auth.ts'
import type { CopyText } from '../i18n/copy.ts'
import type { WalletView } from '../wallet/model.ts'

import type { AllocationRuntime, AllocationState } from './runtime.ts'
import { WalletPicker } from './WalletPicker.tsx'
import { short_address, wallet_label, type CardView } from './view.ts'

export const Wallets = ({
  state,
  cards,
  runtime,
  external,
  text,
  google_label,
}: Readonly<{
  state: AllocationState
  cards: readonly CardView[]
  runtime: AllocationRuntime
  external: WalletView
  text: CopyText
  google_label: string
}>) => {
  const [open, set_open] = useState(false)
  const initial_selection = useRef<AuthSession | null>(null)
  const busy = !!state.task || !!external.state.request
  const count = state.status?.wallets.length ?? 0
  const selected = external.state.session as AuthSession | null
  useEffect(() => {
    if (!selected || selected === initial_selection.current || state.task || !open) return
    set_open(false)
    runtime.dispatch({ type: 'request', task: { kind: 'verify', wallet: selected } })
  }, [selected, runtime, open, state.task])
  const choose = (wallet_name: string) => {
    if (state.session) external.dispatch({ type: 'external_wallet/authorize', wallet_name })
    else {
      set_open(false)
      runtime.dispatch({ type: 'request', task: { kind: 'wallet', name: wallet_name } })
    }
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
        {state.status?.wallets.map((wallet) => {
          const card = cards.find((card) => card.wallet.address === wallet.address)
          const allocation = card ? (card.award?.tier ?? 'pending') : 'none'
          return (
            <div
              className="wrow"
              data-allocation={allocation}
              key={wallet.address}
              data-allocation-wallet={wallet.address}
            >
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
                  onClick={() =>
                    runtime.dispatch({ type: 'request', task: { kind: 'remove', address: wallet.address } })
                  }
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="link-buttons">
        <button
          className="btn btn-ink"
          aria-haspopup="dialog"
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
      <WalletPicker
        open={open}
        close={() => set_open(false)}
        text={text}
        busy={busy}
        wallets={external.state.wallets.map(({ name }) => name)}
        accounts={external.state.accounts}
        choose={choose}
        select={(account) => external.dispatch({ type: 'external_wallet/select', ...account })}
        google_label={google_label}
        error={!!external.state.error}
        google={() => {
          set_open(false)
          runtime.dispatch({ type: 'request', task: { kind: state.session ? 'link_google' : 'google' } })
        }}
      />
    </section>
  )
}
