// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::mastery_tests;

use aresrpg::mastery;

#[test]
fun world_entry_level_sets_the_exact_mastery_reward() {
  assert!(mastery::reward_for_testing(1) == 1);
  assert!(mastery::reward_for_testing(50) == 1);
  assert!(mastery::reward_for_testing(51) == 2);
  assert!(mastery::reward_for_testing(100) == 2);
  assert!(mastery::reward_for_testing(101) == 3);
  assert!(mastery::reward_for_testing(150) == 3);
  assert!(mastery::reward_for_testing(151) == 4);
  assert!(mastery::reward_for_testing(199) == 4);
  assert!(mastery::reward_for_testing(200) == 5);
}

#[test]
fun a_pre_assignment_or_cross_world_fight_cannot_validate_the_quest() {
  assert!(!mastery::completion_scope_for_testing(
    100, b"nauvis".to_string(), 99, b"nauvis".to_string(),
  ));
  assert!(!mastery::completion_scope_for_testing(
    100, b"nauvis".to_string(), 100, b"yakutia".to_string(),
  ));
  assert!(!mastery::completion_scope_for_testing(
    100, b"nauvis".to_string(), 100, b"nauvis".to_string(),
  ));
  assert!(mastery::completion_scope_for_testing(
    100, b"nauvis".to_string(), 101, b"nauvis".to_string(),
  ));
}
