// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { normalizeStructTag, SUI_TYPE_ARG } from '@mysten/sui/utils'

import {
  blast_purchase_config,
  blast_purchase_actions,
  create_blast_claim_transaction,
  create_blast_purchase_transaction,
  type BlastPurchaseConfig,
} from '../src/blast_purchase.ts'

import captured from './fixtures/blast_presale.mainnet.json' with { type: 'json' }
import { id } from './helpers/transport.ts'

const config: BlastPurchaseConfig = {
  id: id(1),
  package: id(2),
  package_original: id(2),
  package_version: id(3),
  coin_type: `${id(4)}::kares::KARES`,
  url: 'https://www.blast.fun/',
}
const pins = { network: 'mainnet' as const, kares_coin_type: config.coin_type, blast_presale: config }

test('purchase refuses absent pins, non-positive amounts and malformed proof data', () => {
  expect(() => blast_purchase_config({})).toThrow('not configured')
  expect(() => create_blast_purchase_transaction(config, id(5), { method: 'open', amount: 0n })).toThrow('positive')
  expect(() =>
    create_blast_purchase_transaction(config, id(5), {
      method: 'allowlisted',
      amount: 1n,
      proof: { index: '65536', cap_mist: '10', siblings: [] },
    })
  ).toThrow('proof index')
  expect(() =>
    create_blast_purchase_transaction(config, id(5), {
      method: 'allowlisted',
      amount: 1n,
      proof: { index: '0', cap_mist: '10', siblings: ['bad'] },
    })
  ).toThrow('proof siblings')
})

test('all commitment methods preserve the sender, version guard, and returned SUI', () => {
  for (const method of ['open', 'uncapped', 'allowlisted'] as const) {
    const intent =
      method === 'allowlisted'
        ? { method, amount: 125000000000n, proof: { index: '0', cap_mist: '125000000000', siblings: [] } }
        : { method, amount: 125000000000n }
    const tx = create_blast_purchase_transaction(config, id(5), intent)
    const data = tx.getData()
    expect(data.sender).toBe(id(5))
    const call = data.commands.find((command) => command.$kind === 'MoveCall')!.MoveCall!
    expect(call.function).toBe(`commit_${method}`)
    expect(call.typeArguments.map(normalizeStructTag)).toEqual([
      normalizeStructTag(config.coin_type),
      normalizeStructTag(SUI_TYPE_ARG),
    ])
    expect(call.arguments).toHaveLength(method === 'allowlisted' ? 7 : 4)
    expect(data.commands.at(-1)?.$kind).toBe('TransferObjects')
  }
})

test('simulation never executes; purchase uses the common executor exactly once', async () => {
  const sale = {
    ...captured.objects[0],
    objectId: config.id,
    type: normalizeStructTag(`${config.package_original}::blast_presale::Presale<${config.coin_type},${SUI_TYPE_ARG}>`),
    json: { ...captured.objects[0].json, lifecycle: { '@variant': 'Open' }, start_ms: '0', duration_ms: '10000' },
  }
  const client = {
    network: 'mainnet',
    core: {
      getObjects: async () => ({
        objects: [
          sale,
          { objectId: id(6), owner: { $kind: 'Shared' }, type: '0x2::clock::Clock', json: { timestamp_ms: '1' } },
        ],
      }),
      getObject: async () => ({
        object: {
          owner: { $kind: 'Shared' },
          type: `${config.package_original}::blast_presale_package::PackageVersion`,
        },
      }),
    },
  }
  let simulations = 0
  let executions = 0
  const receipt = {
    $kind: 'Transaction',
    Transaction: {
      digest: 'confirmed-digest',
      effects: {
        status: { success: true },
        gasUsed: { computationCost: '10', storageCost: '20', storageRebate: '5', nonRefundableStorageFee: '0' },
      },
    },
  }
  const sdk = {
    pins,
    simulate: async () => {
      simulations++
      return receipt
    },
    execute: async () => {
      executions++
      return receipt
    },
  }
  const actions = blast_purchase_actions({ sdk, client, address: id(5) } as never)
  expect(actions.configured()).toBe(true)
  expect((await actions.simulate({ method: 'open', amount: 10n })).amount_mist).toBe(10n)
  expect(simulations).toBe(1)
  expect(executions).toBe(0)
  await actions.purchase({ method: 'open', amount: 10n })
  expect(executions).toBe(1)
  sale.json.lifecycle = { '@variant': 'Migrated' }
  await expect(actions.purchase({ method: 'open', amount: 10n })).rejects.toThrow('not open')
  expect(executions).toBe(1)
})

test('a claim pays the signer as participant and refuses before the sale ends', async () => {
  const tx = create_blast_claim_transaction(config, id(5))
  const call = tx.getData().commands.find((command) => command.$kind === 'MoveCall')!.MoveCall!
  expect(call.function).toBe('claim')
  expect(call.arguments).toHaveLength(4)
  expect(tx.getData().commands).toHaveLength(1)
  const sale = {
    ...captured.objects[0],
    objectId: config.id,
    type: normalizeStructTag(`${config.package_original}::blast_presale::Presale<${config.coin_type},${SUI_TYPE_ARG}>`),
    json: { ...captured.objects[0].json, lifecycle: { '@variant': 'Open' }, start_ms: '0', duration_ms: '10000' },
  }
  const client = {
    network: 'mainnet',
    core: {
      getObjects: async () => ({
        objects: [
          sale,
          { objectId: id(6), owner: { $kind: 'Shared' }, type: '0x2::clock::Clock', json: { timestamp_ms: '1' } },
        ],
      }),
      getObject: async () => ({
        object: {
          owner: { $kind: 'Shared' },
          type: `${config.package_original}::blast_presale_package::PackageVersion`,
        },
      }),
    },
  }
  let executions = 0
  const sdk = {
    pins,
    execute: async () => {
      executions++
      return { $kind: 'Transaction', Transaction: { digest: 'claim-digest' } }
    },
  }
  const actions = blast_purchase_actions({ sdk, client, address: id(5) } as never)
  await expect(actions.claim()).rejects.toThrow('claims are not open')
  for (const lifecycle of ['Migrated', 'Cancelled']) {
    sale.json.lifecycle = { '@variant': lifecycle }
    expect((await actions.claim()).digest).toBe('claim-digest')
  }
  expect(executions).toBe(2)
})
