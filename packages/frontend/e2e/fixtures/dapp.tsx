// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'
import type {
  AgentStatus,
  CharacterRow,
  FightResolutionRow,
  InventoryPacket,
  ItemRow,
  ListingRow,
} from '@aresrpg/protocol'

import type { AuthSession } from '../../src/auth.ts'
import { DappPage } from '../../src/dapp/DappPage.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app, observe_app, read_app_state } from '../../src/store.ts'
import '../../src/tailwind.css'

// Public synthetic Google identity only: the real dapp module talks to a test-routed bot service, and the
// real session module opens its game socket, which the test routes and answers (`dapp_bot.ts`): what the
// page sends on it is what a game server would receive. This page never signs or submits a transaction.
// A stand-in for the game server's push of the bot account to its owner: the test names the account
// and it arrives as `packet/inventory_observed` on the session's own read-only account subscription.
type PushedAccount = Readonly<{
  characters: CharacterRow[]
  items: ItemRow[]
  listings: ListingRow[]
  resolutions: FightResolutionRow[]
  kiosk_versions: Record<string, string>
  balance_mist: string
}>
/** The stand-in chain: the SUI the bot account holds, as the test last named it. */
const chain = { bot_mist: 0n }
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
  push_account: ({ characters, items, listings, resolutions, kiosk_versions, balance_mist }: PushedAccount) => {
    const { agent_inventory } = read_app_state().session
    const pushed = (packet: InventoryPacket) =>
      dispatch_app({
        type: 'server/packet',
        packet: { type: 'packet/inventory_observed', id: agent_inventory.serial, packet },
      })
    pushed({ type: 'packet/characters', characters })
    pushed({ type: 'packet/listings', listings, kiosk_versions })
    pushed({ type: 'packet/fight_resolutions', resolutions })
    // The last packet of a snapshot is its inventory: the account is fully read from then on.
    pushed({ type: 'packet/inventory', items })
    // The balance is a chain read of the session: it reads it again, as it does after any change.
    chain.bot_mist = BigInt(balance_mist)
    dispatch_app({ type: 'wallet/refresh' })
  },
})
const session = {
  address: '0xd41c7cbc0cbccb9e7ab701373f3b5f082cc0024098f2ab561ff342107b91491f',
  identity: 'zklogin',
  wallet_name: 'Fixture',
  disconnect: async () => undefined,
  // What the session reads of its accounts: the owner holds nothing, the bot what the test named.
  read_agent_pairing_request: () => ({ zklogin_public_identifier: 'fixture' }),
  read_sui_balance: async () => 0n,
  read_kares_balance: async () => 0n,
  gas_spent_24h: () => 0n,
  read_agent_balances: async () => ({ sui_balance_mist: chain.bot_mist, kares_balance: null }),
} as unknown as AuthSession

void load_app_copy('en')
  .then((copy) => {
    dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
    observe_app(['dapp', 'session'])
    dispatch_app({ type: 'auth/ready', wallets: [] })
    if (new URLSearchParams(location.search).has('signed_in')) {
      dispatch_app({ type: 'auth/connecting' })
      dispatch_app({ type: 'auth/connected', session })
    }
    createRoot(document.getElementById('root')!).render(<DappPage copy={copy} locale="en" />)
  })
  .catch(console.error)
