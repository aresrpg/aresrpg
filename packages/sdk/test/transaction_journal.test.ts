// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { TransactionDataBuilder } from '@mysten/sui/transactions'

import {
  create_transaction_execution,
  type TransactionJournal,
  type JournalTransaction,
} from '../src/transaction_execution.ts'

const raw = new Uint8Array([1, 2, 3])
const digest = TransactionDataBuilder.getDigestFromBytes(raw)
const receipt = { Transaction: { digest, effects: { status: { success: true }, changedObjects: [] }, events: [] } }
const deferred = () => {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const fixture = (overrides: Partial<TransactionJournal> = {}) => {
  let retained: JournalTransaction | null = null
  const events: string[] = []
  const journal: TransactionJournal = {
    read: async () => retained,
    admit: async (stage) => {
      events.push(stage)
    },
    prepared: async (record) => {
      retained = { ...record, phase: 'prepared' }
      events.push('prepared')
    },
    signed: async (record) => {
      expect(record.bytes).toEqual(raw)
      events.push('signed')
    },
    mark_submitting: async () => {
      events.push('submitting')
    },
    settled: async () => {
      retained = null
      events.push('settled')
    },
    ...overrides,
  }
  const create = () =>
    create_transaction_execution({
      key: 'testnet:fixture',
      storage: null,
      journal,
      core: {
        executeTransaction: async () => {
          events.push('execute')
          return receipt
        },
        waitForTransaction: async () => {
          throw new Error('not found')
        },
      },
      on_receipt: () => {
        events.push('receipt')
      },
    })
  return { create, events }
}

test('durable preparation and admission finish before signing; envelope and admission precede execution', async () => {
  const persist = deferred()
  const signed = deferred()
  const settlement = deferred()
  const { create, events } = fixture({
    prepared: async () => {
      events.push('prepared')
      await persist.promise
    },
    signed: async () => {
      events.push('signed')
      await signed.promise
    },
    settled: async () => {
      events.push('settled')
      await settlement.promise
    },
  })
  const lane = create()
  expect(lane.is_transaction_idle()).toBe(false)
  await lane.before_next()
  const preparation = lane.before_sign(raw, '1000').then(() => {
    events.push('signer')
  })
  await Promise.resolve()
  expect(events).toEqual(['prepare', 'prepared'])
  persist.resolve()
  await preparation
  expect(events).toEqual(['prepare', 'prepared', 'sign', 'signer'])
  const submission = lane.submit(raw, ['fixture'])
  await Promise.resolve()
  expect(events.at(-1)).toBe('signed')
  expect(events).not.toContain('execute')
  signed.resolve()
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
  expect(events).toContain('settled')
  expect(events).not.toContain('receipt')
  expect(lane.is_transaction_idle()).toBe(false)
  settlement.resolve()
  await submission
  expect(events.slice(-5)).toEqual(['submit', 'submitting', 'execute', 'settled', 'receipt'])
})

for (const phase of ['prepared', 'signed', 'mark_submitting', 'settled'] as const) {
  test(`durable ${phase} failure retains an unresolved lane and never rebuilds`, async () => {
    const { create, events } = fixture({
      [phase]: async () => {
        throw new Error('storage failed')
      },
    })
    const lane = create()
    await lane.before_next()
    const run = async () => {
      await lane.before_sign(raw, '1000')
      await lane.submit(raw, ['fixture'])
    }
    await expect(run()).rejects.toThrow('storage failed')
    expect(lane.is_transaction_idle()).toBe(false)
    await expect(lane.before_next(false)).rejects.toThrow('outcome unknown')
    expect(events.filter((event) => event === 'execute').length).toBe(phase === 'settled' ? 1 : 0)
  })
}

test('restart recovers a prepared unresolved digest without signing or submitting', async () => {
  const { create, events } = fixture()
  const first = create()
  await first.before_next()
  await first.before_sign(raw, '1000')
  await expect(create().before_next()).rejects.toThrow('outcome unknown')
  expect(events).not.toContain('execute')
})

test('signed bytes cannot replace prepared bytes', async () => {
  const { create, events } = fixture()
  const lane = create()
  await lane.before_next()
  await lane.before_sign(raw, '1000')
  await expect(lane.submit(new Uint8Array([4]), ['fixture'])).rejects.toThrow('differ')
  expect(events).not.toContain('signed')
})
