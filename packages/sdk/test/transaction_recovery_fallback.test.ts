// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { TransactionDataBuilder } from '@mysten/sui/transactions'

import { create_transaction_execution, type TransactionStorage } from '../src/transaction_execution.ts'
import { transaction_error_outcome } from '../src/transaction_error.ts'
import type { Receipt } from '../src/cache.ts'

const raw = new Uint8Array([1, 2, 3])
const digest = TransactionDataBuilder.getDigestFromBytes(raw)
const receipt: Receipt = {
  Transaction: { digest, effects: { status: { success: true }, changedObjects: [] }, events: [], objectTypes: {} },
}
const storage = (): TransactionStorage => {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  }
}

test('a second receipt reader recovers the exact digest and required fields without resubmitting', async () => {
  let executions = 0
  let folds = 0
  const reads: unknown[] = []
  const journal = storage()
  const lane = create_transaction_execution({
    key: 'testnet:alice',
    storage: journal,
    core: {
      executeTransaction: async () => {
        executions += 1
        throw new Error('response unavailable')
      },
      waitForTransaction: async () => {
        throw new Error('primary unavailable')
      },
    },
    recovery_cores: [
      {
        waitForTransaction: async (input) => {
          reads.push(input)
          return receipt
        },
      },
    ],
    on_receipt: () => {
      folds += 1
    },
  })
  expect(await lane.submit(raw, 'signature', { include: { objectTypes: true } })).toBe(receipt)
  expect(reads).toHaveLength(1)
  expect(reads[0]).toMatchObject({ digest, include: { effects: true, events: true, objectTypes: true } })
  expect({ executions, folds }).toEqual({ executions: 1, folds: 1 })
  expect(journal.getItem('testnet:alice')).toBeNull()
  // The next write's visibility barrier belongs to the resolver's primary, never a fallback.
  await expect(lane.before_next()).rejects.toThrow('is not yet visible')
  expect(reads).toHaveLength(1)
})

test('wrong or incomplete fallback receipts retain uncertainty across reload and never permit another submit', async () => {
  const invalid: Receipt[] = [
    { Transaction: { digest: 'another-transaction' } },
    { Transaction: { digest, effects: { status: { success: true } } } },
    { Transaction: { digest, effects: { status: { success: true }, changedObjects: [] }, events: [] } },
  ]
  for (const result of invalid) {
    let executions = 0
    let folds = 0
    const journal = storage()
    const options = {
      key: 'testnet:alice',
      storage: journal,
      core: {
        executeTransaction: async () => {
          executions += 1
          throw new Error('lost response')
        },
        waitForTransaction: async () => {
          throw new Error('not found')
        },
      },
      recovery_cores: [{ waitForTransaction: async () => result }],
      on_receipt: () => {
        folds += 1
      },
    }
    await expect(
      create_transaction_execution(options).submit(raw, 'signature', { include: { objectTypes: true } })
    ).rejects.toThrow('outcome unknown')
    expect(journal.getItem('testnet:alice')).toContain(digest)
    const restored = create_transaction_execution(options)
    await expect(restored.before_next()).rejects.toThrow('outcome unknown')
    await expect(restored.submit(new Uint8Array([4]), 'signature')).rejects.toThrow(digest)
    expect({ executions, folds }).toEqual({ executions: 1, folds: 0 })
  }
})

test('an incomplete primary receipt falls through to a complete secondary receipt', async () => {
  const lane = create_transaction_execution({
    key: 'testnet:alice',
    storage: null,
    core: {
      executeTransaction: async () => ({ Transaction: { digest } }),
      waitForTransaction: async () => ({ Transaction: { digest } }),
    },
    recovery_cores: [{ waitForTransaction: async () => receipt }],
    on_receipt: () => {},
  })
  expect(await lane.submit(raw, 'signature')).toBe(receipt)
})

test('a hanging primary reader cannot consume the fallback recovery deadline', async () => {
  let primary_signal: AbortSignal | undefined
  let reads = 0
  const lane = create_transaction_execution({
    key: 'testnet:alice',
    storage: null,
    recovery_timeout_ms: 20,
    core: {
      executeTransaction: async () => {
        throw new Error('lost response')
      },
      waitForTransaction: ({ signal }) => {
        primary_signal = signal
        return new Promise(() => {})
      },
    },
    recovery_cores: [
      {
        waitForTransaction: async () => {
          reads += 1
          return receipt
        },
      },
    ],
    on_receipt: () => {},
  })
  expect(await lane.submit(raw, 'signature')).toBe(receipt)
  expect(primary_signal?.aborted).toBe(true)
  expect(reads).toBe(1)
})

test('a late certified failure is folded once and invalidates existing and queued intents', async () => {
  const journal = storage()
  journal.setItem(
    'testnet:alice',
    JSON.stringify({ digest, phase: 'submitted', include: { effects: true, events: true } })
  )
  let executions = 0
  let folds = 0
  const failed: Receipt = {
    FailedTransaction: { digest, effects: { status: { success: false }, changedObjects: [] }, events: [] },
  }
  const lane = create_transaction_execution({
    key: 'testnet:alice',
    storage: journal,
    core: {
      executeTransaction: async () => {
        executions += 1
        return receipt
      },
      waitForTransaction: async () => {
        throw new Error('primary unavailable')
      },
    },
    recovery_cores: [{ waitForTransaction: async () => failed }],
    on_receipt: (result) => {
      expect(result).toBe(failed)
      folds += 1
    },
  })
  await expect(lane.before_next()).rejects.toThrow('previous transaction recovered')
  await expect(lane.before_next()).rejects.toThrow('previous transaction recovered')
  expect({ executions, folds }).toEqual({ executions: 0, folds: 1 })
})

test('transaction error evidence distinguishes uncertain, executed-failure, recovered and unsigned refusals', () => {
  expect(
    transaction_error_outcome(new Error(`[sdk] transaction outcome unknown: ${digest}; check this transaction`))
  ).toEqual({ digest, status: 'unknown' })
  expect(transaction_error_outcome(new Error(`[sdk] transaction ${digest} failed on-chain: Move abort`))).toEqual({
    digest,
    status: 'failed',
  })
  expect(transaction_error_outcome(new Error(`[sdk] previous transaction recovered: ${digest}; refresh`))).toEqual({
    digest,
    status: 'recovered',
  })
  expect(transaction_error_outcome(new Error('[sdk] transaction resolution failed — NOT submitted: no gas'))).toBeNull()
  expect(transaction_error_outcome(new Error('User rejected signature'))).toBeNull()
})

test('both provider outages keep the saved digest blocked until late exact-digest recovery', async () => {
  const journal = storage()
  let available = false
  let executions = 0
  let folds = 0
  const options = {
    key: 'mainnet:alice',
    storage: journal,
    core: {
      executeTransaction: async () => {
        executions += 1
        throw new Error('response unavailable')
      },
      waitForTransaction: async () => {
        throw new Error('primary unavailable')
      },
    },
    recovery_cores: [
      {
        waitForTransaction: async () => {
          if (!available) throw new Error('secondary unavailable')
          return receipt
        },
      },
    ],
    on_receipt: () => {
      folds += 1
    },
  }
  await expect(create_transaction_execution(options).submit(raw, 'signature')).rejects.toThrow('outcome unknown')
  const restored = create_transaction_execution(options)
  await expect(restored.before_next()).rejects.toThrow('outcome unknown')
  expect(journal.getItem('mainnet:alice')).toContain(digest)
  available = true
  await expect(restored.before_next()).rejects.toThrow('previous transaction recovered')
  await expect(restored.before_next()).rejects.toThrow('previous transaction recovered')
  expect({ executions, folds }).toEqual({ executions: 1, folds: 1 })
})
