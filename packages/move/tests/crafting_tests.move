// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::crafting_tests;

use aresrpg::crafting;
use aresrpg_math::job_xp;

#[test]
fun base_craft_xp_depends_only_on_distinct_ingredient_slots() {
  assert!(crafting::test_craft_xp_for(2) == 10);
  assert!(crafting::test_craft_xp_for(3) == 25);
  assert!(crafting::test_craft_xp_for(4) == 50);
  assert!(crafting::test_craft_xp_for(5) == 100);
  assert!(crafting::test_craft_xp_for(6) == 250);
  assert!(crafting::test_craft_xp_for(7) == 500);
  assert!(crafting::test_craft_xp_for(8) == 1000);
  assert!(job_xp::craft_required_level(2) == 1);
  assert!(job_xp::craft_required_level(3) == 10);
  assert!(job_xp::craft_required_level(4) == 20);
  assert!(job_xp::craft_required_level(5) == 40);
  assert!(job_xp::craft_required_level(6) == 60);
  assert!(job_xp::craft_required_level(7) == 80);
  assert!(job_xp::craft_required_level(8) == 100);
}

#[test]
fun obsolete_recipes_stop_granting_xp_at_retro_slot_boundaries() {
  assert!(job_xp::craft_xp_at_level(2, 59) == 10);
  assert!(job_xp::craft_xp_at_level(2, 60) == 0);
  assert!(job_xp::craft_xp_at_level(3, 79) == 25);
  assert!(job_xp::craft_xp_at_level(3, 80) == 0);
  assert!(job_xp::craft_xp_at_level(4, 99) == 50);
  assert!(job_xp::craft_xp_at_level(4, 100) == 0);
  assert!(job_xp::craft_xp_at_level(5, 100) == 100);
}
