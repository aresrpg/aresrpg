// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// PARTY — the character-keyed social group (legacy port, stripped down: one flat
/// package needs no type pinning). Six accepted CHARACTERS max — one wallet may hold several
/// slots. Leadership is `members[0]` (derive, don't store a role); a leaving leader passes
/// it to the oldest survivor. The api door proves custody by borrowing the acting character
/// from the sender's personal kiosk and hands the reference here — possession IS the
/// authorization. The fight's group-gated sides read `is_member`.
module aresrpg::party;

use aresrpg::{character::{Self, Character}, friends::{Self, FriendRegistry}};
use sui::dynamic_field as df;

const MAX_MEMBERS: u64 = 6;

const ENotLeader: u64 = 2001; // invite/kick/disband: the acting character does not lead
const EAlreadyMember: u64 = 2002;
const EAlreadyInvited: u64 = 2003;
const EPartyFull: u64 = 2004;
const EInviteNotFound: u64 = 2005;
const ENotMember: u64 = 2006;
const ECannotKickLeader: u64 = 2007;
const ELeaderAlone: u64 = 2008; // leave: a solo leader disbands instead — no dangling party
const EPartyNotSolo: u64 = 2009; // disband: members remain — leave passes the lead instead

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// Shared roster. `members[0]`'s character is always the leader; vector order is join order
/// (oldest first). `pending` is intent only and never consumes an accepted slot.
public struct Party has key {
  id: UID,
  members: vector<ID>,
  pending: vector<ID>, // invited character ids — accept proves live custody
}

// ╔════════════════ [ Doors (api proves custody, then calls) ] ═══════════════ ]

/// A shared party is born around its leader.
public(package) fun create(registry: &mut FriendRegistry, chr: &Character, ctx: &mut TxContext) {
  let party = Party {
    id: object::new(ctx),
    members: vector[character::id(chr)],
    pending: vector[],
  };
  cm(registry, character::id(chr));
  transfer::share_object(party);
}

/// The leader records an invitation — intent only, membership waits for `accept`.
public(package) fun i(party: &mut Party, actor: &Character, invited: ID, present: bool) {
  if (present) {
    assert!(il(party, actor), ENotLeader);
    assert!(!m(party, invited), EAlreadyMember);
    assert!(!party.pending.contains(&invited), EAlreadyInvited);
    assert!(party.members.length() < MAX_MEMBERS, EPartyFull);
    assert!(party.pending.length() < MAX_MEMBERS, EPartyFull);
    party.pending.push_back(invited);
  } else {
    assert!(character::id(actor) == invited || il(party, actor), ENotLeader);
    rp(party, invited);
  };
}

/// The invited character's CURRENT owner takes the slot.
public(package) fun accept(registry: &mut FriendRegistry, party: &mut Party, chr: &Character) {
  let id = character::id(chr);
  rp(party, id);
  assert!(!m(party, id), EAlreadyMember);
  assert!(party.members.length() < MAX_MEMBERS, EPartyFull);
  cm(registry, id);
  party.members.push_back(id);
}

/// Leave by proven character. A leaving leader passes the lead to the oldest survivor; a
/// solo leader disbands instead — a live party never dangles.
public(package) fun leave(registry: &mut FriendRegistry, party: &mut Party, chr: &Character) {
  let id = character::id(chr);
  let (found, idx) = mp1(party, id);
  assert!(found, ENotMember);
  if (idx == 0) assert!(party.members.length() > 1, ELeaderAlone);
  rm(registry, id);
  party.members.remove(idx);
}

/// The leader removes an accepted member — consent is not a kick authority.
public(package) fun kick(registry: &mut FriendRegistry, party: &mut Party, leader: &Character, target: ID) {
  assert!(il(party, leader), ENotLeader);
  let (found, idx) = mp1(party, target);
  assert!(found, ENotMember);
  assert!(idx != 0, ECannotKickLeader);
  rm(registry, target);
  party.members.remove(idx);
}

/// Delete a SOLO party — multi-member leaders `leave` and pass the lead instead.
public(package) fun disband(registry: &mut FriendRegistry, party: Party, leader: &Character) {
  assert!(il(&party, leader), ENotLeader);
  assert!(party.members.length() == 1, EPartyNotSolo);
  let id = character::id(leader);
  rm(registry, id);
  let Party { id: uid, .. } = party;
  uid.delete();
}

// ╔════════════════ [ Reads (the fight's group gate lives on these) ] ════════ ]

/// The fight's group gate is the only reader — a member check by character id.
public fun m(party: &Party, chr: ID): bool {
  let (found, _) = mp1(party, chr);
  found
}

// ╔════════════════ [ Internals ] ════════════════════════════════════════════ ]

// is_leader
fun il(party: &Party, chr: &Character): bool {
  party.members[0] == character::id(chr)
}

// remove_pending
/// Drop `id` from the pending list (accept/decline/rescind share this) — absent aborts.
fun rp(party: &mut Party, id: ID) {
  let (found, idx) = party.pending.index_of(&id);
  assert!(found, EInviteNotFound);
  party.pending.remove(idx);
}

// member_position
fun mp1(party: &Party, chr: ID): (bool, u64) {
  let mut i = 0;
  while (i < party.members.length()) {
    if (party.members[i] == chr) return (true, i);
    i = i + 1;
  };
  (false, 0)
}

fun cm(registry: &mut FriendRegistry, character: ID) {
  assert!(!df::exists(friends::u(registry), character), EAlreadyMember);
  df::add(friends::um(registry), character, true);
}

fun rm(registry: &mut FriendRegistry, character: ID) {
  assert!(df::exists(friends::u(registry), character), ENotMember);
  let _: bool = df::remove(friends::um(registry), character);
}

public(package) fun af(registry: &FriendRegistry, character: ID) {
  assert!(!df::exists(friends::u(registry), character), EAlreadyMember);
}

#[test_only]
public(package) fun registry_for_testing(ctx: &mut TxContext): FriendRegistry {
  friends::registry_for_testing(ctx)
}

#[test_only]
public(package) fun claim_membership_for_testing(registry: &mut FriendRegistry, character: ID, party: ID) {
  let _ = party;
  cm(registry, character);
}

#[test_only]
public(package) fun release_membership_for_testing(registry: &mut FriendRegistry, character: ID, party: ID) {
  let _ = party;
  rm(registry, character);
}

#[test_only]
public(package) fun destroy_registry_for_testing(registry: FriendRegistry) {
  friends::destroy_registry_for_testing(registry);
}
