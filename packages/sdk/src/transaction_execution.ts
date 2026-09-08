// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { isValidTransactionDigest } from '@mysten/sui/utils'

import { receipt_digest, type Receipt } from './cache.ts'

type ReceiptOptions = Readonly<{ include?: object; gas_scope?: string }>
type PendingTransaction = ReceiptOptions & Readonly<{ digest: string; phase: 'submitted' | 'visible' | 'recovered' }>
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
    (value.include !== undefined && (value.include === null || typeof value.include !== 'object')) ||
    (value.gas_scope !== undefined && typeof value.gas_scope !== 'string')
  )
    throw new Error('[sdk] invalid pending transaction record; refusing to submit')
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
  on_receipt,
  response_timeout_ms = 15_000,
  recovery_timeout_ms = 60_000,
}: Readonly<{
  core: ExecutionCore
  key: string
  storage?: TransactionStorage | null
  on_receipt: (receipt: Receipt, gas_scope?: string) => void
  response_timeout_ms?: number
  recovery_timeout_ms?: number
}>) => {
  let pending: PendingTransaction | null = null
  const storage_key = key.toLowerCase()
  const read_pending = (): PendingTransaction | null => {
    const stored = storage?.getItem(storage_key)
    return stored ? decode_pending(stored) : pending
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
  const accept = (receipt: Receipt, record: PendingTransaction): void => {
    // Keep recovery evidence until receipt processing succeeds. This callback accounts for failures too.
    on_receipt(receipt, record.gas_scope)
    pending = { digest: receipt_digest(receipt), phase: 'visible' }
    storage?.removeItem(storage_key)
  }
  return Object.freeze({
    before_next: async (): Promise<void> => {
      const record = read_pending()
      if (!record) return
      if (record.phase === 'recovered')
        throw new Error(
          `[sdk] previous transaction recovered: ${record.digest}; refresh your game state before trying again`
        )
      if (record.phase === 'submitted') {
        accept(await recover(record), record)
        pending = { digest: record.digest, phase: 'recovered' }
        // The original caller is gone. Invalidate this session's queued work until fresh state is loaded.
        throw new Error(
          `[sdk] previous transaction recovered: ${record.digest}; refresh your game state before trying again`
        )
      }
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
    submit: async (raw: Uint8Array, signature: string, options: ReceiptOptions = {}): Promise<Receipt> => {
      const previous = read_pending()
      if (previous && previous.phase !== 'visible')
        throw new Error(
          `[sdk] transaction outcome unknown: ${previous.digest}; check this transaction before trying again`
        )
      const record: PendingTransaction = {
        ...options,
        digest: TransactionDataBuilder.getDigestFromBytes(raw),
        phase: 'submitted',
        include: { ...options.include, effects: true, events: true },
      }
      // Storage failure is a pre-submission refusal, never a reason to send without recovery evidence.
      storage?.setItem(storage_key, JSON.stringify(record))
      pending = record
      const receipt = await bounded_request(
        (signal) =>
          core.executeTransaction({ transaction: raw, signatures: [signature], include: record.include, signal }),
        response_timeout_ms
      )
        .then((receipt) => verify_receipt(receipt, record))
        .catch((error: unknown) => {
          console.warn('[sdk] submission response unavailable; recovering transaction', record.digest, error)
          return recover(record)
        })
      accept(receipt, record)
      return receipt
    },
  })
}
