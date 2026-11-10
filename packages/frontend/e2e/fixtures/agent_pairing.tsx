// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { StrictMode, useEffect, useState } from 'react'
import { Button } from '@aresrpg/ui'
import { createRoot } from 'react-dom/client'
import type { AgentPairingIdentity, CharacterRow } from '@aresrpg/protocol'
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { create_agent_identity } from '../../../sdk/src/agent_multisig.ts'
import { create_wallet_binding } from '../../../sdk/src/wallet_standard.ts'
import type { AuthSession } from '../../src/auth.ts'
import { AgentSetup, AgentSetupButton } from '../../src/agents/AgentSetup.tsx'
import { AgentKioskPanel } from '../../src/agents/AgentKioskPanel.tsx'
import { send_character_to_agent } from '../../src/agents/send_character.ts'
import { useAgentKiosk } from '../../src/agents/useAgentKiosk.ts'
import { Toasts } from '../../src/components/Toasts.tsx'
import { AgentTransferFunding } from '../../src/agents/AgentTransferFunding.tsx'
import { dispatch_app, read_app_state, useAppStore, observe_app } from '../../src/store.ts'
import { env } from '../../src/env.ts'
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
    read_agent_recall: async (pairing: AgentPairingIdentity) => {
      const { session } = read_app_state()
      dispatch_app({
        type: 'server/packet',
        packet: {
          type: 'packet/inventory_observed',
          id: session.agent_inventory.serial,
          packet: { type: 'packet/inventory', items: [] },
        },
      })
      return {
        transfer: { sender: pairing.address, quote: forbidden, prepare: forbidden },
        characters: [],
        pending: [],
        read_deposit_items: async () => [],
        read_incoming_items: async () => [],
        read_pending_characters: async () => [],
      }
    },
    read_agent_returns: async () => [],
    agent_deposit: () => ({
      sender: identity.address,
      prepare: async () => {
        document.documentElement.setAttribute('data-fixture-offer', 'true')
        throw new Error('Fixture refuses transaction preparation; no signer exists.')
      },
    }),
    agent_transfer: { sender: identity.address, prepare: forbidden },
    return_agent_assets: async (
      _pairing: AgentPairingIdentity,
      options: Parameters<AuthSession['return_agent_assets']>[1]
    ) => {
      options.before_sign()
      await options.guard()
      document.documentElement.setAttribute('data-fixture-returning', 'true')
      await new Promise<void>((resolve, reject) => {
        addEventListener('fixture/return', () => resolve(), { once: true })
        addEventListener('fixture/return-failed', () => reject(new Error('Return outcome uncertain')), { once: true })
      })
      options.before_sign()
      await options.guard()
      document.documentElement.removeAttribute('data-fixture-returning')
    },
    // Fixture-only placeholder; no wallet signature or credential is created.
    sign_personal_message: async () => {
      const html = document.documentElement
      html.setAttribute('data-fixture-signing', 'true')
      html.setAttribute('data-fixture-signatures', String(Number(html.getAttribute('data-fixture-signatures')) + 1))
      if (
        new URLSearchParams(location.search).has('slow_signature') ||
        document.documentElement.hasAttribute('data-delay-next-signature')
      )
        await new Promise<void>((resolve) =>
          window.addEventListener('fixture/signature', () => resolve(), { once: true })
        )
      return { bytes: '', signature: 'fixture-signature' }
    },
  } as unknown as AuthSession
  dispatch_app({ type: 'auth/connecting' })
  dispatch_app({ type: 'auth/connected', session })
  dispatch_app({ type: 'server/packet', packet: { type: 'packet/connection_accepted', address: session.address } })
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
            custody: 'kiosk',
            equipment: [],
          } satisfies CharacterRow,
        ],
      },
    })
}

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
  if (new URLSearchParams(location.search).has('custody')) return <CustodyFixture copy={copy} />
  if (payer && wallet) return <FundingFixture wallet={wallet} payer={payer} copy={copy} />
  return (
    <main className="min-h-screen bg-bg p-4 text-text">
      <p>Synthetic mainnet public identity; local verifier only. No wallet, RPC, assets or credentials.</p>
      <Button onClick={() => set_open(true)}>{copy.ui.agent_connect_your}</Button>
      {open && <AgentSetup copy={copy} close={() => set_open(false)} />}
    </main>
  )
}
const FundingFixture = ({ wallet, payer, copy }: Readonly<{ wallet: AuthSession; payer: string; copy: AppCopy }>) => {
  const [open, set_open] = useState(false)
  return (
    <>
      <Button onClick={() => set_open(true)}>{copy.ui.agent_return_character}</Button>
      <AgentTransferFunding
        wallet={wallet}
        sender={open ? (payer === 'human' ? wallet.address : funding_pairing.address) : null}
        pairing={funding_pairing}
        copy={copy}
        close={() => set_open(false)}
      />
    </>
  )
}

const CustodyFixture = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [open, set_open] = useState(true)
  return (
    <main className="min-h-screen bg-bg p-4 text-text">
      <Button onClick={() => set_open(!open)}>{open ? 'Close inventory' : 'Open inventory'}</Button>
      {open && <CustodyPanel copy={copy} />}
      <Toasts />
    </main>
  )
}
const CustodyPanel = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const kiosk = useAgentKiosk(copy, false)
  return (
    <>
      <AgentSetupButton copy={copy} label={copy.ui.agent_connect_your} />
      <AgentKioskPanel kiosk={kiosk} copy={copy} disabled={false} offline={false} />
      <Button onClick={() => send_character_to_agent('fixture-character', copy)}>Offer fixture character</Button>
    </>
  )
}

void load_app_copy('en')
  .then((copy) => {
    if (new URLSearchParams(location.search).has('custody')) observe_app(['hosted_agent'])
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
