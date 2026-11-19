// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { TransactionDataBuilder } from '@mysten/sui/transactions'

import { create_transaction_execution } from '../src/transaction_execution.ts'

const bytes = new Uint8Array([1, 2, 3])
const digest = TransactionDataBuilder.getDigestFromBytes(bytes)
const receipt = {
  Transaction: { digest, effects: { status: { success: true }, changedObjects: [] }, events: [] },
}

test('memory-only execution keeps ambiguity within its lifetime and never resubmits', async () => {
  let sends = 0
  let visible = false
  let folds = 0
  const execution = create_transaction_execution({
    key: 'memory-only',
    storage: null,
    core: {
      executeTransaction: async () => {
        sends += 1
        throw new Error('response lost')
      },
      waitForTransaction: async ({ digest: requested }) => {
        expect(requested).toBe(digest)
        if (!visible) throw new Error('not visible')
        return receipt
      },
    },
    on_receipt: () => {
      folds += 1
    },
  })
  await expect(execution.submit(bytes, ['signature'])).rejects.toThrow('outcome unknown')
  expect(execution.is_transaction_idle()).toBe(false)
  await expect(execution.before_next(false)).rejects.toThrow('outcome unknown')
  await expect(execution.submit(new Uint8Array([4]), ['signature'])).rejects.toThrow('outcome unknown')
  visible = true
  expect(await execution.recover_pending()).toBe(true)
  expect(await execution.recover_pending()).toBe(false)
  // Recovery invalidates already-planned work, even without persistent storage.
  await expect(execution.before_next(false)).rejects.toThrow('previous transaction recovered')
  expect({ sends, folds }).toEqual({ sends: 1, folds: 1 })
})

test('a new memory-only executor has no restart history and performs no automatic replay', async () => {
  let sends = 0
  let reads = 0
  const create = () =>
    create_transaction_execution({
      key: 'same-wallet',
      storage: null,
      core: {
        executeTransaction: async () => {
          sends += 1
          throw new Error('response lost')
        },
        waitForTransaction: async () => {
          reads += 1
          throw new Error('not visible')
        },
      },
      on_receipt: () => {},
    })
  const before_restart = create()
  await expect(before_restart.submit(bytes, ['signature'])).rejects.toThrow('outcome unknown')
  const reads_before_restart = reads
  const restarted = create()
  expect(restarted.is_transaction_idle()).toBe(true)
  expect(await restarted.recover_pending()).toBe(false)
  await restarted.before_next(false)
  expect({ sends, reads }).toEqual({ sends: 1, reads: reads_before_restart })
  // No claim of cross-restart exactly-once: the caller must re-evaluate current game state.
  expect(before_restart.is_transaction_idle()).toBe(false)
})

test('memory-only recovery folds a certified failure once instead of retrying it', async () => {
  let sends = 0
  const failed = {
    FailedTransaction: {
      digest,
      effects: { status: { success: false, error: 'MoveAbort' }, changedObjects: [] },
      events: [],
    },
  }
  const folds: unknown[] = []
  const execution = create_transaction_execution({
    key: 'memory-failure',
    storage: null,
    core: {
      executeTransaction: async () => {
        sends += 1
        throw new Error('response lost')
      },
      waitForTransaction: async () => failed,
    },
    on_receipt: (value) => folds.push(value),
  })
  expect(await execution.submit(bytes, ['signature'])).toBe(failed)
  expect(await execution.recover_pending()).toBe(false)
  expect(sends).toBe(1)
  expect(folds).toEqual([failed])
})
