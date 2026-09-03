// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg::friends_tests;

use aresrpg::friends;
use sui::test_scenario;

const OWNER: address = @0xA11CE;
const FIRST: address = @0xB0B;

#[test]
fun creation_contains_its_first_friend() {
  let mut scenario = test_scenario::begin(OWNER);
  let list = friends::list_for_testing(OWNER, FIRST, scenario.ctx());
  let first = FIRST;
  assert!(friends::snapshot(&list).contains(&first), 0);
  friends::destroy_for_testing(list);
  scenario.end();
}

#[test]
#[expected_failure(abort_code = 2103, location = aresrpg::friends)]
fun duplicate_add_aborts() {
  let mut scenario = test_scenario::begin(OWNER);
  let mut list = friends::list_for_testing(OWNER, FIRST, scenario.ctx());
  friends::set(&mut list, FIRST, true, scenario.ctx());
  abort 999
}

#[test]
#[expected_failure(abort_code = 2102, location = aresrpg::friends)]
fun another_wallet_cannot_edit_the_list() {
  let mut scenario = test_scenario::begin(@0xBEEF);
  let mut list = friends::list_for_testing(OWNER, FIRST, scenario.ctx());
  friends::set(&mut list, @0xCAFE, true, scenario.ctx());
  abort 999
}
