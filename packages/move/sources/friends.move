// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// FRIENDS — a NON-TRANSFERABLE, address-bound personal whitelist (legacy port, trimmed
/// down). Add or remove addresses freely; NO invites, NO acceptance, NO symmetry (unlike
/// a party — a whitelist is not a contract). Powers friends-only kolizeum lobbies and the
/// social UI. Address-bound, not character-bound: you befriend a wallet, all its characters
/// come along — a friend has no slot semantics, so the character key buys nothing.
///
/// SOULBOUND BY ABILITY: `FriendList` has `key` ONLY (no `store`) — `public_transfer` does
/// not compile for it and no module outside this one can move it. The single
/// `transfer::transfer` at creation binds it to its owner forever; there is NO transfer
/// door, so it is non-transferable by construction, not by a runtime check. Every mutator
/// re-asserts `sender == owner`.
///
/// ONE PER ADDRESS = DERIVED OBJECT (the house pattern): the list's UID is claimed from
/// `FriendKey(owner)` under the shared `FriendRegistry` — its OWN anchor, never the item
/// `TemplateRegistry` (that one belongs to the sealed content seeding; player writes do
/// not touch it). A second create aborts on-chain (TOCTOU-proof) and RPC derives the list
/// address without an indexer.
module aresrpg::friends;

use sui::{derived_object, vec_set::{Self, VecSet}};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EListExists: u64 = 2101; // create: this address already has a list
const ENotOwner: u64 = 2102; // add/remove: sender is not the list's owner
const EAlreadyFriend: u64 = 2103; // add: already whitelisted — abort, never a silent no-op
const ENotFriend: u64 = 2104; // remove: the address is not on the whitelist
const EFriendLimit: u64 = 2105; // add: a personal whitelist is capped at 100 addresses

const MAX_FRIENDS: u64 = 100;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// Shared social uniqueness anchor: one FriendList per address and one Party per character.
public struct FriendRegistry has key {
  id: UID,
}

public(package) fun u(registry: &FriendRegistry): &UID { &registry.id }
public(package) fun um(registry: &mut FriendRegistry): &mut UID { &mut registry.id }

/// Keys a list's derived address by its OWNER address (`copy + drop + store` — derived-object law).
public struct FriendKey(address) has copy, drop, store;

/// A soulbound whitelist of addresses. `key` ONLY → non-transferable (see module doc).
public struct FriendList has key {
  id: UID,
  owner: address,
  friends: VecSet<address>,
}

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::share_object(FriendRegistry { id: object::new(ctx) });
}

// ╔════════════════ [ Doors (api gates the version, then calls) ] ════════════ ]

/// Create the sender's ONE list with its first entry and bind it to them forever. Claims
/// `FriendKey(sender)` under the registry — a second call by the same address aborts.
public(package) fun create(registry: &mut FriendRegistry, first: address, ctx: &TxContext) {
  let owner = ctx.sender();
  assert!(!derived_object::exists(&registry.id, FriendKey(owner)), EListExists);
  let mut entries = vec_set::empty();
  entries.insert(first);
  let list = FriendList {
    id: derived_object::claim(&mut registry.id, FriendKey(owner)),
    owner,
    friends: entries,
  };
  transfer::transfer(list, owner); // key-only → the ONLY transfer this object ever sees
}

/// Whitelist `addr`. A duplicate add ABORTS (party parity) so the client learns it was
/// already present. (`addr`, not `friend` — `friend` is a Move keyword.)
public(package) fun set(list: &mut FriendList, addr: address, present: bool, ctx: &TxContext) {
  assert!(list.owner == ctx.sender(), ENotOwner);
  if (present) {
    assert!(!list.friends.contains(&addr), EAlreadyFriend);
    assert!(list.friends.length() < MAX_FRIENDS, EFriendLimit);
    list.friends.insert(addr);
  } else {
    assert!(list.friends.contains(&addr), ENotFriend);
    list.friends.remove(&addr);
  };
}

// ╔════════════════ [ Reads (kolizeum's friends-only gate + snapshot) ] ══════ ]

/// The whitelist as an owned set — a kolizeum SNAPSHOTS it at creation (the list is soulbound
/// to the owner, so a joiner can never present it live; the lobby carries the frozen copy).
public(package) fun s(list: &FriendList): VecSet<address> { list.friends }

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }

#[test_only]
public(package) fun registry_for_testing(ctx: &mut TxContext): FriendRegistry {
  FriendRegistry { id: object::new(ctx) }
}

#[test_only]
public(package) fun destroy_registry_for_testing(registry: FriendRegistry) {
  let FriendRegistry { id } = registry;
  id.delete();
}

#[test_only]
public(package) fun list_for_testing(owner: address, first: address, ctx: &mut TxContext): FriendList {
  let mut entries = vec_set::empty();
  entries.insert(first);
  FriendList { id: object::new(ctx), owner, friends: entries }
}

#[test_only]
public(package) fun destroy_for_testing(list: FriendList) {
  let FriendList { id, .. } = list;
  id.delete();
}
