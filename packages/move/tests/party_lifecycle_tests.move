// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::party_lifecycle_tests;

use aresrpg::{api, character::{Self, Character}, friends::{Self, FriendRegistry}, party::{Self, Party}, version::{Self, Version}};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{kiosk::{Self, Kiosk}, test_scenario::{Self, Scenario}};

const OWNER: address = @0xA11CE;

public struct Fixture {
  scenario: Scenario,
  version: Version,
  registry: FriendRegistry,
  party: Party,
  kiosk: Kiosk,
  personal: PersonalKioskCap,
  ids: vector<ID>,
}

fun fixture(): Fixture {
  let mut scenario = test_scenario::begin(OWNER);
  friends::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let version = scenario.take_shared<Version>();
  let mut registry = scenario.take_shared<FriendRegistry>();
  let (mut kiosk, cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, cap, scenario.ctx());
  let cap = personal_kiosk::borrow(&personal);
  let mut ids = vector[];
  let mut i = 0u64;
  while (i < 8) {
    let character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
    ids.push_back(object::id(&character));
    kiosk.place(cap, character);
    i = i + 1;
  };
  api::create_party_invitation(&mut registry, &kiosk, cap, ids[0], ids[1], &version, scenario.ctx());
  transfer::public_share_object(kiosk);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  test_scenario::return_shared(registry);
  test_scenario::return_shared(version);
  scenario.next_tx(OWNER);
  let version = scenario.take_shared<Version>();
  let registry = scenario.take_shared<FriendRegistry>();
  let party = scenario.take_shared<Party>();
  let kiosk = scenario.take_shared<Kiosk>();
  let personal = scenario.take_from_sender<PersonalKioskCap>();
  Fixture { scenario, version, registry, party, kiosk, personal, ids }
}

fun finish(fixture: Fixture, leader: u64) {
  let Fixture { scenario, version, mut registry, party, mut kiosk, personal, ids } = fixture;
  let cap = personal_kiosk::borrow(&personal);
  api::party_disband(&mut registry, party, &kiosk, cap, ids[leader], &version);
  ids.do!(|id| {
    party::assert_membership_available(&registry, id);
    character::destroy(kiosk.take<Character>(cap, id));
  });
  test_scenario::return_shared(registry);
  test_scenario::return_shared(version);
  test_scenario::return_shared(kiosk);
  test_scenario::return_to_sender(&scenario, personal);
  scenario.end();
}

#[test]
fun public_party_lifecycle_preserves_intent_membership_and_leadership() {
  let Fixture { scenario, version, mut registry, mut party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  let (leader, first, members, pending) = party::shape_for_testing(&party);
  assert!(leader == ids[0] && first == ids[1] && members == 1 && pending == 1);
  assert!(party::is_member(&party, ids[0]) && !party::is_member(&party, ids[1]));
  api::party_accept(&mut registry, &mut party, &kiosk, cap, ids[1], &version);
  api::party_invitation(&registry, &mut party, &kiosk, cap, ids[1], ids[2], true, &version);
  api::party_invitation(&registry, &mut party, &kiosk, cap, ids[0], ids[3], true, &version);
  api::party_invitation(&registry, &mut party, &kiosk, cap, ids[3], ids[3], false, &version);
  party::assert_membership_available(&registry, ids[3]);
  api::party_invitation(&registry, &mut party, &kiosk, cap, ids[0], ids[3], true, &version);
  api::party_invitation(&registry, &mut party, &kiosk, cap, ids[0], ids[3], false, &version);
  api::party_accept(&mut registry, &mut party, &kiosk, cap, ids[2], &version);
  api::party_kick(&mut registry, &mut party, &kiosk, cap, ids[0], ids[2], &version);
  assert!(!party::is_member(&party, ids[2]));
  party::assert_membership_available(&registry, ids[2]);
  api::party_leave(&mut registry, &mut party, &kiosk, cap, ids[1], &version);
  api::party_invitation(&registry, &mut party, &kiosk, cap, ids[0], ids[1], true, &version);
  api::party_accept(&mut registry, &mut party, &kiosk, cap, ids[1], &version);
  api::party_leave(&mut registry, &mut party, &kiosk, cap, ids[0], &version);
  assert!(!party::is_member(&party, ids[0]) && party::is_member(&party, ids[1]));
  finish(Fixture { scenario, version, registry, party, kiosk, personal, ids }, 1);
}

#[test]
fun the_shared_party_can_be_disbanded_without_accepting_its_pending_invitation() {
  finish(fixture(), 0);
}

#[test, expected_failure(abort_code = 2002, location = aresrpg::party)]
fun a_member_cannot_found_another_party() {
  let Fixture { mut scenario, version, mut registry, party: _party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  api::create_party_invitation(&mut registry, &kiosk, cap, ids[0], ids[2], &version, scenario.ctx());
  abort 999
}

#[test, expected_failure(abort_code = 2003, location = aresrpg::party)]
fun duplicate_pending_invitation_is_refused() {
  let Fixture { scenario: _scenario, version, registry, mut party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  api::party_invitation(&registry, &mut party, &kiosk, cap, ids[0], ids[1], true, &version);
  abort 999
}

#[test, expected_failure(abort_code = 2006, location = aresrpg::party)]
fun an_outsider_cannot_invite() {
  let Fixture { scenario: _scenario, version, registry, mut party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  api::party_invitation(&registry, &mut party, &kiosk, cap, ids[7], ids[2], true, &version);
  abort 999
}

#[test, expected_failure(abort_code = 2002, location = aresrpg::party)]
fun an_existing_member_cannot_be_invited_again() {
  let Fixture { scenario: _scenario, version, registry, mut party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  api::party_invitation(&registry, &mut party, &kiosk, cap, ids[0], ids[0], true, &version);
  abort 999
}

#[test, expected_failure(abort_code = 2001, location = aresrpg::party)]
fun a_nonleader_cannot_rescind_someone_elses_invitation() {
  let Fixture { scenario: _scenario, version, registry, mut party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  api::party_invitation(&registry, &mut party, &kiosk, cap, ids[2], ids[1], false, &version);
  abort 999
}

#[test, expected_failure(abort_code = 2005, location = aresrpg::party)]
fun rescind_requires_an_existing_invitation() {
  let Fixture { scenario: _scenario, version, registry, mut party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  api::party_invitation(&registry, &mut party, &kiosk, cap, ids[0], ids[7], false, &version);
  abort 999
}

#[test, expected_failure(abort_code = 2005, location = aresrpg::party)]
fun accept_requires_an_existing_invitation() {
  let Fixture { scenario: _scenario, version, mut registry, mut party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  api::party_accept(&mut registry, &mut party, &kiosk, cap, ids[7], &version);
  abort 999
}

#[test, expected_failure(abort_code = 2006, location = aresrpg::party)]
fun an_outsider_cannot_leave() {
  let Fixture { scenario: _scenario, version, mut registry, mut party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  api::party_leave(&mut registry, &mut party, &kiosk, cap, ids[7], &version);
  abort 999
}

#[test, expected_failure(abort_code = 2008, location = aresrpg::party)]
fun a_solo_leader_must_disband_instead_of_leaving() {
  let Fixture { scenario: _scenario, version, mut registry, mut party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  api::party_leave(&mut registry, &mut party, &kiosk, cap, ids[0], &version);
  abort 999
}

#[test, expected_failure(abort_code = 2001, location = aresrpg::party)]
fun only_the_leader_can_kick() {
  let Fixture { scenario: _scenario, version, mut registry, mut party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  api::party_kick(&mut registry, &mut party, &kiosk, cap, ids[1], ids[0], &version);
  abort 999
}

#[test, expected_failure(abort_code = 2006, location = aresrpg::party)]
fun a_kick_requires_an_accepted_member() {
  let Fixture { scenario: _scenario, version, mut registry, mut party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  api::party_kick(&mut registry, &mut party, &kiosk, cap, ids[0], ids[7], &version);
  abort 999
}

#[test, expected_failure(abort_code = 2007, location = aresrpg::party)]
fun the_leader_cannot_kick_itself() {
  let Fixture { scenario: _scenario, version, mut registry, mut party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  api::party_kick(&mut registry, &mut party, &kiosk, cap, ids[0], ids[0], &version);
  abort 999
}

#[test, expected_failure(abort_code = 2001, location = aresrpg::party)]
fun only_the_leader_can_disband() {
  let Fixture { scenario: _scenario, version, mut registry, party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  api::party_disband(&mut registry, party, &kiosk, cap, ids[1], &version);
  abort 999
}

#[test, expected_failure(abort_code = 2009, location = aresrpg::party)]
fun accepted_members_prevent_disband() {
  let Fixture { scenario: _scenario, version, mut registry, mut party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  api::party_accept(&mut registry, &mut party, &kiosk, cap, ids[1], &version);
  api::party_disband(&mut registry, party, &kiosk, cap, ids[0], &version);
  abort 999
}

#[test, expected_failure(abort_code = 2004, location = aresrpg::party)]
fun pending_invitations_have_a_six_target_bound() {
  let Fixture { scenario: _scenario, version, registry, mut party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  let mut i = 2;
  while (i <= 7) {
    api::party_invitation(&registry, &mut party, &kiosk, cap, ids[0], ids[i], true, &version);
    i = i + 1;
  };
  abort 999
}

#[test, expected_failure(abort_code = 2004, location = aresrpg::party)]
fun a_full_party_cannot_accept_an_already_pending_seventh_character() {
  let Fixture { scenario: _scenario, version, mut registry, mut party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  let mut i = 2;
  while (i <= 6) {
    api::party_invitation(&registry, &mut party, &kiosk, cap, ids[0], ids[i], true, &version);
    i = i + 1;
  };
  i = 1;
  while (i <= 6) {
    api::party_accept(&mut registry, &mut party, &kiosk, cap, ids[i], &version);
    i = i + 1;
  };
  abort 999
}

#[test, expected_failure(abort_code = 2004, location = aresrpg::party)]
fun a_full_party_cannot_add_another_invitation() {
  let Fixture { scenario: _scenario, version, mut registry, mut party, kiosk, personal, ids } = fixture();
  let cap = personal_kiosk::borrow(&personal);
  let mut i = 1;
  while (i <= 5) {
    if (i > 1) api::party_invitation(&registry, &mut party, &kiosk, cap, ids[0], ids[i], true, &version);
    api::party_accept(&mut registry, &mut party, &kiosk, cap, ids[i], &version);
    i = i + 1;
  };
  api::party_invitation(&registry, &mut party, &kiosk, cap, ids[0], ids[6], true, &version);
  abort 999
}
