// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { createRoot } from 'react-dom/client'

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
const Fixture = () => {
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
        <button hidden data-fund onClick={() => set_balance(1_050_000_000n)}>
          Fund
        </button>
        <button hidden data-empty onClick={() => set_balance(0n)}>
          Empty
        </button>
        {new URLSearchParams(location.search).has('popover') ? (
          <WalletCard copy={copy} session={session} network={network} disconnect={() => {}} />
        ) : created ? (
          <p>Character creation opened</p>
        ) : (
          <Welcome copy={copy} session={session} network={network} create={() => set_created(true)} />
        )}
      </main>
    </LocaleScope>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
