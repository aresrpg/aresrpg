// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { decode_gift_request, gift_request_message } from '../src/gift_contract.ts'
import { create_transaction_execution } from '../src/transaction_execution.ts'

const address = `0x${'1'.repeat(64)}`
const giftcard = `0x${'2'.repeat(64)}`
const request = { action: 'redeem', network: 'mainnet', address, time: 1000, proof: { giftcard } } as const

test('sponsorship accepts one explicit campaign operation, never arbitrary transaction bytes', () => {
  expect(decode_gift_request(request)).toEqual(request)
  expect(() => decode_gift_request({ ...request, transaction: 'arbitrary bytes' })).toThrow()
  expect(() => decode_gift_request({ ...request, action: 'create_character' })).toThrow()
  expect(() => decode_gift_request({ ...request, action: ['redeem'] })).toThrow()
  expect(() => decode_gift_request({ ...request, network: ['mainnet'] })).toThrow()
  expect(() => decode_gift_request({ ...request, proof: { giftcard, open: 'not-a-digest' } })).toThrow()
})

test('wallet authorization binds the action, network, account and exact gift proof', () => {
  const original = gift_request_message(request)
  expect(gift_request_message({ ...request, action: 'open' })).not.toEqual(original)
  expect(gift_request_message({ ...request, network: 'testnet' })).not.toEqual(original)
  expect(gift_request_message({ ...request, address: giftcard })).not.toEqual(original)
})

test('a sponsored submission recovers by digest without falling back to player-funded execution', async () => {
  let regular_submissions = 0
  let sponsored_submissions = 0
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
  const lane = create_transaction_execution({
    key: 'gift',
    storage,
    on_receipt: () => {},
    core: {
      executeTransaction: async () => {
        regular_submissions++
        throw new Error('must not spend player SUI')
      },
      waitForTransaction: async ({ digest }) => ({
        Transaction: { digest, effects: { status: { success: true }, changedObjects: [] }, events: [] },
      }),
    },
  })
  const receipt = await lane.submit(new Uint8Array([1, 2, 3]), 'signature', {}, async () => {
    sponsored_submissions++
    throw new Error('Enoki response lost after execution')
  })
  expect(receipt.Transaction?.effects?.status?.success).toBe(true)
  expect(sponsored_submissions).toBe(1)
  expect(regular_submissions).toBe(0)
  expect(values.size).toBe(0)
})

test('sponsored receipts retain their payer across recovery without counting sponsor fees as player spending', async () => {
  const { SDK, sui_transport } = await import('../src/client.ts')
  const { Transaction, TransactionDataBuilder } = await import('@mysten/sui/transactions')
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519')
  const { toBase64 } = await import('@mysten/sui/utils')
  const signer = new Ed25519Keypair()
  const transaction = new Transaction()
  transaction.setSender(signer.toSuiAddress())
  transaction.setGasOwner(giftcard)
  transaction.setGasBudget(10_000_000)
  transaction.setGasPrice(1000)
  transaction.setGasPayment([{ objectId: address, version: '1', digest: '11111111111111111111111111111111' }])
  const raw = await transaction.build()
  const digest = TransactionDataBuilder.getDigestFromBytes(raw)
  const receipt = {
    Transaction: {
      digest,
      objectTypes: {},
      events: [],
      effects: {
        status: { success: true },
        changedObjects: [],
        gasUsed: { computationCost: '1000000', storageCost: '1000000', storageRebate: '0' },
      },
    },
  }
  const core = {
    simulateTransaction: async () => receipt,
    waitForTransaction: async () => receipt,
    executeTransaction: async () => {
      throw new Error('player-paid execution must not be used')
    },
  }
  const sdk = SDK({
    signer,
    network: 'mainnet',
    pins: {},
    client: sui_transport({ core } as never),
    transaction_storage: null,
  })
  let submissions = 0
  await sdk.execute_sponsored(
    async () => ({ bytes: toBase64(raw), digest }),
    async () => {
      submissions++
      throw new Error('lost sponsor response')
    }
  )
  expect(submissions).toBe(1)
  expect(sdk.gas_spent_24h()).toBe(0n)
})

test('only transport intents permit a separate QR sender, and authorization binds it', () => {
  const transfer = { ...request, action: 'transfer', sender: giftcard }
  expect(decode_gift_request(transfer).sender).toBe(giftcard)
  expect(() => decode_gift_request({ ...request, sender: giftcard })).toThrow()
  expect(() => decode_gift_request({ ...transfer, sender: undefined })).toThrow()
  expect(gift_request_message({ ...request, action: 'transfer', sender: giftcard })).not.toEqual(
    gift_request_message({ ...request, action: 'transfer', sender: address })
  )
})
