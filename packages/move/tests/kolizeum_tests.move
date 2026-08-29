// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg::kolizeum_tests;

use aresrpg::kolizeum;

#[test]
fun an_active_wagered_fight_may_forfeit() {
  kolizeum::assert_forfeit_phase_for_testing(false);
}

#[test]
#[expected_failure(abort_code = 2808, location = aresrpg::kolizeum)]
fun placement_can_only_exit_with_a_refund() {
  kolizeum::assert_forfeit_phase_for_testing(true);
  abort 999
}

#[test]
fun creator_is_always_in_the_frozen_friend_snapshot() {
  assert!(kolizeum::creator_allowed_for_testing(vector[@0xBEEF], @0xA11CE), 0);
  assert!(kolizeum::creator_allowed_for_testing(vector[@0xA11CE], @0xA11CE), 1);
}

#[test]
fun placement_clock_arms_only_for_a_full_lobby() {
  assert!(kolizeum::placement_clock_for_testing(3, 3, 2, 42_000) == 0, 0);
  assert!(kolizeum::placement_clock_for_testing(3, 2, 3, 42_000) == 0, 1);
  assert!(kolizeum::placement_clock_for_testing(3, 3, 3, 42_000) == 42_000, 2);
}
