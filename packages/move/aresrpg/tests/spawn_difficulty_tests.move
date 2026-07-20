// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Regression for Lane 69: the full 1000×1000 first-join box is the floor ring, then the authored continuous
/// distance curve begins at its boundary. These are geometry/cap assertions, so PRNG luck cannot make the test
/// pass while a high roster tier remains eligible next to spawn.
#[test_only]
module aresrpg::spawn_difficulty_tests;

use aresrpg::zone_comp;
use aresrpg_foundation::world_math;
use std::unit_test::assert_eq;

const ZONE_SIZE: u32 = 512;
const BOUNDS: u32 = 500_000;
const SPAWN: u32 = 1_000;

fun progress(zx: u32, zy: u32): u64 {
  zone_comp::distance_progress_for_testing(
    zx, zy, ZONE_SIZE, BOUNDS, BOUNDS, SPAWN, SPAWN,
  )
}

#[test]
fun every_fresh_join_zone_is_the_low_band() {
  // The centred join interval is [249500, 250499], spanning zone indices 487..489 on both axes.
  assert_eq!(progress(487, 487), 0);
  assert_eq!(progress(487, 489), 0);
  assert_eq!(progress(489, 487), 0);
  assert_eq!(progress(489, 489), 0);
  assert_eq!(world_math::level_cap(progress(489, 489), 3, 12), 3);
  assert_eq!(world_math::size_cap(progress(489, 489), 6), 2);
}

#[test]
fun difficulty_grows_smoothly_after_the_spawn_boundary() {
  let at_spawn = progress(489, 488);
  let adjacent = progress(490, 488);
  let middle = progress(492, 488);
  let far = progress(500, 488);
  let adjacent_cap = world_math::level_cap(adjacent, 3, 12);
  let middle_cap = world_math::level_cap(middle, 3, 12);
  assert!(at_spawn == 0 && at_spawn < adjacent);
  assert!(adjacent < middle && middle < far);
  assert!(3 < adjacent_cap && adjacent_cap < middle_cap && middle_cap < 12);
  assert_eq!(far, 1000);
  assert_eq!(world_math::level_cap(far, 3, 12), 12);
  assert_eq!(world_math::size_cap(far, 6), 6);
}
