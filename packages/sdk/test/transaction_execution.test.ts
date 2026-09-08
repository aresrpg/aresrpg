// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { TransactionDataBuilder, type TransactionPlugin } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { SuiGraphQLClient } from '@mysten/sui/graphql'

import { create_transaction_execution } from '../src/transaction_execution.ts'
import { SDK, sui_transport, type SuiTransport } from '../src/client.ts'

import { execution_receipt } from './helpers/execution_receipt.ts'

const raw = new Uint8Array([1, 2, 3])
const digest = TransactionDataBuilder.getDigestFromBytes(raw)
const receipt = {
  Transaction: { digest, effects: { status: { success: true }, changedObjects: [] }, events: [], objectTypes: {} },
}
const storage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

test('GraphQL remains read-only rather than silently truncating business receipts', async () => {
  let signatures = 0
  const sdk = SDK({
    client: sui_transport(new SuiGraphQLClient({ network: 'testnet', url: 'https://unused.invalid' })),
    address: `0x${'1'.repeat(64)}`,
    pins: {},
    transaction_storage: null,
    sign_transaction: async () => {
      signatures += 1
      return { bytes: raw, signature: 'unused' }
    },
  })
  await expect(sdk.execute(sdk.tx())).rejects.toThrow('writes require a gRPC client')
  expect(signatures).toBe(0)
})

test('SDK recovery feeds the existing object cache and returns the original outcome', async () => {
  const object_id = `0x${'1'.repeat(64)}`
  const resolve: TransactionPlugin = async (data, _options, next) => {
    data.gasData.price = '1000'
    data.gasData.payment = [{ objectId: object_id, version: '1', digest: '11111111111111111111111111111111' }]
    await next()
  }
  let executions = 0
  let expected_digest = ''
  const client = {
    core: {
      resolveTransactionPlugin: () => resolve,
      executeTransaction: async ({ transaction }: { transaction: Uint8Array }) => {
        executions += 1
        expected_digest = TransactionDataBuilder.getDigestFromBytes(transaction)
        throw new Error('lost execution response')
      },
      waitForTransaction: async ({ digest: requested }: { digest: string }) => {
        expect(requested).toBe(expected_digest)
        return {
          Transaction: {
            digest: requested,
            events: [],
            effects: {
              status: { success: true },
              changedObjects: [
                {
                  objectId: object_id,
                  outputVersion: '2',
                  outputDigest: digest,
                  outputState: 'ObjectWrite',
                  outputOwner: { AddressOwner: object_id },
                },
              ],
            },
          },
        }
      },
    },
  } as unknown as SuiTransport
  const sdk = SDK({ client, signer: new Ed25519Keypair(), pins: {}, transaction_storage: null })
  const result = await sdk.execute(sdk.tx())
  expect(result.Transaction?.digest).toBe(expected_digest)
  expect(sdk.ref(object_id)).toMatchObject({ version: '2' })
  expect(executions).toBe(1)
})

test('a lost submission response recovers its exact receipt with one execution', async () => {
  let executions = 0
  const folds: unknown[] = []
  const reads: unknown[] = []
  const lane = create_transaction_execution({
    key: 'testnet:alice',
    storage: storage(),
    core: {
      executeTransaction: async () => {
        executions += 1
        throw new Error('connection lost')
      },
      waitForTransaction: async (input) => {
        reads.push(input)
        return receipt
      },
    },
    on_receipt: (value) => {
      folds.push(value)
    },
  })
  expect(await lane.submit(raw, 'signature', { include: { objectTypes: true } })).toBe(receipt)
  expect(executions).toBe(1)
  expect(folds).toEqual([receipt])
  expect(reads[0]).toMatchObject({ digest, include: { effects: true, events: true, objectTypes: true } })
})

test('an unknown outcome survives executor recreation and blocks another intent', async () => {
  const journal = storage()
  let executions = 0
  let available = false
  const core = {
    executeTransaction: async () => {
      executions += 1
      throw new Error('lost')
    },
    waitForTransaction: async () => {
      if (!available) throw new Error('not found')
      return receipt
    },
  }
  const options = { key: 'testnet:alice', storage: journal, core, on_receipt: () => {} }
  await expect(create_transaction_execution(options).submit(raw, 'signature')).rejects.toThrow('outcome unknown')
  await expect(create_transaction_execution(options).before_next()).rejects.toThrow('outcome unknown')
  available = true
  const restored = create_transaction_execution(options)
  await expect(restored.before_next()).rejects.toThrow('previous transaction recovered')
  await expect(restored.before_next()).rejects.toThrow('previous transaction recovered')
  await create_transaction_execution(options).before_next()
  expect(executions).toBe(1)
})

test('a mismatched recovery receipt never clears the pending digest', async () => {
  const journal = storage()
  const lane = create_transaction_execution({
    key: 'testnet:alice',
    storage: journal,
    core: {
      executeTransaction: async () => {
        throw new Error('lost')
      },
      waitForTransaction: async () => ({ Transaction: { digest: 'wrong' } }),
    },
    on_receipt: () => {},
  })
  await expect(lane.submit(raw, 'signature')).rejects.toThrow('outcome unknown')
  expect(journal.getItem('testnet:alice')).toContain(digest)
})

test('a hanging response is bounded and a late response cannot fold twice', async () => {
  let finish!: (value: typeof receipt) => void
  let executions = 0
  let folds = 0
  const lane = create_transaction_execution({
    key: 'testnet:alice',
    storage: storage(),
    response_timeout_ms: 1,
    core: {
      executeTransaction: () => {
        executions += 1
        return new Promise((resolve) => {
          finish = resolve
        })
      },
      waitForTransaction: async () => receipt,
    },
    on_receipt: () => {
      folds += 1
    },
  })
  expect(await lane.submit(raw, 'signature')).toBe(receipt)
  finish(receipt)
  await Promise.resolve()
  expect({ executions, folds }).toEqual({ executions: 1, folds: 1 })
})

test('storage failure refuses submission and cannot be bypassed by recreating the executor', async () => {
  let executions = 0
  const lane = create_transaction_execution({
    key: 'testnet:alice',
    storage: {
      ...storage(),
      setItem: () => {
        throw new Error('storage unavailable')
      },
    },
    core: {
      executeTransaction: async () => {
        executions += 1
        return receipt
      },
      waitForTransaction: async () => receipt,
    },
    on_receipt: () => {},
  })
  await expect(lane.submit(raw, 'signature')).rejects.toThrow('storage unavailable')
  expect(executions).toBe(0)
})

test('another submission cannot overwrite an uncertain transaction', async () => {
  const journal = storage()
  let executions = 0
  const options = {
    key: 'testnet:alice',
    storage: journal,
    core: {
      executeTransaction: async () => {
        executions += 1
        throw new Error('lost')
      },
      waitForTransaction: async () => {
        throw new Error('unknown')
      },
    },
    on_receipt: () => {},
  }
  await expect(create_transaction_execution(options).submit(raw, 'signature')).rejects.toThrow('outcome unknown')
  await expect(create_transaction_execution(options).submit(new Uint8Array([4]), 'signature')).rejects.toThrow(digest)
  expect(executions).toBe(1)
})

test('recovery invalidates queued intents created without the recovered result', async () => {
  const journal = storage()
  journal.setItem('testnet:alice', JSON.stringify({ digest, phase: 'submitted' }))
  const lane = create_transaction_execution({
    key: 'testnet:alice',
    storage: journal,
    core: { executeTransaction: async () => receipt, waitForTransaction: async () => receipt },
    on_receipt: () => {},
  })
  await expect(lane.before_next()).rejects.toThrow('previous transaction recovered')
  await expect(lane.before_next()).rejects.toThrow('previous transaction recovered')
})

test('recovery rejects partial receipts and preserves the unresolved identity', async () => {
  const journal = storage()
  const lane = create_transaction_execution({
    key: 'testnet:alice',
    storage: journal,
    core: {
      executeTransaction: async () => {
        throw new Error('lost')
      },
      waitForTransaction: async () => ({ Transaction: { digest, effects: { status: { success: true } } } }),
    },
    on_receipt: () => {},
  })
  await expect(lane.submit(raw, 'signature')).rejects.toThrow('outcome unknown')
  expect(journal.getItem('testnet:alice')).toContain(digest)
})

test('direct responses obey the same identity and completeness checks as recovered receipts', async () => {
  let reads = 0
  const lane = create_transaction_execution({
    key: 'testnet:alice',
    storage: storage(),
    core: {
      executeTransaction: async () => ({ Transaction: { digest: 'wrong' } }),
      waitForTransaction: async () => {
        reads += 1
        return receipt
      },
    },
    on_receipt: () => {},
  })
  expect(await lane.submit(raw, 'signature')).toBe(receipt)
  expect(reads).toBe(1)
})

test('queued stale inputs are refused before signing after recovery, just as after an ordinary receipt', async () => {
  const object_id = `0x${'1'.repeat(64)}`
  let signatures = 0
  let executions = 0
  let recovered = false
  let submitted: Uint8Array = raw
  const resolve: TransactionPlugin = async (data, _options, next) => {
    if (recovered && data.inputs.some((input) => input.Object?.ImmOrOwnedObject?.version === '1'))
      throw new Error('provided version does not match, provided: 1 actual: 0x2')
    data.gasData.price = '1000'
    data.gasData.payment = [{ objectId: object_id, version: '1', digest: '11111111111111111111111111111111' }]
    await next()
  }
  const client = {
    core: {
      resolveTransactionPlugin: () => resolve,
      executeTransaction: async ({ transaction }: { transaction: Uint8Array }) => {
        executions += 1
        submitted = transaction
        throw new Error('response lost')
      },
      waitForTransaction: async () => {
        recovered = true
        return execution_receipt(submitted)
      },
    },
  } as unknown as SuiTransport
  const signer = new Ed25519Keypair()
  const sdk = SDK({
    client,
    pins: {},
    address: signer.toSuiAddress(),
    transaction_storage: null,
    sign_transaction: async (transaction) => {
      signatures += 1
      return transaction.sign({ signer })
    },
  })
  const stale = sdk.tx()
  stale.objectRef({ objectId: object_id, version: '1', digest: '11111111111111111111111111111111' })
  const first = sdk.execute(sdk.tx())
  const second = sdk.execute(stale)
  await Promise.all([first, expect(second).rejects.toThrow('NOT submitted')])
  expect({ signatures, executions }).toEqual({ signatures: 1, executions: 1 })
})
