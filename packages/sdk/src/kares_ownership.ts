// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { GrpcTypes, type SuiGrpcClient } from '@mysten/sui/grpc'
import type { SuiClientTypes } from '@mysten/sui/client'
import { normalizeStructTag, normalizeSuiObjectId } from '@mysten/sui/utils'

import type { Receipt } from './cache.ts'
import type { KaresPins } from './kares_ptb.ts'

/** A certified write is newer than the RPC read; retry the read, never the transaction. */
export class KaresSnapshotPending extends Error {}

export type FinanceObject = SuiClientTypes.Object<{ content: true }>
export type MissingPosition = Readonly<{ id: string; version: bigint }>
type PositionResolution = Readonly<{ object: FinanceObject }> | Readonly<{ receipt: Receipt }>

const cache_change = (change: SuiClientTypes.ChangedObject) => ({
  objectId: change.objectId,
  outputState: change.outputState,
  outputVersion: change.outputVersion ?? undefined,
  outputDigest: change.outputDigest ?? undefined,
  outputOwner: change.outputOwner,
  idOperation: change.idOperation,
})

/** Keep the validated Core receipt's cache fields and normalize nullable output references. */
const cache_receipt = (transaction: SuiClientTypes.Transaction<{ effects: true; objectTypes: true }>): Receipt => ({
  $kind: 'Transaction',
  Transaction: {
    digest: transaction.digest,
    objectTypes: transaction.objectTypes,
    effects: {
      status: transaction.effects.status,
      changedObjects: transaction.effects.changedObjects.map(cache_change),
      gasObject: transaction.effects.gasObject ? cache_change(transaction.effects.gasObject) : null,
    },
  },
})

/** Query one exact object, never a wallet-wide transaction history or a transaction retry. */
const latest_mutation = async (client: SuiGrpcClient, id: string): Promise<string> => {
  const query = client.ledgerService.listTransactions(
    {
      filter: {
        terms: [
          {
            literals: [
              { negated: false, predicate: { oneofKind: 'affectedObject', affectedObject: { objectId: id } } },
            ],
          },
        ],
      },
      options: { limit: 1, ordering: GrpcTypes.Ordering.DESCENDING },
      readMask: { paths: ['digest'] },
    },
    { abort: AbortSignal.timeout(10_000) }
  )
  let digest: string | undefined
  for await (const frame of query.responses) digest = frame.transaction?.digest ?? digest
  if (!digest) throw new KaresSnapshotPending('KARES ownership snapshot is behind a certified transaction')
  return digest
}

/** A certificate must consume the known owned version; NOT_FOUND alone proves nothing. */
const assert_consumed = (change: SuiClientTypes.ChangedObject, minimum: bigint, owner: string): void => {
  if (change.idOperation !== 'Deleted' || change.outputState !== 'DoesNotExist')
    throw new KaresSnapshotPending('KARES ownership snapshot is behind a certified transaction')
  if (change.inputVersion === null || BigInt(change.inputVersion) < minimum)
    throw new Error('KARES deletion receipt is older than the observed position')
  if (change.inputOwner?.$kind !== 'AddressOwner' || normalizeSuiObjectId(change.inputOwner.AddressOwner) !== owner)
    throw new Error('KARES deletion receipt belongs to another owner')
}

const deletion_receipt = async (client: SuiGrpcClient, missing: MissingPosition, owner: string): Promise<Receipt> => {
  const digest = await latest_mutation(client, missing.id)
  const result = await client.core.getTransaction({
    digest,
    include: { effects: true, objectTypes: true },
    signal: AbortSignal.timeout(10_000),
  })
  if (
    result.$kind !== 'Transaction' ||
    result.Transaction.digest !== digest ||
    !result.Transaction.effects?.status.success
  )
    throw new Error('KARES ownership change has no successful certified receipt')
  const change = result.Transaction.effects.changedObjects.find(({ objectId }) => objectId === missing.id)
  if (!change) throw new KaresSnapshotPending('KARES ownership snapshot is behind a certified transaction')
  assert_consumed(change, missing.version, owner)
  return cache_receipt(result.Transaction)
}

const resolve_position = async (
  client: SuiGrpcClient,
  pins: KaresPins,
  owner: string,
  missing: MissingPosition,
  object: FinanceObject | Error
): Promise<PositionResolution> => {
  if (object instanceof Error) {
    if (Reflect.get(object, 'code') !== 'notExists' || Reflect.get(object, 'objectId') !== missing.id) throw object
    return { receipt: await deletion_receipt(client, missing, owner) }
  }
  const types = [`${pins.original}::offering::Contribution`, `${pins.original}::staking::StakePosition`].map(
    normalizeStructTag
  )
  if (normalizeSuiObjectId(object.objectId) !== missing.id || !types.includes(normalizeStructTag(object.type)))
    throw new Error('Unexpected KARES position returned during ownership reconciliation')
  if (object.owner.$kind !== 'AddressOwner' || normalizeSuiObjectId(object.owner.AddressOwner) !== owner)
    throw new Error('KARES position belongs to another wallet')
  return { object }
}

/** Recover omitted live rows or prove consumption, including a claim before the first indexed read. */
export const reconcile_kares_positions = async (
  client: SuiGrpcClient,
  pins: KaresPins,
  owner: string,
  missing: readonly MissingPosition[]
): Promise<readonly PositionResolution[]> => {
  if (!missing.length) return []
  const { objects } = await client.core.getObjects({
    objectIds: missing.map(({ id }) => id),
    include: { content: true },
  })
  if (objects.length !== missing.length) throw new Error('Incomplete KARES ownership lookup')
  const resolved = await Promise.allSettled(
    missing.map((position, index) => resolve_position(client, pins, owner, position, objects[index]))
  )
  return resolved.map((result) => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  })
}
