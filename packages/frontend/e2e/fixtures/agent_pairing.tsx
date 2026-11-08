// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { StrictMode, useEffect, useState } from 'react'
import { Button } from '@aresrpg/ui'
import { createRoot } from 'react-dom/client'
import type { CharacterRow } from '@aresrpg/protocol'
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { create_agent_identity } from '../../../sdk/src/agent_multisig.ts'
import { create_wallet_binding } from '../../../sdk/src/wallet_standard.ts'
import type { AuthSession } from '../../src/auth.ts'
import { AgentSetup } from '../../src/agents/AgentSetup.tsx'
import { AgentInventoryPanel } from '../../src/agents/AgentInventoryPanel.tsx'
import type { AgentRecall } from '../../../sdk/src/agent_recall.ts'
import type { AgentTransferIntent } from '../../../sdk/src/agent_transfer_actions.ts'
import { AgentTransferReview } from '../../src/agents/AgentTransferReview.tsx'
import { dispatch_app, read_app_state, useAppStore } from '../../src/store.ts'
import { env } from '../../src/env.ts'
import type { SetupExchange } from '../../src/agents/setup_requests.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import '../../src/tailwind.css'

// Synthetic Google identifiers with address seeds 1 and 2; no Google account or private key.
const identities = [
  { address: '0xd41c7cbc0cbccb9e7ab701373f3b5f082cc0024098f2ab561ff342107b91491f', suffix: 'AB' },
  { address: '0xe971cf45c36d7c57a5c9dbeedaf953045d509c795a46e6b480f487588ca788e5', suffix: 'AC' },
]
const public_identity = create_agent_identity({
  agent_public_key: new Ed25519PublicKey(new Uint8Array(32).fill(1)),
  zklogin_public_identifier: toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false }),
})
const funding_pairing = {
  address: public_identity.address,
  multisig_public_key: public_identity.public_key.toBase64(),
  signer_mode: 'disposable' as const,
}
const forbidden = () => {
  throw new Error('Secret access, signing and transactions are forbidden')
}
const connect = (index: number) => {
  dispatch_app({ type: 'auth/disconnected' })
  const identity = identities[index]
  if (!identity) return
  const wallet = {
    features: {
      'standard:events': { on: () => () => undefined },
      'enoki:getSession': { getSession: forbidden },
      'sui:signPersonalMessage': { signPersonalMessage: forbidden },
      'sui:signTransaction': { signTransaction: forbidden },
    },
  } as unknown as Parameters<typeof create_wallet_binding>[0]
  const public_key = Uint8Array.from(
    atob(`G2h0dHBzOi8vYWNjb3VudHMuZ29vZ2xlLmNvbQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA${identity.suffix}`),
    (char) => char.charCodeAt(0)
  )
  const account = { address: identity.address, publicKey: public_key, chains: ['sui:mainnet'] as const, features: [] }
  const binding = create_wallet_binding(wallet, account, 'mainnet')
  const session = {
    address: identity.address,
    identity: 'zklogin',
    read_agent_pairing_request: binding.read_agent_pairing_request,
  } as AuthSession
  dispatch_app({ type: 'auth/connecting' })
  dispatch_app({ type: 'auth/connected', session })
  if (new URLSearchParams(location.search).has('character'))
    dispatch_app({
      type: 'server/packet',
      packet: {
        type: 'packet/characters',
        characters: [
          {
            id: 'fixture-character',
            name: 'Asobi',
            classe: 'asobi',
            sex: 'male',
            experience: '0',
            level: 1,
            color_1: 0,
            color_2: 0,
            color_3: 0,
            vitality: 0,
            wisdom: 0,
            strength: 0,
            intelligence: 0,
            chance: 0,
            agility: 0,
            available_points: 0,
            spells: {},
            available_spell_points: 0,
            jobs: {},
            kiosk: 'fixture-kiosk',
            equipment: [],
          } satisfies CharacterRow,
        ],
      },
    })
}
const exchange: SetupExchange = async (wallet, request) => {
  const endpoint = env.server_ws_url.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
  const response = await fetch(new URL('/fixture/session', endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ owner: wallet.address, request }),
  })
  if (!response.ok) throw new Error('FIXTURE_SESSION_FAILED')
  return response.json()
}
const inventory_fixture = {
  read_inventory: async () => ({
    items: [
      {
        item: {
          id: 'available-item',
          version: '1',
          name: 'Available wool',
          item_type: 'wool',
          category: 'resource',
          level: 1,
          amount: 2,
          kiosk: 'first-kiosk',
        },
        status: 'available',
      },
      {
        item: {
          id: 'equipped-item',
          version: '2',
          name: 'Equipped hat',
          item_type: 'wool',
          category: 'hat',
          level: 1,
          amount: 1,
          kiosk: 'second-kiosk',
        },
        status: 'equipped',
        character_id: 'character',
        slot: 'hat',
      },
      {
        item: {
          id: 'listed-item',
          version: '3',
          name: 'Listed wool',
          item_type: 'wool',
          category: 'resource',
          level: 1,
          amount: 3,
          kiosk: 'third-kiosk',
        },
        status: 'listed',
        exclusive: false,
      },
    ],
    positions: [],
    proceeds: [],
    owned: [],
    other_kiosk_objects: [],
    sui_mist: '1000000000',
    kares_mist: '2000000000',
  }),
  read_incoming_items: async () => {
    if (new URLSearchParams(location.search).has('incoming_failure'))
      throw new Error('Incoming equipment capability is missing')
    return []
  },
  transfer: {
    sender: identities[1]!.address,
    prepare: async (intent: AgentTransferIntent) => {
      document.documentElement.setAttribute('data-inventory-review', JSON.stringify(intent))
      return { intent, sender: identities[1]!.address, network: 'mainnet', gas_mist: '1000', confirm: forbidden }
    },
  },
} as unknown as AgentRecall

const Fixture = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [open, set_open] = useState(false)
  const wallet = useAppStore((app) => app.session.wallet)
  const candidate = useAppStore((app) => app.session.agent_pairing_candidate)
  const confirmed = useAppStore((app) => app.session.inventory_pairing)
  useEffect(() => {
    document.documentElement.setAttribute('data-agent-candidate', candidate?.signer_mode ?? '')
    document.documentElement.setAttribute('data-agent-confirmed', String(!!confirmed))
  }, [candidate, confirmed])
  const payer = new URLSearchParams(location.search).get('funding')
  if (new URLSearchParams(location.search).has('inventory') && wallet)
    return <AgentInventoryPanel wallet={wallet} copy={copy} recall={inventory_fixture} />
  if (payer && wallet)
    return (
      <AgentTransferReview
        wallet={wallet}
        copy={copy}
        allow_submit
        funding_pairing={funding_pairing}
        intent={{ kind: 'claim', character_id: 'character', seller_kiosk: 'kiosk', purchase_cap: 'cap' }}
        actions={{
          sender: payer === 'human' ? wallet.address : funding_pairing.address,
          prepare: async () => {
            throw new Error('No valid gas coins for transaction')
          },
        }}
      />
    )
  return (
    <main className="min-h-screen bg-bg p-4 text-text">
      <p>Synthetic mainnet public identity; local verifier only. No wallet, RPC, assets or credentials.</p>
      <Button onClick={() => set_open(true)}>{copy.ui.agent_connect_your}</Button>
      {open && <AgentSetup copy={copy} close={() => set_open(false)} exchange={exchange} />}
    </main>
  )
}
void load_app_copy('en')
  .then((copy) => {
    connect(0)
    if (new URLSearchParams(location.search).has('funding')) {
      const source = {
        address: `0x${'33'.repeat(32)}`,
        wallet_name: 'Fixture source',
        is_transaction_idle: () => true,
        identity: 'wallet',
        read_sui_balance: async () => 10_000_000_000n,
        estimate_sui_transfer: async () => {
          if (new URLSearchParams(location.search).has('slow_estimate'))
            await new Promise<void>((resolve) =>
              addEventListener('fixture/release_estimate', () => resolve(), { once: true })
            )
          return 1_000_000n
        },
        send_sui: async (address: string, amount: bigint) => {
          document.documentElement.setAttribute(
            'data-fake-payment',
            JSON.stringify({ address, amount: String(amount) })
          )
          return { digest: 'fixture-no-transaction' }
        },
      } as unknown as AuthSession
      dispatch_app({ type: 'external_wallet/ready', remembered: null, wallets: [] })
      dispatch_app({
        type: 'external_wallet/connected',
        sequence: read_app_state().external_wallet.sequence,
        session: source,
      })
      document.documentElement.setAttribute('data-funding-pairing', funding_pairing.address)
    }
    // The fixture injects only the already-authenticated owner boundary; the real exchange verifies its proof.
    window.addEventListener('fixture/wallet', (event) => connect((event as CustomEvent<number>).detail))
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <Fixture copy={copy} />
      </StrictMode>
    )
  })
  .catch(console.error)
