// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// PARTY — AresRPG's character-keyed social group. Accepted membership is capped at six CHARACTERS, so one
/// wallet may occupy several distinct slots.
///
/// OWNERSHIP PROOF: every mutator authenticates its acting character through a shared personal `Kiosk` plus
/// its sender-owned `PersonalKioskCap`. This mirrors `aresrpg::fight::join` at
/// `packages/move/aresrpg/sources/fight.move:90`: that door carries `&Kiosk`, `&PersonalKioskCap`, and a
/// character `ID`, then performs the typed borrow at `fight.move:291-292`. Social remains a dependency leaf, so
/// the super admin pins the canonical Character `TypeName` under the existing Version UID at upgrade time; every
/// generic borrow below must equal that nominal brand before the cap-backed `kiosk.borrow<T>` is accepted.
module aresrpg_social::party;

use aresrpg_social::version::Version;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{event, kiosk::{Self, Kiosk}};

// ╔════════════════ [ Constants / errors ] ════════════════════════════════════ ]

const MAX_MEMBERS: u64 = 6;

const ENotLeader: u64 = 201;
const EAlreadyMember: u64 = 202;
const EAlreadyInvited: u64 = 203;
const EPartyFull: u64 = 204;
const EInviteNotFound: u64 = 205;
const ENotMember: u64 = 206;
const ECannotKickLeader: u64 = 207;
const ELeaderAlone: u64 = 208;
const EWrongKioskCap: u64 = 209;
const ECharacterNotInKiosk: u64 = 210;
const ENotCurrentOwner: u64 = 211;
const EPartyNotSolo: u64 = 212;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

public struct Member has copy, drop, store {
  character: ID,
  owner: address,
  order: u8,
}

public struct Invite has copy, drop, store {
  character: ID,
  owner: address,
}

/// Shared character roster. `members` always contains `leader`; vector order and `Member.order` are kept in
/// oldest-accepted order. `pending` is intent only and never consumes one of the six accepted slots.
public struct Party has key {
  id: UID,
  leader: ID,
  members: vector<Member>,
  pending: vector<Invite>,
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct PartyCreated has copy, drop { party: ID, character: ID, owner: address }
public struct PartyJoined has copy, drop { party: ID, character: ID, owner: address }
public struct PartyLeft has copy, drop { party: ID, character: ID, owner: address }

// ╔════════════════ [ Entries ] ══════════════════════════════════════════════ ]
// Every entry starts at `version.assert_enabled()` and authenticates the acting character before mutation.

/// Create a shared party with the currently owned leader character as its first accepted member.
public fun create<Character: key + store>(
  kiosk: &Kiosk,
  pkcap: &PersonalKioskCap,
  leader_character: ID,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_enabled();
  version.assert_party_character_type<Character>();
  let owner = current_owner<Character>(kiosk, pkcap, leader_character, ctx);
  let party = Party {
    id: object::new(ctx),
    leader: leader_character,
    members: vector[Member { character: leader_character, owner, order: 0 }],
    pending: vector[],
  };
  event::emit(PartyCreated { party: object::id(&party), character: leader_character, owner });
  transfer::share_object(party);
}

/// The currently owning wallet of the leader character records an invitation for one character ID and its
/// expected owner snapshot. No membership is granted until that character's current owner calls `accept`.
public fun invite<Character: key + store>(
  party: &mut Party,
  leader_kiosk: &Kiosk,
  leader_pkcap: &PersonalKioskCap,
  leader_character: ID,
  invited_character: ID,
  invited_owner: address,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_enabled();
  version.assert_party_character_type<Character>();
  let _ = current_owner<Character>(leader_kiosk, leader_pkcap, leader_character, ctx);
  assert!(party.leader == leader_character, ENotLeader);
  assert!(!contains_member(&party.members, invited_character), EAlreadyMember);
  assert!(!contains_invite(&party.pending, invited_character), EAlreadyInvited);
  assert!(party.members.length() < MAX_MEMBERS, EPartyFull);
  party.pending.push_back(Invite { character: invited_character, owner: invited_owner });
}

/// Accept the character-keyed intent only after proving CURRENT custody of that exact ID. This is deliberately
/// composable after `invite` in one same-signer PTB for owned alts; a friend's wallet calls only this function.
public fun accept<Character: key + store>(
  party: &mut Party,
  kiosk: &Kiosk,
  pkcap: &PersonalKioskCap,
  character: ID,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_enabled();
  version.assert_party_character_type<Character>();
  let owner = current_owner<Character>(kiosk, pkcap, character, ctx);
  let (found, idx) = invite_position(&party.pending, character);
  assert!(found, EInviteNotFound);
  assert!(!contains_member(&party.members, character), EAlreadyMember);
  assert!(party.members.length() < MAX_MEMBERS, EPartyFull);
  party.pending.remove(idx);
  let order = party.members.length() as u8;
  party.members.push_back(Member { character, owner, order });
  event::emit(PartyJoined { party: object::id(party), character, owner });
}

/// Decline a pending invitation. The pending character itself supplies the ownership proof.
public fun decline<Character: key + store>(
  party: &mut Party,
  kiosk: &Kiosk,
  pkcap: &PersonalKioskCap,
  character: ID,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_enabled();
  version.assert_party_character_type<Character>();
  let _ = current_owner<Character>(kiosk, pkcap, character, ctx);
  let (found, idx) = invite_position(&party.pending, character);
  assert!(found, EInviteNotFound);
  party.pending.remove(idx);
}

/// Leave by character ID. If the leader leaves, the oldest accepted survivor becomes leader. A solo leader
/// cannot leave because a live shared Party may never have a dangling leader or an empty roster.
public fun leave<Character: key + store>(
  party: &mut Party,
  kiosk: &Kiosk,
  pkcap: &PersonalKioskCap,
  character: ID,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_enabled();
  version.assert_party_character_type<Character>();
  let owner = current_owner<Character>(kiosk, pkcap, character, ctx);
  let (found, idx) = member_position(&party.members, character);
  assert!(found, ENotMember);
  let was_leader = party.leader == character;
  if (was_leader) assert!(party.members.length() > 1, ELeaderAlone);
  party.members.remove(idx);
  if (was_leader) party.leader = party.members.borrow(0).character;
  normalize_orders(&mut party.members);
  event::emit(PartyLeft { party: object::id(party), character, owner });
}

/// The currently owned leader character removes a different accepted character. Target consent is not a kick
/// authority; the stored accepted owner is emitted so the projection can remove the character deterministically.
public fun kick<Character: key + store>(
  party: &mut Party,
  leader_kiosk: &Kiosk,
  leader_pkcap: &PersonalKioskCap,
  leader_character: ID,
  target_character: ID,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_enabled();
  version.assert_party_character_type<Character>();
  let _ = current_owner<Character>(leader_kiosk, leader_pkcap, leader_character, ctx);
  assert!(party.leader == leader_character, ENotLeader);
  assert!(target_character != party.leader, ECannotKickLeader);
  let (found, idx) = member_position(&party.members, target_character);
  assert!(found, ENotMember);
  let owner = party.members.borrow(idx).owner;
  party.members.remove(idx);
  normalize_orders(&mut party.members);
  event::emit(PartyLeft { party: object::id(party), character: target_character, owner });
}

/// Delete a solo party after proving current ownership of its leader character. Multi-member leaders use
/// `leave`, which deterministically transfers leadership to the oldest accepted survivor.
public fun disband<Character: key + store>(
  party: Party,
  leader_kiosk: &Kiosk,
  leader_pkcap: &PersonalKioskCap,
  leader_character: ID,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_enabled();
  version.assert_party_character_type<Character>();
  let owner = current_owner<Character>(leader_kiosk, leader_pkcap, leader_character, ctx);
  assert!(party.leader == leader_character, ENotLeader);
  assert!(party.members.length() == 1, EPartyNotSolo);
  let party_id = object::id(&party);
  let Party { id, leader: _, members: _, pending: _ } = party;
  object::delete(id);
  event::emit(PartyLeft { party: party_id, character: leader_character, owner });
}

// ╔════════════════ [ Read shape ] ═══════════════════════════════════════════ ]

public fun leader_character(party: &Party): ID { party.leader }
public fun members(party: &Party): vector<Member> { party.members }
public fun pending(party: &Party): vector<Invite> { party.pending }
public fun size(party: &Party): u64 { party.members.length() }
public fun is_member(party: &Party, character: ID): bool { contains_member(&party.members, character) }
public fun is_pending(party: &Party, character: ID): bool { contains_invite(&party.pending, character) }

public fun member_character(member: &Member): ID { member.character }
public fun member_owner(member: &Member): address { member.owner }
public fun member_order(member: &Member): u8 { member.order }
public fun invite_character(invite: &Invite): ID { invite.character }
public fun invite_owner(invite: &Invite): address { invite.owner }

// ╔════════════════ [ Internal guards ] ══════════════════════════════════════ ]

/// Proves all three custody facts. The cap is never accepted as an ornamental argument: its embedded kiosk ID
/// is checked before the item/owner checks, closing wrong-cap and foreign-kiosk substitution.
fun current_owner<Character: key + store>(
  kiosk: &Kiosk,
  pkcap: &PersonalKioskCap,
  character: ID,
  ctx: &TxContext,
): address {
  let owner_cap = personal_kiosk::borrow(pkcap);
  assert!(kiosk::kiosk_owner_cap_for(owner_cap) == object::id(kiosk), EWrongKioskCap);
  assert!(kiosk.has_item_with_type<Character>(character), ECharacterNotInKiosk);
  let _character: &Character = kiosk.borrow(owner_cap, character);
  let owner = personal_kiosk::owner(kiosk);
  assert!(owner == ctx.sender(), ENotCurrentOwner);
  owner
}

fun contains_member(members: &vector<Member>, character: ID): bool {
  let (found, _) = member_position(members, character);
  found
}

fun contains_invite(invites: &vector<Invite>, character: ID): bool {
  let (found, _) = invite_position(invites, character);
  found
}

fun member_position(members: &vector<Member>, character: ID): (bool, u64) {
  let mut i = 0;
  while (i < members.length()) {
    if (members.borrow(i).character == character) return (true, i);
    i = i + 1;
  };
  (false, 0)
}

fun invite_position(invites: &vector<Invite>, character: ID): (bool, u64) {
  let mut i = 0;
  while (i < invites.length()) {
    if (invites.borrow(i).character == character) return (true, i);
    i = i + 1;
  };
  (false, 0)
}

fun normalize_orders(members: &mut vector<Member>) {
  let mut i = 0;
  while (i < members.length()) {
    members.borrow_mut(i).order = i as u8;
    i = i + 1;
  };
}
