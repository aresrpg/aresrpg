// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SHARED CHAIN-READ HELPERS for the NEW on-chain package reads (game / pools / dungeon / kolizeum). Zero-backend
// object fetches via the house gRPC Core client, mirroring `deployment/items.js`'s reads. One home for the
// getObject-to-json + Option/Balance/bigint normalizers so each package read module stays a thin decoder.

/**
 * getObject → flattened json (`include:{json:true}`), or null on absence / error.
 * @param {any} grpc_client the SDK's SuiGrpcClient (has `.core.getObject`)
 * @param {string} object_id
 */
export async function get_object_json(grpc_client, object_id) {
  try {
    const { object } = await grpc_client.core.getObject({
      objectId: object_id,
      include: { json: true },
    })
    return object?.json ?? null
  } catch {
    return null
  }
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
