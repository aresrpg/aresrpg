// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// PARTY — the character-keyed social group (legacy port, stripped down: one flat
/// package needs no type pinning). Six accepted CHARACTERS max — one wallet may hold several
/// slots. Leadership is `members[0]` (derive, don't store a role); a leaving leader passes
/// it to the oldest survivor. The api door proves custody in the acting character's current
/// home, then hands only that verified character id here. The
/// fight's group-gated sides read `is_member`.
module aresrpg::party;

use aresrpg::{character::{Self, Character}, friends::{Self, FriendRegistry}};
use sui::dynamic_field as df;

const MAX_MEMBERS: u64 = 6;

const ENotLeader: u64 = 2001; // rescind/kick/disband: the acting character does not lead
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

/// The first invitation births the party with that same pending intent. This is the same
/// invite/accept rule as every later member, without asking a second transaction to rediscover
/// a shared object created milliseconds earlier.
public(package) fun create_inviting(
  registry: &mut FriendRegistry,
  actor: ID,
  invited: ID,
  ctx: &mut TxContext,
) {
  let party = Party {
    id: object::new(ctx),
    members: vector[actor],
    pending: vector[invited],
  };
  claim_membership(registry, actor);
  assert_membership_available(registry, invited);
  transfer::share_object(party);
}

/// Any accepted member records an invitation — intent only, membership waits for `accept`.
public(package) fun update_invitation(registry: &FriendRegistry, party: &mut Party, actor: ID, invited: ID, present: bool) {
  if (present) {
    assert!(is_member(party, actor), ENotMember);
    assert_membership_available(registry, invited);
    assert!(!party.pending.contains(&invited), EAlreadyInvited);
    assert!(party.members.length() < MAX_MEMBERS && party.pending.length() < MAX_MEMBERS, EPartyFull);
    party.pending.push_back(invited);
  } else {
    assert!(actor == invited || party.members[0] == actor, ENotLeader);
    remove_pending_invitation(party, invited);
  };
}

/// The invited character's CURRENT owner takes the slot.
public(package) fun accept(registry: &mut FriendRegistry, party: &mut Party, id: ID) {
  remove_pending_invitation(party, id);
  assert!(party.members.length() < MAX_MEMBERS, EPartyFull);
  claim_membership(registry, id);
  party.members.push_back(id);
}

/// Leave by proven character. A leaving leader passes the lead to the oldest survivor; a
/// solo leader disbands instead — a live party never dangles.
public(package) fun leave(registry: &mut FriendRegistry, party: &mut Party, id: ID) {
  let (found, idx) = party.members.index_of(&id);
  assert!(found, ENotMember);
  if (idx == 0) assert!(party.members.length() > 1, ELeaderAlone);
  release_membership(registry, id);
  party.members.remove(idx);
}

/// The leader removes an accepted member — consent is not a kick authority.
public(package) fun kick(registry: &mut FriendRegistry, party: &mut Party, leader: ID, target: ID) {
  assert!(party.members[0] == leader, ENotLeader);
  let (found, idx) = party.members.index_of(&target);
  assert!(found, ENotMember);
  assert!(idx != 0, ECannotKickLeader);
  release_membership(registry, target);
  party.members.remove(idx);
}

/// Delete a SOLO party — multi-member leaders `leave` and pass the lead instead.
public(package) fun disband(registry: &mut FriendRegistry, party: Party, leader: ID) {
  assert!(party.members[0] == leader, ENotLeader);
  assert!(party.members.length() == 1, EPartyNotSolo);
  release_membership(registry, leader);
  let Party { id: uid, .. } = party;
  uid.delete();
}

// ╔════════════════ [ Reads (the fight's group gate lives on these) ] ════════ ]

/// The fight's group gate is the only reader — a member check by character id.
public fun is_member(party: &Party, character: ID): bool {
  party.members.contains(&character)
}

// ╔════════════════ [ Internals ] ════════════════════════════════════════════ ]

// remove_pending
/// Drop `id` from the pending list (accept/decline/rescind share this) — absent aborts.
fun remove_pending_invitation(party: &mut Party, id: ID) {
  let (found, idx) = party.pending.index_of(&id);
  assert!(found, EInviteNotFound);
  party.pending.remove(idx);
}

fun claim_membership(registry: &mut FriendRegistry, character: ID) {
  assert!(!df::exists(friends::uid(registry), character), EAlreadyMember);
  df::add(friends::uid_mut(registry), character, true);
}

fun release_membership(registry: &mut FriendRegistry, character: ID) {
  assert!(df::exists(friends::uid(registry), character), ENotMember);
  let _: bool = df::remove(friends::uid_mut(registry), character);
}

public(package) fun assert_membership_available(registry: &FriendRegistry, character: ID) {
  assert!(!df::exists(friends::uid(registry), character), EAlreadyMember);
}

#[test_only]
public(package) fun registry_for_testing(ctx: &mut TxContext): FriendRegistry {
  friends::registry_for_testing(ctx)
}

#[test_only]
public(package) fun claim_membership_for_testing(registry: &mut FriendRegistry, character: ID, party: ID) {
  let _ = party;
  claim_membership(registry, character);
}

#[test_only]
public(package) fun release_membership_for_testing(registry: &mut FriendRegistry, character: ID, party: ID) {
  let _ = party;
  release_membership(registry, character);
}

#[test_only]
public(package) fun destroy_registry_for_testing(registry: FriendRegistry) {
  friends::destroy_registry_for_testing(registry);
}

#[test_only]
public(package) fun inviting_for_testing(
  registry: &mut FriendRegistry,
  character: &Character,
  invited: ID,
  ctx: &mut TxContext,
): Party {
  assert!(character::id(character) != invited, EAlreadyMember);
  assert_membership_available(registry, invited);
  let actor = character::id(character);
  let party = Party { id: object::new(ctx), members: vector[actor], pending: vector[invited] };
  claim_membership(registry, actor);
  party
}

#[test_only]
public(package) fun shape_for_testing(party: &Party): (ID, ID, u64, u64) {
  (party.members[0], party.pending[0], party.members.length(), party.pending.length())
}
