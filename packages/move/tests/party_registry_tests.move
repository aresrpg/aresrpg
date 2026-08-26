// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg::party_registry_tests;

use aresrpg::party;
use sui::test_scenario;

const CHARACTER: address = @0xC0FFEE;
const PARTY_A: address = @0xA;
const PARTY_B: address = @0xB;

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
