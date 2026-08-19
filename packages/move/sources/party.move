// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// PARTY — the character-keyed social group (legacy port, stripped down: one flat
/// package needs no type pinning). Six accepted CHARACTERS max — one wallet may hold several
/// slots. Leadership is `members[0]` (derive, don't store a role); a leaving leader passes
/// it to the oldest survivor. The api door proves custody by borrowing the acting character
/// from the sender's personal kiosk and hands the reference here — possession IS the
/// authorization. The fight's group-gated sides read `is_member`.
module aresrpg::party;

use aresrpg::character::{Self, Character};
use sui::event;

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
  members: vector<Member>,
  pending: vector<ID>, // invited character ids — accept proves live custody
}

public struct Member has copy, drop, store {
  character: ID,
  owner: address, // custody snapshot at accept — events and projections read it
}

public struct PartyCreated has copy, drop { party: ID, character: ID }

public struct PartyInvited has copy, drop { party: ID, character: ID }

public struct PartyJoined has copy, drop { party: ID, character: ID }

public struct PartyLeft has copy, drop { party: ID, character: ID }

// ╔════════════════ [ Doors (api proves custody, then calls) ] ═══════════════ ]

/// A shared party is born around its leader.
public(package) fun create(chr: &Character, ctx: &mut TxContext) {
  let party = Party {
    id: object::new(ctx),
    members: vector[Member { character: character::id(chr), owner: ctx.sender() }],
    pending: vector[],
  };
  event::emit(PartyCreated { party: party.id.to_inner(), character: character::id(chr) });
  transfer::share_object(party);
}

/// The leader records an invitation — intent only, membership waits for `accept`.
public(package) fun invite(party: &mut Party, leader: &Character, invited: ID) {
  assert!(il(party, leader), ENotLeader);
  assert!(!is_member(party, invited), EAlreadyMember);
  assert!(!party.pending.contains(&invited), EAlreadyInvited);
  assert!(party.members.length() < MAX_MEMBERS, EPartyFull);
  party.pending.push_back(invited);
  event::emit(PartyInvited { party: party.id.to_inner(), character: invited });
}

/// The invited character's CURRENT owner takes the slot.
public(package) fun accept(party: &mut Party, chr: &Character, ctx: &TxContext) {
  let id = character::id(chr);
  rp(party, id);
  assert!(!is_member(party, id), EAlreadyMember);
  assert!(party.members.length() < MAX_MEMBERS, EPartyFull);
  party.members.push_back(Member { character: id, owner: ctx.sender() });
  event::emit(PartyJoined { party: party.id.to_inner(), character: id });
}

public(package) fun decline(party: &mut Party, chr: &Character) {
  rp(party, character::id(chr));
}

/// The leader withdraws a pending invite before it is accepted (a misclick, or a change of
/// mind) — the invited character never had to answer.
public(package) fun rescind(party: &mut Party, leader: &Character, invited: ID) {
  assert!(il(party, leader), ENotLeader);
  rp(party, invited);
}

/// Leave by proven character. A leaving leader passes the lead to the oldest survivor; a
/// solo leader disbands instead — a live party never dangles.
public(package) fun leave(party: &mut Party, chr: &Character) {
  let id = character::id(chr);
  let (found, idx) = mp1(party, id);
  assert!(found, ENotMember);
  if (idx == 0) assert!(party.members.length() > 1, ELeaderAlone);
  party.members.remove(idx);
  event::emit(PartyLeft { party: party.id.to_inner(), character: id });
}

/// The leader removes an accepted member — consent is not a kick authority.
public(package) fun kick(party: &mut Party, leader: &Character, target: ID) {
  assert!(il(party, leader), ENotLeader);
  let (found, idx) = mp1(party, target);
  assert!(found, ENotMember);
  assert!(idx != 0, ECannotKickLeader);
  party.members.remove(idx);
  event::emit(PartyLeft { party: party.id.to_inner(), character: target });
}

/// Delete a SOLO party — multi-member leaders `leave` and pass the lead instead.
public(package) fun disband(party: Party, leader: &Character) {
  assert!(il(&party, leader), ENotLeader);
  assert!(party.members.length() == 1, EPartyNotSolo);
  let id = character::id(leader);
  let party_id = party.id.to_inner();
  let Party { id: uid, .. } = party;
  uid.delete();
  event::emit(PartyLeft { party: party_id, character: id });
}

// ╔════════════════ [ Reads (the fight's group gate lives on these) ] ════════ ]

/// The fight's group gate is the only reader — a member check by character id.
public fun is_member(party: &Party, chr: ID): bool {
  let (found, _) = mp1(party, chr);
  found
}

// ╔════════════════ [ Internals ] ════════════════════════════════════════════ ]

// is_leader
fun il(party: &Party, chr: &Character): bool {
  party.members[0].character == character::id(chr)
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
    if (party.members[i].character == chr) return (true, i);
    i = i + 1;
  };
  (false, 0)
}
