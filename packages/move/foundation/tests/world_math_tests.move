/// WORLD MATH TESTS — coverage for the overworld travel-plausibility law and the zone spawn-roll helpers; this
/// module ships with NO source-file inline tests at all (0% baseline). `abs_diff`/`budget_blocks`/`isqrt` are
/// PRIVATE with no public wrapper — covered TRANSITIVELY: `travel_ok`/`wait_seconds` call `abs_diff` +
/// `budget_blocks`; `wait_seconds` calls `isqrt`. `RandomGenerator` is built via the Sui framework's
/// `#[test_only] random::new_generator_for_testing()` — no `Random` object / `test_scenario` needed.
#[test_only]
module aresrpg_foundation::world_math_tests;

use aresrpg_foundation::world_math;
use sui::random;

#[test]
fun t_travel_ok_within_beyond_and_pet_boosted_budget() {
  // speed_budget=1000 (x100 fixed point) over 2000ms -> raw = 1000*2000/100_000 = 20 blocks.
  assert!(world_math::travel_ok(1000, 0, 0, 0, 15, 0, 2000, false), 0); // dx=15 <= budget 20 -> reachable
  assert!(!world_math::travel_ok(1000, 0, 0, 0, 25, 0, 2000, false), 1); // dx=25 > budget 20 -> not yet
  assert!(world_math::travel_ok(1000, 0, 0, 0, 25, 0, 2000, true), 2); // pet_both: 20/2*3=30 >= 25 -> reachable
  assert!(!world_math::travel_ok(1000, 0, 0, 5000, 0, 0, 4000, false), 3); // now_ms < from_ms -> always false
  // pathological elapsed saturates budget_blocks to MAX_LINEAR -> short-circuits true regardless of distance.
  assert!(world_math::travel_ok(1, 0, 0, 0, 4_000_000, 4_000_000, 20_000_000_000_000, false), 4);
}

#[test]
fun t_wait_seconds_remaining_time_and_pet_boost() {
  // distance 30 blocks (isqrt(900) exact), speed_budget=1000 -> need = 30*100/1000 = 3s.
  assert!(world_math::wait_seconds(1000, 0, 0, 0, 30, 0, 0, false) == 3, 0); // no time elapsed -> wait 3
  assert!(world_math::wait_seconds(1000, 0, 0, 0, 30, 0, 2000, false) == 1, 1); // 2s elapsed -> wait 1
  assert!(world_math::wait_seconds(1000, 0, 0, 0, 30, 0, 5000, false) == 0, 2); // already legal
  // pet_both: eff = 1000/2*3 = 1500 -> need = 3000/1500 = 2s.
  assert!(world_math::wait_seconds(1000, 0, 0, 0, 30, 0, 0, true) == 2, 3);
}

#[test]
fun t_roll_u32_and_group_clamp() {
  // (pick_weighted / roll_u64 / roll_pos retired with the search-cost rework — their replayable prng twins live
  // in zone_gen.move; roll_u32 survives as the JOIN spawn roll's helper.)
  let mut gen = random::new_generator_for_testing();
  assert!(world_math::roll_u32(&mut gen, 7, 7) == 7, 0); // point band -> lo, no draw
  let r32 = world_math::roll_u32(&mut gen, 1, 50);
  assert!(r32 >= 1 && r32 <= 50, 1);

  assert!(world_math::clamp_group_u16(10, 6) == 6, 2); // over bound -> clamps down
  assert!(world_math::clamp_group_u16(0, 6) == 1, 3); // under 1 -> floors to 1
  assert!(world_math::clamp_group_u16(4, 6) == 4, 4); // in range -> unchanged
}
