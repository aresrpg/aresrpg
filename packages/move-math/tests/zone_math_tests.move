// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::zone_math_tests;

use aresrpg_math::zone_math;

#[test]
fun group_size_reaches_the_authored_average_three_at_two_thousand_blocks() {
  assert!(zone_math::group_size_bounds_for_testing(2_000) == vector[2, 4], 0);
}

#[test]
fun the_first_outer_zone_can_already_draw_multi_mob_groups() {
  assert!(zone_math::group_size_bounds_for_testing(848) == vector[1, 2], 0);
}

#[test]
fun mob_level_bounds_move_from_minimum_to_the_upper_quarter() {
  assert!(zone_math::level_bounds_for_testing(0) == vector[0, 0], 0);
  assert!(zone_math::level_bounds_for_testing(10_000) == vector[37, 50], 1);
  assert!(zone_math::level_bounds_for_testing(20_000) == vector[75, 100], 2);
  assert!(zone_math::level_bounds_for_testing(50_000) == vector[75, 100], 3);
}
