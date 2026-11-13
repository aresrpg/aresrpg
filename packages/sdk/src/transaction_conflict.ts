// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { isValidTransactionDigest, normalizeSuiObjectId } from '@mysten/sui/utils'

import type { FetchedObject, Receipt } from './cache.ts'

export type ConflictEnvelope = Readonly<{ digest: string; bytes: Uint8Array }>
export type ConflictReader = Readonly<{
  getObjects?: (input: {
    objectIds: string[]
    include?: { json?: boolean; previousTransaction?: boolean }
    signal?: AbortSignal
  }) => Promise<{ objects: FetchedObject[] }>
  getTransaction?: (input: { digest: string; include: { effects: true }; signal: AbortSignal }) => Promise<Receipt>
}>
const gas_inputs = (envelope: ConflictEnvelope) => {
  if (TransactionDataBuilder.getDigestFromBytes(envelope.bytes) !== envelope.digest)
    throw new Error('conflict_envelope_digest_mismatch')
  const transaction = Transaction.from(envelope.bytes).getData()
  return { owner: transaction.gasData.owner ?? transaction.sender, refs: transaction.gasData.payment ?? [] }
}

/** Only a different checkpointed transaction consuming an EXACT owned gas ref proves exclusion.
 * A newer object, missing original receipt, read-only/shared input or error text proves nothing. */
export const proves_transaction_conflict = (envelope: ConflictEnvelope, receipt: Receipt): boolean => {
  const { owner, refs } = gas_inputs(envelope)
  const { digest = '', checkpoint = '', effects = {} } = receipt.Transaction ?? receipt.FailedTransaction ?? {}
  const { success } = effects.status ?? {}
  const valid = [
    !!digest,
    isValidTransactionDigest(digest),
    digest !== envelope.digest,
    /^[0-9]+$/.test(checkpoint ?? ''),
    effects.transactionDigest === digest,
    typeof success === 'boolean',
  ].every(Boolean)
  if (!valid) return false
  return (effects.changedObjects ?? []).some((row) => {
    const consumed = row.outputState === 'DoesNotExist' && row.idOperation === 'Deleted'
    const advanced =
      row.outputState === 'ObjectWrite' && BigInt(row.outputVersion ?? -1) > BigInt(row.inputVersion ?? -1)
    return [
      row.inputState === 'Exists',
      !!owner,
      row.inputOwner?.AddressOwner === owner,
      consumed || advanced,
      refs.some(
        (ref) =>
          ref.objectId === normalizeSuiObjectId(row.objectId ?? '') &&
          ref.version === String(row.inputVersion) &&
          ref.digest === row.inputDigest
      ),
    ].every(Boolean)
  })
}

/** Current coin provenance only discovers a candidate; certified exact consumption owns the proof.
 * A later descendant or unavailable historical receipt leaves recovery unresolved. */
export const read_transaction_conflict = async (
  reader: ConflictReader,
  envelope: ConflictEnvelope,
  signal: AbortSignal
): Promise<Receipt | null> => {
  if (!reader.getObjects || !reader.getTransaction) return null
  const { refs } = gas_inputs(envelope)
  if (!refs.length) return null
  const { objects } = await reader.getObjects({
    objectIds: refs.map((ref) => ref.objectId),
    include: { previousTransaction: true },
    signal,
  })
  const candidates = [
    ...new Set(
      objects
        .filter((row) => refs.some((ref) => ref.objectId === row.objectId))
        .map((row) => row.previousTransaction)
        .filter((digest): digest is string =>
          [typeof digest === 'string', digest !== envelope.digest, isValidTransactionDigest(digest ?? '')].every(
            Boolean
          )
        )
    ),
  ]
  for (const digest of candidates) {
    const receipt = await reader.getTransaction({ digest, include: { effects: true }, signal })
    const transaction = receipt.Transaction ?? receipt.FailedTransaction
    if (transaction?.digest === digest && proves_transaction_conflict(envelope, receipt)) return receipt
  }
  return null
}
