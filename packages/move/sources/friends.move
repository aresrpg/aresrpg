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

use sui::{derived_object, event, vec_set::{Self, VecSet}};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EListExists: u64 = 2101; // create: this address already has a list
const ENotOwner: u64 = 2102; // add/remove: sender is not the list's owner
const EAlreadyFriend: u64 = 2103; // add: already whitelisted — abort, never a silent no-op
const ENotFriend: u64 = 2104; // remove: the address is not on the whitelist
const EFriendLimit: u64 = 2105; // add: a personal whitelist is capped at 100 addresses

const MAX_FRIENDS: u64 = 100;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The shared derived-object anchor: one `FriendList` per address, by construction.
public struct FriendRegistry has key {
  id: UID,
}

/// Keys a list's derived address by its OWNER address (`copy + drop + store` — derived-object law).
public struct FriendKey(address) has copy, drop, store;

/// A soulbound whitelist of addresses. `key` ONLY → non-transferable (see module doc).
public struct FriendList has key {
  id: UID,
  owner: address,
  friends: VecSet<address>,
}

public struct FriendListCreated has copy, drop { list: ID, owner: address }

public struct FriendAdded has copy, drop { list: ID, who: address }

public struct FriendRemoved has copy, drop { list: ID, who: address }

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::share_object(FriendRegistry { id: object::new(ctx) });
}

// ╔════════════════ [ Doors (api gates the version, then calls) ] ════════════ ]

/// Create the sender's ONE empty list and bind it to them forever. Claims
/// `FriendKey(sender)` under the registry — a second call by the same address aborts.
public(package) fun create(registry: &mut FriendRegistry, ctx: &TxContext) {
  let owner = ctx.sender();
  assert!(!derived_object::exists(&registry.id, FriendKey(owner)), EListExists);
  let list = FriendList {
    id: derived_object::claim(&mut registry.id, FriendKey(owner)),
    owner,
    friends: vec_set::empty(),
  };
  event::emit(FriendListCreated { list: object::id(&list), owner });
  transfer::transfer(list, owner); // key-only → the ONLY transfer this object ever sees
}

/// Whitelist `addr`. A duplicate add ABORTS (party parity) so the client learns it was
/// already present. (`addr`, not `friend` — `friend` is a Move keyword.)
public(package) fun add(list: &mut FriendList, addr: address, ctx: &TxContext) {
  assert!(list.owner == ctx.sender(), ENotOwner);
  assert!(!list.friends.contains(&addr), EAlreadyFriend);
  assert!(list.friends.length() < MAX_FRIENDS, EFriendLimit);
  list.friends.insert(addr);
  event::emit(FriendAdded { list: object::id(list), who: addr });
}

/// Remove `addr` from the whitelist; aborts if not present.
public(package) fun remove(list: &mut FriendList, addr: address, ctx: &TxContext) {
  assert!(list.owner == ctx.sender(), ENotOwner);
  assert!(list.friends.contains(&addr), ENotFriend);
  list.friends.remove(&addr);
  event::emit(FriendRemoved { list: object::id(list), who: addr });
}

// ╔════════════════ [ Reads (kolizeum's friends-only gate + snapshot) ] ══════ ]

public fun is_friend(list: &FriendList, addr: address): bool { list.friends.contains(&addr) }

/// The whitelist as an owned set — a kolizeum SNAPSHOTS it at creation (the list is soulbound
/// to the owner, so a joiner can never present it live; the lobby carries the frozen copy).
public fun snapshot(list: &FriendList): VecSet<address> { list.friends }

/// The list's owner — a friends-only kolizeum snapshots the creator's OWN list, asserted here.
public fun owner(list: &FriendList): address { list.owner }

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
