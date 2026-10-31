// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::tournament_bracket_tests;

use aresrpg_math::tournament_bracket as bracket;

fun entrants(count: u64): vector<u64> {
  let mut rows = vector[];
  let mut i = 0;
  while (i < count) { rows.push_back(i); i = i + 1; };
  rows
}

#[test]
fun every_supported_size_has_a_fixed_bracket_and_unique_podium() {
  let mut count = 2;
  while (count <= bracket::max_teams()) {
    let mut matches = bracket::new(entrants(count), 1_000);
    let mut played = 0;
    let mut now = 2_000;
    while (!bracket::done(&matches)) {
      let mut i = 0;
      let before = played;
      while (i < matches.length()) {
        if (bracket::state(&matches[i]) == 1) {
          let a = bracket::team(&matches[i], 0);
          let b = bracket::team(&matches[i], 1);
          assert!(a != b && a < count && b < count, 0);
          assert!(bracket::available_ms(&matches[i]) < now, 1);
          let side = ((a + b) % 2) as u8;
          let winner = if (side == 0) a else b;
          let loser = if (side == 0) b else a;
          bracket::resolve(&mut matches, i, option::some(side), true, now);
          assert!(bracket::winner(&matches[i]) == option::some(winner), 2);
          assert!(bracket::loser(&matches[i]) == option::some(loser), 3);
          played = played + 1;
          now = now + 1;
        };
        i = i + 1;
      };
      assert!(played > before, 4);
    };
    assert!(played == if (count >= 4) count else count - 1, 5);
    let mut places = vector[0u64, 0, 0, 0, 0, 0];
    let mut team = 0;
    while (team < count) {
      let place = bracket::placement(&matches, team) as u64;
      *places.borrow_mut(place) = places[place] + 1;
      team = team + 1;
    };
    assert!(places[1] == 1 && places[2] == 1, 6);
    if (count >= 4) assert!(places[3] == 1 && places[4] == 1, 7);
    if (count >= 8) assert!(places[5] == 4, 8);
    count = count + 1;
  };
}

#[test]
fun abandoned_brackets_finish_without_inventing_prize_winners() {
  let mut count = 2;
  while (count <= bracket::max_teams()) {
    let mut matches = bracket::new(entrants(count), 1_000);
    while (!bracket::done(&matches)) {
      let mut i = 0;
      while (i < matches.length()) {
        if (bracket::state(&matches[i]) == 1)
          bracket::resolve(&mut matches, i, option::none(), false, 61_000);
        i = i + 1;
      };
    };
    // Byes may advance a team, but an absent final cannot manufacture a runner-up.
    assert!(bracket::loser(&matches[0]).is_none(), 0);
    let mut team = 0;
    while (team < count) {
      let place = bracket::placement(&matches, team);
      assert!(place == 0 || place == 1, 1);
      team = team + 1;
    };
    count = count + 1;
  };
}

#[test]
fun semifinal_walkover_never_rewards_the_absent_team() {
  let mut matches = bracket::new(entrants(4), 1_000);
  let absent = bracket::team(&matches[1], 1);
  bracket::resolve(&mut matches, 1, option::some(0), false, 61_000);
  bracket::resolve(&mut matches, 2, option::some(1), true, 62_000);
  assert!(bracket::state(&matches[3]) == 2, 0);
  assert!(bracket::available_ms(&matches[0]) == 62_000, 1);
  bracket::resolve(&mut matches, 0, option::some(0), true, 70_000);
  assert!(bracket::placement(&matches, absent) == 0, 2);
  assert!(bracket::available_ms(&matches[0]) == 62_000, 3);
}

#[test, expected_failure(abort_code = 3302, location = aresrpg_math::tournament_bracket)]
fun duplicate_result_cannot_change_the_winner() {
  let mut matches = bracket::new(entrants(2), 1);
  bracket::resolve(&mut matches, 0, option::some(0), true, 2);
  bracket::resolve(&mut matches, 0, option::some(1), true, 3);
}

#[test, expected_failure(abort_code = 3302, location = aresrpg_math::tournament_bracket)]
fun unresolved_dependencies_cannot_be_played() {
  let mut matches = bracket::new(entrants(4), 1);
  bracket::resolve(&mut matches, 0, option::some(0), true, 2);
}

#[test, expected_failure(abort_code = 3301, location = aresrpg_math::tournament_bracket)]
fun oversized_bracket_is_refused() { let _ = bracket::new(entrants(65), 1); }

#[test, expected_failure(abort_code = 3301, location = aresrpg_math::tournament_bracket)]
fun invalid_side_is_refused() {
  let mut matches = bracket::new(entrants(2), 1);
  bracket::resolve(&mut matches, 0, option::some(2), true, 2);
}

#[test]
fun prize_tables_determine_the_minimum_complete_roster() {
  bracket::validate_bps(&vector[6000,2500,1000,500,0]);
  assert!(bracket::minimum_teams(&vector[10000,0,0,0,0], &vector[10000,0,0,0,0], vector[]) == 2, 0);
  assert!(bracket::minimum_teams(&vector[9000,0,1000,0,0], &vector[10000,0,0,0,0], vector[]) == 4, 1);
  assert!(bracket::minimum_teams(&vector[10000,0,0,0,0], &vector[9000,0,0,0,1000], vector[]) == 8, 2);
  assert!(bracket::minimum_teams(&vector[10000,0,0,0,0], &vector[10000,0,0,0,0], vector[3,5]) == 8, 3);
}
#[test, expected_failure(abort_code = 3303, location = aresrpg_math::tournament_bracket)]
fun percentages_must_have_five_places() { bracket::validate_bps(&vector[]); }
#[test, expected_failure(abort_code = 3303, location = aresrpg_math::tournament_bracket)]
fun percentages_cannot_exceed_one_hundred() { bracket::validate_bps(&vector[10001,0,0,0,0]); }
#[test, expected_failure(abort_code = 3303, location = aresrpg_math::tournament_bracket)]
fun percentages_must_allocate_the_whole_pool() { bracket::validate_bps(&vector[1,0,0,0,0]); }

#[test]
fun an_unstarted_bracket_is_empty() { assert!(bracket::empty().is_empty(), 0); }
#[test, expected_failure(abort_code = 3301, location = aresrpg_math::tournament_bracket)]
fun one_team_is_not_a_competition() { let _ = bracket::new(entrants(1), 1); }
#[test, expected_failure(abort_code = 3301, location = aresrpg_math::tournament_bracket)]
fun availability_requires_chain_time() { let _ = bracket::new(entrants(2), 0); }
#[test, expected_failure(abort_code = 3302, location = aresrpg_math::tournament_bracket)]
fun unfinished_brackets_cannot_assign_prizes() { let m = bracket::new(entrants(2), 1); let _ = bracket::placement(&m, 0); }
#[test, expected_failure(abort_code = 3301, location = aresrpg_math::tournament_bracket)]
fun a_match_has_only_two_sides() { let m = bracket::new(entrants(2), 1); let _ = bracket::team(&m[0], 2); }

#[test]
fun immutable_settings_accept_supported_formats_and_optional_registration_levels() {
  assert!(bracket::valid_settings(1, 1, 0, 2, 1, &option::none()), 0);
  assert!(bracket::valid_settings(3, 80, 10, 2, 1, &option::some(1)), 1);
  assert!(bracket::valid_settings(6, 80, 10, 2, 1, &option::some(200)), 2);
  assert!(!bracket::valid_settings(2, 1, 0, 2, 1, &option::none()), 3);
  assert!(!bracket::valid_settings(1, 0, 0, 2, 1, &option::none()), 4);
  assert!(!bracket::valid_settings(1, 81, 0, 2, 1, &option::none()), 5);
  assert!(!bracket::valid_settings(1, 1, 11, 2, 1, &option::none()), 6);
  assert!(!bracket::valid_settings(1, 1, 0, 1, 1, &option::none()), 7);
  assert!(!bracket::valid_settings(1, 1, 0, 2, 1, &option::some(0)), 8);
  assert!(!bracket::valid_settings(1, 1, 0, 2, 1, &option::some(201)), 9);
}
