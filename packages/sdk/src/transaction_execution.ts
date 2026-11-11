// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { isValidTransactionDigest } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'

import { receipt_digest, type Receipt } from './cache.ts'

export type ReceiptOptions = Readonly<{ include?: object; gas_scope?: string; gas_payer?: string }>
export type PendingTransaction = ReceiptOptions &
  Readonly<{ digest: string; phase: 'submitted' | 'visible' | 'recovered' }>
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
/** The host owns encryption, lane CAS, fencing and policy. Every effect must be durable before resolving.
 * read returns the exact unresolved phase and decrypted envelope. mark_submitting atomically consumes
 * only a signed phase under the current fence; it must reject a second transition.
 * settled must retain the unresolved lane until receipt and budget settlement commit atomically. */
export type TransactionJournal = Readonly<{
  read: () => Promise<JournalTransaction | null>
  admit: (stage: 'prepare' | 'sign' | 'submit') => Promise<void>
  prepared: (record: PreparedTransaction) => Promise<void>
  signed: (record: SignedTransaction) => Promise<void>
  mark_submitting: (record: SignedTransaction) => Promise<void>
  settled: (receipt: Receipt, record: PendingTransaction) => Promise<void>
}>
export type { Receipt } from './cache.ts'
export type TransactionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ExecutionCore = Readonly<{
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

export const bounded_request = async <T>(
  request: (signal: AbortSignal) => Promise<T>,
  milliseconds: number
): Promise<T> => {
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

/** Resume only the exact ordinary-member envelope for this execution lane. No key or rebuild is involved. */
const verify_signed_envelope = async (record: SignedTransaction, address: string | null | undefined): Promise<void> => {
  const transaction = Transaction.from(record.bytes).getData()
  const valid = [
    !!address,
    transaction.sender === address,
    TransactionDataBuilder.getDigestFromBytes(record.bytes) === record.digest,
    String(transaction.gasData.budget) === record.gas_budget_mist,
    record.signatures.length > 0,
  ].every(Boolean)
  if (!valid) throw new Error('[sdk] invalid durable signed envelope')
  const signers = await Promise.all(
    record.signatures.map((signature) => verifyTransactionSignature(record.bytes, signature))
  )
  if (!signers.some((signer) => signer.verifyAddress(address!)))
    throw new Error('[sdk] durable envelope signature does not authorize sender')
}

/** One execution boundary: submit once, recover by digest, then feed the ordinary receipt pipeline once. */
export const create_transaction_execution = ({
  core,
  key,
  address,
  storage = browser_transaction_storage(),
  on_receipt,
  journal,
  response_timeout_ms = 15_000,
  recovery_timeout_ms = 60_000,
}: Readonly<{
  core: ExecutionCore
  key: string
  address?: string | null
  storage?: TransactionStorage | null
  journal?: TransactionJournal
  on_receipt: (receipt: Receipt, gas_scope?: string, gas_payer?: string) => void
  response_timeout_ms?: number
  recovery_timeout_ms?: number
}>) => {
  let pending: PendingTransaction | null = null
  let prepared: PreparedTransaction | null = null
  let journal_loaded = !journal
  let queued = 0
  let execution_tail: Promise<unknown> = Promise.resolve()
  const storage_key = key.toLowerCase()
  const read_pending = (): PendingTransaction | null => {
    const stored = storage?.getItem(storage_key)
    return stored ? decode_pending(stored) : pending
  }
  const load_pending = async (): Promise<PendingTransaction | null> => {
    if (!journal) return read_pending()
    const record = await journal.read()
    journal_loaded = true
    if (record) {
      if (!isValidTransactionDigest(record.digest) || !['prepared', 'signed', 'submitting'].includes(record.phase))
        throw new Error('[sdk] invalid durable pending transaction')
      pending = { ...record, phase: 'submitted' }
    }
    return pending
  }
  const recover = async (record: PendingTransaction): Promise<Receipt> => {
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
      throw new Error(
        `[sdk] transaction outcome unknown: ${record.digest}; check this transaction before trying again`,
        { cause }
      )
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
    pending = record
    const receipt = await bounded_request(
      (signal) =>
        core.executeTransaction({ transaction: raw, signatures: [...signatures], include: record.include, signal }),
      response_timeout_ms
    )
      .then((receipt) => verify_receipt(receipt, record))
      .catch((error: unknown) => {
        console.warn('[sdk] submission response unavailable; recovering transaction', record.digest, error)
        return recover(record)
      })
    await accept(receipt, record)
    return receipt
  }
  const recover_pending = async (): Promise<boolean> => {
    const record = await load_pending()
    if (!record || record.phase !== 'submitted') return false
    await accept(await recover(record), record)
    pending = { digest: record.digest, phase: 'recovered' }
    return true
  }
  const resume_pending = async (): Promise<boolean> => {
    const saved = await journal?.read()
    if (!saved || saved.phase !== 'signed') return recover_pending()
    // Copy before awaiting provider verification or admission so a mutable adapter cannot swap bytes.
    const envelope = { ...saved, bytes: saved.bytes.slice(), signatures: [...saved.signatures] }
    const record: PendingTransaction = {
      digest: envelope.digest,
      phase: 'submitted',
      include: envelope.include,
      gas_scope: envelope.gas_scope,
      gas_payer: envelope.gas_payer,
    }
    pending = record
    journal_loaded = true
    await verify_signed_envelope(envelope, address)
    await journal!.admit('submit')
    await journal!.mark_submitting(envelope)
    await send_envelope(envelope.bytes, envelope.signatures, record)
    pending = { digest: record.digest, phase: 'recovered' }
    return true
  }
  return Object.freeze({
    is_transaction_idle: (): boolean => journal_loaded && queued === 0 && read_pending()?.phase !== 'submitted',
    enqueue: <T>(action: () => Promise<T>): Promise<T> => {
      queued += 1
      const result = execution_tail.then(action, action).finally(() => {
        queued -= 1
      })
      // Only the queue tail absorbs rejection; the caller retains the original failing promise.
      execution_tail = result.then(
        () => undefined,
        () => undefined
      )
      return result
    },
    recover_pending,
    resume_pending,
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
