// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'
import type { AgentStatus, CharacterRow, ItemRow, ListingRow } from '@aresrpg/protocol'

import type { AuthSession } from '../../src/auth.ts'
import { DappPage } from '../../src/dapp/DappPage.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app, observe_app, read_app_state, subscribe_app } from '../../src/store.ts'
import '../../src/tailwind.css'

// Public synthetic Google identity only: the real dapp module talks to a test-routed bot service,
// while this page never signs, opens the game socket or submits a transaction.
// A stand-in for the game server's push of the bot account to its owner: the test names the account
// and it arrives as `packet/inventory_observed` on the session's own read-only account subscription.
type PushedAccount = Readonly<{ characters: CharacterRow[]; items: ItemRow[]; balance_mist: string }>
Object.assign(window, {
  // The bot's own status, as the game server relays it from the bot's socket on that same subscription.
  push_status: (status: AgentStatus) =>
    dispatch_app({
      type: 'server/packet',
      packet: {
        type: 'packet/inventory_observed',
        id: read_app_state().session.agent_inventory.serial,
        packet: { type: 'packet/agent_status', status },
      },
    }),
  push_account: ({ characters, items, balance_mist }: PushedAccount) => {
    const { wallet, inventory_pairing: pairing, agent_inventory } = read_app_state().session
    if (!wallet || !pairing) return
    const pushed = (
      packet: { type: 'packet/characters'; characters: CharacterRow[] } | { type: 'packet/inventory'; items: ItemRow[] }
    ) =>
      dispatch_app({
        type: 'server/packet',
        packet: { type: 'packet/inventory_observed', id: agent_inventory.serial, packet },
      })
    pushed({ type: 'packet/characters', characters })
    pushed({ type: 'packet/inventory', items })
    dispatch_app({
      type: 'agent/inventory_balances',
      wallet,
      pairing,
      sui_balance_mist: BigInt(balance_mist),
      kares_balance: null,
    })
  },
})
// A stand-in for the game server's public market data on this page's own socket: every category lists
// its one dungeon key, and the offers of the item on screen are the ones the test names.
const KEY = { item_type: 'key_of_gilded_lorito', category: 'key', name: 'Key of the Gilded Lorito', level: 8 } as const
subscribe_app(({ marketplace }, previous) => {
  const { observation } = marketplace
  if (!observation || observation === previous.marketplace.observation) return
  const listings = (window as unknown as { market_offers?: ListingRow[] }).market_offers ?? []
  queueMicrotask(() => {
    dispatch_app({ type: 'server/packet', packet: { type: 'packet/market_types', observation, items: [KEY] } })
    if (observation.kind !== 'offers') return
    const packet = {
      type: 'packet/market_slice',
      observation,
      listings,
      kiosk_versions: {},
      next_cursor: null,
    } as const
    dispatch_app({ type: 'server/packet', packet })
  })
})
const session = {
  address: '0xd41c7cbc0cbccb9e7ab701373f3b5f082cc0024098f2ab561ff342107b91491f',
  identity: 'zklogin',
  wallet_name: 'Fixture',
  disconnect: async () => undefined,
} as unknown as AuthSession

void load_app_copy('en')
  .then((copy) => {
    dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
    observe_app(['dapp'])
    dispatch_app({ type: 'auth/ready', wallets: [] })
    if (new URLSearchParams(location.search).has('signed_in')) {
      dispatch_app({ type: 'auth/connecting' })
      dispatch_app({ type: 'auth/connected', session })
    }
    createRoot(document.getElementById('root')!).render(<DappPage copy={copy} locale="en" />)
  })
  .catch(console.error)
