// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// OBJECT-ARG SEAM (S-51b) — THE one home for the builders' ref-or-id contract. Every PTB builder object
// parameter accepts EITHER a plain object-id string (the historical shape — resolved by the client at build
// time, one `getObject` round-trip each) OR a caller-cached resolved ref, letting a hot caller build
// KIND-ONLY with ZERO network requests:
//
//   shared ref  { objectId, initialSharedVersion, mutable }  → tx.sharedObjectRef  (Sui freezes
//               initial_shared_version at share-time, so a cached pair is valid forever; `mutable` MUST
//               mirror the Move ref kind at the call-site — a false flag on a `&mut` arg fails at execution)
//   owned ref   { objectId, version, digest }                → tx.objectRef        (version/digest move on
//               every mutation — cache per read, never forever)
//
// The static deployment singletons (Version/GameConfig/policies/registries…) do NOT ride this seam — the
// builders resolve those themselves via `aresrpg_shared_ref` (deployment/aresrpg.js). This seam is for the
// RUNTIME objects only: world/fight/pool/kolizeum/kiosk/sale/party ids, content templates (ItemTemplate /
// MobTemplate / SpellTemplate / Recipe / CrushBoard) and owned passes/caps the caller already holds.

import { assert_chain_id } from '../pending_fight_id.js'

/**
 * A builder object parameter: an object-id string, a cached shared ref, or a cached owned ref.
 * @typedef {string
 *   | { objectId: string, initialSharedVersion: string | number, mutable: boolean }
 *   | { objectId: string, version: string | number, digest: string }
 * } ObjectArg
 */

/**
 * Place `ref_or_id` as a transaction object argument — `tx.object` for a string (client-resolved at build),
 * `tx.sharedObjectRef` / `tx.objectRef` for a caller-cached ref (static — no resolution round-trip).
 * Call it ONCE per distinct object per builder and reuse the returned argument across move calls.
 * Throws loudly on any other shape — a malformed ref must never silently degrade into a network resolve.
 * @param {import('@mysten/sui/transactions').Transaction} tx
 * @param {ObjectArg} ref_or_id
 * @returns {ReturnType<import('@mysten/sui/transactions').Transaction['object']>}
 */
export function as_object_arg(tx, ref_or_id) {
  // THE PENDING FENCE (#1609). This seam is the ONE boundary every PTB object parameter crosses, so asserting
  // here covers every write door taking a fight_id (and every other runtime object) with a single call — a new
  // door cannot forget it. A pending-branded session id has no on-chain identity: composing against it would
  // build a transaction the chain can never resolve, so it is a TYPED refusal, never a network resolve.
  assert_chain_id(ref_or_id, 'as_object_arg')
  if (typeof ref_or_id === 'string' && ref_or_id) return tx.object(ref_or_id)
  if (ref_or_id && typeof ref_or_id === 'object' && ref_or_id.objectId) {
    // Widen the union for shape discrimination — tsc cannot narrow a jsdoc union via bare property reads.
    const ref =
      /** @type {{ objectId: string, initialSharedVersion?: string | number, mutable?: boolean, version?: string | number, digest?: string }} */ (
        ref_or_id
      )
    if (typeof ref.mutable === 'boolean' && ref.initialSharedVersion != null)
      return tx.sharedObjectRef({
        objectId: ref.objectId,
        initialSharedVersion: ref.initialSharedVersion,
        mutable: ref.mutable,
      })
    if (ref.version != null && ref.digest)
      return tx.objectRef({
        objectId: ref.objectId,
        version: ref.version,
        digest: ref.digest,
      })
  }
  throw new Error(
    `[as_object_arg] expected an object-id string, {objectId, initialSharedVersion, mutable} or ` +
      `{objectId, version, digest} — got ${JSON.stringify(ref_or_id)}`,
  )
}
