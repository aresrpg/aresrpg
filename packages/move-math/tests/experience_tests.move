// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::experience_tests;

use aresrpg_math::experience;

#[test]
fun level_changes_at_the_retro_threshold_and_never_before_it() {
  let amounts = vector[0, 1, 109, 110, 649, 650, 171_000, 621_599, 621_600,
    5_349_999, 5_350_000, 95_885_999, 95_886_000, 7_407_231_999, 7_407_232_000, 18_446_744_073_709_551_615];
  let levels = vector[1u16, 1, 1, 2, 2, 3, 20, 29, 30, 49, 50, 99, 100, 199, 200, 200];
  assert!(experience::max_level() == 200, 1);
  let mut index = 0;
  while (index < amounts.length()) {
    assert!(experience::level_from_xp(amounts[index]) == levels[index], 2);
    index = index + 1;
  };
}
