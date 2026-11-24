// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The execution lane after submission: an uncertain outcome is recovered by digest and folded once,
// never resent; durable hosts journal every phase; only an exact conflict proof settles a lost lane.

import { expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction, TransactionDataBuilder, type TransactionPlugin } from '@mysten/sui/transactions'

import { SDK, type SuiTransport } from '../src/client.ts'
import {
  create_transaction_execution,
  type JournalTransaction,
  type TransactionJournal,
} from '../src/transaction_execution.ts'

import { execution_receipt } from './helpers/execution_receipt.ts'
import { captured, conflict_digest, gas } from './helpers/transaction_conflict.ts'
import { memory_storage } from './helpers/transport.ts'

const raw = new Uint8Array([1, 2, 3])
const digest = TransactionDataBuilder.getDigestFromBytes(raw)
const receipt = {
  Transaction: { digest, effects: { status: { success: true }, changedObjects: [] }, events: [], objectTypes: {} },
}
type Core = Parameters<typeof create_transaction_execution>[0]['core']
const lane = (core: Partial<Core>, options: Partial<Parameters<typeof create_transaction_execution>[0]> = {}) =>
  create_transaction_execution({
    key: 'testnet:alice',
    storage: memory_storage(),
    core: {
      executeTransaction: async () => receipt,
      waitForTransaction: async () => receipt,
      ...core,
    },
    on_receipt: () => {},
    ...options,
  })

test('a lost or hanging response recovers the exact receipt by digest and folds it once', async () => {
  let executions = 0
  const folds: unknown[] = []
  const reads: unknown[] = []
  const lost = lane(
    {
      executeTransaction: async () => {
        executions += 1
        throw new Error('connection lost')
      },
      waitForTransaction: async (input) => {
        reads.push(input)
        return receipt
      },
    },
    { on_receipt: (value) => void folds.push(value) }
  )
  expect(await lost.submit(raw, ['signature'], { include: { objectTypes: true } })).toBe(receipt)
  expect([executions, folds]).toEqual([1, [receipt]])
  expect(reads[0]).toMatchObject({ digest, include: { effects: true, events: true, objectTypes: true } })

  let finish!: (value: typeof receipt) => void
  let late_folds = 0
  const hanging = lane(
    {
      executeTransaction: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    },
    { response_timeout_ms: 1, on_receipt: () => void (late_folds += 1) }
  )
  expect(await hanging.submit(raw, ['signature'])).toBe(receipt)
  finish(receipt)
  await Promise.resolve()
  expect(late_folds).toBe(1)

  let recovered_reads = 0
  const foreign = lane({
    executeTransaction: async () => ({ Transaction: { digest: 'wrong' } }),
    waitForTransaction: async () => {
      recovered_reads += 1
      return receipt
    },
  })
  expect(await foreign.submit(raw, ['signature'])).toBe(receipt)
  expect(recovered_reads).toBe(1)
})

test('the SDK folds a recovered receipt into its cache and observers exactly as a direct one', async () => {
  const object_id = `0x${'1'.repeat(64)}`
  const resolver: TransactionPlugin = async (data, _options, next) => {
    data.gasData.price = '1000'
    data.gasData.payment = [{ objectId: object_id, version: '1', digest: '11111111111111111111111111111111' }]
    await next()
  }
  let executions = 0
  let submitted: Uint8Array = raw
  const client = {
    core: {
      resolveTransactionPlugin: () => resolver,
      executeTransaction: async ({ transaction }: { transaction: Uint8Array }) => {
        executions += 1
        submitted = transaction
        throw new Error('lost execution response')
      },
      waitForTransaction: async () =>
        execution_receipt(submitted, {
          Transaction: {
            effects: {
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
        }),
    },
  } as unknown as SuiTransport
  const signer = new Ed25519Keypair()
  let signatures = 0
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
  const observed: unknown[] = []
  sdk.on_transaction((execution) => observed.push(execution))
  const result = await sdk.execute(sdk.tx())
  expect(result.Transaction?.digest).toBe(TransactionDataBuilder.getDigestFromBytes(submitted))
  expect(sdk.ref(object_id)).toMatchObject({ version: '2' })
  expect(observed).toEqual([{ digest: result.Transaction?.digest, outcome: 'success' }])
  // A write queued before the recovery still carries a stale ref: it is refused before signing.
  const stale = sdk.tx()
  stale.objectRef({ objectId: object_id, version: '1', digest: '11111111111111111111111111111111' })
  client.core.resolveTransactionPlugin = () => async (data, options, next) => {
    if (data.inputs.some((input) => input.Object?.ImmOrOwnedObject?.version === '1'))
      throw new Error('provided version does not match, provided: 1 actual: 0x2')
    await resolver(data, options, next)
  }
  await expect(sdk.execute(stale)).rejects.toThrow('NOT submitted')
  expect({ signatures, executions }).toEqual({ signatures: 1, executions: 1 })
})

test('an unknown outcome blocks every new intent, survives executor recreation and is never overwritten', async () => {
  const journal = memory_storage()
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
  const create = () => lane(core, { storage: journal })
  await expect(create().submit(raw, ['signature'])).rejects.toThrow('outcome unknown')
  expect(create().is_transaction_idle()).toBe(false)
  await expect(create().before_next()).rejects.toThrow('outcome unknown')
  await expect(create().submit(new Uint8Array([4]), ['signature'])).rejects.toThrow(digest)
  available = true
  const restored = create()
  await expect(restored.before_next(false)).rejects.toThrow('previous transaction recovered')
  await expect(restored.before_next(false)).rejects.toThrow('previous transaction recovered')
  await create().before_next()
  expect([executions, create().is_transaction_idle()]).toEqual([1, true])

  for (const partial of [
    { Transaction: { digest: 'wrong' } },
    { Transaction: { digest, effects: { status: { success: true } } } },
  ]) {
    const record = memory_storage()
    const mismatched = lane(
      {
        executeTransaction: async () => {
          throw new Error('lost')
        },
        waitForTransaction: async () => partial,
      },
      { storage: record }
    )
    await expect(mismatched.submit(raw, ['signature'])).rejects.toThrow('outcome unknown')
    expect(record.getItem('testnet:alice')).toContain(digest)
  }
})

test('missing recovery evidence refuses submission; a failed receipt fold keeps the evidence', async () => {
  let executions = 0
  const unwritable = lane(
    {
      executeTransaction: async () => {
        executions += 1
        return receipt
      },
    },
    {
      storage: {
        ...memory_storage(),
        setItem: () => {
          throw new Error('storage unavailable')
        },
      },
    }
  )
  await expect(unwritable.submit(raw, ['signature'])).rejects.toThrow('storage unavailable')
  expect(executions).toBe(0)

  const persistence = memory_storage()
  const folding = lane(
    {
      executeTransaction: async () => {
        executions += 1
        return receipt
      },
    },
    {
      storage: persistence,
      on_receipt: () => {
        throw new Error('receipt fold failed')
      },
    }
  )
  await expect(folding.submit(raw, ['signature'])).rejects.toThrow('receipt fold failed')
  await expect(folding.before_next(false)).rejects.toThrow('receipt fold failed')
  expect([persistence.getItem('testnet:alice')?.includes(digest), folding.is_transaction_idle(), executions]).toEqual([
    true,
    false,
    1,
  ])
  const queued = lane({}, { storage: memory_storage() })
  const gate = Promise.withResolvers<void>()
  const first = queued.enqueue(() => gate.promise)
  const second = queued.enqueue(async () => {})
  expect(queued.is_transaction_idle()).toBe(false)
  gate.resolve()
  await Promise.all([first, second])
  expect(queued.is_transaction_idle()).toBe(true)
})

test('a memory-only lane keeps ambiguity for its own lifetime, folds a certified failure once and never replays', async () => {
  let sends = 0
  let visible = false
  let folds = 0
  const memory_core = {
    executeTransaction: async () => {
      sends += 1
      throw new Error('response lost')
    },
    waitForTransaction: async () => {
      if (!visible) throw new Error('not visible')
      return receipt
    },
  }
  const memory = lane(memory_core, { key: 'memory-only', storage: null, on_receipt: () => void (folds += 1) })
  await expect(memory.submit(raw, ['signature'])).rejects.toThrow('outcome unknown')
  await expect(memory.before_next(false)).rejects.toThrow('outcome unknown')
  await expect(memory.submit(new Uint8Array([4]), ['signature'])).rejects.toThrow('outcome unknown')
  const restarted = lane(memory_core, { key: 'memory-only', storage: null })
  expect([restarted.is_transaction_idle(), await restarted.recover_pending()]).toEqual([true, false])
  visible = true
  expect([await memory.recover_pending(), await memory.recover_pending()]).toEqual([true, false])
  await expect(memory.before_next(false)).rejects.toThrow('previous transaction recovered')
  expect({ sends, folds }).toEqual({ sends: 1, folds: 1 })

  const failed = {
    FailedTransaction: {
      digest,
      effects: { status: { success: false, error: 'MoveAbort' }, changedObjects: [] },
      events: [],
    },
  }
  const outcomes: unknown[] = []
  const certified = lane(
    {
      executeTransaction: async () => {
        throw new Error('response lost')
      },
      waitForTransaction: async () => failed,
    },
    { storage: null, on_receipt: (value) => void outcomes.push(value) }
  )
  expect(await certified.submit(raw, ['signature'])).toBe(failed)
  expect([await certified.recover_pending(), outcomes]).toEqual([false, [failed]])
})

// ── the bot's durable journal ───────────────────────────────────────────────────────────────────
const journal_fixture = (overrides: Partial<TransactionJournal> = {}) => {
  let retained: JournalTransaction | null = null
  const events: string[] = []
  const journal: TransactionJournal = {
    read: async () => retained,
    admit: async (stage) => void events.push(stage),
    prepared: async (record) => {
      retained = { ...record, phase: 'prepared' }
      events.push('prepared')
    },
    signed: async (record) => {
      expect(record.bytes).toEqual(raw)
      events.push('signed')
    },
    mark_submitting: async () => void events.push('submitting'),
    settled: async () => {
      retained = null
      events.push('settled')
    },
    ...overrides,
  }
  const create = () =>
    lane(
      {
        executeTransaction: async () => {
          events.push('execute')
          return receipt
        },
        waitForTransaction: async () => {
          throw new Error('not found')
        },
      },
      { key: 'testnet:fixture', storage: null, journal, on_receipt: () => void events.push('receipt') }
    )
  return { create, events }
}

test('the journal commits each phase before the next: prepare, sign, signed envelope, submit, settle', async () => {
  const persist = Promise.withResolvers<void>()
  const signed = Promise.withResolvers<void>()
  const settlement = Promise.withResolvers<void>()
  const { create, events } = journal_fixture({
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
  const durable = create()
  expect(durable.is_transaction_idle()).toBe(false)
  await durable.before_next()
  await expect(durable.before_sign(raw, '0')).rejects.toThrow('resolved gas budget required')
  const preparation = durable.before_sign(raw, '1000').then(() => void events.push('signer'))
  await Promise.resolve()
  expect(events).toEqual(['prepare', 'prepared'])
  persist.resolve()
  await preparation
  expect(events).toEqual(['prepare', 'prepared', 'sign', 'signer'])
  const submission = durable.submit(raw, ['fixture'])
  await Promise.resolve()
  expect([events.at(-1), events.includes('execute')]).toEqual(['signed', false])
  signed.resolve()
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
  expect([events.includes('settled'), events.includes('receipt'), durable.is_transaction_idle()]).toEqual([
    true,
    false,
    false,
  ])
  settlement.resolve()
  await submission
  expect(events.slice(-5)).toEqual(['submit', 'submitting', 'execute', 'settled', 'receipt'])

  const replaced = journal_fixture()
  const lane_b = replaced.create()
  await lane_b.before_next()
  await lane_b.before_sign(raw, '1000')
  await expect(lane_b.submit(new Uint8Array([4]), ['fixture'])).rejects.toThrow('differ')
  await expect(replaced.create().before_next()).rejects.toThrow('outcome unknown')
  expect(replaced.events.filter((event) => ['signed', 'execute'].includes(event))).toEqual([])
})

test('a durable failure at any phase leaves the lane unresolved and never rebuilds', async () => {
  for (const phase of ['prepared', 'signed', 'mark_submitting', 'settled'] as const) {
    const { create, events } = journal_fixture({
      [phase]: async () => {
        throw new Error('storage failed')
      },
    })
    const durable = create()
    await durable.before_next()
    const run = async () => {
      await durable.before_sign(raw, '1000')
      await durable.submit(raw, ['fixture'])
    }
    await expect(run()).rejects.toThrow('storage failed')
    expect(durable.is_transaction_idle()).toBe(false)
    await expect(durable.before_next(false)).rejects.toThrow('outcome unknown')
    expect(events.filter((event) => event === 'execute').length).toBe(phase === 'settled' ? 1 : 0)
  }
})

const conflict_fixture = async () => {
  const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(13))
  const tx = new Transaction()
  tx.setSender(key.toSuiAddress())
  tx.setGasOwner('0x51c1751d2fb53e802c7d89a4907d81327f24dd517a2a4ac8d345fb06a08c120a')
  tx.setGasPayment([gas])
  tx.setGasPrice(100)
  tx.setGasBudget(50000000)
  const bytes = await tx.build()
  const own_digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  const { signature } = await key.signTransaction(bytes)
  const state = {
    saved: {
      bytes,
      digest: own_digest,
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
    prepared: async (record) => void (state.saved = { ...record, phase: 'prepared' }),
    signed: async (record) => void (state.saved = { ...record, phase: 'signed' }),
    mark_submitting: async (record) => void (state.saved = { ...record, phase: 'submitting' }),
    settled: async () => void (state.saved = null),
    conflicted: async () => {
      state.commits += 1
      state.saved = null
    },
  }
  const create = () =>
    create_transaction_execution({
      core: {
        executeTransaction: async () => {
          state.executions += 1
          throw new Error('response unavailable')
        },
        waitForTransaction: async () => {
          if (!state.original_available) throw new Error('not found')
          return {
            Transaction: { digest: own_digest, effects: { status: { success: true }, changedObjects: [] }, events: [] },
          }
        },
        getObjects: async () => ({
          objects: [{ ...gas, version: '1068218221', previousTransaction: conflict_digest }],
        }),
        getTransaction: async () => {
          if (!state.available) throw new Error('receipt unavailable')
          return state.proof
        },
      },
      journal,
      key: 'fixture',
      storage: null,
      on_receipt: () => void (state.receipts += 1),
    })
  return { state, create, journal, bytes, own_digest, signature }
}

test('only another checkpointed transaction consuming the exact gas ref settles a lost lane', async () => {
  const f = await conflict_fixture()
  const executor = f.create()
  expect(await executor.recover_pending()).toBe(true)
  expect([f.state.saved, f.state.commits, f.state.executions, f.state.receipts]).toEqual([null, 1, 0, 0])
  await expect(executor.before_next()).rejects.toThrow('refresh')
  expect(await f.create().recover_pending()).toBe(false)

  const original = await conflict_fixture()
  original.state.original_available = true
  expect(await original.create().recover_pending()).toBe(true)
  expect([original.state.commits, original.state.receipts]).toEqual([0, 1])

  const unavailable = await conflict_fixture()
  unavailable.state.available = false
  await expect(unavailable.create().recover_pending()).rejects.toThrow('outcome unknown')
  expect([unavailable.state.saved?.phase, unavailable.state.commits]).toEqual(['submitting', 0])

  const direct = await conflict_fixture()
  direct.state.saved = null
  const lane_d = direct.create()
  await lane_d.before_next()
  await lane_d.before_sign(direct.bytes, '50000000')
  const sent = lane_d.enqueue(() => lane_d.submit(direct.bytes, [direct.signature]))
  const queued = lane_d.enqueue(() => lane_d.before_next(false)).catch((error: Error) => error.message)
  await expect(sent).rejects.toThrow('not executable')
  expect(await queued).toContain('refresh')
  expect([direct.state.executions, direct.state.commits, direct.state.receipts]).toEqual([1, 1, 0])

  const ambiguous = await conflict_fixture()
  const settle = ambiguous.journal.conflicted!
  Object.assign(ambiguous.journal, {
    conflicted: async (...args: Parameters<typeof settle>) => {
      await settle(...args)
      throw new Error('reply lost after commit')
    },
  })
  const lane_a = ambiguous.create()
  await expect(lane_a.recover_pending()).rejects.toThrow('outcome unknown')
  await expect(lane_a.before_next()).rejects.toThrow('outcome unknown')
  expect([ambiguous.state.saved, ambiguous.state.executions, await ambiguous.create().recover_pending()]).toEqual([
    null,
    0,
    false,
  ])
})

test('any mismatch in the conflict proof keeps the submission pending', async () => {
  const corruptions = {
    object: (row: Record<string, unknown>) => void (row.objectId = '0x' + '1'.repeat(64)),
    version: (row: Record<string, unknown>) => void (row.inputVersion = '1068218221'),
    input_digest: (row: Record<string, unknown>) => void (row.inputDigest = conflict_digest),
    unchanged: (row: Record<string, unknown>) => void (row.outputVersion = gas.version),
    shared: (row: Record<string, unknown>) => void (row.inputOwner = { Shared: { initialSharedVersion: '1' } }),
    receipt_digest: (_row: unknown, proof: typeof captured.Transaction) => void (proof.digest = gas.digest),
    effects_digest: (_row: unknown, proof: typeof captured.Transaction) =>
      void (proof.effects.transactionDigest = gas.digest),
    checkpoint: (_row: unknown, proof: typeof captured.Transaction) => void (proof.checkpoint = ''),
    same_transaction: (_row: unknown, proof: typeof captured.Transaction, own: string) => void (proof.digest = own),
  }
  for (const corrupt of Object.values(corruptions)) {
    const f = await conflict_fixture()
    corrupt(f.state.proof.Transaction.effects.changedObjects[0]!, f.state.proof.Transaction, f.own_digest)
    await expect(f.create().recover_pending()).rejects.toThrow('outcome unknown')
    expect([f.state.saved?.phase, f.state.commits, f.state.executions]).toEqual(['submitting', 0, 0])
  }
  const envelope = await conflict_fixture()
  envelope.state.saved = { ...envelope.state.saved!, digest: conflict_digest }
  await expect(envelope.create().recover_pending()).rejects.toThrow('outcome unknown')
  expect(envelope.state.commits).toBe(0)
})
