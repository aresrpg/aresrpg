// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import { dispatch_app, useAppStore, type AppState } from '../../src/store.ts'

type StoreReader = <T>(selector: (state: AppState) => T) => T
const BalanceValue = ({ useSource, label }: Readonly<{ useSource: StoreReader; label: string }>) => {
  const balance = useSource((state) => state.session.kares_balance)
  return <output aria-label={label}>{balance === null ? 'unknown' : balance.toString()}</output>
}
const publish_balance = (kares_balance: bigint): void =>
  dispatch_app({ type: 'wallet/refreshed', balance_mist: 0n, kares_balance, gas_spent_mist: 0n })
const BalanceProbe = () => {
  const [generation, set_generation] = useState(0)
  const [reader, set_reader] = useState<StoreReader>(() => useAppStore)
  const reload_store = async (): Promise<void> => {
    const path = `/src/store.ts?t=${Date.now()}`
    const next = (await import(/* @vite-ignore */ path)) as typeof import('../../src/store.ts')
    set_reader(() => next.useAppStore)
    set_generation((value) => value + 1)
  }
  return (
    <>
      <BalanceValue label="Sidebar balance" useSource={useAppStore} />
      <BalanceValue label="Staking balance" useSource={reader} />
      <button type="button" onClick={() => publish_balance(100_000_000_000n)}>
        Publish balance
      </button>
      <button type="button" onClick={() => publish_balance(150_000_000_000n)}>
        Update balance
      </button>
      <output aria-label="Store generation">{generation}</output>
      <button
        type="button"
        onClick={() => {
          void reload_store().catch((error: unknown) => console.error(error))
        }}
      >
        Reload store module
      </button>
    </>
  )
}
createRoot(document.getElementById('root')!).render(<BalanceProbe />)
