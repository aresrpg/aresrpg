// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::fight_loot_tests;

use aresrpg::fight;
use sui::test_scenario as ts;

#[test]
fun duplicate_item_rows_are_one_collection_group() {
  assert!(fight::matching_drops_for_testing() == vector[5], 0);
}

#[test]
fun three_guaranteed_quantity_three_mob_rows_pay_nine_non_stackable_items() {
  assert!(fight::three_mob_non_stackable_split_for_testing() == vector[6, 3, 9], 0);
}

#[test]
fun mob_birth_resolves_loot_chance_but_preserves_quantity() {
  assert!(fight::mob_loot_scaling_for_testing() == vector[4_000, 6_000, 1, 2], 0);
}

#[test]
fun active_chance_effects_modify_loot_but_power_does_not() {
  let mut scenario = ts::begin(@0xA11CE);
  assert!(fight::active_chance_for_loot_for_testing(scenario.ctx()) == vector[600, 480, 420], 0);
  scenario.end();
}
