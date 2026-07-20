// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// JOB XP TESTS — coverage for the immutable 100-level job progression table's public surface. No private
/// helpers in this module (unlike `character_xp`, everything here is a direct, fully-public formula).
#[test_only]
module aresrpg_foundation::job_xp_tests;

use aresrpg_foundation::job_xp;

#[test]
fun t_max_level_is_100() {
  assert!(job_xp::max_level() == 100, 0);
}

#[test]
fun t_level_from_xp_boundaries_and_clamp() {
  assert!(job_xp::level_from_xp(0) == 1, 0);
  assert!(job_xp::level_from_xp(49) == 1, 1); // just under level 2's threshold
  assert!(job_xp::level_from_xp(50) == 2, 2); // exact threshold for level 2
  assert!(job_xp::level_from_xp(140) == 3, 3); // exact threshold for level 3
  assert!(job_xp::level_from_xp(581687) == 100, 4); // exact max threshold
  assert!(job_xp::level_from_xp(999999999) == 100, 5); // way beyond -> clamps at 100
}

#[test]
fun t_tier_to_level_mapping_and_cap() {
  assert!(job_xp::tier_to_level(0) == 1, 0); // tier <= 1 -> level 1
  assert!(job_xp::tier_to_level(1) == 1, 1);
  assert!(job_xp::tier_to_level(2) == 10, 2);
  assert!(job_xp::tier_to_level(10) == 90, 3);
  assert!(job_xp::tier_to_level(11) == 100, 4);
  assert!(job_xp::tier_to_level(12) == 100, 5); // (12-1)*10=110 > MAX_LEVEL -> capped at 100
}
