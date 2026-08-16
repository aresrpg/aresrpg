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

export type OwnedRef = { objectId: string; version: string; digest: string }
export type SharedEntry = { initialSharedVersion: string }
export type ResolutionCache = {
  owned: Map<string, OwnedRef>
  shared: Map<string, SharedEntry>
}

/** A core-client ObjectOwner, structurally — only the shared branch matters here. */
type ObjectOwner =
  | { $kind?: string; AddressOwner?: string; Shared?: { initialSharedVersion?: string | number | bigint } }
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
  Transaction?: { digest?: string; effects?: Effects }
  FailedTransaction?: { digest?: string; effects?: Effects }
  effects?: Effects
}

/** The digest of a receipt, whatever branch carries it. */
export const receipt_digest = (receipt: Receipt): string =>
  receipt.Transaction?.digest ?? receipt.FailedTransaction?.digest ?? receipt.digest ?? 'receipt'

/** The parsed fields of the first receipt event whose type ends with `suffix`, or null —
 *  the door builders read their own emits from here (a receipt tells the client everything
 *  about its OWN action; the server only streams what the client cannot know). */
export const receipt_event = (receipt: Receipt, suffix: string): Record<string, unknown> | null => {
  const visit = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object') return null
    if (Array.isArray(value)) {
      for (const row of value) {
        const found = visit(row)
        if (found) return found
      }
      return null
    }
    const row = value as Record<string, unknown>
    const event_type = String(row.type ?? row.eventType ?? '')
    if (event_type.endsWith(suffix)) {
      const parsed = (row.json ?? row.parsedJson ?? row.data) as Record<string, unknown> | undefined
      if (parsed) return parsed
    }
    for (const child of Object.values(row)) {
      const found = visit(child)
      if (found) return found
    }
    return null
  }
  return visit(receipt)
}

/** A fetched core-client Object (a hydrate row). */
export type FetchedObject = {
  objectId?: string
  version?: string | number | bigint
  digest?: string
  owner?: ObjectOwner
}

/** A fresh, empty cache. Plain data — hold it wherever your state lives. */
export const create_cache = (): ResolutionCache => ({ owned: new Map(), shared: new Map() })

/** The initial shared version out of a core-client ObjectOwner, or undefined. */
const shared_version_of = (owner: ObjectOwner) => owner?.Shared?.initialSharedVersion

/** The changedObjects rows of a receipt, whatever branch. */
const changed_rows = (receipt: Receipt | null | undefined): ChangedObject[] =>
  receipt?.Transaction?.effects?.changedObjects ??
  receipt?.FailedTransaction?.effects?.changedObjects ??
  receipt?.effects?.changedObjects ??
  []

/** The one write door: fold a transaction result's changed objects into the cache. Stale
 *  versions never regress a newer entry (results can land out of order). Deleted objects
 *  leave. Returns the same cache (the cache IS the store; this is its only writer). */
export const absorb_receipt = (cache: ResolutionCache, receipt: Receipt | null | undefined): ResolutionCache => {
  for (const change of changed_rows(receipt)) {
    const { objectId, outputState, outputVersion, outputDigest, outputOwner, idOperation } = change
    if (!objectId) continue
    if (idOperation === 'Deleted' || outputState === 'DoesNotExist') {
      cache.owned.delete(objectId)
      cache.shared.delete(objectId)
      continue
    }
    const shared_version = shared_version_of(outputOwner)
    if (shared_version !== undefined) {
      if (!cache.shared.has(objectId)) cache.shared.set(objectId, { initialSharedVersion: String(shared_version) })
      continue
    }
    if (!outputVersion || !outputDigest) continue
    const known = cache.owned.get(objectId)
    if (known && BigInt(known.version) >= BigInt(outputVersion)) continue
    cache.owned.set(objectId, { objectId, version: String(outputVersion), digest: outputDigest })
  }
  return cache
}

/** Seed one object from a fetched core-client `Object` (a hydrate) — owned or shared, decided
 *  by its owner field. */
export const absorb_object = (cache: ResolutionCache, data: FetchedObject): ResolutionCache => {
  if (!data?.objectId) return cache
  const shared_version = shared_version_of(data.owner)
  if (shared_version !== undefined) {
    cache.shared.set(data.objectId, { initialSharedVersion: String(shared_version) })
  } else if (data.version && data.digest) {
    const known = cache.owned.get(data.objectId)
    if (!known || BigInt(known.version) < BigInt(data.version)) {
      cache.owned.set(data.objectId, { objectId: data.objectId, version: String(data.version), digest: data.digest })
    }
  }
  return cache
}

/** Freshest known OWNED ref, or undefined. */
export const owned_ref = (cache: ResolutionCache, object_id: string): OwnedRef | undefined => cache.owned.get(object_id)

/** Known SHARED shape ({initialSharedVersion}), or undefined. */
export const shared_ref = (cache: ResolutionCache, object_id: string): SharedEntry | undefined =>
  cache.shared.get(object_id)
