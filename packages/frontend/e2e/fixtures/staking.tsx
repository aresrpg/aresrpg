// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useReducer } from 'react'
import { createRoot } from 'react-dom/client'

import { Sidebar } from '../../src/components/Sidebar.tsx'
import { load_app_copy, type AppCopy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import { KaresPageView } from '../../src/kares/KaresPage.tsx'
import { initial_finance, type FinanceInput, type FinanceState } from '../../src/kares/model.ts'
import { initial_wallet_state, type WalletUiInput, type WalletState } from '../../src/wallet/model.ts'
import { finance_state } from '../../test/kares/fixture.ts'

import '../../src/tailwind.css'

// Presentation-only fixture: no runtime, signer, RPC reader or transaction executor is started.
const account = finance_state()
const external = {
  ...finance_state(),
  address: '0xexternal',
  snapshot: { ...account.snapshot!, address: '0xexternal' },
  balances: { kares_balance: 12_000_000_000n, sui_balance: 0n },
}
const wallet = {
  name: 'Test wallet',
  authorize: async () => [],
  connect: async () => {
    throw new Error('Fixture must not connect a real wallet')
  },
  disconnect: async () => undefined,
}
type ProbeInput =
  Readonly<{ owner: 'account' | 'external'; input: FinanceInput }> | Readonly<{ owner: 'wallet'; input: WalletUiInput }>
type ProbeState = Readonly<{ external: FinanceState; wallet: WalletState; inputs: readonly ProbeInput[] }>
const reduce_probe = (state: ProbeState, event: ProbeInput): ProbeState => {
  if (event.owner === 'wallet') {
    if (event.input.type === 'external_wallet/authorize')
      return {
        ...state,
        external,
        wallet: {
          ...state.wallet,
          session: { address: '0xexternal', wallet_name: wallet.name, disconnect: wallet.disconnect },
        },
      }
    if (event.input.type === 'external_wallet/disconnect')
      return { ...state, external: initial_finance(), wallet: { ...state.wallet, session: null } }
  }
  return { ...state, inputs: [...state.inputs, event] }
}
const StakingProbe = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [state, dispatch] = useReducer(reduce_probe, {
    external: initial_finance(),
    wallet: { ...initial_wallet_state(), wallets: [wallet], loaded: true },
    inputs: [],
  })
  return (
    <main className="flex h-dvh gap-3 overflow-hidden bg-bg p-3 font-mono text-text">
      <div className="shrink-0">
        <Sidebar
          address={account.snapshot!.address!}
          copy={copy}
          network="testnet"
          open_page={() => undefined}
          page="kares"
        />
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto" data-page-slot="">
        <KaresPageView
          wallet={{ state: state.wallet, dispatch: (input) => dispatch({ owner: 'wallet', input }) }}
          account_balance={7_000_000_000n}
          copy={copy}
          account={{ state: account, dispatch: (input) => dispatch({ owner: 'account', input }) }}
          external={{ state: state.external, dispatch: (input) => dispatch({ owner: 'external', input }) }}
        />
      </div>
      <output className="hidden" data-staking-inputs="">
        {JSON.stringify(state.inputs, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))}
      </output>
    </main>
  )
}
const locale = new URLSearchParams(location.search).get('locale')
void load_app_copy(LOCALES.find(({ code }) => code === locale)?.code ?? 'en')
  .then((copy) => createRoot(document.getElementById('root')!).render(<StakingProbe copy={copy} />))
  .catch((error: unknown) => console.error('Staking fixture failed', error))
