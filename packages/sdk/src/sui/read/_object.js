// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SHARED CHAIN-READ HELPERS for the NEW on-chain package reads (game / pools / dungeon / kolizeum). Zero-backend
// object fetches via the house gRPC Core client, mirroring `deployment/items.js`'s reads. THE ONE HOME for the
// getObject-to-json + Option/Balance/bigint normalizers so each package read module stays a thin decoder — every
// chain-object read in `sui/read/**` and `fight_read.js` goes through `get_object_json`, no second copy (#2054).

// #2054 — THE SEAM IS HONEST: `null` means GENUINE ABSENCE and nothing else. It used to catch every error to
// null, so a network blip, a decode miss and an empty dynamic field arrived at every consumer as the same
// value — the shape that let a ~570ms ledger lag render an empty zone over a full one (#2030's false void).
// Absent is DATA; failed is an ERROR; they never merge again.

/**
 * Is this the ledger's per-object "no such object" ANSWER (the call succeeded), rather than a failed call?
 *
 * SDK SOURCE — @mysten/sui 2.20.1's `client/errors.ts` gives `ObjectError` a structured `code` field;
 * `graphql/core.ts` emits `notFound`, while `jsonRpc/core.ts` converts the ledger's `notExists` / `deleted`
 * answers into that class. `client/core.ts::getObject` then throws that per-object result unchanged. Those
 * stable codes are the PRIMARY classifier; no translated or rewritten message can change their meaning.
 *
 * WIRE PROVENANCE — probed live against `https://fullnode.testnet.sui.io:443` on 2026-08-03 through the exact
 * gRPC `core.getObject({ include:{json:true} })` transport this module rides. gRPC 2.20.1 still reduces the
 * per-object `google.rpc.Status` to a PLAIN `Error`, with no `code` / `status` and message
 * `Object 0xde…de not found`. That legacy English shape remains a SECONDARY, id-bound compatibility arm only.
 *   · unreachable host → `RpcError` with `code: 'INTERNAL'` ("Unable to connect…") — the call FAILED.
 * Nothing else is recognised: an unclassified error is a failure and fails SHUT (it throws), because guessing
 * absence is precisely the bug this seam exists to kill.
 */
const ABSENT_OBJECT_ERROR_CODES = new Set(['notFound', 'notExists', 'deleted'])

const is_object_absent_answer = (error, object_id) => {
  if (error == null || typeof error !== 'object') return false
  const shaped = /** @type {{ name?: unknown, message?: unknown, code?: unknown, status?: unknown }} */ (
    error
  )
  // An SDK Error always has both fields (inherited fields still count). A partial serialized lookalike is not
  // positive evidence and must fail shut.
  if (
    typeof shaped.name !== 'string' ||
    shaped.name.length === 0 ||
    typeof shaped.message !== 'string' ||
    shaped.message.length === 0
  )
    return false

  // PRIMARY: @mysten/sui's ObjectError discriminator. Transport codes are uppercase grpc statuses and cannot
  // enter this set; a present status or unknown structured verdict also blocks the legacy message arm.
  if (shaped.status != null) return false
  if (typeof shaped.code === 'string') return ABSENT_OBJECT_ERROR_CODES.has(shaped.code)
  if (shaped.code != null) return false

  // SECONDARY: gRPC 2.20.1 discards the per-object Status structure. Bind the English phrase to the requested id
  // so an unrelated "not found" diagnostic cannot manufacture absence.
  return shaped.message.includes(object_id) && shaped.message.toLowerCase().includes('not found')
}

/**
 * getObject → flattened json (`include:{json:true}`).
 * @returns {Promise<any>} the object's json, or `null` when the object genuinely does not exist.
 * @throws when the READ fails — transport, an unclassified ledger error, or an object that answers without the
 *   json payload the read asked for. Decode errors surface ONCE, here, at the transport boundary.
 * @param {any} grpc_client the SDK's SuiGrpcClient (has `.core.getObject`)
 * @param {string} object_id
 */
export async function get_object_json(grpc_client, object_id) {
  const response = await grpc_client.core
    .getObject({ objectId: object_id, include: { json: true } })
    .catch((/** @type {any} */ error) => {
      if (is_object_absent_answer(error, object_id)) return { object: null }
      throw new Error(`[read/_object] object ${object_id} is unreadable`, {
        cause: error,
      })
    })
  if (
    response == null ||
    typeof response !== 'object' ||
    !Object.hasOwn(response, 'object') ||
    response.object === undefined
  )
    throw new Error(`[read/_object] object ${object_id} read answered without an object field`)
  const { object } = response
  if (object === null) return null // the ledger positively answered "nothing at this id"
  if (object.json == null)
    throw new Error(
      `[read/_object] object ${object_id} exists but answered without a json payload`,
    )
  return object.json
}

/** Normalize a Move `Option<T>` json (`{vec:[]}` / `{vec:[x]}` / `[x]` / bare / null) to `value | null`. */
export function option_value(opt) {
  if (opt == null) return null
  if (Array.isArray(opt)) return opt.length ? opt[0] : null
  if (typeof opt === 'object' && 'vec' in opt)
    return opt.vec.length ? opt.vec[0] : null
  return opt
}

/** Coerce a json numeric (string | number | bigint | null | undefined) to BigInt, defaulting to 0n. */
export function to_bigint(value) {
  return value == null ? 0n : BigInt(value)
}

/** A Move `Balance<T>` json flattens to `{ value }` (or a bare scalar) — read its amount as BigInt. */
export function balance_value(json) {
  if (json == null) return 0n
  if (typeof json === 'object' && 'value' in json) return to_bigint(json.value)
  return to_bigint(json)
}
