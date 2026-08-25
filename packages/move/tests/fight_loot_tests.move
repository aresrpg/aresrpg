// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::fight_loot_tests;

use aresrpg::fight;

#[test]
fun duplicate_item_rows_are_one_collection_group() {
  assert!(fight::matching_drops_for_testing() == vector[2, 5], 0);
}

#[test]
fun mob_birth_resolves_loot_chance_but_preserves_quantity() {
  assert!(fight::mob_loot_scaling_for_testing() == vector[4_000, 6_000, 1, 2], 0);
}
