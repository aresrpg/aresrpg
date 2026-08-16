// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::crafting_tests;

use aresrpg::crafting;

#[test]
fun craft_xp_depends_only_on_distinct_ingredient_slots() {
  assert!(crafting::test_craft_xp_for(2) == 10);
  assert!(crafting::test_craft_xp_for(3) == 25);
  assert!(crafting::test_craft_xp_for(4) == 50);
  assert!(crafting::test_craft_xp_for(5) == 100);
  assert!(crafting::test_craft_xp_for(6) == 250);
  assert!(crafting::test_craft_xp_for(7) == 500);
  assert!(crafting::test_craft_xp_for(8) == 1000);
  assert!(crafting::test_craft_xp_for(9) == 1000);
  assert!(crafting::test_craft_xp_for(10) == 1000);
}
