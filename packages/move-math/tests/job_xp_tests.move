// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::job_xp_tests;
use aresrpg_math::job_xp;

#[test]
fun base_craft_xp_depends_only_on_distinct_ingredient_slots() {
  assert!(job_xp::craft_xp(2) == 10);
  assert!(job_xp::craft_xp(3) == 25);
  assert!(job_xp::craft_xp(4) == 50);
  assert!(job_xp::craft_xp(5) == 100);
  assert!(job_xp::craft_xp(6) == 250);
  assert!(job_xp::craft_xp(7) == 500);
  assert!(job_xp::craft_xp(8) == 1000);
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


#[test]
fun every_progression_boundary_selects_the_highest_earned_level() {
  assert!(job_xp::level_from_xp(49) == 1 && job_xp::level_from_xp(50) == 2, 0);
  assert!(job_xp::level_from_xp(62490) == 49 && job_xp::level_from_xp(62491) == 50, 1);
  assert!(job_xp::level_from_xp(581686) == 99 && job_xp::level_from_xp(581687) == 100, 2);
  let (maximum, next) = job_xp::level_and_next_xp(18446744073709551615);
  assert!(maximum == job_xp::max_level() && next == 0, 3);
  let mut xp = 0u64;
  let mut level = 1u64;
  while (level < job_xp::max_level()) {
    let (current, next) = job_xp::level_and_next_xp(xp);
    assert!(current == level && next > xp, 4);
    assert!(job_xp::level_from_xp(next - 1) == level && job_xp::level_from_xp(next) == level + 1, 5);
    xp = next;
    level = level + 1;
  };
}

#[test]
fun legal_job_levels_bound_success_yield_delay_and_slots() {
  let unlocks = vector[1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  let mut tier = 1u64;
  while (tier <= unlocks.length()) {
    assert!(job_xp::tier_to_level(tier) == unlocks[tier - 1], 0);
    tier = tier + 1;
  };
  assert!(job_xp::tier_to_level(0) == 1 && job_xp::tier_to_level(12) == 100, 1);
  assert!(job_xp::gather_time_ms(1) == 12000 && job_xp::gather_time_ms(100) == 2000, 2);
  assert!(job_xp::gather_time_ms(101) == 2000, 3);
  let (lo, hi) = job_xp::gather_quantity_bounds(1, 1);
  assert!(lo == 1 && hi == 2, 4);
  let (lo, hi) = job_xp::gather_quantity_bounds(100, 100);
  assert!(lo == 6 && hi == 6, 5);
  let (lo, hi) = job_xp::gather_quantity_bounds(100, 1);
  assert!(lo == 6 && hi == 21, 6);
  assert!(job_xp::gather_xp(1) == 10 && job_xp::gather_xp(100) == 60, 7);
  assert!(job_xp::craft_success_bp(2) == 5050 && job_xp::craft_success_bp(99) == 9900, 14);
  let mut previous_delay = 12000u64;
  let mut level = 1u64;
  while (level <= 100) {
    let delay = job_xp::gather_time_ms(level);
    assert!(delay >= 2000 && delay <= previous_delay, 15);
    previous_delay = delay;
    let chance = job_xp::craft_success_bp(level);
    assert!(chance >= 5000 && chance <= 9900, 8);
    let slots = job_xp::craft_slot_capacity(level);
    assert!(slots <= job_xp::max_craft_ingredients() && job_xp::craft_required_level(slots) <= level, 9);
    if (slots < 8) assert!(job_xp::craft_required_level(slots + 1) > level, 10);
    level = level + 1;
  };
  assert!(job_xp::gathering_tool(&b"FARMER".to_string()) == b"tool_farmer".to_string(), 11);
  assert!(job_xp::gathering_tool(&b"HERBALIST".to_string()) == b"tool_herbalist".to_string(), 12);
  assert!(job_xp::gathering_tool(&b"MINER".to_string()) == b"tool_miner".to_string(), 13);
}
