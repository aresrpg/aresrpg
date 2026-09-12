// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from 'zustand'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { create_wallet_runtime } from '../../src/wallet/runtime.ts'
import { WalletControl } from '../../src/wallet/WalletControl.tsx'

import '../../src/tailwind.css'

const copy = await load_app_copy('en')
const wallets = ['First wallet', 'Second wallet'].map((name) => ({
  name,
  authorize: async () => ['0x1111111111111111', '0x2222222222222222'],
  connect: async (address: string) => ({ address, wallet_name: name, disconnect: async () => undefined }),
  disconnect: async () => undefined,
}))
const runtime = create_wallet_runtime({
  network: 'mainnet',
  storage: null,
  create_auth: async () => ({ wallets: () => wallets }),
})
const stop = runtime.start()
window.addEventListener('pagehide', stop, { once: true })
const Fixture = () => {
  const state = useStore(runtime.store)
  const [locked, set_locked] = useState(false)
  return (
    <main className="min-h-screen bg-bg p-12 text-text">
      <WalletControl wallet={{ state, dispatch: runtime.dispatch }} copy={copy.kares_page} locked={locked} />
      <div data-active-wallet>{state.session ? `${state.session.wallet_name}:${state.session.address}` : ''}</div>
      <button onClick={() => set_locked(!locked)} type="button">
        Toggle pending transfer
      </button>
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
