// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::friends_lifecycle_tests;

use aresrpg::{api, friends::{Self, FriendList, FriendRegistry}, version::{Self, Version}};
use sui::{address, test_scenario::{Self, Scenario}};

const OWNER: address = @0xA11CE;
const FIRST: address = @0xB0B;

fun fixture(sender: address): (Scenario, Version, FriendRegistry, FriendList) {
  let mut scenario = test_scenario::begin(OWNER);
  version::test_init(scenario.ctx());
  friends::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let version = scenario.take_shared<Version>();
  let mut registry = scenario.take_shared<FriendRegistry>();
  api::create_friend_list(&mut registry, FIRST, &version, scenario.ctx());
  test_scenario::return_shared(version);
  test_scenario::return_shared(registry);
  scenario.next_tx(sender);
  let version = scenario.take_shared<Version>();
  let registry = scenario.take_shared<FriendRegistry>();
  let list = scenario.take_from_address<FriendList>(OWNER);
  (scenario, version, registry, list)
}

fun finish(scenario: Scenario, version: Version, registry: FriendRegistry, list: FriendList) {
  test_scenario::return_shared(version);
  test_scenario::return_shared(registry);
  test_scenario::return_to_address(OWNER, list);
  scenario.end();
}

#[test]
fun the_real_whitelist_persists_edits_and_snapshots_are_values() {
  let (mut scenario, version, registry, mut list) = fixture(OWNER);
  let first = FIRST;
  let second = @0xCAFE;
  let snapshot = friends::snapshot(&list);
  assert!(snapshot.contains(&first) && snapshot.length() == 1);
  api::set_friend(&mut list, second, true, &version, scenario.ctx());
  assert!(friends::snapshot(&list).contains(&second));
  assert!(!snapshot.contains(&second));
  api::set_friend(&mut list, FIRST, false, &version, scenario.ctx());
  assert!(!friends::snapshot(&list).contains(&first));
  test_scenario::return_to_sender(&scenario, list);
  test_scenario::return_shared(version);
  test_scenario::return_shared(registry);
  scenario.next_tx(OWNER);
  let list = scenario.take_from_sender<FriendList>();
  assert!(friends::snapshot(&list).length() == 1 && friends::snapshot(&list).contains(&second));
  let version = scenario.take_shared<Version>();
  let registry = scenario.take_shared<FriendRegistry>();
  finish(scenario, version, registry, list);
}

#[test]
fun removal_reopens_a_full_whitelist_slot() {
  let (mut scenario, version, registry, mut list) = fixture(OWNER);
  let mut i = 1;
  while (i < 100) {
    api::set_friend(&mut list, address::from_u256(i), true, &version, scenario.ctx());
    i = i + 1;
  };
  assert!(friends::snapshot(&list).length() == 100);
  api::set_friend(&mut list, FIRST, false, &version, scenario.ctx());
  api::set_friend(&mut list, @0xFFFF, true, &version, scenario.ctx());
  assert!(friends::snapshot(&list).length() == 100);
  finish(scenario, version, registry, list);
}

#[test, expected_failure(abort_code = 2101, location = aresrpg::friends)]
fun one_owner_cannot_create_a_second_list() {
  let (mut scenario, version, mut registry, list) = fixture(OWNER);
  api::create_friend_list(&mut registry, @0xCAFE, &version, scenario.ctx());
  finish(scenario, version, registry, list);
}
#[test, expected_failure(abort_code = 2103, location = aresrpg::friends)]
fun duplicate_friend_is_refused_by_the_public_door() {
  let (mut scenario, version, registry, mut list) = fixture(OWNER);
  api::set_friend(&mut list, FIRST, true, &version, scenario.ctx());
  finish(scenario, version, registry, list);
}
#[test, expected_failure(abort_code = 2104, location = aresrpg::friends)]
fun removing_an_absent_friend_is_refused() {
  let (mut scenario, version, registry, mut list) = fixture(OWNER);
  api::set_friend(&mut list, @0xCAFE, false, &version, scenario.ctx());
  finish(scenario, version, registry, list);
}
#[test, expected_failure(abort_code = 2102, location = aresrpg::friends)]
fun a_foreign_sender_cannot_edit_a_persisted_list() {
  let (mut scenario, version, registry, mut list) = fixture(@0xBEEF);
  api::set_friend(&mut list, @0xCAFE, true, &version, scenario.ctx());
  finish(scenario, version, registry, list);
}
#[test, expected_failure(abort_code = 2105, location = aresrpg::friends)]
fun the_hundred_and_first_friend_is_refused() {
  let (mut scenario, version, registry, mut list) = fixture(OWNER);
  let mut i = 1;
  while (i <= 100) {
    api::set_friend(&mut list, address::from_u256(i), true, &version, scenario.ctx());
    i = i + 1;
  };
  finish(scenario, version, registry, list);
}
