// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { browser_auth_storage, remember_auth_wallet } from '../../src/auth_storage.ts'
import { boot_game } from '../../src/game_entry.tsx'
import { dispatch_app, read_app_state } from '../../src/store.ts'
import type { AuthSession } from '../../src/auth.ts'
import '../../src/tailwind.css'

// Actual game bootstrap; only login completion is injected. No wallet signing or transactions.
const session = {
  address: '0xd41c7cbc0cbccb9e7ab701373f3b5f082cc0024098f2ab561ff342107b91491f',
  identity: 'zklogin',
  wallet_name: 'Fixture',
  is_transaction_idle: () => true,
  read_sui_balance: async () => 0n,
  read_kares_balance: async () => null,
  gas_spent_24h: () => 0n,
  disconnect: async () => {},
  on_transaction: () => () => {},
  read_agent_pairing_request: (nonce: string) => ({
    version: 1,
    nonce,
    network: 'mainnet',
    owner: '0xd41c7cbc0cbccb9e7ab701373f3b5f082cc0024098f2ab561ff342107b91491f',
    zklogin_public_identifier: 'G2h0dHBzOi8vYWNjb3VudHMuZ29vZ2xlLmNvbQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB',
  }),
} as unknown as AuthSession
boot_game()
addEventListener('fixture/login', () => {
  // An unknown remembered name makes restore an asynchronous null result; the injected completion wins.
  remember_auth_wallet(browser_auth_storage(), 'Fixture')
  dispatch_app({ type: 'auth/connecting' })
  dispatch_app({ type: 'auth/connected', session })
  dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [] } })
})
addEventListener('fixture/snapshot', () =>
  document.documentElement.setAttribute('data-session-wallet', read_app_state().session.wallet?.address ?? '')
)
