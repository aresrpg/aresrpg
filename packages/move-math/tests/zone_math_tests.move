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
