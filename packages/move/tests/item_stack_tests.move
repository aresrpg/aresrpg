// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::item_stack_tests;

use aresrpg::item;
use sui::test_scenario;

const OWNER: address = @0xA11CE;

#[test]
fun a_split_stack_keeps_the_template_that_owns_its_live_behavior() {
  let mut scenario = test_scenario::begin(OWNER);
  assert!(item::split_preserves_template_for_testing(scenario.ctx()), 0);
  scenario.end();
}
