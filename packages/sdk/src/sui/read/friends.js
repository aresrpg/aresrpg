import { bcs } from '@mysten/sui/bcs'
import { deriveObjectID } from '@mysten/sui/utils'

import { aresrpg_id } from '../../deployment/aresrpg.js'

import { get_object_json } from './_object.js'

// FRIENDS READ for the STANDALONE `aresrpg_social` package — the soulbound `FriendList` a player owns (§13).
// A `FriendList` is `{ id, owner, friends: VecSet<address> }`; it is address-owned (soulbound), so the frontend
// resolves its id from the deterministic derived address, then decodes it here. Returns `null` when unreadable
// (never a fake empty list — the caller distinguishes "no list yet" from "read failed" by the null).

/** Normalize a Move `VecSet<K>` json to a plain array of its keys. gRPC renders it as `{ contents: [...] }`
 *  (the inner `vector<K>`); tolerate a bare array or null too so a serializer drift never throws. */
function vec_set_keys(json) {
  if (json == null) return []
  if (Array.isArray(json)) return json
  if (typeof json === 'object' && Array.isArray(json.contents))
    return json.contents
  return []
}

/**
 * Decode a `FriendList` object by its id: `{ id, owner, friends: string[] }` (the whitelisted addresses), or null
 * if unreadable. The list is a ONE-WAY allowlist — no requests, no pending state to surface.
 * @param {import("../../../types.js").Context} context
 */
export function get_friend_list(context) {
  const { grpc_client } = context
  return async friend_list_id => {
    const json = await get_object_json(grpc_client, friend_list_id)
    if (!json) return null
    return {
      id: json.id ?? friend_list_id,
      owner: json.owner ?? null,
      friends: vec_set_keys(json.friends),
    }
  }
}

/**
 * Resolve an account's `FriendList` BY OWNER from the deterministic address claimed under the shared registry:
 * `derived_object::derive_address(registry, FriendKey(address))`. Returns `null` when either social id is
 * unstamped, the account has no list yet, or the read fails — the caller shows the empty roster + the
 * add-first-friend flow, never a fake list. `context` needs `{ grpc_client, network }`.
 * @param {import("../../../types.js").Context & { network: string }} context
 */
export function get_friend_list_by_owner(context) {
  const { network } = context
  return async owner => {
    const pkg = aresrpg_id(network, 'SOCIAL_PACKAGE_ID')
    const registry_id = aresrpg_id(network, 'SOCIAL_FRIEND_REGISTRY')
    if (!pkg || !registry_id || !owner) return null
    try {
      const friend_list_id = deriveObjectID(
        registry_id,
        `${pkg}::friends::FriendKey`,
        bcs.Address.serialize(owner).toBytes(),
      )
      return get_friend_list(context)(friend_list_id)
    } catch {
      return null
    }
  }
}
