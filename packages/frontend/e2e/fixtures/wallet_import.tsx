// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AgentHandoverIncomplete } from '@aresrpg/sdk/agent-handover'
import {
  WalletImportFundingRequired,
  type WalletImportOptions,
  type WalletImportPlan,
} from '@aresrpg/sdk/wallet-import'

import type { AuthSession } from '../../src/auth.ts'
import { load_app_copy, type AppCopy } from '../../src/i18n/copy.ts'
import { WalletImport } from '../../src/settings/WalletImport.tsx'
import { dispatch_app, observe_app, useAppStore } from '../../src/store.ts'
import '../../src/tailwind.css'

// Only the real window, reducer and observer run. Both wallets record intent without any chain access.
const params = new URLSearchParams(location.search)
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
// A `stepped` run holds every intermediate state until the test releases it: no state is on
// screen for a fixed time only, so a slow runner cannot miss it.
const step = (): Promise<void> =>
  params.has('stepped')
    ? new Promise((resolve) => window.addEventListener('import-step', () => resolve(), { once: true }))
    : Promise.resolve()
const record = (call: string): void => {
  const calls = JSON.parse(document.documentElement.dataset.calls ?? '[]') as string[]
  document.documentElement.dataset.calls = JSON.stringify([...calls, call])
}
const plan = {
  characters: params.has('empty') ? [] : [{ character_id: '0xa', kiosk: '0xkiosk', unequip: [] }],
  items: [],
  pending: { characters: [], items: [] },
  left: { roster: params.has('roster') ? 2 : 0, listed: params.has('listed') ? 3 : 0 },
  assets: params.has('empty') ? 0 : 42,
  royalty_mist: params.has('empty') ? 0n : 42_000_000n,
} as unknown as WalletImportPlan

const source = {
  address: `0x${'2'.repeat(64)}`,
  wallet_name: 'Slush',
  identity: 'wallet',
  is_transaction_idle: () => true,
  disconnect: async () => {},
} as unknown as AuthSession

const import_assets = async (_source: AuthSession, options: WalletImportOptions): Promise<WalletImportPlan> => {
  record('import')
  options.before_sign()
  if (params.has('source_gas')) throw new WalletImportFundingRequired('source', 31_000_000n)
  options.on_progress?.({ signer: 'source', moved: 0, total: 42 })
  await step()
  if (params.has('owner_gas'))
    throw new AgentHandoverIncomplete(new WalletImportFundingRequired('owner', 60_000_000n), 'offer-digest')
  if (params.has('fail')) throw new AgentHandoverIncomplete(new Error('RPC unavailable'), 'offer-digest')
  options.on_progress?.({ signer: 'owner', moved: 20, total: 42 })
  await step()
  options.on_progress?.({ signer: 'owner', moved: 42, total: 42 })
  return plan
}

const wallet = {
  address: `0x${'1'.repeat(64)}`,
  wallet_name: 'Google',
  identity: 'zklogin',
  is_transaction_idle: () => true,
  on_transaction: () => () => {},
  gas_spent_24h: () => 0n,
  read_sui_balance: async () => (params.has('unfunded') ? 0n : 5_000_000_000n),
  read_kares_balance: async () => null,
  read_wallet_import: async () => {
    record('read')
    await pause(250)
    if (params.has('read_fail')) throw new Error('RPC unavailable')
    return plan
  },
  import_wallet_assets: import_assets,
} as unknown as AuthSession

const stop = observe_app(['wallet_import'])
window.addEventListener('pagehide', stop, { once: true })
dispatch_app({ type: 'auth/connecting' })
dispatch_app({ type: 'auth/connected', session: wallet })
dispatch_app({
  type: 'wallet/refreshed',
  balance_mist: params.has('unfunded') ? 0n : 5_000_000_000n,
  kares_balance: null,
  gas_spent_mist: 0n,
})
dispatch_app({
  type: 'external_wallet/ready',
  remembered: null,
  wallets: [
    { name: 'Slush', authorize: async () => [source.address], connect: async () => source, disconnect: async () => {} },
  ],
})

const Fixture = () => {
  const [copy, set_copy] = useState<AppCopy | null>(null)
  const { request, sequence } = useAppStore((state) => state.external_wallet)
  const funding = useAppStore((state) => state.navigation.funding_cost_mist)
  useEffect(() => {
    void load_app_copy('en')
      .then((loaded) => {
        dispatch_app({ type: 'locale/loaded', locale: 'en', copy: loaded })
        set_copy(loaded)
      })
      .catch(console.error)
  }, [])
  useEffect(() => {
    if (request?.kind === 'disconnect') dispatch_app({ type: 'external_wallet/finished', sequence })
    if (request?.kind === 'authorize')
      dispatch_app({ type: 'external_wallet/accounts', sequence, accounts: [source.address] })
    if (request?.kind === 'connect') dispatch_app({ type: 'external_wallet/connected', sequence, session: source })
  }, [request, sequence])
  if (!copy) return null
  return (
    <main className="aui-settings min-h-screen bg-bg p-6 text-text">
      <div className="max-w-xl">
        <WalletImport copy={copy} />
      </div>
      <output data-funding="">{funding === null ? '' : String(funding)}</output>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
