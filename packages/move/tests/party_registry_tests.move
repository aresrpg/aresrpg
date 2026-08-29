// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg::party_registry_tests;

use aresrpg::{character, party};
use sui::test_scenario;

const CHARACTER: address = @0xC0FFEE;
const PARTY_A: address = @0xA;
const PARTY_B: address = @0xB;

#[test]
fun first_invitation_is_pending_from_party_birth() {
  let mut scenario = test_scenario::begin(@0xA11CE);
  let mut registry = party::registry_for_testing(scenario.ctx());
  let leader = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let leader_id = object::id(&leader);
  let invited = object::id_from_address(CHARACTER);
  let row = party::inviting_for_testing(&mut registry, &leader, invited, scenario.ctx());
  let (stored_leader, stored_invited, members, pending) = party::shape_for_testing(&row);
  assert!(stored_leader == leader_id, 0);
  assert!(stored_invited == invited, 1);
  assert!(members == 1, 2);
  assert!(pending == 1, 3);
  party::disband(&mut registry, row, object::id(&leader));
  character::destroy(leader);
  party::destroy_registry_for_testing(registry);
  scenario.end();
}

#[test, expected_failure(abort_code = 2002, location = aresrpg::party)]
fun first_invitation_cannot_target_its_leader() {
  let mut scenario = test_scenario::begin(@0xA11CE);
  let mut registry = party::registry_for_testing(scenario.ctx());
  let leader = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let row = party::inviting_for_testing(&mut registry, &leader, object::id(&leader), scenario.ctx());
  party::disband(&mut registry, row, object::id(&leader));
  character::destroy(leader);
  party::destroy_registry_for_testing(registry);
  scenario.end();
  abort 999
}

#[test, expected_failure(abort_code = 2002, location = aresrpg::party)]
fun first_invitation_cannot_target_an_existing_party_member() {
  let mut scenario = test_scenario::begin(@0xA11CE);
  let mut registry = party::registry_for_testing(scenario.ctx());
  let leader = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let invited = object::id_from_address(CHARACTER);
  party::claim_membership_for_testing(&mut registry, invited, object::id_from_address(PARTY_A));
  let row = party::inviting_for_testing(&mut registry, &leader, invited, scenario.ctx());
  party::disband(&mut registry, row, object::id(&leader));
  character::destroy(leader);
  party::destroy_registry_for_testing(registry);
  scenario.end();
  abort 999
}

#[test, expected_failure(abort_code = 2002, location = aresrpg::party)]
fun later_invitation_cannot_target_an_existing_party_member() {
  let mut scenario = test_scenario::begin(@0xA11CE);
  let mut registry = party::registry_for_testing(scenario.ctx());
  let leader = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let first_invited = object::id_from_address(@0xF1);
  let occupied = object::id_from_address(CHARACTER);
  let mut row = party::inviting_for_testing(&mut registry, &leader, first_invited, scenario.ctx());
  party::claim_membership_for_testing(&mut registry, occupied, object::id_from_address(PARTY_A));
  party::i(&registry, &mut row, object::id(&leader), occupied, true);
  party::disband(&mut registry, row, object::id(&leader));
  character::destroy(leader);
  party::destroy_registry_for_testing(registry);
  scenario.end();
  abort 999
}

#[test]
fun released_membership_can_join_again() {
  let mut scenario = test_scenario::begin(@0xA11CE);
  let mut registry = party::registry_for_testing(scenario.ctx());
  let character = object::id_from_address(CHARACTER);
  let party_a = object::id_from_address(PARTY_A);
  let party_b = object::id_from_address(PARTY_B);
  party::claim_membership_for_testing(&mut registry, character, party_a);
  party::release_membership_for_testing(&mut registry, character, party_a);
  party::claim_membership_for_testing(&mut registry, character, party_b);
  party::release_membership_for_testing(&mut registry, character, party_b);
  party::destroy_registry_for_testing(registry);
  scenario.end();
}

#[test]
fun an_accepted_member_can_invite() {
  let mut scenario = test_scenario::begin(@0xA11CE);
  let mut registry = party::registry_for_testing(scenario.ctx());
  let leader = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let member = character::test_character(b"shugo".to_string(), 1, 0, scenario.ctx());
  let target = object::id_from_address(@0xCAFE);
  let mut row = party::inviting_for_testing(&mut registry, &leader, object::id(&member), scenario.ctx());
  party::accept(&mut registry, &mut row, object::id(&member));
  party::i(&registry, &mut row, object::id(&member), target, true);
  party::leave(&mut registry, &mut row, object::id(&leader));
  party::disband(&mut registry, row, object::id(&member));
  character::destroy(leader);
  character::destroy(member);
  party::destroy_registry_for_testing(registry);
  scenario.end();
}

#[test]
#[expected_failure(abort_code = 2006, location = aresrpg::party)]
fun a_nonmember_character_cannot_invite() {
  let mut scenario = test_scenario::begin(@0xA11CE);
  let mut registry = party::registry_for_testing(scenario.ctx());
  let leader = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let outsider = character::test_character(b"shugo".to_string(), 1, 0, scenario.ctx());
  let mut row = party::inviting_for_testing(
    &mut registry,
    &leader,
    object::id_from_address(@0xF1),
    scenario.ctx(),
  );
  party::i(&registry, &mut row, object::id(&outsider), object::id_from_address(@0xCAFE), true);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2002, location = aresrpg::party)]
fun one_character_cannot_claim_two_parties() {
  let mut scenario = test_scenario::begin(@0xA11CE);
  let mut registry = party::registry_for_testing(scenario.ctx());
  let character = object::id_from_address(CHARACTER);
  party::claim_membership_for_testing(&mut registry, character, object::id_from_address(PARTY_A));
  party::claim_membership_for_testing(&mut registry, character, object::id_from_address(PARTY_B));
  abort 999
}

#[test]
#[expected_failure(abort_code = 2002, location = aresrpg::party)]
fun a_party_member_cannot_be_deleted() {
  let mut scenario = test_scenario::begin(@0xA11CE);
  let mut registry = party::registry_for_testing(scenario.ctx());
  let character = object::id_from_address(CHARACTER);
  party::claim_membership_for_testing(&mut registry, character, object::id_from_address(PARTY_A));
  party::af(&registry, character);
  abort 999
}
