// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { isValidTransactionDigest } from '@mysten/sui/utils'

import { receipt_digest, type FetchedObject, type Receipt } from './cache.ts'
import { read_transaction_conflict, read_transaction_executed, type ConflictReader } from './transaction_conflict.ts'

export { proves_transaction_conflict, proves_transaction_executed } from './transaction_conflict.ts'

export type ReceiptOptions = Readonly<{ include?: object; gas_scope?: string; gas_payer?: string }>
export type PendingTransaction = ReceiptOptions &
  Readonly<{ digest: string; phase: 'submitted' | 'visible' | 'recovered' }>
/** `signatures` are held only for an envelope that crossed the submission gate. */
type ExecutionPending = PendingTransaction & Readonly<{ bytes?: Uint8Array; signatures?: readonly string[] }>
export type PreparedTransaction = ReceiptOptions &
  Readonly<{
    digest: string
    bytes: Uint8Array
    gas_budget_mist: string
  }>
export type SignedTransaction = PreparedTransaction & Readonly<{ signatures: readonly string[] }>
export type JournalTransaction =
  | (PreparedTransaction & Readonly<{ phase: 'prepared' }>)
  | (SignedTransaction & Readonly<{ phase: 'signed' | 'submitting' }>)
/** The host owns lane CAS, fencing and policy. Every effect must commit to the host's store before resolving;
 * that store may be process-local. read returns the exact unresolved phase and envelope. mark_submitting atomically consumes
 * only a signed phase under the current fence; it must reject a second transition.
 * settled must retain the unresolved lane until receipt and budget settlement commit atomically. */
export type TransactionJournal = Readonly<{
  read: () => Promise<JournalTransaction | null>
  admit: (stage: 'prepare' | 'sign' | 'submit') => Promise<void>
  prepared: (record: PreparedTransaction) => Promise<void>
  signed: (record: SignedTransaction) => Promise<void>
  mark_submitting: (record: SignedTransaction) => Promise<void>
  settled: (receipt: Receipt, record: PendingTransaction) => Promise<void>
  conflicted?: (proof: Receipt, record: PendingTransaction) => Promise<void>
  /** The transaction ran but its receipt cannot be read: `written` is a gas coin it wrote last. */
  executed?: (written: FetchedObject, record: PendingTransaction) => Promise<void>
}>
export type { Receipt } from './cache.ts'
export type TransactionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
/** Runs `task` while holding the exclusive lock `name` and settles as `task` settles. The holder releases
 * the lock on every settlement; a browser also releases it when the tab that holds it closes.
 * It protects one account's gas and owned-object selection, through signing and submission, across the
 * tabs of one origin: two tabs never resolve and sign at once. It does not protect against another tab's
 * uncertain submission (each tab keeps its own record), another device, or another origin. An external
 * wallet's signing prompt holds the lock until the player answers it. */
export type TransactionLock = <T>(name: string, task: () => Promise<T>) => Promise<T>
export type ExecutionCore = ConflictReader &
  Readonly<{
    executeTransaction: (input: {
      transaction: Uint8Array
      signatures: string[]
      include?: object
      signal?: AbortSignal
    }) => Promise<Receipt>
    waitForTransaction: (input: {
      digest: string
      include?: object
      signal?: AbortSignal
      timeout?: number
      pollSchedule?: number[]
    }) => Promise<Receipt>
  }>

/** The browser tab retains uncertain submissions across reloads. No signatures or transaction bytes persist. */
export const browser_transaction_storage = (): TransactionStorage | null =>
  typeof window === 'undefined' ? null : window.sessionStorage

/** The browser's Web Locks order this account's lane across tabs; null on a host without them. */
export const browser_transaction_lock = (): TransactionLock | null => {
  if (typeof window === 'undefined' || !('locks' in window.navigator)) return null
  const { locks } = window.navigator
  return (name, task) => locks.request(name, () => task())
}

/** The lock of a host without Web Locks: exclusive per name inside this process, granted in request
 * order, released when the task settles. A failed task never blocks the next one. */
const fifo_lock = (): TransactionLock => {
  const tails = new Map<string, Promise<void>>()
  return (name, task) => {
    const result = (tails.get(name) ?? Promise.resolve()).then(task)
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    tails.set(name, tail)
    void tail.then(() => {
      if (tails.get(name) === tail) tails.delete(name)
    })
    return result
  }
}

const bounded_request = async <T>(request: (signal: AbortSignal) => Promise<T>, milliseconds: number): Promise<T> => {
  const signal = AbortSignal.timeout(milliseconds)
  let stop = (): void => {}
  const aborted = new Promise<never>((_, reject) => {
    stop = () => reject(signal.reason)
    signal.addEventListener('abort', stop, { once: true })
  })
  try {
    return await Promise.race([request(signal), aborted])
  } finally {
    signal.removeEventListener('abort', stop)
  }
}

const decode_pending = (source: string): PendingTransaction => {
  const value = JSON.parse(source) as PendingTransaction
  if (
    !value ||
    typeof value.digest !== 'string' ||
    !isValidTransactionDigest(value.digest) ||
    value.phase !== 'submitted' ||
    (value.include !== undefined && (value.include === null || typeof value.include !== 'object'))
  )
    throw new Error('[sdk] invalid pending transaction record; refusing to submit')
  if (!(['gas_scope', 'gas_payer'] as const).every((key) => value[key] === undefined || typeof value[key] === 'string'))
    throw new Error('[sdk] invalid pending transaction metadata; refusing to submit')
  return value
}

const verify_receipt = (receipt: Receipt, record: PendingTransaction): Receipt => {
  if (receipt_digest(receipt) !== record.digest) throw new Error('Recovery returned another transaction')
  const result = receipt.Transaction ?? receipt.FailedTransaction ?? {}
  const includes = record.include ?? {}
  const complete = [
    typeof result.effects?.status?.success === 'boolean',
    Array.isArray(result.effects?.changedObjects),
    !Reflect.get(includes, 'events') || Array.isArray(result.events),
    !Reflect.get(includes, 'objectTypes') || (result.objectTypes !== null && typeof result.objectTypes === 'object'),
  ].every(Boolean)
  if (!complete) throw new Error('Recovery omitted required receipt fields')
  return receipt
}

/** One execution boundary: submit once, recover by digest, then feed the ordinary receipt pipeline once. */
export const create_transaction_execution = ({
  core,
  key,
  storage = browser_transaction_storage(),
  lock = browser_transaction_lock() ?? fifo_lock(),
  on_receipt,
  journal,
  response_timeout_ms = 15_000,
  recovery_timeout_ms = 60_000,
}: Readonly<{
  core: ExecutionCore
  key: string
  storage?: TransactionStorage | null
  lock?: TransactionLock
  journal?: TransactionJournal
  on_receipt: (receipt: Receipt, gas_scope?: string, gas_payer?: string) => void
  response_timeout_ms?: number
  recovery_timeout_ms?: number
}>) => {
  let pending: ExecutionPending | null = null
  let prepared: PreparedTransaction | null = null
  let journal_loaded = !journal
  let queued = 0
  // The lane's one name: its per-tab record's storage key and the lock that orders its passes.
  const storage_key = key.toLowerCase()
  const read_pending = (): PendingTransaction | null => {
    const stored = storage?.getItem(storage_key)
    return stored ? decode_pending(stored) : pending
  }
  const load_pending = async (): Promise<ExecutionPending | null> => {
    if (!journal) return read_pending()
    const record = await journal.read()
    journal_loaded = true
    if (record) {
      if (!isValidTransactionDigest(record.digest) || !['prepared', 'signed', 'submitting'].includes(record.phase))
        throw new Error('[sdk] invalid durable pending transaction')
      const { bytes, digest, include, gas_scope, gas_payer } = record
      const signatures = record.phase === 'submitting' ? record.signatures : undefined
      pending = { bytes, digest, include, gas_scope, gas_payer, signatures, phase: 'submitted' }
    }
    return pending
  }
  /** One digest runs at most once, so sending the same signed bytes again never repeats an action: the
   * chain runs them now, returns what it already ran, or says why it will not. A rebuilt transaction is
   * never sent here. */
  const resend = async (record: ExecutionPending): Promise<Receipt | null> => {
    const { bytes, signatures } = record
    if (!bytes || !signatures) return null
    const receipt = await bounded_request(
      (signal) =>
        core.executeTransaction({ transaction: bytes, signatures: [...signatures], include: record.include, signal }),
      response_timeout_ms
    )
    return verify_receipt(receipt, record)
  }
  /** A lost receipt is settled from current state, which stays readable where the transaction itself is
   * not. The gas coin shows that it ran: its receipt is asked for once more, and without one the lane is
   * released with that fact alone. Another certified transaction took the coin: this one never can. Neither
   * is shown: the same bytes are sent again. Null leaves the outcome unknown. */
  const resolve_lost = async (record: ExecutionPending): Promise<Readonly<{ receipt: Receipt | null }> | null> => {
    if (!journal || !record.bytes) return null
    const envelope = { digest: record.digest, bytes: record.bytes }
    const read = <T>(reader: (signal: AbortSignal) => Promise<T>) => bounded_request(reader, recovery_timeout_ms)
    const written = journal.executed ? await read((signal) => read_transaction_executed(core, envelope, signal)) : null
    if (written) {
      const receipt = await resend(record).catch((error: unknown) => {
        console.warn('[sdk] the transaction ran; its receipt is unavailable', record.digest, error)
        return null
      })
      if (receipt) return { receipt }
      await journal.executed!(written, record)
    } else {
      const proof = journal.conflicted
        ? await read((signal) => read_transaction_conflict(core, envelope, signal))
        : null
      if (!proof) return resend(record).then((receipt) => receipt && { receipt })
      await journal.conflicted!(proof, record)
    }
    pending = { digest: record.digest, phase: 'recovered' }
    storage?.removeItem(storage_key)
    return { receipt: null }
  }
  const recover = async (record: ExecutionPending): Promise<Receipt | null> => {
    try {
      const receipt = await bounded_request(
        (signal) =>
          core.waitForTransaction({
            digest: record.digest,
            include: record.include,
            signal,
            timeout: recovery_timeout_ms,
          }),
        recovery_timeout_ms
      )
      return verify_receipt(receipt, record)
    } catch (cause) {
      const message = `[sdk] transaction outcome unknown: ${record.digest}; check this transaction before trying again`
      try {
        const lost = await resolve_lost(record)
        if (lost) return lost.receipt
      } catch (failure) {
        throw new AggregateError([cause, failure], message, { cause: failure })
      }
      throw new Error(message, { cause })
    }
  }
  const accept = async (receipt: Receipt, record: PendingTransaction): Promise<void> => {
    await journal?.settled(receipt, record)
    // Keep recovery evidence until receipt processing succeeds. This callback accounts for failures too.
    on_receipt(receipt, record.gas_scope, record.gas_payer)
    pending = { digest: receipt_digest(receipt), phase: 'visible' }
    storage?.removeItem(storage_key)
  }
  const send_envelope = async (
    raw: Uint8Array,
    signatures: readonly string[],
    record: PendingTransaction
  ): Promise<Receipt> => {
    // Storage failure is a pre-submission refusal, never a reason to send without recovery evidence.
    storage?.setItem(storage_key, JSON.stringify(record))
    const retained: ExecutionPending = journal ? { ...record, bytes: raw.slice(), signatures } : record
    pending = retained
    const receipt = await bounded_request(
      (signal) =>
        core.executeTransaction({ transaction: raw, signatures: [...signatures], include: record.include, signal }),
      response_timeout_ms
    )
      .then((receipt) => verify_receipt(receipt, record))
      .catch((error: unknown) => {
        console.warn('[sdk] submission response unavailable; recovering transaction', record.digest, error)
        return recover(retained)
      })
    if (!receipt) throw new Error(`[sdk] transaction not executable: ${record.digest}; refresh before a new intent`)
    await accept(receipt, record)
    return receipt
  }
  const recover_pending = async (): Promise<boolean> => {
    const record = await load_pending()
    if (!record || record.phase !== 'submitted') return false
    const receipt = await recover(record)
    if (receipt) await accept(receipt, record)
    pending = { digest: record.digest, phase: 'recovered' }
    return true
  }
  return Object.freeze({
    /** Reload safety for THIS tab only: none of its own passes is queued, waiting for the lock or running,
     * and its own per-tab record holds no unresolved submission. Another tab's transaction never changes it. */
    is_transaction_idle: (): boolean => journal_loaded && queued === 0 && read_pending()?.phase !== 'submitted',
    /** The lock orders every pass of this account, in this tab and in every other tab. Each pass reads this
     * tab's record and resolves gas only after it holds the lock. The caller keeps the pass's own failure. */
    enqueue: <T>(action: () => Promise<T>): Promise<T> => {
      queued += 1
      return lock(storage_key, action).finally(() => {
        queued -= 1
      })
    },
    recover_pending,
    before_next: async (wait_for_visibility?: boolean): Promise<void> => {
      const record = await load_pending()
      await journal?.admit('prepare')
      if (!record) return
      if (record.phase === 'recovered')
        throw new Error(
          `[sdk] previous transaction recovered: ${record.digest}; refresh your game state before trying again`
        )
      if (record.phase === 'submitted') {
        await recover_pending()
        // The original caller is gone. Invalidate this session's queued work until fresh state is loaded.
        throw new Error(
          `[sdk] previous transaction recovered: ${record.digest}; refresh your game state before trying again`
        )
      }
      // A certified receipt already resolves outcome; checked write resolution need not reread it.
      if (wait_for_visibility === false) return
      try {
        await bounded_request(
          (signal) => core.waitForTransaction({ digest: record.digest, signal }),
          recovery_timeout_ms
        )
        pending = null
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        throw new Error(
          `[sdk] previous transaction ${record.digest} is not yet visible — next transaction NOT submitted: ${message}`,
          { cause }
        )
      }
    },
    before_sign: async (raw: Uint8Array, gas_budget_mist: string, options: ReceiptOptions = {}): Promise<void> => {
      if (!journal) return
      if (!/^[1-9][0-9]*$/.test(gas_budget_mist)) throw new Error('[sdk] resolved gas budget required')
      const record: PreparedTransaction = {
        ...options,
        include: { ...options.include, effects: true, events: true },
        bytes: raw.slice(),
        digest: TransactionDataBuilder.getDigestFromBytes(raw),
        gas_budget_mist,
      }
      // Even a failed/uncertain persistence response blocks this process from signing another intent.
      pending = { ...options, digest: record.digest, phase: 'submitted', include: record.include }
      await journal.prepared(record)
      prepared = record
      await journal.admit('sign')
    },
    submit: async (raw: Uint8Array, signatures: readonly string[], options: ReceiptOptions = {}): Promise<Receipt> => {
      const previous = read_pending()
      if (previous && previous.phase !== 'visible' && !(journal && prepared?.digest === previous.digest))
        throw new Error(
          `[sdk] transaction outcome unknown: ${previous.digest}; check this transaction before trying again`
        )
      const record: PendingTransaction = {
        ...options,
        digest: TransactionDataBuilder.getDigestFromBytes(raw),
        phase: 'submitted',
        include: { ...options.include, effects: true, events: true },
      }
      if (journal) {
        if (!prepared || prepared.digest !== record.digest)
          throw new Error('[sdk] signed bytes differ from durable preparation')
        const envelope: SignedTransaction = { ...prepared, bytes: raw.slice(), signatures: [...signatures] }
        // Invalidate local signing eligibility before any uncertain durable operation.
        prepared = null
        await journal.signed(envelope)
        await journal.admit('submit')
        await journal.mark_submitting(envelope)
      }
      return send_envelope(raw, signatures, record)
    },
  })
}
