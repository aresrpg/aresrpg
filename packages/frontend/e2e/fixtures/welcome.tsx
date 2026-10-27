// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import { AddFundsModal } from '../../src/components/AddFundsModal.tsx'
import { initialize_app_store, dispatch_app, useAppStore } from '../../src/store.ts'
import { Welcome } from '../../src/components/Welcome.tsx'
import { WalletCard } from '../../src/components/WalletCard.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LocaleScope } from '../../src/i18n/LocaleScope.tsx'
import { initial_session_state } from '../../src/modules/session.ts'
import '../../src/tailwind.css'
import '../../src/components/app_layout.css'
import '@aresrpg/ui/styles.css'

const copy = await load_app_copy('en')
const network = new URLSearchParams(location.search).has('testnet') ? 'testnet' : 'mainnet'
initialize_app_store({ quality: 'medium', music_enabled: false, render_distance: null })
const Fixture = () => {
  const funding_cost = useAppStore((state) => state.navigation.funding_cost_mist)
  const [balance, set_balance] = useState<bigint | null>(null)
  const [created, set_created] = useState(false)
  const session = {
    ...initial_session_state(),
    wallet: { address: `0x${'11'.repeat(32)}` } as never,
    sui_balance_mist: balance,
    kares_balance: 0n,
  }
  return (
    <LocaleScope locale="en">
      <main className="app-ui fixed inset-0 bg-bg font-mono text-text">
        <button
          hidden
          data-fund
          onClick={() => {
            set_balance(1_050_000_000n)
            dispatch_app({
              type: 'wallet/refreshed',
              balance_mist: 1_050_000_000n,
              kares_balance: null,
              gas_spent_mist: 0n,
            })
          }}
        >
          Fund
        </button>
        <button
          hidden
          data-empty
          onClick={() => {
            set_balance(0n)
            dispatch_app({ type: 'wallet/refreshed', balance_mist: 0n, kares_balance: null, gas_spent_mist: 0n })
          }}
        >
          Empty
        </button>
        {new URLSearchParams(location.search).has('popover') ? (
          <WalletCard copy={copy} session={session} disconnect={() => {}} />
        ) : created ? (
          <p>Character creation opened</p>
        ) : (
          <Welcome copy={copy} session={session} network={network} create={() => set_created(true)} />
        )}
        {funding_cost !== null && (
          <AddFundsModal
            address={`0x${'11'.repeat(32)}`}
            copy={copy}
            network={network}
            cost_mist={funding_cost}
            on_close={() => dispatch_app({ type: 'funding/close' })}
          />
        )}
      </main>
    </LocaleScope>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
