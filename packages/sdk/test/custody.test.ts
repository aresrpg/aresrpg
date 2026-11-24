// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Custody between a player and their agent: offers are trusted only from their creation receipt, a
// character and its gear move together, an executed offer is never repeated, and only the paired
// multisig member may sign the exact reviewed bytes.

import { expect, test } from 'bun:test'
import type { KioskOwnerCap } from '@mysten/kiosk'
import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, normalizeStructTag } from '@mysten/sui/utils'

import { compose_agent_batch } from '../src/agent_batch.ts'
import { agent_batch_fits, submit_agent_batches, type AgentBatchLimits } from '../src/agent_batch_limits.ts'
import { AgentHandoverIncomplete, complete_agent_handover, type AgentHandoverIntent } from '../src/agent_handover.ts'
import { AgentReturnFundingRequired, quote_return_transaction, return_funding } from '../src/agent_return_funding.ts'
import {
  check_agent_return,
  decode_agent_purchase_cap,
  decode_return_equipment,
  read_agent_item_returns,
  read_agent_returns,
} from '../src/agent_returns.ts'
import {
  agent_transfer_actions,
  type AgentTransferActions,
  type AgentTransferIntent,
} from '../src/agent_transfer_actions.ts'
import { SDK } from '../src/client.ts'
import { pre_submission_failure } from '../src/transaction_error.ts'

import { digest, fake_client, id, pins, sample_gas } from './helpers/transport.ts'

// Real mainnet object 0xb134...9d43, version 780663637, captured 2026-11-05 via
// https://graphql.mainnet.sui.io/graphql objects(filter:{type:"0x2::kiosk::PurchaseCap"}).
// Generic T was slush_wallet_og_badge::Nft; PurchaseCap's fields do not depend on phantom T.
const captured_cap = fromBase64(
  'sTRjgw4y3MUkcH7ahKA9kReV5/L7KDMPA/cSGvepnUOHQZnxcjRktncZemVaBru4oBamuGR4vGoBDYaPcARAConqXAfP0LAPGhy2D+Kxzq9LNBih4EflDX2Gthcfq4wQAOQLVAIAAAA='
)
// Real mainnet ItemUnequipped, tx EFeRtwp5gEnutcAZmzmySPdLVcXDjY8nTJpkACnam4ht,
// captured 2026-11-05 via https://graphql.mainnet.sui.io/graphql (package pins.package_original).
const captured_unequip = fromBase64(
  'N/1GK340kl2GRxibVneQhzWqfF26Auj8HQz95aDY9twEdG9vbEgFPVxg9M22isVmK/eFwBW8jsVIgitHh7Au0SnYKrG0'
)
const cap_id = '0xb13463830e32dcc524707eda84a03d911795e7f2fb28330f03f7121af7a99d43'
const kiosk_id = '0x874199f1723464b677197a655a06bbb8a016a6b86478bc6a010d868f7004400a'
const owner = `0x${'1'.repeat(64)}`
const agent = `0x${'2'.repeat(64)}`
const game = `0x${'3'.repeat(64)}`
const cap_layout = bcs.struct('PurchaseCap', {
  id: bcs.Address,
  kiosk_id: bcs.Address,
  item_id: bcs.Address,
  min_price: bcs.u64(),
})
const cap_type = (kind: 'character::Character' | 'item::Item') =>
  normalizeStructTag(`0x2::kiosk::PurchaseCap<${game}::${kind}>`)
const agent_kiosks = {
  game_type_package: game,
  get_owned_kiosks: async (_address: string, pagination?: { cursor?: string }) =>
    pagination?.cursor
      ? { kioskOwnerCaps: [{ isPersonal: true, kioskId: kiosk_id }], hasNextPage: false, nextCursor: null }
      : { kioskOwnerCaps: [], hasNextPage: true, nextCursor: 'second' },
}
const equipped = decode_return_equipment(captured_unequip)
const offer_chain = () => {
  const cap = (object_id: string, kind: 'character::Character' | 'item::Item', item_id: string) => ({
    objectId: object_id,
    type: cap_type(kind),
    version: '7',
    digest: 'object-digest',
    previousTransaction: 'offer-tx',
    owner: { $kind: 'AddressOwner', AddressOwner: owner },
    content: cap_layout.serialize({ id: object_id, kiosk_id, item_id, min_price: 0 }).toBytes(),
  })
  const character = cap(cap_id, 'character::Character', equipped.character)
  const gear = cap(agent, 'item::Item', equipped.item)
  const loose = { ...cap(game, 'item::Item', owner), previousTransaction: 'independent-offer' }
  const event = { eventType: `${game}::equipment::ItemUnequipped`, bcs: captured_unequip }
  const receipt = (digest_value: string, rows: (typeof character)[], events: unknown[] = []) => ({
    $kind: 'Transaction',
    Transaction: {
      digest: digest_value,
      status: { success: true },
      transaction: { sender: agent },
      events,
      effects: {
        changedObjects: rows.map((row) => ({
          objectId: row.objectId,
          idOperation: 'Created',
          outputVersion: row.version,
          outputDigest: row.digest,
          outputOwner: row.owner,
        })),
      },
    },
  })
  const state = { rows: [character, gear, loose], offer: receipt('offer-tx', [character, gear], [event]) }
  const client = {
    core: {
      listOwnedObjects: async ({ type }: { type: string }) => ({
        objects: state.rows.filter((row) => row.type === type),
        hasNextPage: false,
      }),
      getTransaction: async ({ digest: requested }: { digest: string }) =>
        requested === 'offer-tx'
          ? state.offer
          : receipt(
              requested,
              state.rows.filter((row) => row.previousTransaction === requested)
            ),
    },
  }
  return { state, client, gear, event }
}

test('a return offer is trusted only from its unchanged creation receipt, with exact gear association', async () => {
  expect(decode_agent_purchase_cap(captured_cap)).toEqual({
    id: cap_id,
    kiosk_id,
    item_id: '0x89ea5c07cfd0b00f1a1cb60fe2b1ceaf4b3418a1e047e50d7d86b6171fab8c10',
    min_price: '10000000000',
  })
  expect(equipped).toEqual({
    character: '0x37fd462b7e34925d8647189b5677908735aa7c5dba02e8fc1d0cfde5a0d8f6dc',
    slot: 'tool',
    item: '0x48053d5c60f4cdb68ac5662bf785c015bc8ec548822b4787b02ed129d82ab1b4',
  })
  expect(() => decode_agent_purchase_cap(captured_cap.slice(0, 10))).toThrow()
  const f = offer_chain()
  const offers = await read_agent_returns(f.client as never, agent_kiosks as never, owner, agent)
  expect(offers).toEqual([
    {
      purchase_cap: cap_id,
      character_id: equipped.character,
      seller_kiosk: kiosk_id,
      recipient: owner,
      agent_address: agent,
      equipment: [{ slot: 'tool', item_id: equipped.item, purchase_cap: agent }],
    },
  ])
  expect(
    (await read_agent_item_returns(f.client as never, agent_kiosks as never, owner, agent)).map(
      ({ purchase_cap }) => purchase_cap
    )
  ).toEqual([game])
  await check_agent_return(f.client as never, agent_kiosks as never, owner, offers[0]!)
  const foreign_kiosk = { ...agent_kiosks, get_owned_kiosks: async () => ({ kioskOwnerCaps: [], hasNextPage: false }) }
  expect(await read_agent_returns(f.client as never, foreign_kiosk as never, owner, agent)).toEqual([])
  const paid = offer_chain()
  paid.state.rows[0] = { ...paid.state.rows[0]!, content: captured_cap }
  expect(await read_agent_returns(paid.client as never, agent_kiosks as never, owner, agent)).toEqual([])
  const tampered = [
    (g: ReturnType<typeof offer_chain>) => void (g.state.rows = [g.state.rows[0]!]),
    (g: ReturnType<typeof offer_chain>) => void (g.state.rows = [...g.state.rows, g.gear]),
    (g: ReturnType<typeof offer_chain>) => void (g.gear.previousTransaction = 'different'),
    (g: ReturnType<typeof offer_chain>) => void (g.gear.version = '8'),
    (g: ReturnType<typeof offer_chain>) => void (g.state.offer.Transaction.transaction.sender = owner),
    (g: ReturnType<typeof offer_chain>) => void (g.state.offer.Transaction.events = [g.event, g.event]),
    (g: ReturnType<typeof offer_chain>) =>
      void (g.state.rows[0] = { ...g.state.rows[0]!, owner: { $kind: 'AddressOwner', AddressOwner: agent } }),
  ]
  for (const tamper of tampered) {
    const g = offer_chain()
    tamper(g)
    await expect(read_agent_returns(g.client as never, agent_kiosks as never, owner, agent)).rejects.toThrow()
  }
  f.state.rows = f.state.rows.filter(({ objectId }) => objectId !== agent)
  await expect(check_agent_return(f.client as never, agent_kiosks as never, owner, offers[0]!)).rejects.toThrow(
    'missing'
  )
})

const limits: AgentBatchLimits = {
  commands: 1024,
  objects: 2048,
  bytes: 131072,
  arguments: 512,
  pure_bytes: 16384,
  gas_objects: 256,
}
const personal = (kiosk = id(6)): KioskOwnerCap => ({
  objectId: id(5),
  kioskId: kiosk,
  isPersonal: true,
  version: '1',
  digest,
})

test('batches keep a character with its gear, offer before claim, and never resubmit a failed batch', async () => {
  const sdk = SDK({
    client: fake_client(),
    address: id(9),
    pins: { ...pins, kiosk_package: id(20), package_original: id(1) },
    transaction_storage: null,
  })
  for (const object_id of [id(111), id(112)])
    sdk.cache.owned.set(object_id, { objectId: object_id, version: '1', digest })
  const context = {
    address: id(9),
    client: {} as never,
    limits,
    kiosk_cap: async () => personal(),
    recipient: () => id(10),
    check_offer: async () => {},
    check_return: async () => {},
  }
  const offer = await compose_agent_batch(sdk, context, {
    kind: 'offer_batch',
    recipient: id(10),
    characters: [11, 12].map((n) => ({
      character_id: id(n),
      kiosk: id(6),
      unequip: [{ slot: 'weapon', item_id: id(n + 100) }],
    })),
    items: [],
  })
  const offered = offer.getData().commands.flatMap(({ MoveCall }) => (MoveCall ? [MoveCall.function] : []))
  expect([
    offered.filter((name) => name === 'list_with_purchase_cap').length,
    offered.filter((name) => name === 'unequip_item').length,
  ]).toEqual([4, 2])
  expect(offered.indexOf('unequip_item')).toBeLessThan(offered.indexOf('list_with_purchase_cap'))
  expect(
    offer.getData().inputs.flatMap(({ Object }) => (Object?.Receiving ? [Object.Receiving.objectId] : []))
  ).toEqual([id(111), id(112)])
  const claim = await compose_agent_batch(
    sdk,
    { ...context, address: id(10), kiosk_cap: async () => null },
    {
      kind: 'claim_batch',
      agent_address: id(9),
      characters: [11, 12].map((n) => ({
        character_id: id(n),
        seller_kiosk: id(6),
        purchase_cap: id(n + 60),
        recipient: id(10),
        agent_address: id(9),
        equipment: [{ slot: 'weapon', item_id: id(n + 100), purchase_cap: id(n + 70) }],
      })),
      items: [],
    }
  )
  const claimed = claim
    .getData()
    .commands.flatMap(({ MoveCall }) => (MoveCall ? [`${MoveCall.module}::${MoveCall.function}`] : []))
  expect([
    claimed.filter((name) => name === 'kiosk::purchase_with_cap').length,
    claimed.filter((name) => name === 'api::equip_item').length,
    claimed.filter((name) => name === 'kiosk::new').length,
  ]).toEqual([4, 2, 1])
  expect(claimed.indexOf('api::equip_item')).toBeGreaterThan(claimed.indexOf('transfer_policy::confirm_request'))
  await expect(
    compose_agent_batch(sdk, context, {
      kind: 'claim_batch',
      agent_address: id(8),
      characters: [],
      items: [{ item_id: id(1), seller_kiosk: id(6), purchase_cap: id(2), recipient: id(10), agent_address: id(9) }],
    })
  ).rejects.toThrow('sender or recipient changed')

  const sent: number[][] = []
  await submit_agent_batches(
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    async (rows) => rows.length <= 4,
    async (rows) => void sent.push([...rows])
  )
  expect(sent).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]])
  sent.length = 0
  const failure = submit_agent_batches(
    [1, 2, 3, 4, 5],
    async (rows) => rows.length <= 2,
    async (rows) => {
      sent.push([...rows])
      if (sent.length === 2) throw new Error('outcome unknown')
    }
  )
  await expect(failure).rejects.toThrow('outcome unknown')
  expect(sent).toEqual([
    [1, 2],
    [3, 4],
  ])
  await expect(
    submit_agent_batches(
      [1],
      async () => false,
      async () => void sent.push([1])
    )
  ).rejects.toThrow('One asset')
  const tx = new Transaction()
  tx.moveCall({ target: '0x2::fixture::first' })
  tx.moveCall({ target: '0x2::fixture::second' })
  expect(await agent_batch_fits({} as never, tx, { ...limits, gas_objects: 1, commands: 2 })).toBe(false)
  expect(await agent_batch_fits({} as never, tx, { ...limits, gas_objects: 1, commands: 3 })).toBe(true)
})

const handover = (intent: AgentHandoverIntent) => {
  const calls: AgentTransferIntent[] = []
  const state = { offered: false, failure: null as 'offer' | 'claim' | null, current: true }
  const actions = (sender: string): AgentTransferActions => ({
    sender,
    synchronize: async () => {},
    fits: async () => true,
    quote: async () => ({ budget_mist: 2n, cost_mist: 1n, required_mist: 2n }),
    prepare: async (input) => ({
      intent: input,
      sender,
      network: 'mainnet',
      gas_mist: '1',
      gas_budget_mist: '1',
      confirm: async ({ before_sign } = {}) => {
        before_sign?.()
        calls.push(input)
        if ((sender === 'owner' ? 'offer' : 'claim') === state.failure) throw new Error('Uncertain submission')
        if (sender === 'owner') state.offered = true
        return { digest: `${sender}-receipt`, receipt: {} as never }
      },
    }),
  })
  const options = {
    offer: actions('owner'),
    claim: actions('agent'),
    intent,
    read: {
      characters: async () =>
        state.offered
          ? [
              {
                character_id: 'character',
                seller_kiosk: 'source',
                purchase_cap: 'character-cap',
                recipient: 'agent',
                agent_address: 'owner',
                equipment: [{ slot: 'weapon', item_id: 'sword', purchase_cap: 'sword-cap' }],
              },
            ]
          : [],
      items: async () =>
        state.offered
          ? [
              {
                item_id: 'wheat',
                seller_kiosk: 'source',
                purchase_cap: 'wheat-cap',
                recipient: 'agent',
                agent_address: 'owner',
              },
            ]
          : [],
    },
    before_sign: () => {
      if (!state.current) throw new Error('Owner changed')
    },
  }
  return { options, calls, state, kinds: () => calls.map(({ kind }) => kind) }
}
const character_offer = {
  kind: 'offer' as const,
  character_id: 'character',
  kiosk: 'source',
  recipient: 'agent',
  unequip: [{ slot: 'weapon', item_id: 'sword' }],
}

test('an executed offer is never repeated: a failed claim keeps its digest and a rerun claims the existing caps', async () => {
  const uncertain = handover(character_offer)
  uncertain.state.failure = 'offer'
  await expect(complete_agent_handover(uncertain.options)).rejects.toThrow('Uncertain submission')
  expect(uncertain.kinds()).toEqual(['offer'])
  const failed = handover(character_offer)
  failed.state.failure = 'claim'
  const error = await complete_agent_handover(failed.options).catch((failure: unknown) => failure)
  expect([
    error instanceof AgentHandoverIncomplete,
    pre_submission_failure(error),
    (error as AgentHandoverIncomplete).offer_digest,
  ]).toEqual([true, false, 'owner-receipt'])
  failed.state.failure = null
  await complete_agent_handover(failed.options)
  expect(failed.kinds()).toEqual(['offer', 'claim', 'claim'])
  expect(failed.calls.at(-1)).toMatchObject({
    kind: 'claim',
    purchase_cap: 'character-cap',
    equipment: [{ slot: 'weapon', item_id: 'sword', purchase_cap: 'sword-cap' }],
  })
  const replaced = handover(character_offer)
  const stopped = await complete_agent_handover({
    ...replaced.options,
    on_offer: () => void (replaced.state.current = false),
  }).catch((failure: unknown) => failure)
  expect([(stopped as AgentHandoverIncomplete).offer_digest, replaced.kinds()]).toEqual(['owner-receipt', ['offer']])
  const observer = handover(character_offer)
  const projection = await complete_agent_handover({
    ...observer.options,
    on_offer: () => {
      throw new Error('[sdk] transaction resolution failed — NOT submitted: observer')
    },
  }).catch((failure: unknown) => failure)
  expect([projection instanceof AgentHandoverIncomplete, pre_submission_failure(projection)]).toEqual([true, false])
  const changed = handover(character_offer)
  changed.state.current = false
  await expect(complete_agent_handover(changed.options)).rejects.toThrow('Owner changed')
  expect(changed.calls).toEqual([])
  const items = {
    kind: 'asset_offer' as const,
    items: [{ item_id: 'wheat', kiosk: 'source', version: '1' }],
    recipient: 'agent',
    sui_mist: '0',
    kares_mist: '0',
    reserve_mist: '1',
  }
  const drop = handover(items)
  await complete_agent_handover(drop.options)
  expect(drop.kinds()).toEqual(['asset_offer', 'asset_claim'])
  const partial = handover({ ...items, items: [...items.items, { item_id: 'ore', kiosk: 'source', version: '1' }] })
  partial.state.offered = true
  await expect(complete_agent_handover(partial.options)).rejects.toThrow('does not match')
  expect(partial.calls).toEqual([])
})

test('return funding quotes policy spending and moves only the quoted shortfall through the ordinary signer', async () => {
  const simulated = (sender: string, debit: bigint) => ({
    $kind: 'Transaction' as const,
    Transaction: {
      status: { success: true },
      effects: { status: { success: true }, gasUsed: { computationCost: '100', storageCost: '0', storageRebate: '0' } },
      balanceChanges: [{ address: sender, coinType: '0x2::sui::SUI', amount: String(-debit) }],
    },
  })
  const quoted = new Transaction()
  quoted.setSender(owner)
  const quote_client = {
    core: {
      getReferenceGasPrice: async () => ({ referenceGasPrice: '1' }),
      simulateTransaction: async () => simulated(owner, 600n),
    },
  }
  expect(await quote_return_transaction(quote_client as never, owner, quoted)).toEqual({
    budget_mist: 1100n,
    cost_mist: 600n,
    required_mist: 1600n,
  })
  expect(quoted.getData().gasData.payment).toBeNull()
  const funding = (owner_balance: bigint, agent_balance: bigint) => {
    const submitted: Transaction[] = []
    const client = {
      core: {
        getBalance: async ({ owner: address }: { owner: string }) => ({
          balance: { balance: String(address === owner ? owner_balance : agent_balance) },
        }),
        getReferenceGasPrice: async () => ({ referenceGasPrice: '1' }),
        simulateTransaction: async ({ transaction }: { transaction: Transaction }) => {
          const input = transaction.getData().inputs.find(({ Pure }) => Pure && fromBase64(Pure.bytes).length === 8)!
          return simulated(transaction.getData().sender!, BigInt(bcs.u64().parse(fromBase64(input.Pure!.bytes))) + 100n)
        },
        waitForTransaction: async () => ({}),
      },
    }
    const signer_sdk = {
      execute: async (transaction: Transaction, options: { before_sign: () => void }) => {
        options.before_sign()
        submitted.push(transaction)
        return { Transaction: { digest: 'funding-receipt' } }
      },
    }
    const flow = return_funding({
      client: client as never,
      sdk: signer_sdk as never,
      owner_sdk: signer_sdk as never,
      owner,
      agent,
      before_sign: () => {},
      guard: async () => {},
    })
    const amounts = () =>
      submitted.map((tx) => [
        tx.getData().sender,
        ...tx
          .getData()
          .inputs.flatMap(({ Pure }) =>
            Pure && fromBase64(Pure.bytes).length === 8 ? [bcs.u64().parse(fromBase64(Pure.bytes))] : []
          ),
      ])
    return { flow, amounts }
  }
  const quote = { budget_mist: 1000n, cost_mist: 100n, required_mist: 1000n }
  const funded = funding(2000n, 1000n)
  await funded.flow.ensure(agent, quote)
  expect(funded.amounts()).toEqual([])
  const short = funding(2000n, 200n)
  await short.flow.ensure(agent, quote)
  expect(short.amounts()).toEqual([[owner, '800']])
  const both_short = funding(900n, 200n)
  const failure = await both_short.flow.ensure(agent, quote).catch((error: unknown) => error)
  expect([
    failure instanceof AgentReturnFundingRequired,
    (failure as AgentReturnFundingRequired).cost_mist,
    both_short.amounts(),
  ]).toEqual([true, 1900n, []])
  const owner_short = funding(0n, 3000n)
  await owner_short.flow.ensure(owner, quote)
  expect(owner_short.amounts()).toEqual([[agent, '1000']])
  await expect(funding(0n, 2000n).flow.ensure(owner, quote)).rejects.toBeInstanceOf(AgentReturnFundingRequired)
})

test('a reviewed transfer is simulated before signing and its confirmation is consumed before submission', async () => {
  const wallet = new Ed25519Keypair()
  const address = wallet.toSuiAddress()
  const offer = { kind: 'offer' as const, character_id: id(40), kiosk: id(6), recipient: id(10), unequip: [] }
  const reviewing = (client: ReturnType<typeof fake_client>, checks: string[]) => {
    const sdk = SDK({
      client,
      signer: wallet,
      pins: { ...pins, kiosk_package: id(20), package_original: id(1) },
      transaction_storage: null,
    })
    return agent_transfer_actions(sdk, {
      address,
      kiosk_cap: async () => personal(),
      check_offer: async () => void checks.push('offer'),
    })
  }
  const checks: string[] = []
  const client = fake_client({ gas_used: sample_gas })
  const actions = reviewing(client, checks)
  const review = await actions.prepare(offer)
  expect([review.sender, review.gas_mist, client.calls.executions, Object.isFrozen(review.intent)]).toEqual([
    address,
    '2500000',
    0,
    true,
  ])
  const { digest: confirmed } = await review.confirm()
  expect([confirmed, client.calls.executions, checks]).toEqual([client.calls.digests[0], 1, ['offer', 'offer']])
  const offered = Transaction.from(client.calls.submitted[0]!).getData()
  expect(offered.commands.filter(({ MoveCall }) => MoveCall?.function === 'list_with_purchase_cap')).toHaveLength(1)
  await expect(review.confirm()).rejects.toThrow('already submitted')
  expect(client.calls.executions).toBe(1)
  await expect(actions.prepare({ ...offer, recipient: address })).rejects.toThrow('different recipient')
  const refused = fake_client({ simulate_ok: false })
  await expect(reviewing(refused, []).prepare(offer)).rejects.toThrow()
  expect(refused.calls.executions).toBe(0)
})
