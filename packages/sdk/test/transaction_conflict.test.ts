// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'

import {
  create_transaction_execution,
  type JournalTransaction,
  type TransactionJournal,
} from '../src/transaction_execution.ts'

import { gas, conflict_digest, captured } from './helpers/transaction_conflict.ts'

const fixture = async () => {
  const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(13))
  const tx = new Transaction()
  tx.setSender(key.toSuiAddress())
  tx.setGasOwner('0x51c1751d2fb53e802c7d89a4907d81327f24dd517a2a4ac8d345fb06a08c120a')
  tx.setGasPayment([gas])
  tx.setGasPrice(100)
  tx.setGasBudget(50000000)
  const bytes = await tx.build()
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  const { signature } = await key.signTransaction(bytes)
  const state = {
    saved: {
      bytes,
      digest,
      gas_budget_mist: '50000000',
      signatures: [signature],
      phase: 'submitting',
    } as JournalTransaction | null,
    proof: structuredClone(captured),
    available: true,
    original_available: false,
    commits: 0,
    executions: 0,
    receipts: 0,
  }
  const journal: TransactionJournal = {
    read: async () => state.saved,
    admit: async () => {},
    prepared: async (record) => {
      state.saved = { ...record, phase: 'prepared' }
    },
    signed: async (record) => {
      state.saved = { ...record, phase: 'signed' }
    },
    mark_submitting: async (record) => {
      state.saved = { ...record, phase: 'submitting' }
    },
    settled: async () => {
      state.saved = null
    },
    conflicted: async () => {
      state.commits += 1
      state.saved = null
    },
  }
  const core = {
    executeTransaction: async () => {
      state.executions += 1
      throw new Error('response unavailable')
    },
    waitForTransaction: async () => {
      if (!state.original_available) throw new Error('not found')
      return { Transaction: { digest, effects: { status: { success: true }, changedObjects: [] }, events: [] } }
    },
    getObjects: async () => ({ objects: [{ ...gas, version: '1068218221', previousTransaction: conflict_digest }] }),
    getTransaction: async () => {
      if (!state.available) throw new Error('receipt unavailable')
      return state.proof
    },
  }
  const create = () =>
    create_transaction_execution({
      core,
      journal,
      key: 'fixture',
      address: key.toSuiAddress(),
      storage: null,
      on_receipt: () => {
        state.receipts += 1
      },
    })
  return { state, create, journal, bytes, digest, core, signature }
}

test('withdrawal conflict resolves the original submitting envelope without replay or a fabricated receipt', async () => {
  const f = await fixture()
  const executor = f.create()
  expect(await executor.recover_pending()).toBe(true)
  expect(f.state.saved).toBeNull()
  expect(f.state.commits).toBe(1)
  expect(f.state.executions).toBe(0)
  expect(f.state.receipts).toBe(0)
  await expect(executor.before_next()).rejects.toThrow('refresh')
  expect(await f.create().recover_pending()).toBe(false)
})

test('original certified receipt takes precedence over any conflict lookup', async () => {
  const f = await fixture()
  f.state.original_available = true
  expect(await f.create().recover_pending()).toBe(true)
  expect(f.state.commits).toBe(0)
  expect(f.state.receipts).toBe(1)
})

test('a missing receipt and newer coin alone preserve the unresolved submission', async () => {
  const f = await fixture()
  f.state.available = false
  await expect(f.create().recover_pending()).rejects.toThrow('outcome unknown')
  expect(f.state.saved?.phase).toBe('submitting')
  expect(f.state.commits).toBe(0)
})

for (const mismatch of [
  'object',
  'version',
  'input_digest',
  'same_transaction',
  'receipt_digest',
  'effects_digest',
  'checkpoint',
  'unchanged',
  'shared',
  'envelope_digest',
] as const) {
  test(`conflict proof rejects ${mismatch} mismatch and never clears pending`, async () => {
    const f = await fixture()
    const receipt = f.state.proof.Transaction
    const row = receipt.effects.changedObjects[0]!
    const corrupt = {
      object: () => {
        row.objectId = '0x' + '1'.repeat(64)
      },
      version: () => {
        row.inputVersion = '1068218221'
      },
      input_digest: () => {
        row.inputDigest = conflict_digest
      },
      same_transaction: () => {
        receipt.digest = f.digest
      },
      receipt_digest: () => {
        receipt.digest = gas.digest
      },
      effects_digest: () => {
        receipt.effects.transactionDigest = gas.digest
      },
      checkpoint: () => {
        receipt.checkpoint = ''
      },
      unchanged: () => {
        row.outputVersion = gas.version
      },
      shared: () => {
        Object.assign(row, { inputOwner: { Shared: { initialSharedVersion: '1' } } })
      },
      envelope_digest: () => {
        f.state.saved = { ...f.state.saved!, digest: conflict_digest }
      },
    }
    corrupt[mismatch]()
    await expect(f.create().recover_pending()).rejects.toThrow('outcome unknown')
    expect(f.state.saved?.phase).toBe('submitting')
    expect(f.state.commits).toBe(0)
    expect(f.state.executions).toBe(0)
  })
}

test('direct rejected submission records conflict once and poisons previously queued intents', async () => {
  const f = await fixture()
  f.state.saved = null
  const executor = f.create()
  await executor.before_next()
  await executor.before_sign(f.bytes, '50000000')
  const original = executor.enqueue(() => executor.submit(f.bytes, [f.signature]))
  const queued = executor.enqueue(() => executor.before_next(false))
  await expect(original).rejects.toThrow('not executable')
  await expect(queued).rejects.toThrow('refresh')
  expect(f.state.executions).toBe(1)
  expect(f.state.commits).toBe(1)
  expect(f.state.receipts).toBe(0)
})

test('signed resume crossing submission can settle a competing failed transaction without replay', async () => {
  const f = await fixture()
  f.state.saved = { ...f.state.saved!, phase: 'signed', signatures: [f.signature] }
  f.state.proof.Transaction.effects.status.success = false
  const executor = f.create()
  await expect(executor.resume_pending()).rejects.toThrow('not executable')
  expect(f.state.executions).toBe(1)
  expect(f.state.commits).toBe(1)
  expect(f.state.saved).toBeNull()
  expect(f.state.receipts).toBe(0)
  await expect(executor.before_next()).rejects.toThrow('refresh')
})

test('ambiguous conflict acknowledgment never authorizes a queued write; restart trusts durable state', async () => {
  const f = await fixture()
  const settle = f.journal.conflicted!
  Object.assign(f.journal, {
    conflicted: async (...args: Parameters<typeof settle>) => {
      await settle(...args)
      throw new Error('reply lost after commit')
    },
  })
  const executor = f.create()
  await expect(executor.recover_pending()).rejects.toThrow('outcome unknown')
  expect(f.state.saved).toBeNull()
  await expect(executor.before_next()).rejects.toThrow('outcome unknown')
  expect(f.state.executions).toBe(0)
  expect(await f.create().recover_pending()).toBe(false)
})
