import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID } from '@mysten/sui/utils'

import { aresrpg_deployment } from '../../deployment/aresrpg.js'

import { get_object_json } from './_object.js'

// ZONE-STATE READ — a discovered zone's on-chain state straight off its dynamic field. SEARCH-COST REWORK
// — the Zone DF no longer stores spawn rows — it holds `{ discovered_at_ms, seed, mob_bitmap,
// res_bitmap }` and the FULL spawn lists DERIVE from the seed (`@aresrpg/sim` `zone_derive.js::derive_zone`,
// the byte-exact mirror of the chain's own `zone_comp`/`zone_gen` derivation). This module reads + normalises
// that raw state in ONE derived-DF object fetch; the CALLER (the frontend `zone_rows` composer, the localnet
// bots) joins it with the `get_world` table snapshot and derives the rows. An undiscovered zone has NO field
// (sparse §17.10) → null, which IS the "unsearched" signal.

/** BCS of `zones::ZoneKey { zx: u32, zy: u32 }` — field order mirrors the Move declaration. */
const zone_key_bcs = bcs.struct('ZoneKey', { zx: bcs.u32(), zy: bcs.u32() })
const zone_group_root_key_bcs = bcs.struct('ZoneGroupRootKey', {
  zx: bcs.u32(),
  zy: bcs.u32(),
})

/** Serialized `ZoneKey` bytes for the DF-id derivation (8 bytes, two LE u32). Exported for tests. */
export function zone_key_bytes(zx, zy) {
  return zone_key_bcs.serialize({ zx, zy }).toBytes()
}

/** Serialized `ZoneGroupRootKey` bytes (same two-LE-u32 field order, distinct Move type identity). */
export function zone_group_root_key_bytes(zx, zy) {
  return zone_group_root_key_bcs.serialize({ zx, zy }).toBytes()
}

/** Normalise a json `vector<u8>` (number[] | base64 string | Uint8Array | absent) to a plain byte array. */
function to_bytes(v) {
  if (v == null) return []
  if (Array.isArray(v)) return v.map(Number)
  if (v instanceof Uint8Array) return [...v]
  if (typeof v === 'string') {
    // base64 (a gRPC json encoding for byte vectors)
    const bin =
      typeof atob === 'function'
        ? atob(v)
        : Buffer.from(v, 'base64').toString('binary')
    return [...bin].map(c => c.charCodeAt(0))
  }
  return []
}

/**
 * Decode a `Zone` DF value json into the raw zone state. `seed` is a full u64 → STRING (2^53 law — the sim
 * derivation masks it to 32 bits itself). Bitmaps are plain byte arrays (bit i of entry i>>3 marks derivation
 * index i CONSUMED — `zone_derive.js::bit_get` reads them). Exported for tests.
 * @param {any} value the `Field<ZoneKey, Zone>` json's `.value`
 * @returns {{ discovered_at_ms:number, seed:string, mob_bitmap:number[], res_bitmap:number[] }}
 */
export function decode_zone_state(value) {
  return {
    discovered_at_ms: Number(value?.discovered_at_ms ?? 0),
    seed: String(value?.seed ?? 0),
    mob_bitmap: to_bytes(value?.mob_bitmap),
    res_bitmap: to_bytes(value?.res_bitmap),
  }
}

/** Decode the adjacent `ZoneGroupCommitment { root, count }` DF value. */
export function decode_zone_group_commitment(value) {
  return {
    root: to_bytes(value?.root),
    count: Number(value?.count ?? 0),
  }
}

/**
 * Read zone `(zx, zy)`'s raw state in `world_id`: `{ discovered_at_ms, seed, mob_bitmap, res_bitmap }`, or
 * **null when the zone is undiscovered** (its DF does not exist — the honest "unsearched" signal). Feed the
 * result plus the `get_world` doc into `@aresrpg/sim`'s `derive_zone` to obtain the live spawn rows.
 * @param {import("../../../types.js").Context} context
 */
export function get_zone_state(context) {
  const { grpc_client, network } = context
  return async (world_id, zx, zy) => {
    const dep = aresrpg_deployment(network, context.ids?.aresrpg)
    const field_id = deriveDynamicFieldID(
      world_id,
      `${dep.PACKAGE_ID}::zones::ZoneKey`,
      zone_key_bytes(zx, zy),
    )
    const json = await get_object_json(grpc_client, field_id)
    if (json?.value == null) return null
    return decode_zone_state(json.value)
  }
}

/**
 * Read the adjacent search-time mob commitment for zone `(zx, zy)`, or null when the root DF is absent or
 * unreadable. The key was introduced by an upgrade, so its introducing package id is distinct from PACKAGE_ID;
 * the first ceremony uses LATEST_PACKAGE_ID, and later callers may pin its immutable origin through
 * `group_root_package_id`.
 * @param {import("../../../types.js").Context & { network:'mainnet'|'testnet'|'devnet'|'localnet',
 *   ids?: { aresrpg?: import('../../deployment/aresrpg.js').AresrpgIds },
 *   group_root_package_id?:string }} context
 * @returns {(world_id:string, zx:number, zy:number) =>
 *   Promise<{ root:number[], count:number } | null>}
 */
export function get_zone_group_commitment(context) {
  const { grpc_client, network } = context
  return async (world_id, zx, zy) => {
    const dep = aresrpg_deployment(network, context.ids?.aresrpg)
    const origins = [
      context.group_root_package_id,
      dep.ZONE_GROUP_ROOT_PACKAGE_ID,
      dep.LATEST_PACKAGE_ID,
    ].filter((origin, index, all) => origin && all.indexOf(origin) === index)
    for (const origin of origins) {
      const field_id = deriveDynamicFieldID(
        world_id,
        `${origin}::zones::ZoneGroupRootKey`,
        zone_group_root_key_bytes(zx, zy),
      )
      const json = await get_object_json(grpc_client, field_id)
      if (json?.value != null) return decode_zone_group_commitment(json.value)
    }
    return null
  }
}
