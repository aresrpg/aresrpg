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

/** A fresh, empty cache. Plain data — hold it wherever your state lives. */
export const create_cache = () => ({ owned: new Map(), shared: new Map() })

/** The initial shared version out of a core-client ObjectOwner, or undefined. */
const shared_version_of = (owner) => owner?.Shared?.initialSharedVersion

/** The changedObjects rows of a TransactionResult / SimulateTransactionResult, whatever branch. */
const changed_rows = (receipt) =>
  receipt?.Transaction?.effects?.changedObjects ??
  receipt?.FailedTransaction?.effects?.changedObjects ??
  receipt?.effects?.changedObjects ??
  []

/** The one write door: fold a transaction result's changed objects into the cache. Stale
 *  versions never regress a newer entry (results can land out of order). Deleted objects
 *  leave. Returns the same cache (the cache IS the store; this is its only writer). */
export const absorb_receipt = (cache, receipt) => {
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
export const absorb_object = (cache, data) => {
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
export const owned_ref = (cache, object_id) => cache.owned.get(object_id)

/** Known SHARED shape ({initialSharedVersion}), or undefined. */
export const shared_ref = (cache, object_id) => cache.shared.get(object_id)
