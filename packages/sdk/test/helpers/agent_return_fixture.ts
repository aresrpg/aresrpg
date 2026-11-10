// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Isolated process: mock chain reads/execution, retain the real return sequence, batching and handover guards.
/* eslint-disable functional/no-let, fp-law/no-mutating-methods -- This isolated subprocess owns mutable fake chain state and execution logs. */
import { mock } from 'bun:test'

import type { AgentTransferIntent } from '../../src/agent_transfer_actions.ts'
import { execute_agent_transfer } from '../../src/agent_transfer_actions.ts'
import { same_agent_equipment } from '../../src/agent_equipment.ts'
import * as batch_limits from '../../src/agent_batch_limits.ts'

const [, , scenario] = process.argv
const owner = `0x${'1'.repeat(64)}`,
  agent = `0x${'2'.repeat(64)}`
const calls: string[] = []
const batches: { kind: string; characters: number; items: number }[] = []
let characters = scenario === 'multi' ? ['character-a', 'character-b'] : ['character']
let items = scenario === 'multi' ? ['item-a', 'item-b', 'item-c'] : ['item']
const offered_characters = new Set(scenario === 'resume' ? characters : [])
const offered_items = new Set<string>()
let balance = scenario === 'unfunded' ? 0n : 1_000_000_000n
const staking = scenario.startsWith('stake')
const stake = {
  amount: scenario === 'stake' || scenario === 'stake_uncertain' ? '25' : '0',
  rewards: ['stake_empty', 'stake_paid'].includes(scenario) ? 0n : 7n,
  payout: scenario === 'stake_paid' ? 32n : 0n,
}
const exhausted_stake = () => stake.amount === '0' && stake.rewards === 0n
const settle_stake = (intent: AgentTransferIntent) => {
  if (intent.kind === 'asset_unstake') {
    stake.payout += BigInt(stake.amount) + stake.rewards
    stake.amount = '0'
    stake.rewards = 0n
    if (scenario === 'stake_uncertain') throw new Error('[sdk] transaction outcome unknown: staking-fixture')
  }
  if (intent.kind === 'asset_offer') stake.payout -= BigInt(intent.kares_mist)
}
const equipment = (id: string) => [{ slot: 'weapon', item_id: `sword-${id}` }]
const character_offer = (id: string) => ({
  character_id: id,
  seller_kiosk: 'kiosk',
  purchase_cap: `${id}-cap`,
  recipient: owner,
  agent_address: agent,
  equipment: [{ ...equipment(id)[0]!, purchase_cap: `sword-${id}-cap` }],
})
const item_offer = (id: string) => ({
  item_id: id,
  seller_kiosk: 'kiosk',
  purchase_cap: `${id}-cap`,
  recipient: owner,
  agent_address: agent,
})
mock.module('../../src/agent_batch_limits.ts', () => ({
  ...batch_limits,
  read_agent_batch_limits: async () => ({
    commands: 1024,
    objects: 2048,
    bytes: 131072,
    arguments: 512,
    pure_bytes: 16384,
    gas_objects: 256,
  }),
}))
mock.module('../../src/agent_equipment.ts', () => ({
  same_agent_equipment,
  read_agent_equipment: async (_client: unknown, _type: string, id: string) => equipment(id),
}))
mock.module('../../src/kiosk_discovery.ts', () => ({ read_personal_kiosks: async () => [] }))
mock.module('../../src/agent_returns.ts', () => ({
  read_agent_returns: async (_client: unknown, _sdk: unknown, recipient: string) =>
    recipient === owner ? [...offered_characters].map(character_offer) : [],
  read_agent_item_returns: async (_client: unknown, _sdk: unknown, recipient: string) =>
    recipient === owner ? [...offered_items].map(item_offer) : [],
  check_agent_return: async () => {},
}))
mock.module('../../src/agent_inventory.ts', () => ({
  read_agent_recovery_assets: async () => ({
    kiosk_caps: [],
    items: [],
    positions: staking && !exhausted_stake() ? [{ id: 'stake', amount: stake.amount }] : [],
    exhausted_positions: staking && exhausted_stake() ? ['stake'] : [],
    proceeds: [],
    other_kiosk_objects: [],
    owned:
      scenario === 'opaque'
        ? [{ id: 'foreign', type: '0x3::foreign::Asset' }]
        : staking
          ? [{ id: 'stake', type: '0x3::staking::StakePosition' }]
          : [],
    kiosk_assets: [
      ...characters.map((id) => ({
        kind: 'character',
        id,
        kiosk: 'kiosk',
        listed: offered_characters.has(id),
        exclusive: offered_characters.has(id),
      })),
      ...items.map((id) => ({
        kind: 'item',
        id,
        kiosk: 'kiosk',
        listed: offered_items.has(id),
        exclusive: offered_items.has(id),
      })),
    ],
  }),
}))
mock.module('../../src/agent_transfer_actions.ts', () => ({
  execute_agent_transfer,
  agent_transfer_actions: (_sdk: unknown, { address }: { address: string }) => ({
    sender: address,
    fits: async (intent: AgentTransferIntent) =>
      scenario !== 'split' ||
      (intent.kind !== 'offer_batch' && intent.kind !== 'claim_batch') ||
      intent.characters.length + intent.items.length <= 1,
    quote: async () => ({ budget_mist: 1000n, cost_mist: 100n, required_mist: 1000n }),
    prepare: async (intent: AgentTransferIntent) => ({
      intent,
      sender: address,
      network: 'mainnet',
      gas_mist: '100',
      gas_budget_mist: '1000',
      confirm: async ({ before_sign }: { before_sign?: () => void } = {}) => {
        before_sign?.()
        calls.push(`${address === agent ? 'agent' : 'owner'}:${intent.kind}`)
        settle_stake(intent)
        if (intent.kind === 'offer_batch' || intent.kind === 'claim_batch')
          batches.push({ kind: intent.kind, characters: intent.characters.length, items: intent.items.length })
        if (intent.kind === 'offer_batch') {
          intent.characters.forEach(({ character_id }) => offered_characters.add(character_id))
          intent.items.forEach(({ item_id }) => offered_items.add(item_id))
          if (scenario === 'uncertain') throw new Error('[sdk] transaction outcome unknown: fixture-digest')
        }
        if (intent.kind === 'claim_batch') {
          intent.characters.forEach(({ character_id }) => offered_characters.delete(character_id))
          intent.items.forEach(({ item_id }) => offered_items.delete(item_id))
          characters = characters.filter((id) => !intent.characters.some(({ character_id }) => character_id === id))
          items = items.filter((id) => !intent.items.some(({ item_id }) => item_id === id))
        }
        return { digest: 'fixture-receipt', receipt: {} }
      },
    }),
  }),
}))
const { return_agent_assets } = await import('../../src/agent_return.ts')
const sdk = {
  pins: {},
  game_type_package: `0x${'3'.repeat(64)}`,
  recover_pending_transaction: async () => false,
  synchronize_transactions: async () => {},
  hydrate: async () => {},
  ref: () => ({ version: '1' }),
  read_kares_balance: async () => (staking ? stake.payout : null),
  execute: async () => {
    calls.push('agent:sweep')
    balance = 0n
    return { Transaction: { digest: 'sweep-receipt' } }
  },
}
const client = {
  core: {
    getBalance: async ({ owner: address }: { owner: string }) => ({
      balance: { balance: String(address === agent ? balance : scenario === 'unfunded' ? 0n : 1_000_000_000n) },
    }),
    getReferenceGasPrice: async () => ({ referenceGasPrice: '1' }),
    simulateTransaction: async () => ({
      Transaction: {
        status: { success: true },
        effects: { gasUsed: { computationCost: '100', storageCost: '0', storageRebate: '0' } },
        balanceChanges: [],
      },
    }),
    waitForTransaction: async () => ({}),
  },
}
const read_projection = async (accept: (value: unknown) => boolean = () => true) => {
  const value = {
    characters: characters.map((id) => ({ id, kiosk: 'kiosk', custody: 'kiosk', equipment: [] })),
    inventory: items.map((id) => ({ id })),
    fights: {},
    resolutions: [],
  }
  if (!accept(value)) throw new Error('Fixture projection did not reconcile')
  return value
}
try {
  await return_agent_assets({
    sdk: sdk as never,
    owner_sdk: sdk as never,
    client: client as never,
    owner,
    agent,
    owner_kiosk_cap: async () => null,
    before_sign: () => {},
    guard: async () => {},
    read_projection: read_projection as never,
  })
  console.log(JSON.stringify({ ok: true, calls, batches, balance: String(balance) }))
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      calls,
      batches,
      balance: String(balance),
      error: error instanceof Error ? error.message : String(error),
    })
  )
}
