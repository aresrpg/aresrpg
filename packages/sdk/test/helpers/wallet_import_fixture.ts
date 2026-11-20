// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Isolated process: mock chain reads and execution, retain the real import sequence, batching and resume.
/* eslint-disable functional/no-let, fp-law/no-mutating-methods -- This isolated subprocess owns mutable fake chain state and execution logs. */
import { mock } from 'bun:test'

import type { AgentTransferIntent } from '../../src/agent_transfer_actions.ts'
import { execute_agent_transfer } from '../../src/agent_transfer_actions.ts'
import { same_agent_equipment } from '../../src/agent_equipment.ts'
import * as batch_limits from '../../src/agent_batch_limits.ts'

const [, , scenario] = process.argv
const owner = `0x${'1'.repeat(64)}`,
  source = scenario === 'same_wallet' ? owner : `0x${'2'.repeat(64)}`
const calls: string[] = []
const progress: { signer: string; moved: number; total: number }[] = []
const claim_kiosks: (string | null)[] = []
let characters = ['character-a', 'character-b']
let items = ['item-a', 'item-b', 'item-c']
const offered_characters = new Set(scenario === 'resume' ? ['character-a'] : [])
const offered_items = new Set<string>()
const on_sale = new Set(scenario === 'listed' ? ['item-c'] : [])
const equipment = (id: string) => [{ slot: 'weapon', item_id: `sword-${id}` }]
const character_offer = (id: string) => ({
  character_id: id,
  seller_kiosk: 'kiosk',
  purchase_cap: `${id}-cap`,
  recipient: owner,
  agent_address: source,
  equipment: [{ ...equipment(id)[0]!, purchase_cap: `sword-${id}-cap` }],
})
const item_offer = (id: string) => ({
  item_id: id,
  seller_kiosk: 'kiosk',
  purchase_cap: `${id}-cap`,
  recipient: owner,
  agent_address: source,
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
  read_agent_returns: async () => [...offered_characters].map(character_offer),
  read_agent_item_returns: async () => [...offered_items].map(item_offer),
  check_agent_return: async () => {},
}))
mock.module('../../src/agent_inventory.ts', () => ({
  read_agent_recovery_assets: async () => ({
    items: [],
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
        listed: offered_items.has(id) || on_sale.has(id),
        exclusive: offered_items.has(id),
      })),
    ],
  }),
}))
const kiosk_id = async (load: () => Promise<{ objectId: string } | null>) => (await load())?.objectId ?? null
mock.module('../../src/agent_transfer_actions.ts', () => ({
  execute_agent_transfer,
  agent_transfer_actions: (
    _sdk: unknown,
    { address, kiosk_cap }: { address: string; kiosk_cap: () => Promise<{ objectId: string } | null> }
  ) => ({
    sender: address,
    fits: async (intent: AgentTransferIntent) =>
      scenario !== 'split' ||
      (intent.kind !== 'offer_batch' && intent.kind !== 'claim_batch') ||
      intent.characters.length + intent.items.length <= 2,
    quote: async () => ({ budget_mist: 1000n, cost_mist: 100n, required_mist: 1000n }),
    prepare: async (intent: AgentTransferIntent) => ({
      intent,
      sender: address,
      network: 'mainnet',
      gas_mist: '100',
      gas_budget_mist: '1000',
      confirm: async ({ before_sign }: { before_sign?: () => void } = {}) => {
        before_sign?.()
        calls.push(`${address === owner ? 'owner' : 'source'}:${intent.kind}`)
        if (intent.kind === 'offer_batch') {
          intent.characters.forEach(({ character_id }) => offered_characters.add(character_id))
          intent.items.forEach(({ item_id }) => offered_items.add(item_id))
        }
        if (intent.kind === 'claim_batch') {
          claim_kiosks.push(await kiosk_id(kiosk_cap))
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
const { import_wallet_assets, WalletImportFundingRequired } = await import('../../src/wallet_import.ts')
const { AgentHandoverIncomplete } = await import('../../src/agent_handover.ts')
const sdk = {
  pins: {},
  game_type_package: `0x${'3'.repeat(64)}`,
  synchronize_transactions: async () => {},
  recover_pending_transaction: async () => scenario === 'recovered',
  hydrate: async () => {},
  ref: () => ({ version: '1' }),
}
const funded = (address: string) =>
  !(scenario === 'owner_unfunded' && address === owner) && !(scenario === 'source_unfunded' && address === source)
const client = {
  core: {
    getBalance: async ({ owner: address }: { owner: string }) => ({
      balance: { balance: funded(address) ? '1000000000' : '0' },
    }),
  },
}
const report = (result: Readonly<Record<string, unknown>>) =>
  console.log(JSON.stringify({ ...result, calls, progress, claim_kiosks, remaining: { characters, items } }))
try {
  const plan = await import_wallet_assets(
    {
      client: client as never,
      source_sdk: sdk as never,
      source,
      owner_sdk: sdk as never,
      owner,
      owner_kiosk_cap: async () => ({ objectId: '0xsession' }) as never,
    },
    {
      character_slots: scenario === 'roster' ? 1 : 6,
      before_sign: () => {},
      on_progress: (step) => progress.push(step),
    }
  )
  report({ ok: true, assets: plan.assets, royalty_mist: String(plan.royalty_mist), left: plan.left })
} catch (error) {
  // A failure after a confirmed offer arrives wrapped; callers read the cause, as the bot return does.
  const cause = error instanceof AgentHandoverIncomplete ? error.cause : error
  report({
    ok: false,
    error: cause instanceof Error ? cause.message : String(cause),
    payer: cause instanceof WalletImportFundingRequired ? cause.payer : null,
    after_offer: error instanceof AgentHandoverIncomplete,
  })
}
