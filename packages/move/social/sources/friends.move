/// FRIENDS — a NON-TRANSFERABLE, address-bound personal whitelist (§13). Add or remove addresses freely; NO
/// invites, NO acceptance, NO symmetry required (unlike a party). Powers friends-only Kolizeum creation (the
/// reader snapshots the list at creation time — it takes `&FriendList`, owner-signed) and the social UI.
///
/// SOULBOUND BY ABILITY: `FriendList` has `key` ONLY (no `store`) — so `transfer::public_transfer` does not
/// compile for it and no module outside this one can move it. The single `transfer::transfer` at creation binds
/// it to its owner forever; there is NO transfer entry, so it is non-transferable by construction, not by a
/// runtime check. Every mutator re-asserts `sender == owner`, so the address binding is enforced on every write.
///
/// ONE PER ADDRESS = DERIVED OBJECT (the proven house pattern, mirrors `creation`'s free-character slot): the
/// list's own UID is `derived_object::claim`ed from a `FriendKey` keyed on the owning address, under the shared `FriendRegistry`, so an
/// object already exists at that derived address iff the address already made a list. A second `create_friend_list`
/// aborts on-chain (TOCTOU-proof) — chosen over a first-come `object::new` transfer because it removes the
/// "which list is canonical?" ambiguity the Kolizeum reader would otherwise face.
module aresrpg_social::friends;

use aresrpg_social::version::Version;
use sui::{derived_object, event, tx_context::sender, vec_set::{Self, VecSet}};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EListExists: u64 = 101; // create_friend_list: this address already has a list
const ENotOwner: u64 = 102; // add/remove: sender is not the list's owner
const EAlreadyFriend: u64 = 103; // add: the address is already whitelisted (duplicate-add ABORTS — party parity)
const ENotFriend: u64 = 104; // remove: the address is not on the whitelist

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The shared derived-object GATE: every `FriendList`'s UID is claimed from a `FriendKey` keyed on its owning address, under this
/// registry, guaranteeing one list per address. Seeded once at publish.
public struct FriendRegistry has key {
  id: UID,
}

/// Keys a friend list's derived address by its OWNER address. `copy + drop + store` (derived-object law).
public struct FriendKey(address) has copy, drop, store;

/// A soulbound whitelist of addresses. `key` ONLY → non-transferable (see module doc). `owner` is re-checked on
/// every write; `friends` is a set (no duplicates, cheap membership test).
public struct FriendList has key {
  id: UID,
  owner: address,
  friends: VecSet<address>,
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct FriendListCreated has copy, drop { list: ID, owner: address }

public struct FriendAdded has copy, drop { list: ID, who: address }

public struct FriendRemoved has copy, drop { list: ID, who: address }

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::share_object(FriendRegistry { id: object::new(ctx) });
}

// ╔════════════════ [ Create (one per address) / mutate (self-signed) ] ═════ ]

/// Create the sender's ONE friend list (empty) and bind it to them (soulbound). Claims `FriendKey(sender)` under
/// the registry — a second call by the same address aborts (`EListExists`). The list is `transfer`ed (not
/// `public_transfer`ed — it has no `store`) to the sender, so it can never leave that address.
public fun create_friend_list(registry: &mut FriendRegistry, version: &Version, ctx: &mut TxContext) {
  version.assert_enabled();
  let owner = sender(ctx);
  assert!(!derived_object::exists(&registry.id, FriendKey(owner)), EListExists);
  let list = FriendList {
    id: derived_object::claim(&mut registry.id, FriendKey(owner)),
    owner,
    friends: vec_set::empty(),
  };
  event::emit(FriendListCreated { list: object::id(&list), owner });
  transfer::transfer(list, owner); // key-only → soulbound; the ONLY transfer this object ever sees
}

/// Whitelist `addr`. Owner-signed (`ENotOwner`); a duplicate add ABORTS (`EAlreadyFriend`, mirroring party's
/// `invite`) rather than silently no-op'ing, so the client learns the address was already present.
/// (`addr`, not `friend` — `friend` is a Move keyword.)
public fun add_friend(list: &mut FriendList, addr: address, version: &Version, ctx: &TxContext) {
  version.assert_enabled();
  assert!(list.owner == sender(ctx), ENotOwner);
  assert!(!list.friends.contains(&addr), EAlreadyFriend);
  list.friends.insert(addr);
  event::emit(FriendAdded { list: object::id(list), who: addr });
}

/// Remove `addr` from the whitelist. Owner-signed (`ENotOwner`); aborts (`ENotFriend`) if not present.
public fun remove_friend(list: &mut FriendList, addr: address, version: &Version, ctx: &TxContext) {
  version.assert_enabled();
  assert!(list.owner == sender(ctx), ENotOwner);
  assert!(list.friends.contains(&addr), ENotFriend);
  list.friends.remove(&addr);
  event::emit(FriendRemoved { list: object::id(list), who: addr });
}

// ╔════════════════ [ Read (FREE — the Kolizeum reader + social UI snapshot these) ] ═ ]

public fun owner(list: &FriendList): address { list.owner }

public fun is_friend(list: &FriendList, addr: address): bool { list.friends.contains(&addr) }

public fun friends(list: &FriendList): vector<address> { *list.friends.keys() }

public fun friend_count(list: &FriendList): u64 { list.friends.length() }

/// The deterministic list address for an owner (RPC derives it without an event scan).
public fun list_address(registry: &FriendRegistry, owner: address): address {
  derived_object::derive_address(object::id(registry), FriendKey(owner))
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
