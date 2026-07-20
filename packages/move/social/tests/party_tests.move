// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Party character-roster tests. The fixture `Character` is admin-pinned as the canonical nominal type, exactly
/// as deployment pins AresRPG's core Character without creating a forbidden social→core dependency.
#[test_only]
module aresrpg_social::party_tests;

use aresrpg_social::{admin::{Self, AdminCap}, party::{Self, Party}, test_harness::stand_up, version::Version};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::unit_test::assert_eq;
use sui::{kiosk::{Self, Kiosk}, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0x0A;
const A: address = @0xA1;
const B: address = @0xB1;
const C: address = @0xC1;

const EAlreadyMember: u64 = 202;
const EPartyFull: u64 = 204;
const EWrongKioskCap: u64 = 209;
const ECharacterNotInKiosk: u64 = 210;
const V_ENotEnabled: u64 = 102;
const V_EWrongCharacterType: u64 = 104;

public struct Character has key, store { id: UID }
public struct OtherObject has key, store { id: UID }

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

fun stand_up_party(sc: &mut Scenario, enable: bool) {
  stand_up(sc, enable);
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let mut version = sc.take_shared<Version>();
  admin::admin_set_party_character_type<Character>(&cap, &mut version, sc.ctx());
  sc.return_to_sender(cap);
  ts::return_shared(version);
}

/// Mint `count` distinct character-shaped objects into ONE personal kiosk. This is the important same-wallet
/// shape: one owner/cap may prove several character slots, while every slot retains a distinct object ID.
fun make_roster(sc: &mut Scenario, who: address, count: u64): (ID, vector<ID>) {
  sc.next_tx(who);
  let (mut kiosk, owner_cap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut kiosk, owner_cap, sc.ctx());
  let mut ids = vector[];
  let mut i = 0;
  while (i < count) {
    let character = Character { id: object::new(sc.ctx()) };
    ids.push_back(object::id(&character));
    kiosk.place(personal_kiosk::borrow(&pkcap), character);
    i = i + 1;
  };
  let kiosk_id = object::id(&kiosk);
  personal_kiosk::transfer_to_sender(pkcap, sc.ctx());
  transfer::public_share_object(kiosk);
  (kiosk_id, ids)
}

fun absent_id(sc: &mut Scenario, who: address): ID {
  sc.next_tx(who);
  let uid = object::new(sc.ctx());
  let id = uid.to_inner();
  uid.delete();
  id
}

fun make_other_object(sc: &mut Scenario, who: address): (ID, ID) {
  sc.next_tx(who);
  let (mut kiosk, owner_cap) = kiosk::new(sc.ctx());
  let pkcap = personal_kiosk::new(&mut kiosk, owner_cap, sc.ctx());
  let other = OtherObject { id: object::new(sc.ctx()) };
  let other_id = object::id(&other);
  kiosk.place(personal_kiosk::borrow(&pkcap), other);
  let kiosk_id = object::id(&kiosk);
  personal_kiosk::transfer_to_sender(pkcap, sc.ctx());
  transfer::public_share_object(kiosk);
  (kiosk_id, other_id)
}

fun create(sc: &mut Scenario, who: address, kiosk_id: ID, character: ID) {
  sc.next_tx(who);
  let kiosk = ts::take_shared_by_id<Kiosk>(sc, kiosk_id);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let version = sc.take_shared<Version>();
  party::create<Character>(&kiosk, &pkcap, character, &version, sc.ctx());
  ts::return_shared(kiosk);
  sc.return_to_sender(pkcap);
  ts::return_shared(version);
}

fun invite(
  sc: &mut Scenario,
  who: address,
  leader_kiosk_id: ID,
  leader_character: ID,
  character: ID,
  owner: address,
) {
  sc.next_tx(who);
  let mut party = sc.take_shared<Party>();
  let kiosk = ts::take_shared_by_id<Kiosk>(sc, leader_kiosk_id);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let version = sc.take_shared<Version>();
  party::invite<Character>(
    &mut party, &kiosk, &pkcap, leader_character, character, owner, &version, sc.ctx(),
  );
  ts::return_shared(party);
  ts::return_shared(kiosk);
  sc.return_to_sender(pkcap);
  ts::return_shared(version);
}

fun accept(sc: &mut Scenario, who: address, kiosk_id: ID, character: ID) {
  sc.next_tx(who);
  let mut party = sc.take_shared<Party>();
  let kiosk = ts::take_shared_by_id<Kiosk>(sc, kiosk_id);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let version = sc.take_shared<Version>();
  party::accept<Character>(&mut party, &kiosk, &pkcap, character, &version, sc.ctx());
  ts::return_shared(party);
  ts::return_shared(kiosk);
  sc.return_to_sender(pkcap);
  ts::return_shared(version);
}

fun invite_and_accept(
  sc: &mut Scenario,
  leader: address,
  leader_kiosk: ID,
  leader_character: ID,
  member: address,
  member_kiosk: ID,
  member_character: ID,
) {
  invite(sc, leader, leader_kiosk, leader_character, member_character, member);
  accept(sc, member, member_kiosk, member_character);
}

/// Same-signer owned-alt path: both Move calls execute in one transaction while reusing the exact shared party,
/// kiosk, soulbound personal cap, and Version borrows the SDK composer reuses in one PTB.
fun invite_accept_own_same_tx(
  sc: &mut Scenario,
  who: address,
  kiosk_id: ID,
  leader_character: ID,
  member_character: ID,
) {
  sc.next_tx(who);
  let mut party = sc.take_shared<Party>();
  let kiosk = ts::take_shared_by_id<Kiosk>(sc, kiosk_id);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let version = sc.take_shared<Version>();
  party::invite<Character>(
    &mut party, &kiosk, &pkcap, leader_character, member_character, who, &version, sc.ctx(),
  );
  party::accept<Character>(&mut party, &kiosk, &pkcap, member_character, &version, sc.ctx());
  ts::return_shared(party);
  ts::return_shared(kiosk);
  sc.return_to_sender(pkcap);
  ts::return_shared(version);
}

fun leave(sc: &mut Scenario, who: address, kiosk_id: ID, character: ID) {
  sc.next_tx(who);
  let mut party = sc.take_shared<Party>();
  let kiosk = ts::take_shared_by_id<Kiosk>(sc, kiosk_id);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let version = sc.take_shared<Version>();
  party::leave<Character>(&mut party, &kiosk, &pkcap, character, &version, sc.ctx());
  ts::return_shared(party);
  ts::return_shared(kiosk);
  sc.return_to_sender(pkcap);
  ts::return_shared(version);
}

// ╔════════════════ [ Required happy paths ] ═════════════════════════════════ ]

#[test]
fun multi_character_same_owner_joins_distinct_slots() {
  let mut sc = ts::begin(OWNER);
  stand_up_party(&mut sc, true);
  let (kiosk_id, ids) = make_roster(&mut sc, A, 2);
  let leader = *ids.borrow(0);
  let alt = *ids.borrow(1);
  create(&mut sc, A, kiosk_id, leader);
  invite_accept_own_same_tx(&mut sc, A, kiosk_id, leader, alt);

  sc.next_tx(A);
  let party = sc.take_shared<Party>();
  let members = party::members(&party);
  assert_eq!(party::size(&party), 2);
  assert_eq!(party::member_character(members.borrow(0)), leader);
  assert_eq!(party::member_character(members.borrow(1)), alt);
  assert_eq!(party::member_owner(members.borrow(0)), A);
  assert_eq!(party::member_owner(members.borrow(1)), A);
  ts::return_shared(party);
  sc.end();
}

#[test]
fun leader_leave_promotes_oldest_and_compacts_order() {
  let mut sc = ts::begin(OWNER);
  stand_up_party(&mut sc, true);
  let (ak, a_ids) = make_roster(&mut sc, A, 1);
  let (bk, b_ids) = make_roster(&mut sc, B, 1);
  let (ck, c_ids) = make_roster(&mut sc, C, 1);
  let a = *a_ids.borrow(0);
  let b = *b_ids.borrow(0);
  let c = *c_ids.borrow(0);
  create(&mut sc, A, ak, a);
  invite_and_accept(&mut sc, A, ak, a, B, bk, b);
  invite_and_accept(&mut sc, A, ak, a, C, ck, c);
  leave(&mut sc, A, ak, a);

  sc.next_tx(B);
  let party = sc.take_shared<Party>();
  let members = party::members(&party);
  assert_eq!(party::leader_character(&party), b);
  assert_eq!(party::member_character(members.borrow(0)), b);
  assert_eq!(party::member_order(members.borrow(0)), 0);
  assert_eq!(party::member_character(members.borrow(1)), c);
  assert_eq!(party::member_order(members.borrow(1)), 1);
  ts::return_shared(party);
  sc.end();
}

#[test]
fun leader_kick_is_character_keyed() {
  let mut sc = ts::begin(OWNER);
  stand_up_party(&mut sc, true);
  let (ak, a_ids) = make_roster(&mut sc, A, 1);
  let (bk, b_ids) = make_roster(&mut sc, B, 1);
  let a = *a_ids.borrow(0);
  let b = *b_ids.borrow(0);
  create(&mut sc, A, ak, a);
  invite_and_accept(&mut sc, A, ak, a, B, bk, b);

  sc.next_tx(A);
  let mut party = sc.take_shared<Party>();
  let kiosk = ts::take_shared_by_id<Kiosk>(&sc, ak);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let version = sc.take_shared<Version>();
  party::kick<Character>(&mut party, &kiosk, &pkcap, a, b, &version, sc.ctx());
  assert_eq!(party::size(&party), 1);
  assert!(!party::is_member(&party, b));
  ts::return_shared(party);
  ts::return_shared(kiosk);
  sc.return_to_sender(pkcap);
  ts::return_shared(version);
  sc.end();
}

#[test]
fun current_owner_can_decline_stale_owner_snapshot() {
  let mut sc = ts::begin(OWNER);
  stand_up_party(&mut sc, true);
  let (ak, a_ids) = make_roster(&mut sc, A, 1);
  let (bk, b_ids) = make_roster(&mut sc, B, 1);
  let leader = *a_ids.borrow(0);
  let invited = *b_ids.borrow(0);
  create(&mut sc, A, ak, leader);
  invite(&mut sc, A, ak, leader, invited, C);

  sc.next_tx(B);
  let mut party = sc.take_shared<Party>();
  let kiosk = ts::take_shared_by_id<Kiosk>(&sc, bk);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let version = sc.take_shared<Version>();
  party::decline<Character>(&mut party, &kiosk, &pkcap, invited, &version, sc.ctx());
  assert!(!party::is_pending(&party, invited));
  ts::return_shared(party);
  ts::return_shared(kiosk);
  sc.return_to_sender(pkcap);
  ts::return_shared(version);
  sc.end();
}

#[test]
fun current_owner_accepts_character_intent_after_owner_snapshot_changes() {
  let mut sc = ts::begin(OWNER);
  stand_up_party(&mut sc, true);
  let (ak, a_ids) = make_roster(&mut sc, A, 1);
  let (bk, b_ids) = make_roster(&mut sc, B, 1);
  let leader = *a_ids.borrow(0);
  let invited = *b_ids.borrow(0);
  create(&mut sc, A, ak, leader);
  // `C` models an invitation-time owner snapshot that is stale by acceptance.
  invite(&mut sc, A, ak, leader, invited, C);
  accept(&mut sc, B, bk, invited);

  sc.next_tx(B);
  let party = sc.take_shared<Party>();
  let members = party::members(&party);
  assert_eq!(party::member_owner(members.borrow(1)), B);
  ts::return_shared(party);
  sc.end();
}

#[test]
fun solo_leader_can_disband_with_current_owner_proof() {
  let mut sc = ts::begin(OWNER);
  stand_up_party(&mut sc, true);
  let (kiosk_id, ids) = make_roster(&mut sc, A, 1);
  let leader = *ids.borrow(0);
  create(&mut sc, A, kiosk_id, leader);

  sc.next_tx(A);
  let party = sc.take_shared<Party>();
  let kiosk = ts::take_shared_by_id<Kiosk>(&sc, kiosk_id);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let version = sc.take_shared<Version>();
  party::disband<Character>(party, &kiosk, &pkcap, leader, &version, sc.ctx());
  ts::return_shared(kiosk);
  sc.return_to_sender(pkcap);
  ts::return_shared(version);
  sc.end();
}

// ╔════════════════ [ Required aborts ] ══════════════════════════════════════ ]

#[test, expected_failure(abort_code = EPartyFull, location = party)]
fun six_member_cap_rejects_seventh_character() {
  let mut sc = ts::begin(OWNER);
  stand_up_party(&mut sc, true);
  let (kiosk_id, ids) = make_roster(&mut sc, A, 7);
  let leader = *ids.borrow(0);
  create(&mut sc, A, kiosk_id, leader);
  let mut i = 1;
  while (i < 6) {
    let member = *ids.borrow(i);
    invite_and_accept(&mut sc, A, kiosk_id, leader, A, kiosk_id, member);
    i = i + 1;
  };
  invite(&mut sc, A, kiosk_id, leader, *ids.borrow(6), A);
  abort
}

#[test, expected_failure(abort_code = EAlreadyMember, location = party)]
fun duplicate_character_rejected_even_for_same_owner() {
  let mut sc = ts::begin(OWNER);
  stand_up_party(&mut sc, true);
  let (kiosk_id, ids) = make_roster(&mut sc, A, 2);
  let leader = *ids.borrow(0);
  let alt = *ids.borrow(1);
  create(&mut sc, A, kiosk_id, leader);
  invite_and_accept(&mut sc, A, kiosk_id, leader, A, kiosk_id, alt);
  invite(&mut sc, A, kiosk_id, leader, alt, A);
  abort
}

#[test, expected_failure(abort_code = EWrongKioskCap, location = party)]
fun wrong_personal_kiosk_cap_rejected() {
  let mut sc = ts::begin(OWNER);
  stand_up_party(&mut sc, true);
  let (ak, a_ids) = make_roster(&mut sc, A, 1);
  let (_bk, _b_ids) = make_roster(&mut sc, B, 1);

  sc.next_tx(B);
  let a_kiosk = ts::take_shared_by_id<Kiosk>(&sc, ak);
  let b_cap = sc.take_from_sender<PersonalKioskCap>();
  let version = sc.take_shared<Version>();
  party::create<Character>(&a_kiosk, &b_cap, *a_ids.borrow(0), &version, sc.ctx());
  abort
}

#[test, expected_failure(abort_code = V_EWrongCharacterType, location = aresrpg_social::version)]
fun kiosk_owned_non_character_type_rejected() {
  let mut sc = ts::begin(OWNER);
  stand_up_party(&mut sc, true);
  let (kiosk_id, other_id) = make_other_object(&mut sc, A);

  sc.next_tx(A);
  let kiosk = ts::take_shared_by_id<Kiosk>(&sc, kiosk_id);
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let version = sc.take_shared<Version>();
  party::create<OtherObject>(&kiosk, &pkcap, other_id, &version, sc.ctx());
  abort
}

#[test, expected_failure(abort_code = ECharacterNotInKiosk, location = party)]
fun invited_character_absent_from_owned_kiosk_rejected() {
  let mut sc = ts::begin(OWNER);
  stand_up_party(&mut sc, true);
  let (ak, a_ids) = make_roster(&mut sc, A, 1);
  let (bk, _b_ids) = make_roster(&mut sc, B, 1);
  let missing = absent_id(&mut sc, B);
  let leader = *a_ids.borrow(0);
  create(&mut sc, A, ak, leader);
  invite(&mut sc, A, ak, leader, missing, B);
  accept(&mut sc, B, bk, missing);
  abort
}

#[test, expected_failure(abort_code = V_ENotEnabled, location = aresrpg_social::version)]
fun create_is_version_gated_while_dark() {
  let mut sc = ts::begin(OWNER);
  stand_up_party(&mut sc, false);
  let (kiosk_id, ids) = make_roster(&mut sc, A, 1);
  create(&mut sc, A, kiosk_id, *ids.borrow(0));
  abort
}
