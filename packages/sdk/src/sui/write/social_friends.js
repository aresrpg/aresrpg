// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'

// FRIENDS PTB BUILDERS for the STANDALONE `aresrpg_social` package's `friends` module — a NON-TRANSFERABLE,
// address-bound personal whitelist (§13). There is NO invite / accept / request flow on-chain and none here:
// the list is a ONE-WAY allowlist its owner edits directly (`add`/`remove`), mirroring the sealed "Command
// Roster" design pick (DECISIONS 07-08: friends = soulbound address whitelist, no invites). The Kolizeum
// friends-only reader snapshots this same object at lobby-creation time.
//
// FROZEN Move signatures — read firsthand from packages/move/social/sources/friends.move:
//   public fun create_friend_list(registry: &mut FriendRegistry, version: &Version, ctx)  // one per address (derived-object gate; a 2nd call ABORTS)
//   public fun add_friend(list: &mut FriendList, addr: address, version: &Version, ctx)    // owner-signed; duplicate-add ABORTS
//   public fun remove_friend(list: &mut FriendList, addr: address, version: &Version, ctx) // owner-signed; not-present ABORTS
//
// social is a SATELLITE package (its own id + its own shared Version + a shared FriendRegistry seeded at
// publish) — every id resolves through the ONE deployment home (deployment/aresrpg.js), NON-required (the
// social singletons must never block the core create/shop/fight/pool flows), so each builder guards the
// specific id it touches and refuses loudly when unset (stamp-or-throw; no builder invents an id).

/** Resolve a NON-required social deployment id or throw loudly (the "refuse, never guess" gate). */
function require_id(value, name) {
  if (!value)
    throw new Error(
      `[social] ${name} is not deployed — stamp it in src/deployment/aresrpg.js before this flow.`,
    )
  return value
}

/**
 * CREATE the sender's ONE friend list (empty, soulbound to them). Claims the derived-object slot under the shared
 * `FriendRegistry` — a second call by the same address ABORTS on-chain (`EListExists`), so this is safe to fire
 * once at first-friend time. Needs the `SOCIAL_PACKAGE_ID` + `SOCIAL_VERSION` + `SOCIAL_FRIEND_REGISTRY` ids.
 * @param {import("../../../types.js").Context} context
 */
export function create_friend_list_ptb(context) {
  const { network } = context
  return ({ tx = new Transaction() } = {}) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    tx.moveCall({
      target: `${require_id(a.SOCIAL_PACKAGE_ID, 'SOCIAL_PACKAGE_ID')}::friends::create_friend_list`,
      arguments: [
        shared_object_arg(tx, network, 'SOCIAL_FRIEND_REGISTRY', true, a.SOCIAL_FRIEND_REGISTRY), // registry: &mut FriendRegistry (S-51b static — &mut → mutable:true)
        shared_object_arg(tx, network, 'SOCIAL_VERSION', false, a.SOCIAL_VERSION), // version: &Version (social's own — S-51b static)
      ],
    })
    return tx
  }
}

/**
 * WHITELIST `addr` on the account's `friend_list_id`. Owner-signed on-chain (`ENotOwner`); a duplicate add ABORTS
 * (`EAlreadyFriend`) so the caller learns the address was already present rather than silently no-op'ing.
 * @param {import("../../../types.js").Context} context
 */
export function add_friend_ptb(context) {
  const { network } = context
  return ({ friend_list_id, addr, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    tx.moveCall({
      target: `${require_id(a.SOCIAL_PACKAGE_ID, 'SOCIAL_PACKAGE_ID')}::friends::add_friend`,
      arguments: [
        as_object_arg(tx, friend_list_id), // list: &mut FriendList (the caller's own; OWNED — ref-or-id seam)
        tx.pure.address(addr), // addr: address
        shared_object_arg(tx, network, 'SOCIAL_VERSION', false, a.SOCIAL_VERSION), // version: &Version (S-51b static)
      ],
    })
    return tx
  }
}

/**
 * REMOVE `addr` from the account's `friend_list_id`. Owner-signed on-chain (`ENotOwner`); aborts (`ENotFriend`) if
 * the address is not on the whitelist.
 * @param {import("../../../types.js").Context} context
 */
export function remove_friend_ptb(context) {
  const { network } = context
  return ({ friend_list_id, addr, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    tx.moveCall({
      target: `${require_id(a.SOCIAL_PACKAGE_ID, 'SOCIAL_PACKAGE_ID')}::friends::remove_friend`,
      arguments: [
        as_object_arg(tx, friend_list_id), // list: &mut FriendList (the caller's own; OWNED — ref-or-id seam)
        tx.pure.address(addr), // addr: address
        shared_object_arg(tx, network, 'SOCIAL_VERSION', false, a.SOCIAL_VERSION), // version: &Version (S-51b static)
      ],
    })
    return tx
  }
}
