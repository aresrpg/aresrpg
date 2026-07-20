// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CHARACTER XP TESTS — coverage for `level_from_xp`/`max_level`. `xp_for_level` already has inline coverage
/// via `progression_math`'s source-file tests.
#[test_only]
module aresrpg_foundation::character_xp_tests;

use aresrpg_foundation::character_xp;

#[test]
fun t_max_level_is_200() {
  assert!(character_xp::max_level() == 200, 0);
}

#[test]
fun t_level_from_xp_boundaries_and_clamp() {
  assert!(character_xp::level_from_xp(0) == 1, 0);
  assert!(character_xp::level_from_xp(109) == 1, 1); // just under level 2's threshold (110)
  assert!(character_xp::level_from_xp(110) == 2, 2); // exact threshold for level 2
  assert!(character_xp::level_from_xp(650) == 3, 3); // exact threshold for level 3
  assert!(character_xp::level_from_xp(7407232000) == 200, 4); // exact max threshold
  assert!(character_xp::level_from_xp(999999999999) == 200, 5); // way beyond -> clamps at 200
}
