// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'
import { useStore } from 'zustand'
import type { BlastPhase, BlastSnapshot } from '@aresrpg/sdk/blast'

import { Hero } from '../../src/allocation/Hero.tsx'
import { SalePanel } from '../../src/allocation/SalePanel.tsx'
import { useSaleSpots } from '../../src/allocation/SaleSpots.tsx'
import { create_allocation_runtime } from '../../src/allocation/runtime.ts'
import { initial_sale } from '../../src/allocation/sale.ts'
import { allocation_view } from '../../src/allocation/view.ts'
import { copy_text, load_app_copy } from '../../src/i18n/copy.ts'
import { LocaleScope } from '../../src/i18n/LocaleScope.tsx'
import type { AuthSession } from '../../src/auth.ts'
import '../../src/tailwind.css'
import '../../src/allocation/allocation.css'
import '../../src/allocation/layout.css'
import '../../src/allocation/sale.css'

// Synthetic SDK boundary only: no signer, chain read or transaction leaves this page.
const SUI = 1_000_000_000n
const params = new URLSearchParams(location.search)
const copy = await load_app_copy('en')
const text = copy_text(copy.allocation_page)
const google = `0x${'a1'.repeat(32)}`
const slush = `0x${'b2'.repeat(32)}`
const now = Date.now()
const sale: BlastSnapshot = {
  version: '10',
  clock_ms: BigInt(now),
  phase: (params.get('phase') ?? 'live') as BlastPhase,
  committed: 38_420n * SUI,
  target: 60_000n * SUI,
  progress_bps: 6403,
  start_ms: BigInt(now - 3_600_000),
  end_ms: BigInt(now + 2 * 86_400_000 + 14 * 3_600_000 + 7 * 60_000 + 30_000),
  token_allocation: 400_000_000n * SUI,
}
const purchases: unknown[] = []
const session = {
  address: google,
  wallet_name: 'Sign in with Google',
  identity: 'zklogin',
  read_sui_balance: async () => (params.has('poor') ? (2040n * SUI) / 100n : (21240n * SUI) / 100n),
  blast: {
    purchase: async (purchase: unknown) => {
      purchases.push(purchase)
      document.body.dataset.purchases = JSON.stringify(purchases, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value
      )
      return { digest: 'fixture-buy' }
    },
    claim: async () => ({ digest: 'fixture-claim' }),
  },
} as unknown as AuthSession
const proof = { index: '0', cap_mist: String(125n * SUI), siblings: ['ab'.repeat(32)] }
const runtime = create_allocation_runtime()
runtime.store.setState({
  session,
  status: {
    phase: 'final',
    submissions_open: false,
    wallets: [
      { address: google, label: 'Sign in with Google', game_wallet: true },
      { address: slush, label: 'Slush' },
    ],
    awards: [
      { address: google, tier: 'veteran', source: 'leaderboard', board: 'xp' },
      { address: slush, tier: 'member', source: 'social' },
    ],
    user: null,
    submission: null,
    proofs: [{ address: google, proof }],
  },
})
const connects: string[] = []
const external = {
  state: {
    loaded: true,
    wallets: [],
    selected_wallet: null,
    accounts: [],
    remembered: null,
    session: null,
    request: null,
    sequence: 0,
    error: null,
  },
  dispatch: (input: { wallet_name?: string }) => {
    connects.push(input.wallet_name ?? '')
    document.body.dataset.connects = connects.join(',')
  },
}

const Page = () => {
  const state = useStore(runtime.store)
  const view = allocation_view(state.status, 0, state.session)
  const { spot, overlays } = useSaleSpots({
    sale,
    cards: view.cards,
    state,
    runtime,
    external: external as never,
    copy,
    text,
    locale: 'en',
    now,
  })
  return (
    <div className="allocation-root">
      <main className="page">
        <Hero
          view={view}
          state={state}
          runtime={runtime}
          text={text}
          locale="en"
          open={false}
          sale={sale}
          now={now}
          kares={copy.kares_page}
          spot={spot}
        />
      </main>
      {overlays}
    </div>
  )
}

const STAGES = [
  ['soon', null],
  ['live', 40n],
  ['live', 125n],
  ['funded', 85n],
  ['complete', 85n],
  ['cancelled', 85n],
  ['complete', null],
] as const
const States = () => (
  <div className="allocation-root">
    <main
      className="page"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 32 }}
    >
      {STAGES.map(([phase, bought], index) => (
        <SalePanel
          key={index}
          label="Google game wallet"
          address={google}
          cap={125n * SUI}
          sale={{
            ...sale,
            phase,
            committed: phase === 'live' ? sale.committed : 71_240n * SUI,
            start_ms: phase === 'soon' ? BigInt(now + 5 * 86_400_000) : sale.start_ms,
          }}
          commitment={bought === null ? null : { quote: bought * SUI, wallet_cap: 125n * SUI }}
          balance={(21240n * SUI) / 100n}
          signed
          ready
          busy={false}
          state={initial_sale()}
          now={now}
          text={text}
          locale="en"
          act={{ buy: () => undefined, claim: () => undefined, connect: () => undefined }}
        />
      ))}
    </main>
  </div>
)
createRoot(document.getElementById('root')!).render(
  <LocaleScope locale="en">{params.has('states') ? <States /> : <Page />}</LocaleScope>
)
