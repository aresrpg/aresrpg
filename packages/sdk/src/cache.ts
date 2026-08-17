// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The resolution cache — the zero-roundtrip law's memory. Two tables:
//   owned  — objectId → {objectId, version, digest}: the EXACT ref an owned/immutable input
//            needs; changes on every touch, so receipts keep it fresh.
//   shared — objectId → {initialSharedVersion}: what a sharedObjectRef needs;
//            initialSharedVersion is STABLE for the object's whole life — learned once (from a
//            receipt that created it, or a hydrate), valid forever.
// RECEIPT-FED over the core-client shapes (gRPC/GraphQL): every executed transaction's
// `effects.changedObjects` carry the fresh state of everything it touched — after one bootstrap
// hydrate, the loop sustains itself with zero reads.

import { normalizeSuiObjectId } from '@mysten/sui/utils'

export type OwnedRef = { objectId: string; version: string; digest: string }
export type SharedEntry = { initialSharedVersion: string }
export type ResolutionCache = {
  owned: Map<string, OwnedRef>
  shared: Map<string, SharedEntry>
}

/** A core-client ObjectOwner, structurally — only the shared branch matters here. */
type ObjectOwner =
  | {
      $kind?: string
      AddressOwner?: string
      Immutable?: true
      Shared?: { initialSharedVersion?: string | number | bigint }
    }
  | null
  | undefined

type ChangedObject = {
  objectId?: string
  outputState?: string
  outputVersion?: string | number | bigint
  outputDigest?: string
  outputOwner?: ObjectOwner
  idOperation?: string
}

/** A TransactionResult / SimulateTransactionResult, whatever branch carries the effects. */
type Effects = {
  gasObject?: ChangedObject | null
  changedObjects?: ChangedObject[]
  gasUsed?: {
    computationCost?: string | number | bigint
    storageCost?: string | number | bigint
    storageRebate?: string | number | bigint
  }
  status?: { success?: boolean; error?: { message?: string } | string | null }
}

export type Receipt = {
  $kind?: string
  digest?: string
  Transaction?: { digest?: string; effects?: Effects; objectTypes?: Record<string, string>; events?: unknown }
  FailedTransaction?: { digest?: string; effects?: Effects; objectTypes?: Record<string, string>; events?: unknown }
  effects?: Effects
}

/** The digest of a receipt, whatever branch carries it, or null — display paths that can
 *  tolerate absence read this one. */
export const receipt_digest_or_null = (receipt: Receipt): string | null =>
  receipt.Transaction?.digest ?? receipt.FailedTransaction?.digest ?? receipt.digest ?? null

/** The digest of a receipt — THROWS when absent. A receipt with no digest is a broken
 *  transport; handing a caller a made-up id would end up shown to a human as a transaction. */
export const receipt_digest = (receipt: Receipt): string => {
  const digest = receipt_digest_or_null(receipt)
  if (!digest) throw new Error('The transaction receipt carries no digest — refusing to fabricate one.')
  return digest
}

/** The parsed fields of the first receipt event whose type ends with `suffix`, or null —
 *  the door builders read their own emits from here (a receipt tells the client everything
 *  about its OWN action; the server only streams what the client cannot know). */
export const receipt_events = (receipt: Receipt, suffix: string): readonly Record<string, unknown>[] => {
  const visit = (value: unknown): readonly Record<string, unknown>[] => {
    if (!value || typeof value !== 'object') return []
    if (Array.isArray(value)) return value.flatMap(visit)
    const row = value as Record<string, unknown>
    const event_type = String(row.type ?? row.eventType ?? '')
    if (event_type.endsWith(suffix)) {
      const parsed = (row.json ?? row.parsedJson ?? row.data) as Record<string, unknown> | undefined
      return parsed ? [parsed] : []
    }
    return Object.values(row).flatMap(visit)
  }
  // Only the events branches are searched — recursing the whole receipt would let any nested
  // object with a `type` + `json` pair masquerade as an event under a widened `include`.
  return visit(receipt.Transaction?.events ?? receipt.FailedTransaction?.events ?? null)
}

export const receipt_event = (receipt: Receipt, suffix: string): Record<string, unknown> | null =>
  receipt_events(receipt, suffix)[0] ?? null

/** A fetched core-client Object (a hydrate row). */
export type FetchedObject = {
  objectId?: string
  version?: string | number | bigint
  digest?: string
  owner?: ObjectOwner
  type?: string
  balance?: string
  json?: Record<string, unknown> | null
}

/** A fresh, empty cache. Plain data — hold it wherever your state lives. */
export const create_cache = (): ResolutionCache => ({ owned: new Map(), shared: new Map() })

/** The initial shared version out of a core-client ObjectOwner, or undefined. */
const shared_version_of = (owner: ObjectOwner) => owner?.Shared?.initialSharedVersion

const effects_of = (receipt: Receipt | null | undefined): Effects | undefined =>
  receipt?.Transaction?.effects ?? receipt?.FailedTransaction?.effects ?? receipt?.effects

/** The changedObjects rows of a receipt, including the separately exposed gas object. */
const changed_rows = (receipt: Receipt | null | undefined): ChangedObject[] => {
  const effects = effects_of(receipt)
  return effects?.gasObject ? [effects.gasObject, ...(effects.changedObjects ?? [])] : (effects?.changedObjects ?? [])
}

/** The exact post-transaction gas ref when it remains owned by `owner`. `undefined` means the
 *  receipt carried no gas-object fact; `null` means the former payment is no longer reusable. */
export const receipt_gas_ref = (receipt: Receipt, owner: string): OwnedRef | null | undefined => {
  const gas = effects_of(receipt)?.gasObject
  if (!gas) return undefined
  if (
    gas.outputState !== 'ObjectWrite' ||
    gas.outputOwner?.AddressOwner !== owner ||
    !gas.objectId ||
    !gas.outputVersion ||
    !gas.outputDigest
  )
    return null
  return Object.freeze({ objectId: gas.objectId, version: String(gas.outputVersion), digest: gas.outputDigest })
}

/** The one write door: fold a transaction result's changed objects into the cache. Stale
 *  versions never regress a newer entry (results can land out of order). Deleted objects
 *  leave. Returns the same cache (the cache IS the store; this is its only writer). */
export const absorb_receipt = (cache: ResolutionCache, receipt: Receipt | null | undefined): ResolutionCache => {
  for (const change of changed_rows(receipt)) {
    const { objectId, outputState, outputVersion, outputDigest, outputOwner, idOperation } = change
    if (!objectId) continue
    const canonical_id = normalizeSuiObjectId(objectId)
    if (idOperation === 'Deleted' || outputState === 'DoesNotExist') {
      cache.owned.delete(canonical_id)
      cache.shared.delete(canonical_id)
      continue
    }
    const shared_version = shared_version_of(outputOwner)
    if (shared_version !== undefined) {
      if (!cache.shared.has(canonical_id))
        cache.shared.set(canonical_id, { initialSharedVersion: String(shared_version) })
      continue
    }
    if (!outputVersion || !outputDigest) continue
    const known = cache.owned.get(canonical_id)
    if (known && BigInt(known.version) >= BigInt(outputVersion)) continue
    cache.owned.set(canonical_id, { objectId: canonical_id, version: String(outputVersion), digest: outputDigest })
  }
  return cache
}

/** Seed one object from a fetched core-client `Object` (a hydrate) — owned or shared, decided
 *  by its owner field. */
export const absorb_object = (cache: ResolutionCache, data: FetchedObject): ResolutionCache => {
  if (!data?.objectId) return cache
  const canonical_id = normalizeSuiObjectId(data.objectId)
  const shared_version = shared_version_of(data.owner)
  if (shared_version !== undefined) {
    cache.shared.set(canonical_id, { initialSharedVersion: String(shared_version) })
  } else if (data.version && data.digest) {
    const known = cache.owned.get(canonical_id)
    if (!known || BigInt(known.version) < BigInt(data.version)) {
      cache.owned.set(canonical_id, { objectId: canonical_id, version: String(data.version), digest: data.digest })
    }
  }
  return cache
}

/** Freshest known OWNED ref, or undefined. */
export const owned_ref = (cache: ResolutionCache, object_id: string): OwnedRef | undefined =>
  cache.owned.get(normalizeSuiObjectId(object_id))

/** Known SHARED shape ({initialSharedVersion}), or undefined. */
export const shared_ref = (cache: ResolutionCache, object_id: string): SharedEntry | undefined =>
  cache.shared.get(normalizeSuiObjectId(object_id))
