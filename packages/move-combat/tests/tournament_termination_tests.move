// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_combat::tournament_termination_tests;
use aresrpg_combat::combat;

#[test]
fun managed_expiry_retains_roster_and_returns_no_winner() {
  let mut state = combat::captured_dungeon_wave_for_testing();
  let count = combat::fighter_count(&state);
  combat::finish_managed(&mut state, option::none());
  assert!(combat::ended(&state) && combat::winner(&state).is_none(), 0);
  assert!(combat::fighter_count(&state) == count, 1);
  combat::destroy(state);
}
#[test]
fun managed_walkover_records_the_present_side() {
  let mut state = combat::captured_dungeon_wave_for_testing();
  combat::finish_managed(&mut state, option::some(1));
  assert!(combat::ended(&state) && combat::winner(&state) == option::some(1), 0);
  assert!(combat::placement_duration_ms() == 60000, 1);
  combat::destroy(state);
}
#[test, expected_failure(abort_code = 1710, location = aresrpg_combat::combat)]
fun ended_outcome_cannot_be_overwritten_by_expiry() {
  let mut state = combat::captured_dungeon_wave_for_testing();
  combat::finish_managed(&mut state, option::some(1));
  combat::finish_managed(&mut state, option::none());
  combat::destroy(state);
}
#[test, expected_failure(abort_code = 1709, location = aresrpg_combat::combat)]
fun invalid_winner_is_rejected() {
  let mut state = combat::captured_dungeon_wave_for_testing();
  combat::finish_managed(&mut state, option::some(2));
  combat::destroy(state);
}
