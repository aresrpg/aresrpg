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

// Deterministic, public in-memory fixture only. No credentials, chain calls or funded wallet.
const fixture = async () => {
  const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(9))
  const tx = new Transaction()
  tx.setSender(key.toSuiAddress())
  tx.setGasPrice(1)
  tx.setGasBudget(1000)
  tx.setGasPayment([{ objectId: `0x${'1'.repeat(64)}`, version: '1', digest: '11111111111111111111111111111111' }])
  const bytes = await tx.build()
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  const { signature } = await key.signTransaction(bytes)
  const receipt = { Transaction: { digest, effects: { status: { success: true }, changedObjects: [] }, events: [] } }
  const state: {
    saved: JournalTransaction | null
    admitted: boolean
    fence: boolean
    available: boolean
    fail_submission: boolean
    crash: boolean
  } = {
    saved: null,
    admitted: true,
    fence: true,
    available: false,
    fail_submission: false,
    crash: true,
  }
  const submissions: { transaction: Uint8Array; signatures: string[] }[] = []
  const settlements: unknown[] = []
  const browser_records: string[] = []
  const journal: TransactionJournal = {
    read: async () => state.saved,
    admit: async () => {
      if (!state.admitted) throw new Error('revoked')
    },
    prepared: async (record) => {
      state.saved = { ...record, phase: 'prepared' }
    },
    signed: async (record) => {
      state.saved = { ...record, phase: 'signed' }
      if (state.crash) throw new Error('crash after signed commit')
    },
    mark_submitting: async (record) => {
      if (!state.fence) throw new Error('stale fence')
      if (state.saved?.phase !== 'signed') throw new Error('phase conflict')
      state.saved = { ...record, phase: 'submitting' }
    },
    settled: async (result) => {
      settlements.push(result)
      state.saved = null
    },
  }
  const create = (address = key.toSuiAddress()) =>
    create_transaction_execution({
      key: 'testnet:fixture',
      address,
      storage: {
        getItem: () => null,
        setItem: (_key, value) => {
          browser_records.push(value)
        },
        removeItem: () => {},
      },
      journal,
      core: {
        executeTransaction: async (input) => {
          submissions.push({ transaction: input.transaction.slice(), signatures: [...input.signatures] })
          if (state.fail_submission) throw new Error('response lost')
          return receipt
        },
        waitForTransaction: async () => {
          if (!state.available) throw new Error('not found')
          return receipt
        },
      },
      on_receipt: () => {},
    })
  const crash = async () => {
    const original = create()
    await original.before_next()
    await original.before_sign(bytes, '1000')
    await expect(original.submit(bytes, [signature])).rejects.toThrow('crash after signed commit')
    expect(state.saved?.phase).toBe('signed')
    expect(submissions).toHaveLength(0)
  }
  return { bytes, signature, state, submissions, settlements, browser_records, create, crash }
}

test('restart after signed persistence resumes exactly one identical envelope through the SDK', async () => {
  const f = await fixture()
  await f.crash()
  const restarted = f.create()
  expect(await restarted.resume_pending()).toBe(true)
  expect(f.submissions).toEqual([{ transaction: f.bytes, signatures: [f.signature] }])
  expect(f.settlements).toHaveLength(1)
  await expect(restarted.before_next()).rejects.toThrow('refresh')
})
for (const guard of ['admitted', 'fence'] as const) {
  test(`resume refuses ${guard} loss and leaves the signed lane pending`, async () => {
    const f = await fixture()
    await f.crash()
    f.state[guard] = false
    await expect(f.create().resume_pending()).rejects.toThrow(guard === 'admitted' ? 'revoked' : 'stale fence')
    expect(f.submissions).toHaveLength(0)
    expect(f.state.saved?.phase).toBe('signed')
    // Revocation cannot prevent passive receipt reconciliation.
    f.state.available = true
    expect(await f.create().recover_pending()).toBe(true)
    expect(f.settlements).toHaveLength(1)
  })
}
test('unknown submission outcome blocks new intents and cannot replay the submitting envelope', async () => {
  const f = await fixture()
  await f.crash()
  f.state.fail_submission = true
  await expect(f.create().resume_pending()).rejects.toThrow('outcome unknown')
  expect(f.state.saved?.phase).toBe('submitting')
  await expect(f.create().resume_pending()).rejects.toThrow('outcome unknown')
  await expect(f.create().before_next()).rejects.toThrow('outcome unknown')
  expect(f.submissions).toHaveLength(1)
})
test('resume rejects wrong lane address, altered digest and invalid signature before admission', async () => {
  const f = await fixture()
  await f.crash()
  await expect(f.create(`0x${'2'.repeat(64)}`).resume_pending()).rejects.toThrow('invalid durable')
  const original = f.state.saved!
  f.state.saved = { ...original, digest: '11111111111111111111111111111111' }
  await expect(f.create().resume_pending()).rejects.toThrow('invalid durable')
  f.state.saved = { ...original, phase: 'signed', signatures: ['invalid'] }
  await expect(f.create().resume_pending()).rejects.toThrow()
  expect(f.submissions).toHaveLength(0)
})

test('resumed durable envelopes never copy bytes or signatures into browser storage', async () => {
  const f = await fixture()
  await f.crash()
  await f.create().resume_pending()
  expect(f.browser_records).toHaveLength(1)
  const record = JSON.parse(f.browser_records[0]!)
  expect(record.digest).toBe(TransactionDataBuilder.getDigestFromBytes(f.bytes))
  expect(record).not.toHaveProperty('bytes')
  expect(record).not.toHaveProperty('signatures')
})
