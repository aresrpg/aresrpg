// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ItemRow } from '@aresrpg/protocol'
import type { AgentTransferActions, AgentTransferIntent } from '@aresrpg/sdk/agent-transfer-actions'
import type { AgentRecall } from '@aresrpg/sdk/agent-recall'
import type { AgentItemReturnOffer } from '@aresrpg/sdk/agent-returns'

import type { AuthSession } from '../../src/auth.ts'
import { dispatch_app, read_app_state } from '../../src/store.ts'

declare global {
  interface Window {
    agent_prepared: readonly Readonly<{ sender: string; intent: AgentTransferIntent }>[]
    agent_confirmed: readonly Readonly<{ sender: string; intent: AgentTransferIntent }>[]
    resolve_agent_transaction: () => void
    reject_agent_transaction: () => void
    replay_agent_inventory: () => void
    release_agent_projection: () => void
    release_agent_caps: () => void
    replace_agent_wallet: () => void
  }
}

/** Synthetic custody and pushed packets only. No SDK client, RPC, key or signer. */
export const inventory_agent_fixture = (items: readonly ItemRow[], fail_first: boolean) => {
  window.agent_prepared = []
  window.agent_confirmed = []
  const pairing = {
    address: '0xagent',
    multisig_public_key: 'synthetic-public-identity',
    signer_mode: 'host-persistent' as const,
  }
  let player_items = [...items]
  let agent_items = items
    .filter(({ item_type }) => ['wheat', 'siluri'].includes(item_type))
    .map((item) => ({ ...item, id: `agent-${item.id}`, kiosk: '0xagentkiosk', version: '1' }))
  const query = new URLSearchParams(location.search)
  const claim_errors: Readonly<Record<string, string>> = {
    uncertain: '[sdk] transaction outcome unknown: fixture-claim',
    executed: '[sdk] transaction fixture-claim failed on-chain: Fixture claim aborted',
  }
  const claim_error = claim_errors[query.get('claim-outcome') ?? '']
  let pending: AgentItemReturnOffer[] = JSON.parse(sessionStorage.getItem('fixture:item-pending') ?? '[]')
  if (!pending.length && query.has('pending-items'))
    pending = agent_items
      .filter(({ item_type }) => item_type === 'wheat')
      .map((item, index) => ({
        item_id: item.id,
        seller_kiosk: item.kiosk,
        purchase_cap: `${item.id}-cap`,
        recipient: '0xowner',
        agent_address: '0xagent',
        offer_digest: query.has('independent-caps') ? `receipt-${index}` : 'receipt',
      }))
  let indexed_player = player_items,
    indexed_agent = agent_items
  let stale_pending: readonly AgentItemReturnOffer[] = []
  window.release_agent_caps = () => {
    stale_pending = []
    dispatch_app({ type: 'agent/inventory_refresh' })
  }
  window.replace_agent_wallet = () => {
    const { session } = read_app_state()
    dispatch_app({ type: 'auth/disconnected' })
    dispatch_app({ type: 'auth/connecting' })
    dispatch_app({ type: 'auth/connected', session: { ...session.wallet!, address: '0xreplacement' } })
    dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [...session.characters] } })
  }
  window.release_agent_projection = () => {
    indexed_player = player_items
    indexed_agent = agent_items
    dispatch_app({ type: 'server/packet', packet: { type: 'packet/inventory', items: indexed_player } })
    publish()
  }
  const publish = () => {
    const { session } = read_app_state()
    const id = session.agent_inventory.serial
    dispatch_app({
      type: 'server/packet',
      packet: {
        type: 'packet/inventory_observed',
        id,
        packet: { type: 'packet/listings', listings: [], kiosk_versions: {} },
      },
    })
    dispatch_app({
      type: 'server/packet',
      packet: { type: 'packet/inventory_observed', id, packet: { type: 'packet/inventory', items: indexed_agent } },
    })
    dispatch_app({
      type: 'agent/inventory_balances',
      wallet: session.wallet!,
      pairing,
      sui_balance_mist: 4_000_000_000n,
      kares_balance: null,
    })
  }
  window.replay_agent_inventory = publish
  const actions = (sender: string): AgentTransferActions => ({
    sender,
    synchronize: async () => {},
    fits: async () => true,
    quote: async () => ({ budget_mist: 2_000_000n, cost_mist: 1_000_000n, required_mist: 2_000_000n }),
    prepare: async (intent) => {
      window.agent_prepared = [...window.agent_prepared, { sender, intent }]
      if (query.has('offer-failure') && intent.kind === 'asset_offer')
        throw new Error('[sdk] transaction resolution failed — NOT submitted: Fixture offer refused')
      if (query.has('claim-failure') && intent.kind === 'asset_claim')
        throw new Error('[sdk] transaction resolution failed — NOT submitted: Fixture claim policy refused')
      return {
        intent,
        sender,
        network: 'mainnet',
        gas_mist: '1000000',
        gas_budget_mist: '2000000',
        confirm: async ({ before_sign = () => {} } = {}) => {
          before_sign()
          if (new URLSearchParams(location.search).has('pending-transfer')) {
            const wait = Promise.withResolvers<void>()
            window.resolve_agent_transaction = () => wait.resolve()
            window.reject_agent_transaction = () => wait.reject(new Error('Signature rejected'))
            await wait.promise
          }
          before_sign()
          if (claim_error && intent.kind === 'asset_claim') throw new Error(claim_error)
          window.agent_confirmed = [...window.agent_confirmed, { sender, intent }]
          if (intent.kind === 'asset_offer')
            pending = [
              ...pending,
              ...intent.items.map(({ item_id, kiosk }) => ({
                item_id,
                offer_digest: `receipt-${window.agent_confirmed.length}`,
                seller_kiosk: kiosk,
                purchase_cap: `${item_id}-cap`,
                recipient: intent.recipient,
                agent_address: sender,
              })),
            ]
          sessionStorage.setItem('fixture:item-pending', JSON.stringify(pending))
          if (intent.kind === 'asset_claim') {
            if (query.has('stale-caps')) stale_pending = intent.items
            const ids = new Set(intent.items.map(({ item_id }) => item_id))
            const received = [...player_items, ...agent_items]
              .filter(({ id }) => ids.has(id))
              .map((item) => ({ ...item, version: '2', kiosk: sender === '0xowner' ? '0xkiosk' : '0xagentkiosk' }))
            player_items = [...player_items.filter(({ id }) => !ids.has(id)), ...(sender === '0xowner' ? received : [])]
            agent_items = [...agent_items.filter(({ id }) => !ids.has(id)), ...(sender === '0xagent' ? received : [])]
            pending = pending.filter(({ item_id }) => !ids.has(item_id))
            sessionStorage.setItem('fixture:item-pending', JSON.stringify(pending))
            if (!query.has('hold-index')) window.release_agent_projection()
          }
          return { digest: 'synthetic-receipt', receipt: {} as never }
        },
      }
    },
  })
  const recall = {
    transfer: actions('0xagent'),
    characters: [],
    pending: [],
    read_pending_characters: async () => [],
    read_incoming_items: async () => [...pending, ...stale_pending].filter(({ recipient }) => recipient === '0xowner'),
    read_deposit_items: async () => [...pending, ...stale_pending].filter(({ recipient }) => recipient === '0xagent'),
  } as unknown as AgentRecall
  let reads = 0
  return {
    pairing,
    publish,
    wallet: {
      agent_deposit: () => actions('0xowner'),
      agent_transfer: actions('0xowner'),
      read_agent_returns: async () => [],
      read_agent_balances: async () => ({ sui_balance_mist: 4_000_000_000n, kares_balance: null }),
      read_agent_recall: async () => {
        reads += 1
        if (fail_first && reads === 1) throw new Error('Synthetic inventory read failed')
        publish()
        return recall
      },
    } satisfies Pick<
      AuthSession,
      'agent_deposit' | 'agent_transfer' | 'read_agent_recall' | 'read_agent_returns' | 'read_agent_balances'
    >,
  }
}
