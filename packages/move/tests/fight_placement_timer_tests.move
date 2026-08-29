// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg::fight_placement_timer_tests;

use aresrpg::fight;

#[test]
fun force_start_requires_an_armed_elapsed_clock() {
  assert!(!fight::placement_force_ready_for_testing(0, 1_000_000), 0);
  assert!(!fight::placement_force_ready_for_testing(42_000, 101_999), 1);
  assert!(fight::placement_force_ready_for_testing(42_000, 102_000), 2);
}
