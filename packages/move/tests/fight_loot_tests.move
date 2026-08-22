// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::fight_loot_tests;

use aresrpg::fight;

#[test]
fun duplicate_item_rows_are_one_claim() {
  assert!(fight::matching_drops_for_testing() == vector[2, 5], 0);
}
